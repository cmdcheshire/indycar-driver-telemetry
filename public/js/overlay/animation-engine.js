/**
 * Animation engine.
 *
 * Provides show/hide/value-transition animations for overlay elements.
 * Works with the CSS animation classes defined in overlay.html.
 */

export class AnimationEngine {
  /**
   * @param {Map<string, HTMLElement>} domMap - Map of element ID -> DOM node.
   */
  constructor(domMap) {
    /** element.id -> DOM node */
    this._domMap = domMap || new Map();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Show an element with an optional enter animation.
   *
   * @param {string}  elementId - The template element id.
   * @param {string} [animation] - Animation name (e.g. "fadeIn", "slideInLeft").
   */
  show(elementId, animation) {
    const node = this._domMap.get(elementId);
    if (!node) return;

    // Remove any lingering exit animation classes
    this._clearAnimations(node);

    // Make visible
    node.style.display = '';
    node.style.opacity = '';

    if (animation) {
      const className = `anim-${animation}`;
      node.classList.add(className);

      // Clean up the class after animation completes
      node.addEventListener('animationend', () => {
        node.classList.remove(className);
      }, { once: true });
    }
  }

  /**
   * Hide an element with an optional exit animation.
   * When the animation completes, display is set to 'none'.
   *
   * @param {string}  elementId - The template element id.
   * @param {string} [animation] - Animation name (e.g. "fadeOut", "slideOutLeft").
   */
  hide(elementId, animation) {
    const node = this._domMap.get(elementId);
    if (!node) return;

    this._clearAnimations(node);

    if (animation) {
      const className = `anim-${animation}`;
      node.classList.add(className);

      node.addEventListener('animationend', () => {
        node.style.display = 'none';
        node.classList.remove(className);
        // Reset opacity so it can be shown again later
        node.style.opacity = '';
      }, { once: true });
    } else {
      node.style.display = 'none';
    }
  }

  /**
   * Update a data element's displayed value with an optional transition.
   *
   * Supported transitions:
   *   - "crossfade": fade out the old text, swap, fade in.
   *   - "none" / undefined: instant textContent swap.
   *
   * @param {string}  elementId  - The template element id.
   * @param {string}  newValue   - The new text to display.
   * @param {string} [transition] - Transition type.
   */
  updateValue(elementId, newValue, transition) {
    const node = this._domMap.get(elementId);
    if (!node) return;

    if (transition === 'crossfade') {
      this._crossfadeValue(node, newValue);
    } else {
      node.textContent = newValue;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Perform a crossfade transition: fade out -> swap text -> fade in.
   */
  _crossfadeValue(node, newValue) {
    const duration = 150; // ms per phase

    // Phase 1: fade out
    node.style.transition = `opacity ${duration}ms ease-out`;
    node.style.opacity = '0';

    const onFadedOut = () => {
      // Phase 2: swap text
      node.textContent = newValue;

      // Phase 3: fade in
      // Use a microtask to ensure the browser has painted the opacity:0 frame
      requestAnimationFrame(() => {
        node.style.transition = `opacity ${duration}ms ease-in`;
        node.style.opacity = '1';

        const onFadedIn = () => {
          // Clean up inline transition
          node.style.transition = '';
          node.removeEventListener('transitionend', onFadedIn);
        };
        node.addEventListener('transitionend', onFadedIn, { once: true });
      });

      node.removeEventListener('transitionend', onFadedOut);
    };

    node.addEventListener('transitionend', onFadedOut, { once: true });
  }

  /**
   * Remove all animation utility classes from a node.
   */
  _clearAnimations(node) {
    const animClasses = [];
    for (const cls of node.classList) {
      if (cls.startsWith('anim-')) {
        animClasses.push(cls);
      }
    }
    for (const cls of animClasses) {
      node.classList.remove(cls);
    }
  }
}
