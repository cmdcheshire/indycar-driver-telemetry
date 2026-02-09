/**
 * GSAP-based animation engine for the overlay runtime.
 *
 * Integrates motorsport broadcast best practices:
 *   - Channel-based animation management with auto-interruption
 *   - overwrite:'auto' on all tweens for same-property conflict resolution
 *   - gsap.context() scoping for clean teardown on overlay rebuild
 *   - will-change management for GPU-accelerated animation performance
 *   - Preset default easings (motorsport curves applied automatically)
 *   - Motorsport easing resolver for custom cubic-bezier curves
 */

import {
  getEnterPreset,
  getExitPreset,
  getEmphasisPreset,
  migrateEasing,
} from '/js/shared/animation-presets.js';
import { resolveEasing } from '/js/shared/motorsport-easings.js';

export class GsapAnimationEngine {
  /**
   * @param {Map<string, HTMLElement>} domMap - Map of element ID -> DOM node.
   */
  constructor(domMap) {
    /** @type {Map<string, HTMLElement>} */
    this._domMap = domMap || new Map();

    /**
     * Channel map: channelName -> gsap.core.Tween|Timeline
     * Named channels auto-interrupt: starting a new animation on the same
     * channel kills the previous one. Channel names default to elementId
     * but can be custom (e.g. 'tower-ingress', 'flag-bar').
     */
    this._channels = new Map();

    /**
     * GSAP context scopes all tweens created by this engine.
     * Calling revert() kills everything cleanly on overlay rebuild.
     */
    this._ctx = gsap.context ? gsap.context(() => {}) : null;

    /**
     * Track elements with will-change set so we can clean up after idle.
     * elementId -> timeoutId
     */
    this._willChangeTimers = new Map();
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

    this._killChannel(elementId);

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
    // Use preset's default easing if no easing specified, then resolve motorsport aliases
    const rawEasing = config.easing || preset.defaultEase || 'power2.out';
    const easing = resolveEasing(migrateEasing(rawEasing));

    // Promote to GPU layer before animation starts
    this._setWillChange(elementId, node);

    const tweenFn = () => {
      const tween = gsap.from(node, {
        ...preset.vars,
        duration,
        delay,
        ease: easing,
        overwrite: 'auto',
        onComplete: () => {
          this._channels.delete(elementId);
          // Clear GSAP-set inline transforms so element returns to CSS-defined position
          if (preset.clearProps) {
            gsap.set(node, { clearProps: preset.clearProps });
          } else {
            gsap.set(node, { clearProps: 'transform,opacity' });
          }
          // Restore mask clip-path if clipping mask system set one
          this._restoreMaskClipPath(node);
          this._clearWillChange(elementId, node);
        },
      });

      this._channels.set(elementId, tween);
    };

    // Run inside GSAP context if available
    if (this._ctx) {
      this._ctx.add(tweenFn);
    } else {
      tweenFn();
    }
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

    this._killChannel(elementId);

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
    const rawEasing = config.easing || preset.defaultEase || 'power2.in';
    const easing = resolveEasing(migrateEasing(rawEasing));

    this._setWillChange(elementId, node);

    const tweenFn = () => {
      const tween = gsap.to(node, {
        ...preset.vars,
        duration,
        delay,
        ease: easing,
        overwrite: 'auto',
        onComplete: () => {
          node.style.display = 'none';
          this._channels.delete(elementId);
          gsap.set(node, { clearProps: 'transform,opacity,clipPath' });
          // Restore mask clip-path if clipping mask system set one
          this._restoreMaskClipPath(node);
          this._clearWillChange(elementId, node);
        },
      });

      this._channels.set(elementId, tween);
    };

    if (this._ctx) {
      this._ctx.add(tweenFn);
    } else {
      tweenFn();
    }
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
  // Channel-based animation (named channels with auto-interruption)
  // -----------------------------------------------------------------------

  /**
   * Run a tween on a named channel. If a tween is already running on
   * this channel, it is killed before the new one starts.
   *
   * @param {string} channel - Channel name (e.g. 'tower-ingress', 'flag-bar')
   * @param {HTMLElement} target - DOM element to animate
   * @param {object} vars - GSAP vars object (to values)
   * @param {object} [opts] - { duration, ease, onComplete, ... }
   * @returns {gsap.core.Tween}
   */
  animate(channel, target, vars, opts = {}) {
    this._killChannel(channel);

    const tweenVars = {
      ...vars,
      duration: opts.duration || 0.3,
      ease: resolveEasing(opts.ease || 'power2.out'),
      overwrite: 'auto',
      onComplete: () => {
        this._channels.delete(channel);
        if (opts.onComplete) opts.onComplete();
      },
    };

    let tween;
    const tweenFn = () => {
      tween = gsap.to(target, tweenVars);
      this._channels.set(channel, tween);
    };

    if (this._ctx) {
      this._ctx.add(tweenFn);
    } else {
      tweenFn();
    }

    return tween;
  }

  /**
   * Create a timeline on a named channel.
   *
   * @param {string} channel - Channel name
   * @param {object} [opts] - Timeline options (onComplete, etc.)
   * @returns {gsap.core.Timeline}
   */
  timeline(channel, opts = {}) {
    this._killChannel(channel);

    let tl;
    const tlFn = () => {
      tl = gsap.timeline({
        ...opts,
        onComplete: () => {
          this._channels.delete(channel);
          if (opts.onComplete) opts.onComplete();
        },
      });
      this._channels.set(channel, tl);
    };

    if (this._ctx) {
      this._ctx.add(tlFn);
    } else {
      tlFn();
    }

    return tl;
  }

  /**
   * Immediately complete a channel's animation (snap to end state).
   *
   * @param {string} channel
   */
  snapToEnd(channel) {
    const anim = this._channels.get(channel);
    if (anim) {
      anim.progress(1).kill();
      this._channels.delete(channel);
    }
  }

  // -----------------------------------------------------------------------
  // Keyframe-based animation (advanced choreography)
  // -----------------------------------------------------------------------

  /**
   * Show an element using a keyframe animation definition instead of a preset.
   * Builds a GSAP timeline from per-property tracks with timed keyframes.
   *
   * @param {string} elementId
   * @param {object} keyframeData - { duration, tracks: [{ property, keyframes: [{ time, value, easing }] }] }
   * @returns {gsap.core.Timeline|null} The built timeline (for adding to a parent timeline)
   */
  showWithKeyframes(elementId, keyframeData) {
    const node = this._getNode(elementId);
    if (!node || !keyframeData || !keyframeData.tracks) return null;

    this._killChannel(elementId);

    // Make visible
    node.style.display = '';
    node.style.opacity = '';

    this._setWillChange(elementId, node);

    let tl;
    const tlFn = () => {
      tl = gsap.timeline({
        onComplete: () => {
          this._channels.delete(elementId);
          // Do NOT clearProps here — keyframe animations use gsap.to() so the
          // final keyframe values are the intended end state and must persist.
          // Only restore mask clip-path and clean up GPU layer.
          this._restoreMaskClipPath(node);
          this._clearWillChange(elementId, node);
        },
      });

      for (const track of keyframeData.tracks) {
        const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
        if (sorted.length < 2) continue;

        // Set initial value inside the timeline so it fires at playback time,
        // not at build time (prevents flash when added with a delay)
        tl.set(node, { [track.property]: sorted[0].value }, 0);

        // Build tweens between consecutive keyframes
        for (let i = 0; i < sorted.length - 1; i++) {
          const from = sorted[i];
          const to = sorted[i + 1];
          const dur = (to.time - from.time) / 1000;
          const pos = from.time / 1000;
          const ease = to.easing && to.easing !== 'none'
            ? resolveEasing(migrateEasing(to.easing))
            : 'none';

          tl.to(node, {
            [track.property]: to.value,
            duration: dur,
            ease,
          }, pos);
        }
      }

      this._channels.set(elementId, tl);
    };

    if (this._ctx) {
      this._ctx.add(tlFn);
    } else {
      tlFn();
    }

    return tl;
  }

  /**
   * Hide an element using a keyframe animation definition instead of a preset.
   * Builds a GSAP timeline from per-property tracks with timed keyframes.
   * On complete, hides the element and clears inline transforms.
   *
   * @param {string} elementId
   * @param {object} keyframeData - { duration, tracks: [{ property, keyframes: [{ time, value, easing }] }] }
   * @returns {gsap.core.Timeline|null} The built timeline (for adding to a parent timeline)
   */
  hideWithKeyframes(elementId, keyframeData) {
    const node = this._getNode(elementId);
    if (!node || !keyframeData || !keyframeData.tracks) return null;

    this._killChannel(elementId);

    this._setWillChange(elementId, node);

    let tl;
    const tlFn = () => {
      tl = gsap.timeline({
        onComplete: () => {
          node.style.display = 'none';
          this._channels.delete(elementId);
          gsap.set(node, { clearProps: 'transform,opacity,clipPath,color,backgroundColor' });
          this._restoreMaskClipPath(node);
          this._clearWillChange(elementId, node);
        },
      });

      for (const track of keyframeData.tracks) {
        const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
        if (sorted.length < 2) continue;

        // Set initial value inside the timeline so it fires at playback time
        tl.set(node, { [track.property]: sorted[0].value }, 0);

        // Build tweens between consecutive keyframes
        for (let i = 0; i < sorted.length - 1; i++) {
          const from = sorted[i];
          const to = sorted[i + 1];
          const dur = (to.time - from.time) / 1000;
          const pos = from.time / 1000;
          const ease = to.easing && to.easing !== 'none'
            ? resolveEasing(migrateEasing(to.easing))
            : 'none';

          tl.to(node, {
            [track.property]: to.value,
            duration: dur,
            ease,
          }, pos);
        }
      }

      this._channels.set(elementId, tl);
    };

    if (this._ctx) {
      this._ctx.add(tlFn);
    } else {
      tlFn();
    }

    return tl;
  }

  // -----------------------------------------------------------------------
  // Gauge transitions
  // -----------------------------------------------------------------------

  /**
   * Smoothly tween a gauge element's visual fill to a target value.
   * Uses a named channel per gauge for auto-interruption.
   *
   * @param {string}  elementId - Gauge element ID
   * @param {number}  targetValue - Target numeric value
   * @param {object}  element - Template element definition (min, max, type, etc.)
   * @param {number}  [duration=100] - Tween duration in ms
   */
  tweenGauge(elementId, targetValue, element, duration = 100) {
    const node = this._getNode(elementId);
    if (!node) return;

    const channel = `gauge-${elementId}`;
    this._killChannel(channel);

    // Import the gauge update function dynamically to avoid circular deps
    // We use a proxy object that GSAP will tween, then apply to DOM each frame
    const min = element.min ?? 0;
    const max = element.max ?? 100;
    const currentPct = this._gaugeState?.[elementId] ?? 0;
    const targetPct = Math.max(0, Math.min(1, (targetValue - min) / (max - min)));

    if (!this._gaugeState) this._gaugeState = {};

    const proxy = { pct: currentPct };
    const gaugeType = node.getAttribute('data-gauge-type');

    const tweenFn = () => {
      const tween = gsap.to(proxy, {
        pct: targetPct,
        duration: duration / 1000,
        ease: 'dataPunch',
        overwrite: 'auto',
        onUpdate: () => {
          this._gaugeState[elementId] = proxy.pct;
          // Update DOM directly — import would be circular, so use the data attribute approach
          this._updateGaugeDom(node, proxy.pct, gaugeType, element);
        },
        onComplete: () => {
          this._channels.delete(channel);
          this._gaugeState[elementId] = targetPct;
        },
      });
      this._channels.set(channel, tween);
    };

    if (this._ctx) {
      this._ctx.add(tweenFn);
    } else {
      tweenFn();
    }
  }

  /**
   * Direct DOM gauge update (avoids circular import of element-renderer).
   * @private
   */
  _updateGaugeDom(node, pct, gaugeType, element) {
    switch (gaugeType) {
      case 'arc': {
        const svg = node.querySelector('svg');
        if (!svg) return;
        const fillPath = svg.querySelector('[data-role="fill"]');
        const { startAngle = -135, endAngle = 135, thickness = 12 } = element;
        const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number);
        if (!viewBox) return;
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

        // Inline arc calculation to avoid import
        const startPt = this._polarToCartesian(cx, cy, midR, fillAngle);
        const endPt = this._polarToCartesian(cx, cy, midR, startAngle);
        const largeArc = (fillAngle - startAngle) <= 180 ? '0' : '1';
        const d = `M ${startPt.x} ${startPt.y} A ${midR} ${midR} 0 ${largeArc} 0 ${endPt.x} ${endPt.y}`;

        if (fillPath) {
          fillPath.setAttribute('d', d);
        } else {
          const ns = 'http://www.w3.org/2000/svg';
          const newFill = document.createElementNS(ns, 'path');
          newFill.setAttribute('d', d);
          newFill.setAttribute('fill', 'none');
          newFill.setAttribute('stroke', element.fillColor || '#00e676');
          newFill.setAttribute('stroke-width', String(thickness));
          newFill.setAttribute('stroke-linecap', 'round');
          newFill.setAttribute('data-role', 'fill');
          svg.appendChild(newFill);
        }
        break;
      }
      case 'bar': {
        const fill = node.querySelector('[data-role="fill"]');
        if (!fill) return;
        const orientation = element.orientation || 'horizontal';
        if (orientation === 'vertical') {
          fill.style.height = `${pct * 100}%`;
        } else {
          fill.style.width = `${pct * 100}%`;
        }
        break;
      }
      case 'ringSegment': {
        const svg = node.querySelector('svg');
        if (!svg) return;
        const {
          segments = 10, min = 0, max = 100,
          colorStops = [{ value: 0, color: '#00e676' }, { value: 100, color: '#ff5252' }],
          bgColor = 'rgba(255,255,255,0.15)',
        } = element;
        const activeSegments = Math.round(pct * segments);
        const paths = svg.querySelectorAll('[data-segment]');
        paths.forEach(path => {
          const idx = parseInt(path.getAttribute('data-segment'), 10);
          const isActive = idx < activeSegments;
          // Simple color resolution — use first/last stop for inactive/active
          const segValue = min + ((idx + 0.5) / segments) * (max - min);
          let color = bgColor;
          if (isActive && colorStops.length > 0) {
            // Quick interpolation
            if (segValue <= colorStops[0].value) color = colorStops[0].color;
            else if (segValue >= colorStops[colorStops.length - 1].value) color = colorStops[colorStops.length - 1].color;
            else {
              for (let j = 0; j < colorStops.length - 1; j++) {
                if (segValue >= colorStops[j].value && segValue <= colorStops[j + 1].value) {
                  color = colorStops[j].color; // Close enough for tweens
                  break;
                }
              }
            }
          }
          path.setAttribute('stroke', color);
        });
        break;
      }
    }
  }

  /** @private */
  _polarToCartesian(cx, cy, radius, angleDeg) {
    const angleRad = ((angleDeg - 90) * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(angleRad),
      y: cy + radius * Math.sin(angleRad),
    };
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
    const activeAnim = this._channels.get(elementId);
    if (activeAnim && activeAnim.isActive()) return;

    const totalDuration = (config.duration || 400) / 1000;
    const repeat = config.repeat || 0;

    // Scale keyframe durations to fit total duration
    const keyframes = preset.keyframes.map(kf => ({ ...kf }));
    const sumDurations = keyframes.reduce((sum, kf) => sum + (kf.duration || 0.1), 0);
    const scale = totalDuration / sumDurations;
    for (const kf of keyframes) {
      kf.duration = (kf.duration || 0.1) * scale;
      // Resolve any motorsport easings in keyframe-level easing
      if (kf.ease) kf.ease = resolveEasing(kf.ease);
    }

    const emphasisChannel = `emphasis-${elementId}`;
    this._killChannel(emphasisChannel);

    const tweenFn = () => {
      const tween = gsap.to(node, {
        keyframes,
        repeat,
        overwrite: 'auto',
        onComplete: () => {
          this._channels.delete(emphasisChannel);
          gsap.set(node, { clearProps: 'transform,opacity,textShadow,color,backgroundColor,filter' });
        },
      });
      this._channels.set(emphasisChannel, tween);
    };

    if (this._ctx) {
      this._ctx.add(tweenFn);
    } else {
      tweenFn();
    }
  }

  // -----------------------------------------------------------------------
  // Position animation (leaderboard rank changes)
  // -----------------------------------------------------------------------

  /**
   * Animate an element's vertical position when its leaderboard rank changes.
   * Uses towerSnap easing per the motorsport guide.
   *
   * @param {string} elementId
   * @param {number} fromRank
   * @param {number} toRank
   * @param {number} rowHeight - Pixel height of one row
   * @param {number} [duration=200] - Duration in ms (guide: 200ms for position swaps)
   */
  animatePosition(elementId, fromRank, toRank, rowHeight, duration = 200) {
    const node = this._getNode(elementId);
    if (!node) return;

    const deltaY = (fromRank - toRank) * rowHeight;
    if (deltaY === 0) return;

    const posChannel = `pos-${elementId}`;
    this._killChannel(posChannel);

    this._setWillChange(elementId, node);

    const tweenFn = () => {
      const tween = gsap.fromTo(node,
        { y: deltaY },
        {
          y: 0,
          duration: duration / 1000,
          ease: 'towerSnap',
          overwrite: 'auto',
          onComplete: () => {
            this._channels.delete(posChannel);
            gsap.set(node, { clearProps: 'transform' });
            this._clearWillChange(elementId, node);
          },
        },
      );
      this._channels.set(posChannel, tween);
    };

    if (this._ctx) {
      this._ctx.add(tweenFn);
    } else {
      tweenFn();
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /**
   * Kill all emphasis animations and reset their elements to clean state.
   * Called before TAKE OFF so exit animations play smoothly.
   */
  killEmphasis() {
    for (const [channel, anim] of this._channels) {
      if (channel.startsWith('emphasis-')) {
        if (typeof anim.kill === 'function') anim.kill();
        const elementId = channel.replace('emphasis-', '');
        const node = this._getNode(elementId);
        if (node) {
          gsap.set(node, { clearProps: 'transform,opacity,textShadow,color,backgroundColor,filter' });
          this._restoreMaskClipPath(node);
        }
        this._channels.delete(channel);
      }
    }
  }

  /**
   * Kill all active animations and revert the GSAP context.
   * Call this when rebuilding the overlay DOM.
   */
  killAll() {
    // Revert GSAP context — kills all tweens/timelines created within it
    if (this._ctx) {
      this._ctx.revert();
      this._ctx = gsap.context ? gsap.context(() => {}) : null;
    }

    // Clear channel map
    for (const [, anim] of this._channels) {
      if (anim && typeof anim.kill === 'function') anim.kill();
    }
    this._channels.clear();

    // Clear will-change timers
    for (const [, timerId] of this._willChangeTimers) {
      clearTimeout(timerId);
    }
    this._willChangeTimers.clear();
  }

  /**
   * Diagnostic info: active channel count for performance monitoring.
   */
  get diagnostics() {
    let active = 0;
    for (const [, anim] of this._channels) {
      if (anim && typeof anim.isActive === 'function' && anim.isActive()) active++;
    }
    return {
      active,
      channels: this._channels.size,
    };
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
   * Kill any active animation on a channel.
   */
  _killChannel(channel) {
    const anim = this._channels.get(channel);
    if (anim) {
      if (typeof anim.kill === 'function') anim.kill();
      this._channels.delete(channel);
    }
    // For element-id channels, also kill any GSAP tweens targeting the node directly
    const node = this._getNode(channel);
    if (node) {
      gsap.killTweensOf(node);
    }
  }

  /**
   * Restore the clipping mask's clip-path after animation clearProps removed it.
   * The mask clip-path is stored as a data attribute by template-loader.
   */
  _restoreMaskClipPath(node) {
    const maskClip = node.dataset?.maskClipPath;
    if (maskClip) {
      node.style.clipPath = maskClip;
    }
  }

  /**
   * Set will-change on a node before animation starts.
   * Cleared after 5s idle per the guide's GPU memory recommendation.
   */
  _setWillChange(elementId, node) {
    // Clear any pending removal timer
    const existing = this._willChangeTimers.get(elementId);
    if (existing) clearTimeout(existing);

    node.style.willChange = 'transform, opacity';
  }

  /**
   * Schedule will-change removal after animation completes.
   * 5s idle threshold frees GPU texture memory.
   */
  _clearWillChange(elementId, node) {
    const timerId = setTimeout(() => {
      node.style.willChange = '';
      this._willChangeTimers.delete(elementId);
    }, 5000);
    this._willChangeTimers.set(elementId, timerId);
  }

  /**
   * Crossfade: fade out -> swap text -> fade in.
   * Uses dataPunch easing for snappy data transitions.
   */
  _crossfadeValue(node, newValue, duration = 300) {
    const halfDur = (duration / 1000) / 2;

    gsap.to(node, {
      opacity: 0,
      duration: halfDur,
      ease: 'dataPunch',
      overwrite: 'auto',
      onComplete: () => {
        node.textContent = newValue;
        gsap.to(node, {
          opacity: 1,
          duration: halfDur,
          ease: 'power1.in',
          overwrite: 'auto',
        });
      },
    });
  }
}
