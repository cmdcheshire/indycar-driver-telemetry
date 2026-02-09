/**
 * SVG gauge utility functions.
 * Shared between builder (canvas-engine) and overlay (element-renderer).
 *
 * Provides arc math, gauge percentage calculations, and color interpolation
 * for arc gauges, bar gauges, and ring segment gauges.
 */

// ---------------------------------------------------------------------------
// Arc math
// ---------------------------------------------------------------------------

/**
 * Compute the SVG arc path `d` attribute for a circular arc.
 *
 * @param {number} cx         - Center X
 * @param {number} cy         - Center Y
 * @param {number} radius     - Arc radius
 * @param {number} startAngle - Start angle in degrees (0 = top, clockwise)
 * @param {number} endAngle   - End angle in degrees
 * @returns {string} SVG path `d` attribute
 */
export function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = (endAngle - startAngle) <= 180 ? '0' : '1';
  return [
    'M', start.x, start.y,
    'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y,
  ].join(' ');
}

/**
 * Convert polar coordinates to Cartesian (SVG coordinate space).
 * 0° = 12 o'clock, increases clockwise.
 *
 * @param {number} cx     - Center X
 * @param {number} cy     - Center Y
 * @param {number} radius
 * @param {number} angleDeg - Angle in degrees
 * @returns {{ x: number, y: number }}
 */
export function polarToCartesian(cx, cy, radius, angleDeg) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

// ---------------------------------------------------------------------------
// Gauge percentage
// ---------------------------------------------------------------------------

/**
 * Compute the fill percentage (0–1) for a gauge value.
 *
 * @param {number} value - Current value
 * @param {number} min   - Minimum value
 * @param {number} max   - Maximum value
 * @returns {number} Clamped 0–1
 */
export function gaugePercent(value, min, max) {
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// ---------------------------------------------------------------------------
// Color interpolation (for ring segment color stops)
// ---------------------------------------------------------------------------

/**
 * Interpolate a color from an array of color stops based on a value.
 *
 * @param {number} value - The current value
 * @param {Array<{value: number, color: string}>} stops - Sorted color stops
 * @returns {string} Interpolated hex color
 */
export function interpolateColorStop(value, stops) {
  if (!stops || stops.length === 0) return '#ffffff';
  if (stops.length === 1) return stops[0].color;

  // Clamp to stop range
  if (value <= stops[0].value) return stops[0].color;
  if (value >= stops[stops.length - 1].value) return stops[stops.length - 1].color;

  // Find the two stops to interpolate between
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (value >= a.value && value <= b.value) {
      const t = (value - a.value) / (b.value - a.value);
      return lerpColor(a.color, b.color, t);
    }
  }
  return stops[stops.length - 1].color;
}

/**
 * Linear interpolation between two hex colors.
 *
 * @param {string} colorA - Hex color (#RRGGBB)
 * @param {string} colorB - Hex color (#RRGGBB)
 * @param {number} t      - Interpolation factor 0–1
 * @returns {string} Interpolated hex color
 */
export function lerpColor(colorA, colorB, t) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  return rgbToHex(r, g, bl);
}

/**
 * Parse a hex color string to RGB components.
 * @param {string} hex - #RRGGBB or #RGB
 * @returns {{ r: number, g: number, b: number }}
 */
export function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.substring(0, 2), 16) || 0,
    g: parseInt(h.substring(2, 4), 16) || 0,
    b: parseInt(h.substring(4, 6), 16) || 0,
  };
}

/**
 * Convert RGB to hex string.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string} #RRGGBB
 */
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// SVG builders (used by both builder canvas-engine and overlay renderer)
// ---------------------------------------------------------------------------

/**
 * Build an arc gauge SVG element.
 *
 * @param {number} width     - Container width in px
 * @param {number} height    - Container height in px
 * @param {object} props     - Gauge properties
 * @param {number} [fillPct] - Override fill percentage (0–1)
 * @returns {SVGElement}
 */
export function buildArcGaugeSvg(width, height, props, fillPct) {
  const {
    startAngle = -135,
    endAngle = 135,
    thickness = 12,
    min = 0,
    max = 100,
    fillColor = '#00e676',
    bgColor = 'rgba(255,255,255,0.15)',
    _previewValue,
  } = props;

  const pct = fillPct !== undefined ? fillPct : gaugePercent(_previewValue ?? 50, min, max);
  const size = Math.min(width, height);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = (size / 2) - 2;
  const innerR = outerR - thickness;
  const midR = (outerR + innerR) / 2;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.overflow = 'visible';

  // Background arc
  const bgPath = document.createElementNS(ns, 'path');
  bgPath.setAttribute('d', describeArc(cx, cy, midR, startAngle, endAngle));
  bgPath.setAttribute('fill', 'none');
  bgPath.setAttribute('stroke', bgColor);
  bgPath.setAttribute('stroke-width', String(thickness));
  bgPath.setAttribute('stroke-linecap', 'round');
  svg.appendChild(bgPath);

  // Fill arc
  const fillAngle = startAngle + (endAngle - startAngle) * pct;
  if (pct > 0.001) {
    const fillPath = document.createElementNS(ns, 'path');
    fillPath.setAttribute('d', describeArc(cx, cy, midR, startAngle, fillAngle));
    fillPath.setAttribute('fill', 'none');
    fillPath.setAttribute('stroke', fillColor);
    fillPath.setAttribute('stroke-width', String(thickness));
    fillPath.setAttribute('stroke-linecap', 'round');
    fillPath.setAttribute('data-role', 'fill');
    svg.appendChild(fillPath);
  }

  return svg;
}

/**
 * Build a bar gauge DOM structure.
 *
 * @param {number} width     - Container width in px
 * @param {number} height    - Container height in px
 * @param {object} props     - Gauge properties
 * @param {number} [fillPct] - Override fill percentage (0–1)
 * @returns {HTMLElement}
 */
export function buildBarGauge(width, height, props, fillPct) {
  const {
    orientation = 'horizontal',
    min = 0,
    max = 100,
    fillColor = '#00e676',
    bgColor = 'rgba(255,255,255,0.15)',
    borderRadius = 0,
    _previewValue,
  } = props;

  const pct = fillPct !== undefined ? fillPct : gaugePercent(_previewValue ?? 50, min, max);

  const container = document.createElement('div');
  container.style.cssText = `
    width:100%; height:100%; position:relative;
    background:${bgColor}; border-radius:${borderRadius}px; overflow:hidden;
  `;

  const fill = document.createElement('div');
  fill.setAttribute('data-role', 'fill');
  fill.style.position = 'absolute';
  fill.style.backgroundColor = fillColor;
  fill.style.borderRadius = `${borderRadius}px`;
  fill.style.transition = 'none';

  if (orientation === 'vertical') {
    fill.style.bottom = '0';
    fill.style.left = '0';
    fill.style.width = '100%';
    fill.style.height = `${pct * 100}%`;
  } else {
    fill.style.top = '0';
    fill.style.left = '0';
    fill.style.height = '100%';
    fill.style.width = `${pct * 100}%`;
  }

  container.appendChild(fill);
  return container;
}

/**
 * Build a ring segment gauge SVG element.
 *
 * @param {number} width     - Container width in px
 * @param {number} height    - Container height in px
 * @param {object} props     - Gauge properties
 * @param {number} [fillPct] - Override fill percentage (0–1)
 * @returns {SVGElement}
 */
export function buildRingSegmentSvg(width, height, props, fillPct) {
  const {
    startAngle = -135,
    endAngle = 135,
    segments = 10,
    segmentGap = 3,
    thickness = 12,
    min = 0,
    max = 100,
    colorStops = [{ value: 0, color: '#00e676' }, { value: 100, color: '#ff5252' }],
    bgColor = 'rgba(255,255,255,0.15)',
    _previewValue,
  } = props;

  const pct = fillPct !== undefined ? fillPct : gaugePercent(_previewValue ?? 50, min, max);
  const size = Math.min(width, height);
  const cx = size / 2;
  const cy = size / 2;
  const outerR = (size / 2) - 2;
  const innerR = outerR - thickness;
  const midR = (outerR + innerR) / 2;

  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.overflow = 'visible';

  const totalAngle = endAngle - startAngle;
  const gapAngle = (segmentGap / (2 * Math.PI * midR)) * 360;
  const segAngle = (totalAngle - gapAngle * (segments - 1)) / segments;
  const activeSegments = Math.round(pct * segments);

  for (let i = 0; i < segments; i++) {
    const segStart = startAngle + i * (segAngle + gapAngle);
    const segEnd = segStart + segAngle;
    const isActive = i < activeSegments;

    const segValue = min + ((i + 0.5) / segments) * (max - min);
    const activeColor = interpolateColorStop(segValue, colorStops);

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', describeArc(cx, cy, midR, segStart, segEnd));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', isActive ? activeColor : bgColor);
    path.setAttribute('stroke-width', String(thickness));
    path.setAttribute('stroke-linecap', 'butt');
    path.setAttribute('data-segment', String(i));
    if (isActive) path.setAttribute('data-active', 'true');
    svg.appendChild(path);
  }

  return svg;
}

// ---------------------------------------------------------------------------
// DOM update helpers (used by overlay for live data)
// ---------------------------------------------------------------------------

/**
 * Update an arc gauge's fill level.
 *
 * @param {HTMLElement} wrapper  - The gauge wrapper DOM node
 * @param {number}      pct     - Fill percentage 0–1
 * @param {object}      props   - Gauge properties (startAngle, endAngle, etc.)
 */
export function updateArcGaugeFill(wrapper, pct, props) {
  const svg = wrapper.querySelector('svg');
  if (!svg) return;

  const fillPath = svg.querySelector('[data-role="fill"]');
  const { startAngle = -135, endAngle = 135, thickness = 12 } = props;

  const viewBox = svg.getAttribute('viewBox').split(' ').map(Number);
  const size = viewBox[2];
  const cx = size / 2;
  const cy = size / 2;
  const outerR = (size / 2) - 2;
  const innerR = outerR - thickness;
  const midR = (outerR + innerR) / 2;

  const fillAngle = startAngle + (endAngle - startAngle) * pct;

  if (pct <= 0.001) {
    if (fillPath) fillPath.setAttribute('d', '');
    return;
  }

  const d = describeArc(cx, cy, midR, startAngle, fillAngle);
  if (fillPath) {
    fillPath.setAttribute('d', d);
  } else {
    // Create fill path if it doesn't exist
    const ns = 'http://www.w3.org/2000/svg';
    const newFill = document.createElementNS(ns, 'path');
    newFill.setAttribute('d', d);
    newFill.setAttribute('fill', 'none');
    newFill.setAttribute('stroke', props.fillColor || '#00e676');
    newFill.setAttribute('stroke-width', String(thickness));
    newFill.setAttribute('stroke-linecap', 'round');
    newFill.setAttribute('data-role', 'fill');
    svg.appendChild(newFill);
  }
}

/**
 * Update a bar gauge's fill level.
 *
 * @param {HTMLElement} wrapper     - The gauge wrapper DOM node
 * @param {number}      pct        - Fill percentage 0–1
 * @param {object}      props      - Gauge properties (orientation)
 */
export function updateBarGaugeFill(wrapper, pct, props) {
  const fill = wrapper.querySelector('[data-role="fill"]');
  if (!fill) return;

  const { orientation = 'horizontal' } = props;
  if (orientation === 'vertical') {
    fill.style.height = `${pct * 100}%`;
  } else {
    fill.style.width = `${pct * 100}%`;
  }
}

/**
 * Update a ring segment gauge's active segments.
 *
 * @param {HTMLElement} wrapper  - The gauge wrapper DOM node
 * @param {number}      pct     - Fill percentage 0–1
 * @param {object}      props   - Gauge properties (segments, colorStops, etc.)
 */
export function updateRingSegmentFill(wrapper, pct, props) {
  const svg = wrapper.querySelector('svg');
  if (!svg) return;

  const {
    segments = 10,
    min = 0,
    max = 100,
    colorStops = [{ value: 0, color: '#00e676' }, { value: 100, color: '#ff5252' }],
    bgColor = 'rgba(255,255,255,0.15)',
  } = props;

  const activeSegments = Math.round(pct * segments);
  const paths = svg.querySelectorAll('[data-segment]');

  paths.forEach(path => {
    const idx = parseInt(path.getAttribute('data-segment'), 10);
    const isActive = idx < activeSegments;
    const segValue = min + ((idx + 0.5) / segments) * (max - min);
    path.setAttribute('stroke', isActive ? interpolateColorStop(segValue, colorStops) : bgColor);
    if (isActive) {
      path.setAttribute('data-active', 'true');
    } else {
      path.removeAttribute('data-active');
    }
  });
}
