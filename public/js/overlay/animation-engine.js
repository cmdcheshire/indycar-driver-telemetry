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

  /**
   * Animate an element's vertical position when its leaderboard rank changes.
   *
   * The element starts offset by the rank-change delta (so it visually appears
   * at its old position) and transitions smoothly to translateY(0) (its new
   * position in the DOM/layout).
   *
   * @param {string} elementId  - The template element id.
   * @param {number} fromRank   - The previous rank (1-based).
   * @param {number} toRank     - The new rank (1-based).
   * @param {number} rowHeight  - Pixel height of one leaderboard row.
   * @param {number} [duration=400] - Transition duration in milliseconds.
   */
  animatePosition(elementId, fromRank, toRank, rowHeight, duration = 400) {
    const node = this._domMap.get(elementId);
    if (!node) return;

    const deltaY = (fromRank - toRank) * rowHeight;
    if (deltaY === 0) return;

    // Start at the offset (old visual position)
    node.style.transition = 'none';
    node.style.transform = `translateY(${deltaY}px)`;

    // Force a reflow so the browser registers the starting position
    void node.offsetHeight;

    // Transition to the new position
    node.style.transition = `transform ${duration}ms ease-in-out`;
    node.style.transform = 'translateY(0)';

    // Clean up inline styles after transition
    const onEnd = () => {
      node.style.transition = '';
      node.style.transform = '';
      node.removeEventListener('transitionend', onEnd);
    };
    node.addEventListener('transitionend', onEnd, { once: true });
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
