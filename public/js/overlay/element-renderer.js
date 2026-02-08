/**
 * Element renderer.
 *
 * Creates absolutely-positioned DOM elements from template element definitions.
 * Supports types: text, image, shape, data.
 */

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
  }

  // ── Rotation ──
  if (element.rotation) {
    wrapper.style.transform = `rotate(${element.rotation}deg)`;
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

    default:
      console.warn(`[element-renderer] Unknown element type: "${element.type}"`);
  }

  // ── Fit text (auto-shrink) ──
  if (element.fitText && (element.type === 'text' || element.type === 'data')) {
    wrapper.dataset.fitText = 'true';
    wrapper.dataset.maxFontSize = String(element.fontSize || 24);
    // Run fit after DOM insertion via MutationObserver or rAF
    requestAnimationFrame(() => fitTextToElement(wrapper));
  }

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
  wrapper.style.flexWrap       = 'nowrap';

  // Font properties
  if (element.fontFamily)  wrapper.style.fontFamily  = element.fontFamily;
  if (element.fontSize)    wrapper.style.fontSize    = toPx(element.fontSize);
  if (element.fontWeight)  wrapper.style.fontWeight  = String(element.fontWeight);
  if (element.fontStyle)   wrapper.style.fontStyle   = element.fontStyle;
  if (element.lineHeight)  wrapper.style.lineHeight  = String(element.lineHeight);
  if (element.letterSpacing) wrapper.style.letterSpacing = toPx(element.letterSpacing);

  // Color
  if (element.color)           wrapper.style.color           = element.color;
  if (element.backgroundColor) wrapper.style.backgroundColor = element.backgroundColor;

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
function fitTextToElement(el) {
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
