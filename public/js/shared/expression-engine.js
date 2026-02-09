/**
 * Expression engine for universal visual bindings.
 *
 * Provides:
 *  - BINDABLE_PROPERTIES registry (what CSS/GSAP properties can be data-driven)
 *  - Range mapping (linear input→output)
 *  - Color range interpolation
 *  - Expression compilation (simple + advanced modes)
 *  - Template string evaluation
 *  - Single-binding resolution
 */

import { interpolateColorStop } from './svg-gauge-utils.js';

// ---------------------------------------------------------------------------
// Bindable properties registry
// ---------------------------------------------------------------------------

/**
 * Registry of properties that can be targets for data bindings.
 * Each entry defines the property type, CSS key, unit, and value range.
 */
export const BINDABLE_PROPERTIES = {
  // Number properties (CSS/GSAP)
  opacity:         { type: 'number', css: 'opacity',         unit: '',   min: 0, max: 1,    label: 'Opacity' },
  x:               { type: 'number', css: null, gsap: 'x',   unit: '%',  min: -100, max: 100, label: 'X Position' },
  y:               { type: 'number', css: null, gsap: 'y',   unit: '%',  min: -100, max: 100, label: 'Y Position' },
  width:           { type: 'number', css: 'width',           unit: '%',  min: 0, max: 100,  label: 'Width' },
  height:          { type: 'number', css: 'height',          unit: '%',  min: 0, max: 100,  label: 'Height' },
  rotation:        { type: 'number', css: null, gsap: 'rotation',  unit: 'deg', min: -360, max: 360, label: 'Rotation' },
  rotationX:       { type: 'number', css: null, gsap: 'rotationX', unit: 'deg', min: -360, max: 360, label: 'Rotation X' },
  rotationY:       { type: 'number', css: null, gsap: 'rotationY', unit: 'deg', min: -360, max: 360, label: 'Rotation Y' },
  z:               { type: 'number', css: null, gsap: 'z',        unit: 'px', min: -500, max: 500, label: 'Z Depth' },
  scale:           { type: 'number', css: null, gsap: 'scale',    unit: '',   min: 0, max: 5, label: 'Scale' },
  fontSize:        { type: 'number', css: 'fontSize',        unit: 'px', min: 1, max: 500,  label: 'Font Size' },
  borderRadius:    { type: 'number', css: 'borderRadius',    unit: 'px', min: 0, max: 500,  label: 'Border Radius' },
  letterSpacing:   { type: 'number', css: 'letterSpacing',   unit: 'px', min: -10, max: 50, label: 'Letter Spacing' },
  blur:            { type: 'number', css: null, filter: 'blur', unit: 'px', min: 0, max: 100, label: 'Blur' },

  // Color properties
  color:           { type: 'color', css: 'color',            label: 'Text Color' },
  backgroundColor: { type: 'color', css: 'backgroundColor',  label: 'Background Color' },

  // Boolean properties
  visibility:      { type: 'boolean', css: 'display',        label: 'Visibility' },
};

// ---------------------------------------------------------------------------
// Range evaluation
// ---------------------------------------------------------------------------

/**
 * Linear mapping from input range to output range with optional clamp.
 *
 * @param {number} value    - The input value
 * @param {object} range    - { inputMin, inputMax, outputMin, outputMax, clamp }
 * @returns {number}
 */
export function evaluateRange(value, range) {
  const { inputMin = 0, inputMax = 100, outputMin = 0, outputMax = 1, clamp = true } = range;

  if (inputMax === inputMin) return outputMin;

  let t = (value - inputMin) / (inputMax - inputMin);

  if (clamp) {
    t = Math.max(0, Math.min(1, t));
  }

  return outputMin + t * (outputMax - outputMin);
}

// ---------------------------------------------------------------------------
// Color range evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a color range — maps a numeric value to an interpolated color.
 * Reuses interpolateColorStop from svg-gauge-utils.js.
 *
 * @param {number} value - The input value
 * @param {Array<{value: number, color: string}>} stops - Color stops
 * @returns {string} Hex color
 */
export function evaluateColorRange(value, stops) {
  return interpolateColorStop(value, stops);
}

// ---------------------------------------------------------------------------
// Expression compilation
// ---------------------------------------------------------------------------

/** Cache compiled expressions by binding ID */
const _compiledCache = new Map();

/** Allowed Math functions available in expressions */
const MATH_FNS = ['round', 'floor', 'ceil', 'abs', 'min', 'max', 'pow', 'sqrt', 'log', 'sign'];

/** Forbidden patterns — reject dangerous tokens */
const FORBIDDEN_RE = /\b(window|document|globalThis|eval|Function|fetch|XMLHttpRequest|import|require|process|__proto__|constructor|prototype)\b/;

/**
 * Compile an expression string into a callable function.
 *
 * Simple mode: arithmetic, comparisons, ternary, Math helpers
 * Advanced mode: same + string methods, nested access, multi-statement
 *
 * @param {string}  expr     - The expression string
 * @param {string}  bindingId - Unique ID for cache key
 * @param {boolean} advanced - Enable advanced mode
 * @returns {Function|null} (dataContext) => result, or null if invalid
 */
export function compileExpression(expr, bindingId, advanced = false) {
  if (!expr || typeof expr !== 'string') return null;

  const cacheKey = `${bindingId}:${expr}:${advanced}`;
  if (_compiledCache.has(cacheKey)) return _compiledCache.get(cacheKey);

  // Security check
  if (FORBIDDEN_RE.test(expr)) {
    console.warn('[expression-engine] Rejected expression with forbidden token:', expr);
    _compiledCache.set(cacheKey, null);
    return null;
  }

  try {
    // Build the function body
    // All data fields are available as direct variables via destructuring
    const mathScope = MATH_FNS.map(fn => `const ${fn} = Math.${fn};`).join('\n');

    let body;
    if (advanced) {
      // Advanced: multi-statement, last expression is return value
      body = `
        ${mathScope}
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const lerp = (a, b, t) => a + (b - a) * t;
        const map = (v, inMin, inMax, outMin, outMax) => outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
        with (data) {
          ${expr}
        }
      `;
    } else {
      // Simple: single expression, auto-return
      body = `
        ${mathScope}
        const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const lerp = (a, b, t) => a + (b - a) * t;
        const map = (v, inMin, inMax, outMin, outMax) => outMin + ((v - inMin) / (inMax - inMin)) * (outMax - outMin);
        with (data) {
          return (${expr});
        }
      `;
    }

    const fn = new Function('data', body);

    // Wrap to catch runtime errors gracefully
    const safeFn = (dataContext) => {
      try {
        return fn(dataContext || {});
      } catch (e) {
        return undefined;
      }
    };

    _compiledCache.set(cacheKey, safeFn);
    return safeFn;
  } catch (e) {
    console.warn('[expression-engine] Failed to compile expression:', expr, e.message);
    _compiledCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Clear the compiled expression cache (e.g. when template changes).
 */
export function clearExpressionCache() {
  _compiledCache.clear();
}

// ---------------------------------------------------------------------------
// Template string evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a format template string with data interpolation.
 * Tokens like {speed} are replaced with values from the data context.
 *
 * @param {string} template    - e.g. "{speed} MPH"
 * @param {object} dataContext - { speed: 215, rpm: 12000, ... }
 * @returns {string}
 */
export function evaluateTemplate(template, dataContext) {
  if (!template || typeof template !== 'string') return '';
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const val = dataContext[key];
    return val !== undefined && val !== null ? String(val) : '';
  });
}

// ---------------------------------------------------------------------------
// Single binding resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a single binding to its output value.
 *
 * @param {object}   binding      - The binding definition
 * @param {*}        rawValue     - The raw data value from the source
 * @param {object}   dataContext  - Full data context for expression evaluation
 * @param {object}   prevSmooth   - Previous smoothed value (mutated for EMA)
 * @returns {*} The resolved value (number, color string, or boolean)
 */
export function resolveBinding(binding, rawValue, dataContext, prevSmooth) {
  const { mode, target } = binding;
  const propDef = BINDABLE_PROPERTIES[target];
  if (!propDef) return undefined;

  let value;

  switch (mode) {
    case 'range': {
      const num = parseFloat(rawValue);
      if (isNaN(num)) return undefined;
      value = evaluateRange(num, binding.range || {});
      break;
    }

    case 'colorRange': {
      const num = parseFloat(rawValue);
      if (isNaN(num)) return undefined;
      value = evaluateColorRange(num, binding.colorRange?.stops || []);
      break;
    }

    case 'expression': {
      const fn = compileExpression(binding.expression, binding.id, binding.advanced);
      if (!fn) return undefined;
      value = fn(dataContext || {});
      break;
    }

    case 'visibility': {
      // Visibility can use expression or simple threshold
      if (binding.expression) {
        const fn = compileExpression(binding.expression, binding.id, binding.advanced);
        if (!fn) return undefined;
        value = !!fn(dataContext || {});
      } else {
        // Default: visible when value is truthy/non-zero
        value = rawValue !== undefined && rawValue !== null && rawValue !== '' && rawValue !== 0 && rawValue !== '0';
      }
      break;
    }

    default:
      return undefined;
  }

  // Apply smoothing for numeric values
  if (typeof value === 'number' && binding.smoothing > 0 && prevSmooth) {
    const prev = prevSmooth.value;
    if (prev !== undefined && typeof prev === 'number') {
      const alpha = Math.max(0.05, Math.min(1, 1 - binding.smoothing));
      value = prev + alpha * (value - prev);
    }
    prevSmooth.value = value;
  }

  return value;
}
