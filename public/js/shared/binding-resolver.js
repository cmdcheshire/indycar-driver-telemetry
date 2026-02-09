/**
 * Binding resolver for universal visual bindings.
 *
 * Processes all element bindings each data tick, resolves values through the
 * expression engine, applies results to DOM nodes with dirty checking, and
 * manages smoothing state.
 *
 * Used by the overlay DataBinder — called after standard data/gauge bindings.
 */

import { BINDABLE_PROPERTIES, resolveBinding } from './expression-engine.js';

// ---------------------------------------------------------------------------
// BindingResolver
// ---------------------------------------------------------------------------

export class BindingResolver {
  /**
   * @param {Array}  elements - Template elements (normalized flat format)
   * @param {Map}    domMap   - element.id -> DOM node
   */
  constructor(elements, domMap) {
    this._domMap = domMap || new Map();

    // Pre-filter elements that have at least one binding
    this._boundElements = (elements || []).filter(
      el => Array.isArray(el.bindings) && el.bindings.length > 0
    );

    // Dirty-checking: Map<"elementId:bindingId", prevValue>
    this._previousValues = new Map();

    // Smoothing state: Map<bindingId, { value: number }>
    this._smoothState = new Map();
  }

  /**
   * Resolve all element bindings and apply results to the DOM.
   *
   * @param {Function} valueResolver - (source, field, car) => raw value
   * @param {Function} [contextBuilder] - (element, binding) => full data context object for expressions
   */
  resolveAll(valueResolver, contextBuilder) {
    for (const element of this._boundElements) {
      const node = this._domMap.get(element.id);
      if (!node) continue;

      for (const binding of element.bindings) {
        if (!binding.id || !binding.target) continue;

        // Get raw value from telemetry/data source
        const rawValue = valueResolver(binding.source, binding.field, binding.car);

        // Build data context for expression evaluation
        let dataContext = null;
        if ((binding.mode === 'expression' || binding.mode === 'visibility') && contextBuilder) {
          dataContext = contextBuilder(element, binding);
        }

        // Get or create smoothing state
        let smoothState = null;
        if (binding.smoothing > 0) {
          if (!this._smoothState.has(binding.id)) {
            this._smoothState.set(binding.id, { value: undefined });
          }
          smoothState = this._smoothState.get(binding.id);
        }

        // Resolve the binding
        const resolved = resolveBinding(binding, rawValue, dataContext, smoothState);
        if (resolved === undefined) continue;

        // Dirty check — skip DOM write if value unchanged
        const dirtyKey = `${element.id}:${binding.id}`;
        const prev = this._previousValues.get(dirtyKey);

        if (typeof resolved === 'number') {
          // Use epsilon for float comparison
          if (prev !== undefined && typeof prev === 'number' && Math.abs(prev - resolved) < 0.001) continue;
        } else {
          if (prev === resolved) continue;
        }

        this._previousValues.set(dirtyKey, resolved);

        // Apply to DOM
        this._applyToDOM(node, binding.target, resolved);
      }
    }
  }

  /**
   * Apply a resolved value to a DOM node based on the target property.
   *
   * @param {HTMLElement} node   - The DOM node
   * @param {string}      target - BINDABLE_PROPERTIES key
   * @param {*}            value  - The resolved value
   */
  _applyToDOM(node, target, value) {
    const propDef = BINDABLE_PROPERTIES[target];
    if (!propDef) return;

    switch (propDef.type) {
      case 'number': {
        if (propDef.gsap && typeof gsap !== 'undefined') {
          // Use gsap.set for transform properties (rotation, scale, x, y)
          gsap.set(node, { [propDef.gsap]: value });
        } else if (propDef.filter) {
          // CSS filter properties (blur)
          node.style.filter = `${propDef.filter}(${value}${propDef.unit})`;
        } else if (propDef.css) {
          // Standard CSS property with unit
          const unit = propDef.unit || '';
          node.style[propDef.css] = unit ? `${value}${unit}` : String(value);
        }
        break;
      }

      case 'color': {
        if (propDef.css) {
          node.style[propDef.css] = value;
        }
        break;
      }

      case 'boolean': {
        // Visibility toggle
        if (target === 'visibility') {
          node.style.display = value ? '' : 'none';
        }
        break;
      }
    }
  }

  /**
   * Reset all internal state (for template changes).
   */
  reset() {
    this._previousValues.clear();
    this._smoothState.clear();
  }
}
