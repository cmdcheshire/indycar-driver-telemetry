/**
 * GSAP-based animation engine for the overlay runtime.
 *
 * Replaces the CSS @keyframes AnimationEngine with programmatic GSAP animations.
 * Provides show/hide/emphasis/value-transition/position animations.
 */

import {
  getEnterPreset,
  getExitPreset,
  getEmphasisPreset,
  migrateEasing,
} from '/js/shared/animation-presets.js';

export class GsapAnimationEngine {
  /**
   * @param {Map<string, HTMLElement>} domMap - Map of element ID -> DOM node.
   */
  constructor(domMap) {
    /** @type {Map<string, HTMLElement>} */
    this._domMap = domMap || new Map();

    /** @type {Map<string, gsap.core.Tween>} Active tweens per element */
    this._activeTweens = new Map();
  }

  // -----------------------------------------------------------------------
  // Show / Hide (single element)
  // -----------------------------------------------------------------------

  /**
   * Show an element with an enter animation.
   *
   * @param {string} elementId
   * @param {object} [animConfig] - { type, duration, delay, easing }
   */
  show(elementId, animConfig) {
    const node = this._getNode(elementId);
    if (!node) return;

    this._killTween(elementId);

    // Make visible
    node.style.display = '';
    node.style.opacity = '';

    const config = animConfig || {};
    const presetName = config.type || 'fadeIn';

    if (presetName === 'none') return;

    const preset = getEnterPreset(presetName);
    if (!preset) return;

    const duration = (config.duration || 300) / 1000;
    const delay = (config.delay || 0) / 1000;
    const easing = migrateEasing(config.easing) || 'power2.out';

    const tween = gsap.from(node, {
      ...preset.vars,
      duration,
      delay,
      ease: easing,
      onComplete: () => {
        this._activeTweens.delete(elementId);
        // Clear GSAP-set inline transforms so element returns to CSS-defined position
        if (preset.clearProps) {
          gsap.set(node, { clearProps: preset.clearProps });
        } else {
          gsap.set(node, { clearProps: 'transform,opacity' });
        }
      },
    });

    this._activeTweens.set(elementId, tween);
  }

  /**
   * Hide an element with an exit animation.
   *
   * @param {string} elementId
   * @param {object} [animConfig] - { type, duration, delay, easing }
   */
  hide(elementId, animConfig) {
    const node = this._getNode(elementId);
    if (!node) return;

    this._killTween(elementId);

    const config = animConfig || {};
    const presetName = config.type || 'fadeOut';

    if (presetName === 'none') {
      node.style.display = 'none';
      return;
    }

    const preset = getExitPreset(presetName);
    if (!preset) {
      node.style.display = 'none';
      return;
    }

    const duration = (config.duration || 300) / 1000;
    const delay = (config.delay || 0) / 1000;
    const easing = migrateEasing(config.easing) || 'power2.in';

    const tween = gsap.to(node, {
      ...preset.vars,
      duration,
      delay,
      ease: easing,
      onComplete: () => {
        node.style.display = 'none';
        this._activeTweens.delete(elementId);
        gsap.set(node, { clearProps: 'transform,opacity,clipPath' });
      },
    });

    this._activeTweens.set(elementId, tween);
  }

  // -----------------------------------------------------------------------
  // Orchestrated show/hide (multiple elements with stagger)
  // -----------------------------------------------------------------------

  /**
   * Show multiple elements with per-element animation configs.
   * Each config specifies its own type, duration, delay, and easing.
   *
   * @param {Array<{elementId: string, type: string, duration: number, delay: number, easing: string}>} elementConfigs
   */
  showAll(elementConfigs) {
    if (!elementConfigs || elementConfigs.length === 0) return;

    for (const config of elementConfigs) {
      const node = this._getNode(config.elementId);
      if (node) {
        node.style.display = '';
        node.style.opacity = '';
      }
      this.show(config.elementId, config);
    }
  }

  /**
   * Hide multiple elements with per-element animation configs.
   *
   * @param {Array<{elementId: string, type: string, duration: number, delay: number, easing: string}>} elementConfigs
   */
  hideAll(elementConfigs) {
    if (!elementConfigs || elementConfigs.length === 0) return;

    for (const config of elementConfigs) {
      this.hide(config.elementId, config);
    }
  }

  // -----------------------------------------------------------------------
  // Value transitions
  // -----------------------------------------------------------------------

  /**
   * Update a data element's displayed value with an optional transition.
   *
   * @param {string}  elementId
   * @param {string}  newValue
   * @param {string}  [transition] - 'crossfade' or 'none'
   * @param {number}  [duration=300] - Duration in ms
   */
  updateValue(elementId, newValue, transition, duration = 300) {
    const node = this._getNode(elementId);
    if (!node) return;

    if (transition === 'crossfade') {
      this._crossfadeValue(node, newValue, duration);
    } else {
      node.textContent = newValue;
    }
  }

  // -----------------------------------------------------------------------
  // Emphasis animations
  // -----------------------------------------------------------------------

  /**
   * Play an emphasis animation on an element.
   *
   * @param {string} elementId
   * @param {object} config - { type, duration, repeat }
   */
  playEmphasis(elementId, config) {
    if (!config || config.type === 'none') return;

    const node = this._getNode(elementId);
    if (!node) return;

    const preset = getEmphasisPreset(config.type);
    if (!preset) return;

    // Don't interrupt active enter/exit tweens
    const activeTween = this._activeTweens.get(elementId);
    if (activeTween && activeTween.isActive()) return;

    const totalDuration = (config.duration || 400) / 1000;
    const repeat = config.repeat || 0;

    // Scale keyframe durations to fit total duration
    const keyframes = preset.keyframes.map(kf => ({ ...kf }));
    const sumDurations = keyframes.reduce((sum, kf) => sum + (kf.duration || 0.1), 0);
    const scale = totalDuration / sumDurations;
    for (const kf of keyframes) {
      kf.duration = (kf.duration || 0.1) * scale;
    }

    gsap.to(node, {
      keyframes,
      repeat,
      onComplete: () => {
        gsap.set(node, { clearProps: 'transform,opacity,textShadow,color' });
      },
    });
  }

  // -----------------------------------------------------------------------
  // Position animation (leaderboard rank changes)
  // -----------------------------------------------------------------------

  /**
   * Animate an element's vertical position when its leaderboard rank changes.
   *
   * @param {string} elementId
   * @param {number} fromRank
   * @param {number} toRank
   * @param {number} rowHeight - Pixel height of one row
   * @param {number} [duration=400] - Duration in ms
   */
  animatePosition(elementId, fromRank, toRank, rowHeight, duration = 400) {
    const node = this._getNode(elementId);
    if (!node) return;

    const deltaY = (fromRank - toRank) * rowHeight;
    if (deltaY === 0) return;

    gsap.fromTo(node,
      { y: deltaY },
      {
        y: 0,
        duration: duration / 1000,
        ease: 'power2.inOut',
        onComplete: () => {
          gsap.set(node, { clearProps: 'transform' });
        },
      },
    );
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Kill all active tweens.
   */
  killAll() {
    for (const [id] of this._activeTweens) {
      this._killTween(id);
    }
    this._activeTweens.clear();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Get the DOM node for an element, supporting '__root__' for the overlay root.
   */
  _getNode(elementId) {
    if (elementId === '__root__') {
      return document.getElementById('overlay-root');
    }
    return this._domMap.get(elementId);
  }

  /**
   * Kill any active tween for an element.
   */
  _killTween(elementId) {
    const tween = this._activeTweens.get(elementId);
    if (tween) {
      tween.kill();
      this._activeTweens.delete(elementId);
    }
    // Also kill any GSAP tweens targeting the node directly
    const node = this._getNode(elementId);
    if (node) {
      gsap.killTweensOf(node);
    }
  }

  /**
   * Crossfade: fade out -> swap text -> fade in.
   */
  _crossfadeValue(node, newValue, duration = 300) {
    const halfDur = (duration / 1000) / 2;

    gsap.to(node, {
      opacity: 0,
      duration: halfDur,
      ease: 'power1.out',
      onComplete: () => {
        node.textContent = newValue;
        gsap.to(node, {
          opacity: 1,
          duration: halfDur,
          ease: 'power1.in',
        });
      },
    });
  }
}
