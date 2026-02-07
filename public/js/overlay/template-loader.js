/**
 * Template loader.
 *
 * Receives a template definition (JSON) and builds the overlay DOM inside a
 * given root element. Returns a map of element ID -> DOM node so that other
 * modules (DataBinder, AnimationEngine) can target specific elements.
 */

import { renderElement } from './element-renderer.js';

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

  console.log(`[template-loader] Built ${domMap.size} elements`);
  return domMap;
}
