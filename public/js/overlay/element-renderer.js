/**
 * Element renderer.
 *
 * Creates absolutely-positioned DOM elements from template element definitions.
 * Supports types: text, image, shape, data, arcGauge, barGauge, ringSegment.
 */

import {
  buildArcGaugeSvg,
  buildBarGauge,
  buildRingSegmentSvg,
  updateArcGaugeFill,
  updateBarGaugeFill,
  updateRingSegmentFill,
  gaugePercent,
} from '/js/shared/svg-gauge-utils.js';
import { createScene3D } from '/js/shared/scene3d-utils.js';

/**
 * Render a single overlay element from its template definition.
 *
 * @param {Object} element       - The element definition from the template.
 * @param {Object} referenceData - Reference data for resolving image bindings, etc.
 * @returns {HTMLElement}         The constructed DOM element.
 */
export function renderElement(element, referenceData = {}) {
  const wrapper = document.createElement('div');

  // ── Position & sizing (percentage-based) ──
  wrapper.style.position = 'absolute';
  wrapper.style.left     = pct(element.left);
  wrapper.style.top      = pct(element.top);
  wrapper.style.width    = pct(element.width);
  wrapper.style.height   = pct(element.height);

  // ── Opacity ──
  if (element.opacity !== undefined && element.opacity !== null) {
    wrapper.style.opacity = String(element.opacity);
    wrapper.dataset.baseOpacity = String(element.opacity);
  }

  // ── Transform (rotation + 3D) ──
  {
    const transforms = [];
    if (element.rotation)  transforms.push(`rotate(${element.rotation}deg)`);
    if (element.rotationX) transforms.push(`rotateX(${element.rotationX}deg)`);
    if (element.rotationY) transforms.push(`rotateY(${element.rotationY}deg)`);
    if (element.z)         transforms.push(`translateZ(${element.z}px)`);
    if (transforms.length) {
      const baseTransform = transforms.join(' ');
      wrapper.style.transform = baseTransform;
      wrapper.dataset.baseTransform = baseTransform;
    }
  }

  // ── 3D perspective ──
  if (element.perspective) {
    wrapper.style.perspective = `${element.perspective}px`;
    wrapper.style.transformStyle = 'preserve-3d';
  }

  // ── z-index ──
  if (element.zIndex !== undefined) {
    wrapper.style.zIndex = String(element.zIndex);
  }

  // ── Overflow hidden by default ──
  wrapper.style.overflow = 'hidden';

  // ── CSS containment for render performance (guide §18.1) ──
  // Layout, style, and paint are independent of siblings — enables
  // per-element rendering optimization at broadcast frame rates.
  wrapper.style.contain = 'layout style paint';

  // ── Type-specific rendering ──
  switch (element.type) {
    case 'text':
      renderText(wrapper, element);
      break;

    case 'image':
      renderImage(wrapper, element, referenceData);
      break;

    case 'shape':
      renderShape(wrapper, element);
      break;

    case 'data':
      renderData(wrapper, element);
      break;

    case 'arcGauge':
      renderArcGauge(wrapper, element);
      break;

    case 'barGauge':
      renderBarGauge(wrapper, element);
      break;

    case 'ringSegment':
      renderRingSegment(wrapper, element);
      break;

    case 'scene3d':
      renderScene3d(wrapper, element);
      break;

    default:
      console.warn(`[element-renderer] Unknown element type: "${element.type}"`);
  }

  // ── Overflow override (textbox clipping) ──
  if (element.overflow) {
    wrapper.style.overflow = element.overflow;
  }

  // ── Fit text (auto-shrink) ──
  if (element.fitText && (element.type === 'text' || element.type === 'data')) {
    wrapper.dataset.fitText = 'true';
    wrapper.dataset.maxFontSize = String(element.fontSize || 24);
    // Run fit after DOM insertion via MutationObserver or rAF
    requestAnimationFrame(() => fitTextToElement(wrapper));
  }

  // Store the computed display value so animations can restore it
  // (text/data use 'flex' for alignment; clearing to '' breaks justifyContent/alignItems)
  wrapper.dataset.baseDisplay = wrapper.style.display || '';

  // Enter animations are handled by GsapAnimationEngine — no CSS classes needed

  return wrapper;
}

// ---------------------------------------------------------------------------
// Type renderers
// ---------------------------------------------------------------------------

/**
 * Render a static text element.
 */
function renderText(wrapper, element) {
  applyTextStyles(wrapper, element);
  wrapper.textContent = element.text || '';
}

/**
 * Render an image element.
 */
function renderImage(wrapper, element, referenceData) {
  const img = document.createElement('img');
  img.style.width  = '100%';
  img.style.height = '100%';

  // Object-fit
  img.style.objectFit = element.objectFit || 'contain';

  // Resolve src: could be a direct URL or a referenceData binding
  let src = element.src || '';
  if (element.imageBinding && referenceData.images) {
    const resolved = referenceData.images[element.imageBinding];
    if (resolved) {
      src = resolved;
    }
  }
  img.src = src;
  img.alt = element.alt || '';

  // Prevent drag
  img.draggable = false;

  // Blend mode
  if (element.blendMode && element.blendMode !== 'normal') {
    wrapper.style.mixBlendMode = element.blendMode;
  }

  wrapper.appendChild(img);
}

/**
 * Render a shape element (rectangle, rounded-rect, circle, etc.).
 */
function renderShape(wrapper, element) {
  // Fill
  if (element.gradient) {
    wrapper.style.background = `linear-gradient(${element.gradient})`;
  } else if (element.fill) {
    wrapper.style.backgroundColor = element.fill;
  }

  // Stroke / border
  if (element.stroke) {
    const strokeWidth = element.strokeWidth || 1;
    wrapper.style.border = `${strokeWidth}px solid ${element.stroke}`;
  }

  // Border radius
  if (element.borderRadius !== undefined) {
    wrapper.style.borderRadius = toPx(element.borderRadius);
  }

  // Box shadow
  if (element.boxShadow) {
    wrapper.style.boxShadow = element.boxShadow;
  }

  // Blend mode
  if (element.blendMode && element.blendMode !== 'normal') {
    wrapper.style.mixBlendMode = element.blendMode;
  }
}

/**
 * Render a data-bound element (same visual as text, but with binding attributes).
 */
function renderData(wrapper, element) {
  // Apply the same text styles as a text element
  applyTextStyles(wrapper, element);

  // Tabular-nums for consistent digit widths in timing/telemetry data
  // Prevents layout shift when numbers change (guide §10, §12)
  wrapper.style.fontVariantNumeric = 'tabular-nums';

  // Data-binding attributes
  if (element.source)   wrapper.setAttribute('data-source', element.source);
  if (element.field)    wrapper.setAttribute('data-field', element.field);
  if (element.car)      wrapper.setAttribute('data-car', element.car);
  if (element.format)   wrapper.setAttribute('data-format', element.format);
  if (element.prefix)   wrapper.setAttribute('data-prefix', element.prefix);
  if (element.suffix)   wrapper.setAttribute('data-suffix', element.suffix);
  if (element.fallback) wrapper.setAttribute('data-fallback', element.fallback);

  // Show fallback text initially
  wrapper.textContent = element.fallback || '';
}

// ---------------------------------------------------------------------------
// Gauge renderers
// ---------------------------------------------------------------------------

/**
 * Render an arc gauge element.
 */
function renderArcGauge(wrapper, element) {
  const w = 200; // SVG viewbox-based, scales to 100% via viewBox
  const h = 200;
  const svg = buildArcGaugeSvg(w, h, element, 0); // Start at 0 fill
  wrapper.appendChild(svg);

  // Store gauge config as data attributes for live updates
  wrapper.setAttribute('data-gauge-type', 'arc');
  wrapper.setAttribute('data-min', String(element.min ?? 0));
  wrapper.setAttribute('data-max', String(element.max ?? 100));

  // Data-binding attributes
  if (element.source)      wrapper.setAttribute('data-source', element.source);
  if (element.field)       wrapper.setAttribute('data-field', element.field);
  if (element.car)         wrapper.setAttribute('data-car', element.car);
  if (element.smoothing)   wrapper.setAttribute('data-smoothing', String(element.smoothing));
}

/**
 * Render a bar gauge element.
 */
function renderBarGauge(wrapper, element) {
  const bar = buildBarGauge(200, 200, element, 0); // Start at 0 fill
  wrapper.appendChild(bar);

  wrapper.setAttribute('data-gauge-type', 'bar');
  wrapper.setAttribute('data-min', String(element.min ?? 0));
  wrapper.setAttribute('data-max', String(element.max ?? 100));

  if (element.source)      wrapper.setAttribute('data-source', element.source);
  if (element.field)       wrapper.setAttribute('data-field', element.field);
  if (element.car)         wrapper.setAttribute('data-car', element.car);
  if (element.smoothing)   wrapper.setAttribute('data-smoothing', String(element.smoothing));
}

/**
 * Render a ring segment gauge element.
 */
function renderRingSegment(wrapper, element) {
  const svg = buildRingSegmentSvg(200, 200, element, 0); // Start at 0 fill
  wrapper.appendChild(svg);

  wrapper.setAttribute('data-gauge-type', 'ringSegment');
  wrapper.setAttribute('data-min', String(element.min ?? 0));
  wrapper.setAttribute('data-max', String(element.max ?? 100));

  if (element.source)      wrapper.setAttribute('data-source', element.source);
  if (element.field)       wrapper.setAttribute('data-field', element.field);
  if (element.car)         wrapper.setAttribute('data-car', element.car);
  if (element.smoothing)   wrapper.setAttribute('data-smoothing', String(element.smoothing));
}

// ---------------------------------------------------------------------------
// Scene3D renderer
// ---------------------------------------------------------------------------

/**
 * Render a Three.js 3D scene element.
 */
function renderScene3d(wrapper, element) {
  wrapper.style.overflow = 'hidden';
  // Scene3D controller will be created after DOM insertion (needs dimensions)
  wrapper.setAttribute('data-scene3d-type', element.subType || 'text3d');

  // Data-binding attributes
  if (element.source) wrapper.setAttribute('data-source', element.source);
  if (element.field)  wrapper.setAttribute('data-field', element.field);
  if (element.car)    wrapper.setAttribute('data-car', element.car);

  // Defer scene creation to after DOM insertion so container has dimensions
  requestAnimationFrame(() => {
    const ctrl = createScene3D(wrapper, element);
    wrapper.__scene3dController = ctrl;
  });
}

/**
 * Update a scene3d element from data binding.
 *
 * @param {HTMLElement} domNode  - The scene3d wrapper DOM node.
 * @param {string}     property - The property to update (e.g. 'rotation', 'scale', 'particleColor').
 * @param {*}          value    - The value to set.
 */
export function updateScene3dValue(domNode, property, value) {
  if (!domNode || !domNode.__scene3dController) return;
  domNode.__scene3dController.setBindingValue(property, value);
}

/**
 * Update a gauge element's visual fill from a numeric value.
 *
 * @param {HTMLElement} domNode - The gauge wrapper DOM node.
 * @param {number}      value  - The raw numeric value.
 * @param {object}      element - The template element definition.
 */
export function updateGaugeValue(domNode, value, element) {
  if (!domNode) return;

  const min = element.min ?? parseFloat(domNode.getAttribute('data-min')) ?? 0;
  const max = element.max ?? parseFloat(domNode.getAttribute('data-max')) ?? 100;
  const pct = gaugePercent(value, min, max);

  const gaugeType = domNode.getAttribute('data-gauge-type');

  switch (gaugeType) {
    case 'arc':
      updateArcGaugeFill(domNode, pct, element);
      break;
    case 'bar':
      updateBarGaugeFill(domNode, pct, element);
      break;
    case 'ringSegment':
      updateRingSegmentFill(domNode, pct, element);
      break;
  }
}

// ---------------------------------------------------------------------------
// Shared style helpers
// ---------------------------------------------------------------------------

/**
 * Apply text-related styles to a wrapper element.
 * Uses flexbox for vertical alignment support.
 */
function applyTextStyles(wrapper, element) {
  // Use flexbox for alignment control
  wrapper.style.display        = 'flex';
  wrapper.style.alignItems     = mapVerticalAlign(element.verticalAlign);
  wrapper.style.justifyContent = mapTextAlign(element.textAlign);
  wrapper.style.textAlign      = element.textAlign || 'left';
  wrapper.style.flexWrap       = 'nowrap';

  // Font properties
  if (element.fontFamily)  wrapper.style.fontFamily  = element.fontFamily;
  if (element.fontSize)    wrapper.style.fontSize    = toPx(element.fontSize);
  if (element.fontWeight)  wrapper.style.fontWeight  = String(element.fontWeight);
  if (element.fontStyle)   wrapper.style.fontStyle   = element.fontStyle;
  if (element.lineHeight)  wrapper.style.lineHeight  = String(element.lineHeight);
  if (element.letterSpacing) wrapper.style.letterSpacing = toPx(element.letterSpacing);

  // Color (fallback to white — overlay has transparent background so black is invisible)
  const baseColor = element.color || '#FFFFFF';
  wrapper.style.color = baseColor;
  wrapper.dataset.baseColor = baseColor;
  if (element.backgroundColor) {
    wrapper.style.backgroundColor = element.backgroundColor;
    wrapper.dataset.baseBg = element.backgroundColor;
  }

  // Padding
  if (element.padding) {
    wrapper.style.padding = toPx(element.padding);
  }

  // Border radius
  if (element.borderRadius !== undefined) {
    wrapper.style.borderRadius = toPx(element.borderRadius);
  }

  // Text shadow
  if (element.textShadow) {
    wrapper.style.textShadow = element.textShadow;
    wrapper.dataset.baseTextShadow = element.textShadow;
  }

  // Webkit text stroke (outline text)
  if (element.webkitTextStroke) {
    wrapper.style.webkitTextStroke = element.webkitTextStroke;
  }

  // Text transform (uppercase, lowercase, capitalize)
  if (element.textTransform) {
    wrapper.style.textTransform = element.textTransform;
  }

  // White-space handling for single-line data
  wrapper.style.whiteSpace   = element.whiteSpace || 'nowrap';
  wrapper.style.textOverflow = 'ellipsis';
}

/**
 * Map a verticalAlign value to a flexbox align-items value.
 */
function mapVerticalAlign(val) {
  switch (val) {
    case 'top':    return 'flex-start';
    case 'bottom': return 'flex-end';
    case 'middle':
    case 'center':
    default:       return 'center';
  }
}

/**
 * Map a textAlign value to a flexbox justify-content value.
 */
function mapTextAlign(val) {
  switch (val) {
    case 'left':   return 'flex-start';
    case 'right':  return 'flex-end';
    case 'center': return 'center';
    default:       return 'flex-start';
  }
}

// ---------------------------------------------------------------------------
// DOM-update helpers (exported for DataBinder)
// ---------------------------------------------------------------------------

/**
 * Update the text content of a data-bound element.
 *
 * @param {HTMLElement} domNode - The element to update.
 * @param {string}      value  - The formatted display value.
 */
export function updateElementText(domNode, value) {
  if (!domNode) return;
  domNode.textContent = value;

  // Re-run fit text if enabled
  if (domNode.dataset.fitText === 'true') {
    fitTextToElement(domNode);
  }
}

/**
 * Update inline styles on an element (used for conditional styling).
 *
 * @param {HTMLElement} domNode - The element to update.
 * @param {Object}      styles - A plain object of CSS property -> value pairs.
 */
export function updateElementStyle(domNode, styles) {
  if (!domNode || !styles) return;
  for (const [prop, val] of Object.entries(styles)) {
    domNode.style[prop] = val;
  }
}

// ---------------------------------------------------------------------------
// Tiny helpers
// ---------------------------------------------------------------------------

/**
 * Shrink font size until text fits within the element bounds.
 * @param {HTMLElement} el
 */
export function fitTextToElement(el) {
  const maxSize = parseInt(el.dataset.maxFontSize, 10) || 24;
  let size = maxSize;
  el.style.fontSize = `${size}px`;
  el.style.overflow = 'hidden';
  el.style.whiteSpace = 'nowrap';

  while (size > 6 && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)) {
    size--;
    el.style.fontSize = `${size}px`;
  }
}

/**
 * Convert a numeric value to a percentage string. Passes through strings as-is.
 */
function pct(val) {
  if (val === undefined || val === null) return '0%';
  if (typeof val === 'string') return val;
  return `${val}%`;
}

/**
 * Convert a numeric value to a pixel string. Passes through strings as-is.
 */
function toPx(val) {
  if (val === undefined || val === null) return '0px';
  if (typeof val === 'string') return val;
  return `${val}px`;
}
