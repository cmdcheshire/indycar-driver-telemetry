/**
 * Template loader.
 *
 * Receives a template definition (JSON) and builds the overlay DOM inside a
 * given root element. Returns a map of element ID -> DOM node so that other
 * modules (DataBinder, AnimationEngine) can target specific elements.
 */

import { renderElement } from './element-renderer.js';
import { migrateEasing } from '/js/shared/animation-presets.js';
import { computeClipPath } from '/js/shared/clip-path.js';

/**
 * Normalize a builder element into the flat format the renderer/binder expect.
 *
 * Builder format:  { x, y, width, height, props: { text, color, bindingSource, ... } }
 * Renderer format: { left, top, width, height, text, color, source, ... }
 */
function normalizeElement(el) {
  // If there's no nested props, assume it's already in renderer format
  if (!el.props) return el;

  // Spread props onto the top level (props values override top-level if collisions)
  const flat = { ...el, ...el.props };

  // Map builder position names to renderer names
  if (flat.x !== undefined && flat.left === undefined) flat.left = flat.x;
  if (flat.y !== undefined && flat.top === undefined)  flat.top  = flat.y;

  // Map builder prop names to renderer/binder prop names
  if (flat.bindingSource !== undefined && flat.source === undefined) flat.source = flat.bindingSource;
  if (flat.bindingField  !== undefined && flat.field  === undefined) flat.field  = flat.bindingField;
  if (flat.carSelector   !== undefined && flat.car    === undefined) flat.car    = flat.carSelector;
  if (flat.fit           !== undefined && flat.objectFit === undefined) flat.objectFit = flat.fit;
  if (flat.strokeColor   !== undefined && flat.stroke === undefined) flat.stroke = flat.strokeColor;
  if (flat.textStroke    !== undefined && flat.webkitTextStroke === undefined) flat.webkitTextStroke = flat.textStroke;
  if (flat.conditionalStyles !== undefined && flat.conditions === undefined) flat.conditions = flat.conditionalStyles;

  // Flatten animation object into top-level animation props for the renderer/binder
  if (flat.animation && typeof flat.animation === 'object') {
    const anim = flat.animation;
    if (anim.enter) {
      if (anim.enter.type)     flat.enterAnimation         = anim.enter.type;
      if (anim.enter.duration) flat.enterAnimationDuration  = anim.enter.duration;
      if (anim.enter.delay != null) flat.enterAnimationDelay = anim.enter.delay;
      if (anim.enter.easing)   flat.enterAnimationEasing    = migrateEasing(anim.enter.easing);
    }
    if (anim.exit) {
      if (anim.exit.type)     flat.exitAnimation         = anim.exit.type;
      if (anim.exit.duration) flat.exitAnimationDuration  = anim.exit.duration;
      if (anim.exit.delay != null) flat.exitAnimationDelay = anim.exit.delay;
      if (anim.exit.easing)   flat.exitAnimationEasing    = migrateEasing(anim.exit.easing);
    }
    if (anim.update) {
      if (anim.update.type)     flat.updateAnimation         = anim.update.type;
      if (anim.update.duration) flat.updateAnimationDuration  = anim.update.duration;
    }
    if (anim.emphasis) {
      if (anim.emphasis.type)     flat.emphasisType     = anim.emphasis.type;
      if (anim.emphasis.duration) flat.emphasisDuration  = anim.emphasis.duration;
      if (anim.emphasis.trigger)  flat.emphasisTrigger   = anim.emphasis.trigger;
      if (anim.emphasis.repeat != null) flat.emphasisRepeat = anim.emphasis.repeat;
    }
    // Pass through keyframe animation data (advanced choreography)
    // New: separate enter/exit keyframes
    if (anim.enterKeyframes) {
      flat.enterKeyframeAnimation = anim.enterKeyframes;
    } else if (anim.keyframes) {
      // Legacy migration: old single keyframes → enter
      flat.enterKeyframeAnimation = anim.keyframes;
    }
    if (anim.exitKeyframes) {
      flat.exitKeyframeAnimation = anim.exitKeyframes;
    }
    // Keep legacy field for backward compatibility during transition
    if (anim.keyframes) {
      flat.keyframeAnimation = anim.keyframes;
    }
  }

  return flat;
}

/**
 * Normalize all elements in a template definition.
 * Returns a new array of normalized elements (does not mutate the originals).
 *
 * @param {Object[]} elements - Raw elements from the template.
 * @returns {Object[]} Normalized elements.
 */
export function normalizeElements(elements) {
  if (!Array.isArray(elements)) return [];
  return elements.map(normalizeElement);
}

/**
 * Build the overlay DOM from a template definition.
 *
 * @param {HTMLElement}  rootEl        - The #overlay-root container.
 * @param {Object}       template      - The template definition object.
 * @param {Object}       referenceData - Reference data (images, driver info, etc.).
 * @returns {Map<string, HTMLElement>}  Map of element.id -> DOM node.
 */
export function buildOverlay(rootEl, template, referenceData = {}) {
  const domMap = new Map();

  if (!template || !Array.isArray(template.elements)) {
    console.warn('[template-loader] Template has no elements array');
    return domMap;
  }

  for (const element of template.elements) {
    if (!element.id) {
      console.warn('[template-loader] Skipping element with no id:', element);
      continue;
    }

    try {
      const domNode = renderElement(element, referenceData);

      if (domNode) {
        domNode.setAttribute('data-element-id', element.id);
        rootEl.appendChild(domNode);
        domMap.set(element.id, domNode);
      }
    } catch (err) {
      console.error(`[template-loader] Failed to render element "${element.id}":`, err);
    }
  }

  // Apply clip-paths after all elements are rendered
  _applyClipPaths(template.elements, domMap);

  console.log(`[template-loader] Built ${domMap.size} elements`);
  return domMap;
}

/**
 * Apply CSS clip-path to elements that have a clipMask reference.
 * Also hide mask elements flagged with hideMask.
 * @param {Object[]} elements - Normalized element definitions
 * @param {Map<string, HTMLElement>} domMap - Element ID -> DOM node map
 */
function _applyClipPaths(elements, domMap) {
  if (!Array.isArray(elements)) return;

  const elementMap = new Map();
  for (const el of elements) {
    elementMap.set(el.id, el);
  }

  for (const el of elements) {
    if (!el.clipMask?.elementId) continue;

    const maskEl = elementMap.get(el.clipMask.elementId);
    const domNode = domMap.get(el.id);
    if (!maskEl || !domNode) continue;

    // computeClipPath expects { x, y, width, height }
    // Normalized elements use left/top, so map back to x/y
    const clippedBounds = {
      x: el.left ?? el.x,
      y: el.top ?? el.y,
      width: el.width,
      height: el.height,
    };
    const maskBounds = {
      x: maskEl.left ?? maskEl.x,
      y: maskEl.top ?? maskEl.y,
      width: maskEl.width,
      height: maskEl.height,
      shapeType: maskEl.shapeType,
      borderRadius: maskEl.borderRadius,
    };

    const clipPath = computeClipPath(clippedBounds, maskBounds);
    console.log(`[template-loader] clipMask: ${el.id} → mask=${el.clipMask.elementId}, clipPath=${clipPath}`);
    if (clipPath) {
      domNode.style.clipPath = clipPath;
      // Store mask clip-path so the animation engine can restore it after clearProps
      domNode.dataset.maskClipPath = clipPath;
    }

    // Hide mask element if flagged
    if (el.clipMask.hideMask) {
      const maskDom = domMap.get(el.clipMask.elementId);
      if (maskDom) {
        maskDom.style.display = 'none';
        // Mark as intentionally hidden so TAKE ON display restoration skips it
        maskDom.dataset.maskHidden = 'true';
      }
    }
  }
}
