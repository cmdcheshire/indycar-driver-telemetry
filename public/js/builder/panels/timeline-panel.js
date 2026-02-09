/**
 * Timeline panel — unified IN / HOLD / OUT broadcast timeline.
 *
 * Shows three phases horizontally:
 *   IN (enter animations) → HOLD (on-air) → OUT (exit animations)
 *
 * Each element gets one track row with an enter bar in the IN phase
 * and an exit bar in the OUT phase. Bars are draggable (delay) and
 * resizable (duration). Transport controls play the full sequence
 * on the canvas via GSAP.
 */

import { getEnterPreset, getExitPreset } from '/js/shared/animation-presets.js';
import { buildGsapTimeline, SCENE3D_KEYS, applyScene3dProp } from './animation-designer.js';
import { computeClipPath, offsetMaskBounds } from '/js/shared/clip-path.js';

/* ------------------------------------------------------------------ *
 *  Module state
 * ------------------------------------------------------------------ */

/** @type {Function} */ let _getElements = null;
/** @type {Function} */ let _getTimeline = null;
/** @type {Function} */ let _onTimelineChange = null;
/** @type {Function} */ let _onAnimationChange = null;
/** @type {Function} */ let _onElementSelect = null;

/** @type {HTMLElement} */ let _panelEl = null;
/** @type {HTMLElement} */ let _rulerTrack = null;
/** @type {HTMLElement} */ let _tracksEl = null;
/** @type {HTMLElement} */ let _bodyEl = null;
/** @type {HTMLElement} */ let _playheadEl = null;

let _collapsed = true;
let _loopEnabled = false;
let _atStartPosition = false;

/** @type {gsap.core.Timeline|null} */ let _masterTl = null;
let _isPlaying = false;
let _isScrubbing = false;
let _currentPhase = 'idle'; // 'idle' | 'in' | 'hold' | 'out'
let _holdTimer = null;

/**
 * Recompute and restore canvas-engine base transform for an element node.
 * Must be called after gsap clearProps to prevent losing rotation/3D transforms.
 */
function _restoreBaseTransform(el, node) {
  const transforms = [];
  if (el.rotation) transforms.push(`rotate(${el.rotation}deg)`);
  if (el.rotationX) transforms.push(`rotateX(${el.rotationX}deg)`);
  if (el.rotationY) transforms.push(`rotateY(${el.rotationY}deg)`);
  if (el.z) transforms.push(`translateZ(${el.z}px)`);
  node.style.transform = transforms.join(' ');
  if (el.opacity !== undefined) node.style.opacity = String(el.opacity);
}

/**
 * Add clip-path animation tweens to a GSAP timeline for mask elements with enter animations.
 * When a hidden mask has an enter animation, the clip-path on its dependent elements
 * animates from the mask's "from" position to its rest position.
 *
 * Supports both preset animations (pre-computed fromTo) and keyframe animations
 * (real-time onUpdate tracking of the mask's GSAP transform every frame).
 */
function _addClipPathAnimations(tl, elements) {
  const canvasContainer = document.getElementById('canvasContainer');
  const canvasW = canvasContainer?.clientWidth || 1920;
  const canvasH = canvasContainer?.clientHeight || 1080;

  for (const el of elements) {
    if (!el.clipMask?.elementId) continue;

    const maskEl = elements.find(m => m.id === el.clipMask.elementId);
    if (!maskEl) continue;

    const clippedNode = document.querySelector(`#canvasContainer [data-element-id="${el.id}"]`);
    if (!clippedNode) continue;

    // ── Keyframe animation on mask (priority over preset) ──
    const maskEnterKf = _getEnterKf(maskEl);
    if (maskEnterKf?.enabled && maskEnterKf.tracks?.length > 0) {
      const maskNode = document.querySelector(`#canvasContainer [data-element-id="${maskEl.id}"]`);
      if (!maskNode) continue;

      // Only animate clip-path if keyframes affect position/size/rotation
      const hasPositionTracks = maskEnterKf.tracks.some(t =>
        ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation'].includes(t.property)
      );
      if (!hasPositionTracks) continue;

      const maskAnim = maskEl.animation?.enter || {};
      const delay = (maskAnim.delay || 0) / 1000;
      const duration = (maskEnterKf.duration || 2000) / 1000;

      // Add a tracking tween that recomputes clip-path every frame
      tl.to({}, {
        duration,
        onUpdate: () => {
          const bounds = _getEffectiveMaskBounds(maskEl, maskNode, canvasW, canvasH);
          const cp = computeClipPath(el, bounds, { forcePolygon: true });
          if (cp) clippedNode.style.clipPath = cp;
        },
        onComplete: () => {
          // Snap to final static clip-path
          const cp = computeClipPath(el, maskEl);
          clippedNode.style.clipPath = cp || 'none';
        },
      }, delay);
      continue;
    }

    // ── Preset animation on mask ──
    const maskAnim = maskEl.animation?.enter;
    if (!maskAnim?.type || maskAnim.type === 'none') continue;

    const preset = getEnterPreset(maskAnim.type);
    if (!preset) continue;

    // Skip clip-path based presets (wipe/reveal) — they animate the mask's own clipPath
    if (preset.vars.clipPath) continue;

    // Skip opacity-only presets — no position/size change to animate
    const posVars = { ...preset.vars };
    delete posVars.opacity;
    if (Object.keys(posVars).length === 0) continue;

    // Compute from/to clip-paths (both use polygon for GSAP interpolation compatibility)
    const fromMaskBounds = offsetMaskBounds(maskEl, preset.vars, canvasW, canvasH);
    const toClipPath = computeClipPath(el, maskEl, { forcePolygon: true });
    const fromClipPath = computeClipPath(el, fromMaskBounds, { forcePolygon: true });

    if (!fromClipPath || !toClipPath) continue;

    const delay = (maskAnim.delay || 0) / 1000;
    const duration = (maskAnim.duration || 300) / 1000;
    const easing = maskAnim.easing || preset.defaultEase || 'power2.out';

    tl.fromTo(clippedNode,
      { clipPath: fromClipPath },
      { clipPath: toClipPath, duration, ease: easing, overwrite: false },
      delay
    );
  }
}

/**
 * Read GSAP-applied transform values from a mask DOM node and compute
 * effective mask bounds in canvas percentage space.
 * Used by keyframe clip-path tracking (onUpdate).
 */
function _getEffectiveMaskBounds(maskEl, maskNode, canvasW, canvasH) {
  const gsapXpx = gsap.getProperty(maskNode, 'x') || 0;
  const gsapYpx = gsap.getProperty(maskNode, 'y') || 0;
  const gsapXpct = gsap.getProperty(maskNode, 'xPercent') || 0;
  const gsapYpct = gsap.getProperty(maskNode, 'yPercent') || 0;
  const gsapScaleX = gsap.getProperty(maskNode, 'scaleX');
  const gsapScaleY = gsap.getProperty(maskNode, 'scaleY');
  const gsapRotation = gsap.getProperty(maskNode, 'rotation') || 0;

  const scaleX = (gsapScaleX != null && gsapScaleX !== '') ? gsapScaleX : 1;
  const scaleY = (gsapScaleY != null && gsapScaleY !== '') ? gsapScaleY : 1;

  // Combine pixel + percentage offsets into canvas percentage
  const maskPxW = (maskEl.width / 100) * canvasW;
  const maskPxH = (maskEl.height / 100) * canvasH;
  const totalPxX = gsapXpx + (gsapXpct / 100) * maskPxW;
  const totalPxY = gsapYpx + (gsapYpct / 100) * maskPxH;
  const offsetXPct = (totalPxX / canvasW) * 100;
  const offsetYPct = (totalPxY / canvasH) * 100;

  // Compute effective width/height (scale from center)
  const effectiveW = maskEl.width * scaleX;
  const effectiveH = maskEl.height * scaleY;
  const cx = maskEl.x + maskEl.width / 2;
  const cy = maskEl.y + maskEl.height / 2;

  return {
    x: cx - effectiveW / 2 + offsetXPct,
    y: cy - effectiveH / 2 + offsetYPct,
    width: effectiveW,
    height: effectiveH,
    rotation: (maskEl.rotation || 0) + gsapRotation,
    props: maskEl.props,
    shapeType: maskEl.props?.shapeType || maskEl.shapeType,
    borderRadius: maskEl.props?.borderRadius || maskEl.borderRadius,
  };
}

const LABEL_WIDTH = 90;
const TRACK_HEIGHT = 24;
const MIN_PHASE_MS = 500;
const HOLD_VISUAL_WIDTH = 60; // px width for the HOLD column

/* ------------------------------------------------------------------ *
 *  Public API
 * ------------------------------------------------------------------ */

/**
 * Initialize the timeline panel.
 * @param {object} opts
 * @param {Function} opts.getElements       - Returns current elements array
 * @param {Function} opts.getTimeline       - Returns current timeline data
 * @param {Function} opts.onTimelineChange  - Called with partial timeline changes
 * @param {Function} opts.onAnimationChange - Called with (elementId, animChanges)
 * @param {Function} opts.onElementSelect   - Called with (elementId)
 */
export function initTimelinePanel(opts) {
  _getElements = opts.getElements;
  _getTimeline = opts.getTimeline;
  _onTimelineChange = opts.onTimelineChange;
  _onAnimationChange = opts.onAnimationChange;
  _onElementSelect = opts.onElementSelect;

  _panelEl = document.getElementById('timelinePanel');
  _rulerTrack = document.getElementById('tlRulerTrack');
  _tracksEl = document.getElementById('tlTracks');
  _bodyEl = document.getElementById('tlBody');
  _playheadEl = document.getElementById('tlPlayhead');

  if (!_panelEl) return;

  // Toggle collapse
  const toggleBtn = document.getElementById('tlToggleBtn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      _collapsed = !_collapsed;
      _panelEl.classList.toggle('collapsed', _collapsed);
      toggleBtn.textContent = _collapsed ? '\u25B2' : '\u25BC';
      if (!_collapsed) requestAnimationFrame(() => renderTimelinePanel());
    });
  }

  // Transport: GO TO START / TAKE ON / RESUME / TAKE OFF
  const goStartBtn = document.getElementById('tlGoStartBtn');
  if (goStartBtn) goStartBtn.addEventListener('click', () => { _expandPanel(); _goToStart(); });

  const takeOnBtn = document.getElementById('tlTakeOnBtn');
  if (takeOnBtn) takeOnBtn.addEventListener('click', () => { _expandPanel(); _takeOn(); });

  const resumeBtn = document.getElementById('tlResumeBtn');
  if (resumeBtn) resumeBtn.addEventListener('click', () => _resume());

  const takeOffBtn = document.getElementById('tlTakeOffBtn');
  if (takeOffBtn) takeOffBtn.addEventListener('click', () => _takeOff());

  // Loop toggle
  const loopBtn = document.getElementById('tlLoopBtn');
  if (loopBtn) {
    // Sync initial state from timeline data
    if (_getTimeline) {
      _loopEnabled = _getTimeline().loop || false;
      loopBtn.classList.toggle('active', _loopEnabled);
    }
    loopBtn.addEventListener('click', () => {
      _loopEnabled = !_loopEnabled;
      loopBtn.classList.toggle('active', _loopEnabled);
      if (_onTimelineChange) _onTimelineChange({ loop: _loopEnabled });
    });
  }

  // GO TO HOLD — skip IN, snap to hold
  const goHoldBtn = document.getElementById('tlGoHoldBtn');
  if (goHoldBtn) goHoldBtn.addEventListener('click', () => { _expandPanel(); _goToHold(); });

  // Add pause point
  const addPauseBtn = document.getElementById('tlAddPauseBtn');
  if (addPauseBtn) {
    addPauseBtn.addEventListener('click', () => {
      _expandPanel();
      _addPausePoint();
    });
  }

  // Hold duration select
  const holdSelect = document.getElementById('tlHoldSelect');
  if (holdSelect) {
    // Sync initial value from timeline data
    if (_getTimeline) {
      const tl = _getTimeline();
      holdSelect.value = String(tl.holdDuration || 5000);
    }
    holdSelect.addEventListener('change', () => {
      const ms = parseInt(holdSelect.value, 10);
      if (_onTimelineChange) _onTimelineChange({ holdDuration: ms });
      renderTimelinePanel();
    });
  }

  // Playhead scrubbing
  _initScrubbing();
}

/**
 * Render the timeline panel based on current elements + timeline data.
 */
export function renderTimelinePanel() {
  if (!_tracksEl || !_rulerTrack || !_getElements || !_getTimeline) return;

  const elements = _getElements();
  const timeline = _getTimeline();

  // Sync hold select
  const holdSelect = document.getElementById('tlHoldSelect');
  if (holdSelect && holdSelect.value !== String(timeline.holdDuration)) {
    holdSelect.value = String(timeline.holdDuration);
  }

  // Compute phase durations
  const { inDuration, outDuration } = _computePhases(elements);
  const holdDuration = timeline.holdDuration || 0;

  // Render ruler
  _renderRuler(inDuration, holdDuration, outDuration);

  // Render tracks
  _renderTracks(elements, inDuration, holdDuration, outDuration);

  // Render pause points
  _renderPausePoints(timeline.pausePoints || [], inDuration);

  // When idle, position playhead: at START if user clicked GO TO START, else at HOLD
  if (_currentPhase === 'idle' && !_isScrubbing && !_masterTl) {
    if (_atStartPosition) {
      if (_playheadEl) _playheadEl.style.left = `${LABEL_WIDTH}px`;
    } else {
      _snapPlayheadToHold();
    }
  }
}

/* ------------------------------------------------------------------ *
 *  Phase computation
 * ------------------------------------------------------------------ */

function _computePhases(elements) {
  let inDuration = 0;
  let outDuration = 0;

  for (const el of elements) {
    const enter = el.animation?.enter;
    if (enter?.type && enter.type !== 'none') {
      inDuration = Math.max(inDuration, (enter.delay || 0) + (enter.duration || 300));
    }
    // Enter keyframes may be longer than preset duration
    const enterKf = _getEnterKf(el);
    if (enterKf?.enabled && enterKf.tracks?.length > 0) {
      inDuration = Math.max(inDuration, (enter?.delay || 0) + enterKf.duration);
    }

    const exit = el.animation?.exit;
    if (exit?.type && exit.type !== 'none') {
      outDuration = Math.max(outDuration, (exit.delay || 0) + (exit.duration || 300));
    }
    // Exit keyframes
    const exitKf = el.animation?.exitKeyframes;
    if (exitKf?.enabled && exitKf.tracks?.length > 0) {
      outDuration = Math.max(outDuration, (exit?.delay || 0) + exitKf.duration);
    }
  }

  return {
    inDuration: Math.max(inDuration, MIN_PHASE_MS),
    outDuration: Math.max(outDuration, MIN_PHASE_MS),
  };
}

/** Get enter keyframes for an element (new field or legacy fallback). */
function _getEnterKf(el) {
  return el.animation?.enterKeyframes || el.animation?.keyframes || null;
}

/** Check if element has any animation (presets or keyframes). */
function _hasEnterAnim(el) {
  const enter = el.animation?.enter;
  const kf = _getEnterKf(el);
  return (enter?.type && enter.type !== 'none') || (kf?.enabled && kf.tracks?.length > 0);
}

function _hasExitAnim(el) {
  const exit = el.animation?.exit;
  const kf = el.animation?.exitKeyframes;
  return (exit?.type && exit.type !== 'none') || (kf?.enabled && kf.tracks?.length > 0);
}

/* ------------------------------------------------------------------ *
 *  Ruler
 * ------------------------------------------------------------------ */

function _renderRuler(inMs, holdMs, outMs) {
  if (!_rulerTrack) return;
  _rulerTrack.innerHTML = '';

  const totalWidth = _rulerTrack.clientWidth;
  if (totalWidth <= 0) return;

  // Calculate phase widths
  const { inWidth, holdWidth, outWidth } = _phaseWidths(inMs, holdMs, outMs, totalWidth);

  // IN phase ruler
  const inRuler = document.createElement('div');
  inRuler.className = 'tl-phase-ruler in';
  inRuler.style.width = `${inWidth}px`;
  const inLabel = document.createElement('span');
  inLabel.className = 'tl-phase-label';
  inLabel.textContent = 'IN';
  inRuler.appendChild(inLabel);
  _addTicks(inRuler, inMs, inWidth);
  _rulerTrack.appendChild(inRuler);

  // Separator
  _rulerTrack.appendChild(_sep());

  // HOLD phase ruler
  const holdRuler = document.createElement('div');
  holdRuler.className = 'tl-phase-ruler hold';
  holdRuler.style.width = `${holdWidth}px`;
  const holdLabel = document.createElement('span');
  holdLabel.className = 'tl-phase-label';
  holdLabel.textContent = holdMs > 0 ? `HOLD ${_formatMs(holdMs)}` : 'HOLD';
  holdRuler.appendChild(holdLabel);
  _rulerTrack.appendChild(holdRuler);

  // Separator
  _rulerTrack.appendChild(_sep());

  // OUT phase ruler
  const outRuler = document.createElement('div');
  outRuler.className = 'tl-phase-ruler out';
  outRuler.style.width = `${outWidth}px`;
  const outLabel = document.createElement('span');
  outLabel.className = 'tl-phase-label';
  outLabel.textContent = 'OUT';
  outRuler.appendChild(outLabel);
  _addTicks(outRuler, outMs, outWidth);
  _rulerTrack.appendChild(outRuler);
}

function _sep() {
  const d = document.createElement('div');
  d.className = 'tl-separator';
  return d;
}

function _addTicks(container, phaseMs, phaseWidth) {
  const targetTicks = Math.max(2, Math.floor(phaseWidth / 60));
  const interval = _niceInterval(phaseMs / targetTicks);

  for (let ms = interval; ms < phaseMs; ms += interval) {
    const tick = document.createElement('div');
    tick.className = 'tl-tick';
    tick.style.left = `${(ms / phaseMs) * 100}%`;
    tick.textContent = _formatMs(ms);
    container.appendChild(tick);
  }
}

function _niceInterval(raw) {
  const candidates = [50, 100, 200, 250, 500, 1000, 2000, 5000];
  for (const c of candidates) {
    if (c >= raw * 0.6) return c;
  }
  return 5000;
}

function _formatMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/* ------------------------------------------------------------------ *
 *  Track rendering
 * ------------------------------------------------------------------ */

function _renderTracks(elements, inMs, holdMs, outMs) {
  _tracksEl.innerHTML = '';

  const totalWidth = _rulerTrack ? _rulerTrack.clientWidth : 0;
  if (totalWidth <= 0) return;

  const { inWidth, holdWidth, outWidth } = _phaseWidths(inMs, holdMs, outMs, totalWidth);

  // Filter elements that have any animation (presets or keyframes)
  const animatedElements = elements.filter(el => _hasEnterAnim(el) || _hasExitAnim(el));

  if (animatedElements.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'tl-empty';
    empty.textContent = 'No animations configured — select an element and set enter/exit animations';
    _tracksEl.appendChild(empty);
    return;
  }

  for (const el of animatedElements) {
    const track = document.createElement('div');
    track.className = 'tl-track';

    // Label
    const label = document.createElement('div');
    label.className = 'tl-track-label';
    label.textContent = el.name || el.type;
    label.title = el.name || el.type;
    label.addEventListener('click', () => {
      if (_onElementSelect) _onElementSelect(el.id);
    });
    track.appendChild(label);

    // Phase containers
    const phases = document.createElement('div');
    phases.className = 'tl-track-phases';

    // IN phase
    const inPhase = document.createElement('div');
    inPhase.className = 'tl-track-phase in';
    inPhase.style.width = `${inWidth}px`;
    const enterKf = _getEnterKf(el);
    const enterAnim = el.animation?.enter;
    if (enterKf?.enabled && enterKf.tracks?.length > 0) {
      const bar = _createKeyframeBar(el, enterKf, enterAnim, inMs, 'enter');
      inPhase.appendChild(bar);
    } else if (enterAnim?.type && enterAnim.type !== 'none') {
      const bar = _createBar(el, enterAnim, inMs, 'enter');
      inPhase.appendChild(bar);
    }
    phases.appendChild(inPhase);

    // Separator
    const sep1 = document.createElement('div');
    sep1.className = 'tl-track-sep';
    phases.appendChild(sep1);

    // HOLD phase
    const holdPhase = document.createElement('div');
    holdPhase.className = 'tl-track-phase hold';
    holdPhase.style.width = `${holdWidth}px`;
    phases.appendChild(holdPhase);

    // Separator
    const sep2 = document.createElement('div');
    sep2.className = 'tl-track-sep';
    phases.appendChild(sep2);

    // OUT phase
    const outPhase = document.createElement('div');
    outPhase.className = 'tl-track-phase out';
    outPhase.style.width = `${outWidth}px`;
    const exitKf = el.animation?.exitKeyframes;
    const exitAnim = el.animation?.exit;
    if (exitKf?.enabled && exitKf.tracks?.length > 0) {
      const bar = _createKeyframeBar(el, exitKf, exitAnim, outMs, 'exit');
      outPhase.appendChild(bar);
    } else if (exitAnim?.type && exitAnim.type !== 'none') {
      const bar = _createBar(el, exitAnim, outMs, 'exit');
      outPhase.appendChild(bar);
    }
    phases.appendChild(outPhase);

    track.appendChild(phases);
    _tracksEl.appendChild(track);
  }
}

function _phaseWidths(inMs, holdMs, outMs, totalWidth) {
  // Reserve fixed width for HOLD, distribute rest proportionally
  const sepWidth = 4; // 2px * 2 separators
  const holdWidth = holdMs > 0 ? HOLD_VISUAL_WIDTH : 16;
  const remaining = totalWidth - holdWidth - sepWidth;

  if (remaining <= 0) {
    return { inWidth: 0, holdWidth, outWidth: 0 };
  }

  const total = inMs + outMs;
  if (total <= 0) {
    return { inWidth: remaining / 2, holdWidth, outWidth: remaining / 2 };
  }

  const inWidth = Math.floor((inMs / total) * remaining);
  const outWidth = remaining - inWidth;

  return { inWidth, holdWidth, outWidth };
}

/* ------------------------------------------------------------------ *
 *  Bar creation + drag
 * ------------------------------------------------------------------ */

function _createBar(element, anim, phaseMs, mode) {
  const bar = document.createElement('div');
  bar.className = `tl-bar ${mode}`;

  const delay = anim.delay || 0;
  const duration = anim.duration || 300;
  const leftPct = (delay / phaseMs) * 100;
  const widthPct = (duration / phaseMs) * 100;

  bar.style.left = `${leftPct}%`;
  bar.style.width = `${Math.max(widthPct, 2)}%`;
  bar.title = `${anim.type} — ${delay}ms delay, ${duration}ms`;

  // Label
  const label = document.createElement('span');
  label.className = 'tl-bar-label';
  label.textContent = anim.type;
  bar.appendChild(label);

  // Resize handle
  const handle = document.createElement('div');
  handle.className = 'tl-bar-resize';
  bar.appendChild(handle);

  // Drag bar → change delay
  _addBarDrag(bar, element, anim, phaseMs, mode);

  // Resize handle → change duration
  _addResizeDrag(handle, bar, element, anim, phaseMs, mode);

  return bar;
}

/**
 * Create a keyframe-style bar with diamond markers for the timeline.
 */
function _createKeyframeBar(element, kfData, presetAnim, phaseMs, mode) {
  const bar = document.createElement('div');
  bar.className = `tl-bar ${mode} keyframe`;

  const delay = presetAnim?.delay || 0;
  const duration = kfData.duration || 2000;
  const leftPct = (delay / phaseMs) * 100;
  const widthPct = (duration / phaseMs) * 100;

  bar.style.left = `${leftPct}%`;
  bar.style.width = `${Math.max(widthPct, 2)}%`;
  bar.title = `Keyframes — ${delay}ms delay, ${duration}ms`;

  // Label
  const label = document.createElement('span');
  label.className = 'tl-bar-label';
  label.textContent = 'Keyframes';
  bar.appendChild(label);

  // Diamond markers for each unique keyframe time
  const times = new Set();
  for (const track of kfData.tracks) {
    for (const kf of track.keyframes) {
      times.add(kf.time);
    }
  }
  for (const time of times) {
    const diamond = document.createElement('div');
    diamond.className = 'tl-bar-diamond';
    diamond.style.left = `${(time / duration) * 100}%`;
    bar.appendChild(diamond);
  }

  // Drag bar → change delay (same as preset bar, using the preset anim delay)
  if (presetAnim) {
    _addBarDrag(bar, element, presetAnim, phaseMs, mode);
  } else {
    // No preset anim to drag — still allow click-to-select
    bar.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    bar.addEventListener('click', () => {
      if (_onElementSelect) _onElementSelect(element.id);
    });
  }

  // No resize handle — duration is controlled in the designer

  return bar;
}

function _addBarDrag(bar, element, anim, phaseMs, mode) {
  let startX = 0;
  let startDelay = 0;
  let didDrag = false;

  const onMouseDown = (e) => {
    if (e.target.classList.contains('tl-bar-resize')) return;
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startDelay = anim.delay || 0;
    didDrag = false;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    bar.classList.add('dragging');
  };

  const onMouseMove = (e) => {
    const parent = bar.parentElement;
    if (!parent) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) < 3 && !didDrag) return; // dead zone before drag starts
    didDrag = true;
    const trackWidth = parent.clientWidth;
    const dMs = (dx / trackWidth) * phaseMs;
    const newDelay = Math.max(0, Math.round((startDelay + dMs) / 50) * 50);

    anim.delay = newDelay;
    const leftPct = (newDelay / phaseMs) * 100;
    bar.style.left = `${leftPct}%`;
    bar.title = `${anim.type} — ${newDelay}ms delay, ${anim.duration || 300}ms`;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    bar.classList.remove('dragging');

    if (didDrag) {
      // Actual drag — commit the delay change
      if (_onAnimationChange) {
        _onAnimationChange(element.id, { [mode === 'enter' ? 'enter' : 'exit']: { ...anim } });
      }
    } else {
      // Click (no drag) — select the element
      if (_onElementSelect) _onElementSelect(element.id);
    }
  };

  bar.addEventListener('mousedown', onMouseDown);
}

function _addResizeDrag(handle, bar, element, anim, phaseMs, mode) {
  let startX = 0;
  let startDuration = 0;

  const onMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startDuration = anim.duration || 300;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    bar.classList.add('resizing');
  };

  const onMouseMove = (e) => {
    const parent = bar.parentElement;
    if (!parent) return;
    const trackWidth = parent.clientWidth;
    const dx = e.clientX - startX;
    const dMs = (dx / trackWidth) * phaseMs;
    const newDuration = Math.max(100, Math.round((startDuration + dMs) / 50) * 50);

    anim.duration = newDuration;
    const widthPct = (newDuration / phaseMs) * 100;
    bar.style.width = `${Math.max(widthPct, 2)}%`;
    bar.title = `${anim.type} — ${anim.delay || 0}ms delay, ${newDuration}ms`;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    bar.classList.remove('resizing');

    if (_onAnimationChange) {
      _onAnimationChange(element.id, { [mode === 'enter' ? 'enter' : 'exit']: { ...anim } });
    }
  };

  handle.addEventListener('mousedown', onMouseDown);
}

/* ------------------------------------------------------------------ *
 *  Pause points
 * ------------------------------------------------------------------ */

function _addPausePoint() {
  if (!_getTimeline || !_onTimelineChange) return;
  const timeline = _getTimeline();
  const elements = _getElements ? _getElements() : [];
  const { inDuration } = _computePhases(elements);

  // Place at 50% of IN phase by default
  const time = Math.round(inDuration * 0.5 / 50) * 50;
  const id = `pp_${Date.now()}`;
  const pausePoints = [...(timeline.pausePoints || []), { id, time, label: 'Pause' }];

  _onTimelineChange({ pausePoints });
  _expandPanel();
  renderTimelinePanel();
}

function _renderPausePoints(pausePoints, inDuration) {
  // Remove existing pause point elements
  if (!_bodyEl) return;
  _bodyEl.querySelectorAll('.tl-pause-point').forEach(el => el.remove());

  if (!_rulerTrack || pausePoints.length === 0) return;

  const totalWidth = _rulerTrack.clientWidth;
  if (totalWidth <= 0) return;

  const elements = _getElements ? _getElements() : [];
  const timeline = _getTimeline ? _getTimeline() : {};
  const { inDuration: inMs, outDuration: outMs } = _computePhases(elements);
  const holdMs = timeline.holdDuration || 0;
  const { inWidth } = _phaseWidths(inMs, holdMs, outMs, totalWidth);

  for (const pp of pausePoints) {
    if (pp.time > inMs) continue; // Only show pause points in IN phase for now

    const marker = document.createElement('div');
    marker.className = 'tl-pause-point';
    // Position relative to body: LABEL_WIDTH + (time / inMs) * inWidth
    const xOffset = (pp.time / inMs) * inWidth;
    marker.style.left = `${LABEL_WIDTH + xOffset}px`;

    const ppLabel = document.createElement('span');
    ppLabel.className = 'tl-pause-point-label';
    ppLabel.textContent = pp.label || 'Pause';
    marker.appendChild(ppLabel);

    // Delete button (visible on hover)
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'tl-pause-point-delete';
    deleteBtn.textContent = '\u00d7';
    deleteBtn.title = 'Delete pause point';
    deleteBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_getTimeline || !_onTimelineChange) return;
      const tl = _getTimeline();
      const newPoints = (tl.pausePoints || []).filter(p => p.id !== pp.id);
      _onTimelineChange({ pausePoints: newPoints });
      renderTimelinePanel();
    });
    marker.appendChild(deleteBtn);

    // Drag to reposition
    _addPausePointDrag(marker, pp, inMs, inWidth);

    // Right-click to delete
    marker.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!_getTimeline || !_onTimelineChange) return;
      const tl = _getTimeline();
      const newPoints = (tl.pausePoints || []).filter(p => p.id !== pp.id);
      _onTimelineChange({ pausePoints: newPoints });
      renderTimelinePanel();
    });

    _bodyEl.appendChild(marker);
  }
}

function _addPausePointDrag(marker, pp, inMs, inWidth) {
  let startX = 0;
  let startTime = 0;

  const onMouseDown = (e) => {
    e.preventDefault();
    startX = e.clientX;
    startTime = pp.time;
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const onMouseMove = (e) => {
    const dx = e.clientX - startX;
    const dMs = (dx / inWidth) * inMs;
    const newTime = Math.max(0, Math.min(inMs, Math.round((startTime + dMs) / 50) * 50));
    pp.time = newTime;
    const xOffset = (newTime / inMs) * inWidth;
    marker.style.left = `${LABEL_WIDTH + xOffset}px`;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    if (_getTimeline && _onTimelineChange) {
      const tl = _getTimeline();
      _onTimelineChange({ pausePoints: [...(tl.pausePoints || [])] });
    }
  };

  marker.addEventListener('mousedown', onMouseDown);
}

/* ------------------------------------------------------------------ *
 *  Transport: TAKE ON / RESUME / TAKE OFF
 * ------------------------------------------------------------------ */

function _takeOn() {
  _atStartPosition = false;
  if (_currentPhase !== 'idle' || _masterTl) _hardReset();
  if (!_getElements || !_getTimeline) return;

  const elements = _getElements();
  const timeline = _getTimeline();
  const { inDuration } = _computePhases(elements);

  // Build IN-phase-only timeline
  const enterElements = elements.filter(el => _hasEnterAnim(el));

  if (enterElements.length === 0) {
    // No enter animations — go straight to hold
    _currentPhase = 'in';
    _isPlaying = true;
    if (_playheadEl) _playheadEl.classList.add('active');
    _enterHold();
    return;
  }

  _masterTl = gsap.timeline({
    onUpdate: () => { if (!_isScrubbing) _updatePlayhead(); },
    onComplete: () => { if (!_isScrubbing) _enterHold(); },
  });

  for (const el of enterElements) {
    const node = document.querySelector(`#canvasContainer [data-element-id="${el.id}"]`);
    if (!node) continue;

    const enterKf = _getEnterKf(el);
    const anim = el.animation?.enter || {};
    const delay = (anim.delay || 0) / 1000;

    // Use keyframes if enabled, otherwise use preset
    if (enterKf?.enabled && enterKf.tracks?.length > 0) {
      const subTl = buildGsapTimeline(node, enterKf);
      _masterTl.add(subTl, delay);
    } else {
      const preset = getEnterPreset(anim.type);
      if (!preset) continue;
      const duration = (anim.duration || 300) / 1000;
      const easing = anim.easing || preset.defaultEase || 'power2.out';
      const safeClearProps = preset.clearProps || Object.keys(preset.vars).join(',');
      const elRef = el; // capture for closure
      _masterTl.from(node, {
        ...preset.vars,
        duration,
        ease: easing,
        onComplete: () => {
          gsap.set(node, { clearProps: safeClearProps });
          _restoreBaseTransform(elRef, node);
        },
      }, delay);
    }
  }

  // Animated clip-paths: if a mask element has an enter animation, animate
  // the clip-path on its dependent (clipped) elements from offset → rest position
  _addClipPathAnimations(_masterTl, elements);

  // Add pause points during IN phase
  const pausePoints = (timeline.pausePoints || []).sort((a, b) => a.time - b.time);
  for (const pp of pausePoints) {
    const ppTimeSec = pp.time / 1000;
    if (ppTimeSec < inDuration / 1000) {
      _masterTl.addPause(ppTimeSec);
    }
  }

  _currentPhase = 'in';
  _isPlaying = true;
  if (_playheadEl) _playheadEl.classList.add('active');
  _updateTransportButtons();
}

function _enterHold() {
  // Kill IN timeline
  if (_masterTl) {
    _masterTl.kill();
    _masterTl = null;
  }

  _currentPhase = 'hold';
  _isPlaying = true;

  // Position playhead at hold area
  _updatePlayhead();
  if (_playheadEl) _playheadEl.classList.add('active');
  _updateTransportButtons();
  // Hold indefinitely until TAKE OFF
}

function _resume() {
  if (_currentPhase === 'in' && _masterTl && _masterTl.paused()) {
    _masterTl.resume();
  }
}

function _takeOff() {
  if (_currentPhase === 'idle') return;

  // Clear hold timer
  if (_holdTimer) {
    clearTimeout(_holdTimer);
    _holdTimer = null;
  }

  // Kill IN timeline if still active
  if (_masterTl) {
    _masterTl.kill();
    _masterTl = null;
  }

  if (!_getElements) {
    _hardReset();
    return;
  }

  const elements = _getElements();
  const { outDuration } = _computePhases(elements);

  // Build OUT-phase-only timeline
  const exitElements = elements.filter(el => _hasExitAnim(el));

  if (exitElements.length === 0) {
    _hardReset();
    return;
  }

  _currentPhase = 'out';
  _updateTransportButtons();

  _masterTl = gsap.timeline({
    onUpdate: () => { if (!_isScrubbing) _updatePlayhead(); },
    onComplete: () => { if (!_isScrubbing) _finishTakeOff(); },
  });

  for (const el of exitElements) {
    const node = document.querySelector(`#canvasContainer [data-element-id="${el.id}"]`);
    if (!node) continue;

    const exitKf = el.animation?.exitKeyframes;
    const anim = el.animation?.exit || {};
    const delay = (anim.delay || 0) / 1000;

    if (exitKf?.enabled && exitKf.tracks?.length > 0) {
      const subTl = buildGsapTimeline(node, exitKf);
      _masterTl.add(subTl, delay);
    } else {
      const preset = getExitPreset(anim.type);
      if (!preset) continue;
      const duration = (anim.duration || 300) / 1000;
      const easing = anim.easing || preset.defaultEase || 'power2.in';
      _masterTl.to(node, {
        ...preset.vars,
        duration,
        ease: easing,
      }, delay);
    }
  }
}

/**
 * Skip the IN phase — snap all enter animations to their end state
 * and go straight to HOLD.
 */
function _goToHold() {
  _atStartPosition = false;
  if (_currentPhase !== 'idle' || _masterTl) _hardReset();
  if (!_getElements) return;

  const elements = _getElements();

  // Snap all enter animations to their end state (elements fully visible)
  const enterElements = elements.filter(el => _hasEnterAnim(el));

  for (const el of enterElements) {
    const node = document.querySelector(`#canvasContainer [data-element-id="${el.id}"]`);
    if (!node) continue;

    const enterKf = _getEnterKf(el);
    if (enterKf?.enabled && enterKf.tracks?.length > 0) {
      // Keyframe: snap to the final keyframe value for each track
      // (the hold state is wherever the keyframe animation ends, not CSS rest)
      const endState = {};
      for (const track of enterKf.tracks) {
        if (track.keyframes.length > 0) {
          const last = track.keyframes.reduce((a, b) => a.time > b.time ? a : b);
          if (SCENE3D_KEYS.has(track.property)) {
            // Route scene3d properties directly to Three.js controller
            applyScene3dProp(node, track.property, last.value);
          } else {
            const gsapProp = track.property === 'x' ? 'xPercent'
                           : track.property === 'y' ? 'yPercent'
                           : track.property;
            endState[gsapProp] = last.value;
          }
        }
      }
      if (Object.keys(endState).length > 0) {
        gsap.set(node, endState);
      }
    } else {
      const anim = el.animation?.enter;
      const preset = anim?.type ? getEnterPreset(anim.type) : null;
      if (preset) {
        const safeClearProps = preset.clearProps || Object.keys(preset.vars).join(',');
        gsap.set(node, { clearProps: safeClearProps });
        _restoreBaseTransform(el, node);
      }
    }
  }

  // Restore static clip-paths on mask-dependent elements (snap to final state)
  _restoreStaticClipPaths(elements);

  _enterHold();
}

/**
 * Called when the OUT phase completes. Pauses briefly so the user can see
 * the final exit state before resetting elements for editing.
 */
function _finishTakeOff() {
  if (_masterTl) {
    _masterTl.kill();
    _masterTl = null;
  }

  // Pause 1s after exit completes so elements don't flash back immediately
  _currentPhase = 'out';
  _updateTransportButtons();

  setTimeout(() => {
    // Reset GSAP transforms so elements are visible for editing
    _resetAllElements();

    _currentPhase = 'idle';
    _isPlaying = false;

    // Snap playhead to HOLD position so it's clear we're back in editing state
    _snapPlayheadToHold();
    if (_playheadEl) _playheadEl.classList.remove('active');

    _updateTransportButtons();
  }, 1000);
}

function _hardReset() {
  _isScrubbing = false;
  if (_masterTl) {
    _masterTl.kill();
    _masterTl = null;
  }

  if (_holdTimer) {
    clearTimeout(_holdTimer);
    _holdTimer = null;
  }

  _currentPhase = 'idle';
  _isPlaying = false;
  if (_playheadEl) {
    _playheadEl.classList.remove('active');
    _playheadEl.style.left = '0px';
  }

  // Reset any GSAP-applied transforms on canvas elements
  _resetAllElements();

  _updateTransportButtons();
}

function _resetAllElements() {
  if (!_getElements) return;
  const elements = _getElements();
  for (const el of elements) {
    const node = document.querySelector(`#canvasContainer [data-element-id="${el.id}"]`);
    if (!node) continue;

    // If element uses keyframes, clear only GSAP transform props + the specific
    // properties that the keyframes actually animate. Don't blanket-clear
    // backgroundColor/color/opacity — those are set by canvas-engine, not GSAP.
    // Scene3d properties (Three.js) are routed through applyScene3dProp, not GSAP.
    const enterKf = _getEnterKf(el);
    const exitKf = el.animation?.exitKeyframes;
    if ((enterKf?.enabled) || (exitKf?.enabled)) {
      // Build dynamic clearProps from actual keyframe tracks (skip scene3d — not CSS)
      const clearSet = new Set(['transform', 'xPercent', 'yPercent']);
      const allTracks = [
        ...(enterKf?.tracks || []),
        ...(exitKf?.tracks || []),
      ];
      for (const track of allTracks) {
        if (SCENE3D_KEYS.has(track.property)) continue;
        const gsapProp = track.property === 'x' ? 'xPercent'
                       : track.property === 'y' ? 'yPercent'
                       : track.property;
        clearSet.add(gsapProp);
      }
      gsap.set(node, { clearProps: [...clearSet].join(',') });
      _restoreBaseTransform(el, node);
      // Re-apply final keyframe values so element stays in hold state, not CSS rest
      if (enterKf?.enabled && enterKf.tracks?.length > 0) {
        const endState = {};
        for (const track of enterKf.tracks) {
          if (track.keyframes.length > 0) {
            const last = track.keyframes.reduce((a, b) => a.time > b.time ? a : b);
            if (SCENE3D_KEYS.has(track.property)) {
              applyScene3dProp(node, track.property, last.value);
            } else {
              const gsapProp = track.property === 'x' ? 'xPercent'
                             : track.property === 'y' ? 'yPercent'
                             : track.property;
              endState[gsapProp] = last.value;
            }
          }
        }
        if (Object.keys(endState).length > 0) {
          gsap.set(node, endState);
        }
      }
      continue;
    }

    const enterPreset = el.animation?.enter?.type ? getEnterPreset(el.animation.enter.type) : null;
    const exitPreset = el.animation?.exit?.type ? getExitPreset(el.animation.exit.type) : null;

    const propsToReset = new Set();
    if (enterPreset) {
      (enterPreset.clearProps || Object.keys(enterPreset.vars).join(',')).split(',').forEach(p => propsToReset.add(p.trim()));
    }
    if (exitPreset) {
      (exitPreset.clearProps || Object.keys(exitPreset.vars).join(',')).split(',').forEach(p => propsToReset.add(p.trim()));
    }

    if (propsToReset.size > 0) {
      gsap.set(node, { clearProps: [...propsToReset].join(',') });
      _restoreBaseTransform(el, node);
    }
  }

  // Restore static clip-paths on mask-dependent elements
  _restoreStaticClipPaths(elements);
}

/**
 * Restore the static (final) clip-path on all mask-dependent elements.
 * Called after animations complete or on reset to ensure clip-paths match
 * the mask elements' rest positions (not their animated from-positions).
 */
function _restoreStaticClipPaths(elements) {
  for (const el of elements) {
    if (!el.clipMask?.elementId) continue;
    const maskEl = elements.find(m => m.id === el.clipMask.elementId);
    if (!maskEl) continue;
    const clippedNode = document.querySelector(`#canvasContainer [data-element-id="${el.id}"]`);
    if (!clippedNode) continue;
    const cp = computeClipPath(el, maskEl);
    clippedNode.style.clipPath = cp || 'none';
  }
}

function _updateTransportButtons() {
  const takeOnBtn = document.getElementById('tlTakeOnBtn');
  const resumeBtn = document.getElementById('tlResumeBtn');
  const takeOffBtn = document.getElementById('tlTakeOffBtn');
  const goHoldBtn = document.getElementById('tlGoHoldBtn');

  if (takeOnBtn) {
    takeOnBtn.disabled = _currentPhase !== 'idle';
    takeOnBtn.style.opacity = _currentPhase !== 'idle' ? '0.4' : '';
  }
  if (resumeBtn) {
    resumeBtn.style.display = _currentPhase === 'in' ? '' : 'none';
  }
  if (takeOffBtn) {
    takeOffBtn.disabled = _currentPhase === 'idle' || _currentPhase === 'out';
    takeOffBtn.style.opacity = (_currentPhase === 'idle' || _currentPhase === 'out') ? '0.4' : '';
  }
  if (goHoldBtn) {
    goHoldBtn.disabled = _currentPhase !== 'idle';
    goHoldBtn.style.opacity = _currentPhase !== 'idle' ? '0.4' : '';
  }
}

/* ------------------------------------------------------------------ *
 *  Playhead scrubbing
 * ------------------------------------------------------------------ */

function _initScrubbing() {
  const startScrub = (e, getX) => {
    e.preventDefault();

    // Reset any active playout or leftover scrub state
    if (_currentPhase !== 'idle' || _masterTl) {
      if (_masterTl) { _masterTl.kill(); _masterTl = null; }
      if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; }
      _resetAllElements();
      _currentPhase = 'idle';
      _isPlaying = false;
      _updateTransportButtons();
    }

    _isScrubbing = true;
    _expandPanel();

    // Build a full IN+HOLD+OUT scrub timeline
    _masterTl = _buildScrubTimeline();
    if (!_masterTl) { _isScrubbing = false; return; }

    if (_playheadEl) _playheadEl.classList.add('active');
    _scrubToX(getX(e));

    const onMove = (ev) => {
      if (!_isScrubbing || !_masterTl) return;
      _scrubToX(getX(ev));
    };

    const onUp = () => {
      _isScrubbing = false;
      // Leave the scrub timeline paused at current position so elements
      // stay where the user dropped the playhead (don't reset).
      // The timeline will be killed on next transport action.
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Ruler track scrubbing
  if (_rulerTrack) {
    _rulerTrack.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tl-pause-point')) return;
      const rect = _rulerTrack.getBoundingClientRect();
      startScrub(e, (ev) => ev.clientX - rect.left);
    });
  }

  // Body area scrubbing (empty space only)
  if (_bodyEl) {
    _bodyEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tl-bar, .tl-bar-resize, .tl-pause-point, .tl-pause-point-delete, .tl-track-label')) return;
      const rect = _bodyEl.getBoundingClientRect();
      startScrub(e, (ev) => ev.clientX - rect.left - LABEL_WIDTH);
    });
  }
}

/**
 * Build a full IN+HOLD+OUT timeline for scrub preview (paused).
 */
function _buildScrubTimeline() {
  if (!_getElements || !_getTimeline) return null;

  const elements = _getElements();
  const timeline = _getTimeline();
  const { inDuration, outDuration } = _computePhases(elements);
  const holdMs = timeline.holdDuration || 0;

  const tl = gsap.timeline({ paused: true });

  // IN phase
  const enterElements = elements.filter(el => _hasEnterAnim(el));

  for (const el of enterElements) {
    const node = document.querySelector(`#canvasContainer [data-element-id="${el.id}"]`);
    if (!node) continue;

    const enterKf = _getEnterKf(el);
    const anim = el.animation?.enter || {};
    const delay = (anim.delay || 0) / 1000;

    if (enterKf?.enabled && enterKf.tracks?.length > 0) {
      const subTl = buildGsapTimeline(node, enterKf);
      tl.add(subTl, delay);
    } else {
      const preset = getEnterPreset(anim.type);
      if (!preset) continue;
      const duration = (anim.duration || 300) / 1000;
      const easing = anim.easing || preset.defaultEase || 'power2.out';
      tl.from(node, { ...preset.vars, duration, ease: easing }, delay);
    }
  }

  // Animated clip-paths for scrub timeline
  _addClipPathAnimations(tl, elements);

  // HOLD phase (empty tween to advance timeline)
  const holdStart = inDuration / 1000;
  if (holdMs > 0) {
    tl.to({}, { duration: holdMs / 1000 }, holdStart);
  }

  // OUT phase
  const exitElements = elements.filter(el => _hasExitAnim(el));

  const outStart = holdStart + (holdMs > 0 ? holdMs / 1000 : 0.001);

  for (const el of exitElements) {
    const node = document.querySelector(`#canvasContainer [data-element-id="${el.id}"]`);
    if (!node) continue;

    const exitKf = el.animation?.exitKeyframes;
    const anim = el.animation?.exit || {};
    const delay = (anim.delay || 0) / 1000;

    if (exitKf?.enabled && exitKf.tracks?.length > 0) {
      const subTl = buildGsapTimeline(node, exitKf);
      tl.add(subTl, outStart + delay);
    } else {
      const preset = getExitPreset(anim.type);
      if (!preset) continue;
      const duration = (anim.duration || 300) / 1000;
      const easing = anim.easing || preset.defaultEase || 'power2.in';
      tl.to(node, { ...preset.vars, duration, ease: easing }, outStart + delay);
    }
  }

  return tl;
}

function _scrubToX(xInTrack) {
  if (!_masterTl || !_rulerTrack) return;
  const timeSec = _positionToTime(xInTrack);
  _masterTl.seek(timeSec);
  _updatePlayhead(); // Manual call — GSAP seek() suppresses onUpdate
}

function _positionToTime(xInTrack) {
  if (!_rulerTrack) return 0;
  const elements = _getElements ? _getElements() : [];
  const timeline = _getTimeline ? _getTimeline() : {};
  const { inDuration: inMs, outDuration: outMs } = _computePhases(elements);
  const holdMs = timeline.holdDuration || 0;
  const totalWidth = _rulerTrack.clientWidth;
  if (totalWidth <= 0) return 0;

  const { inWidth, holdWidth, outWidth } = _phaseWidths(inMs, holdMs, outMs, totalWidth);
  const sepW = 2;
  const x = Math.max(0, Math.min(xInTrack, totalWidth));

  if (x <= inWidth) {
    return inWidth > 0 ? (x / inWidth) * inMs / 1000 : 0;
  } else if (x <= inWidth + sepW + holdWidth) {
    const holdX = x - inWidth - sepW;
    const holdProgress = holdWidth > 0 ? Math.max(0, holdX / holdWidth) : 0;
    return (inMs + holdProgress * holdMs) / 1000;
  } else {
    const outX = x - inWidth - sepW - holdWidth - sepW;
    const outProgress = outWidth > 0 ? Math.max(0, Math.min(1, outX / outWidth)) : 0;
    return (inMs + holdMs + outProgress * outMs) / 1000;
  }
}

/* ------------------------------------------------------------------ *
 *  Playhead animation
 * ------------------------------------------------------------------ */

function _updatePlayhead() {
  if (!_playheadEl || !_rulerTrack || !_getElements || !_getTimeline) return;

  const totalWidth = _rulerTrack.clientWidth;
  if (totalWidth <= 0) return;

  const elements = _getElements();
  const timeline = _getTimeline();
  const { inDuration: inMs, outDuration: outMs } = _computePhases(elements);
  const holdMs = timeline.holdDuration || 0;
  const { inWidth, holdWidth, outWidth } = _phaseWidths(inMs, holdMs, outMs, totalWidth);
  const sepWidth = 2;

  let xPos = 0;

  if (_isScrubbing && _masterTl) {
    // Full three-phase position from scrub timeline
    const currentTime = _masterTl.time() * 1000;
    const inEnd = inMs;
    const holdEnd = inEnd + holdMs;

    if (currentTime <= inEnd) {
      xPos = LABEL_WIDTH + (inMs > 0 ? (currentTime / inMs) * inWidth : 0);
    } else if (currentTime <= holdEnd) {
      const holdProgress = holdMs > 0 ? (currentTime - inEnd) / holdMs : 0.5;
      xPos = LABEL_WIDTH + inWidth + sepWidth + holdProgress * holdWidth;
    } else {
      const outProgress = outMs > 0 ? (currentTime - holdEnd) / outMs : 0;
      xPos = LABEL_WIDTH + inWidth + sepWidth + holdWidth + sepWidth + outProgress * outWidth;
    }
  } else if (_currentPhase === 'in' && _masterTl) {
    // IN phase only — timeline covers 0..inDuration
    const currentTime = _masterTl.time() * 1000;
    xPos = LABEL_WIDTH + (inMs > 0 ? (currentTime / inMs) * inWidth : 0);
  } else if (_currentPhase === 'hold') {
    // Static position in middle of HOLD column
    xPos = LABEL_WIDTH + inWidth + sepWidth + holdWidth * 0.5;
  } else if (_currentPhase === 'out' && _masterTl) {
    // OUT phase only — timeline covers 0..outDuration
    const currentTime = _masterTl.time() * 1000;
    xPos = LABEL_WIDTH + inWidth + sepWidth + holdWidth + sepWidth +
      (outMs > 0 ? (currentTime / outMs) * outWidth : 0);
  }

  _playheadEl.style.left = `${xPos}px`;
}

/* ------------------------------------------------------------------ *
 *  Helpers
 * ------------------------------------------------------------------ */

/**
 * Snap playhead to the HOLD position (middle of the HOLD column).
 * Used after playback finishes to show editing state visually.
 */
function _snapPlayheadToHold() {
  if (!_playheadEl || !_rulerTrack || !_getElements || !_getTimeline) return;
  const totalWidth = _rulerTrack.clientWidth;
  if (totalWidth <= 0) return;

  const elements = _getElements();
  const timeline = _getTimeline();
  const { inDuration: inMs, outDuration: outMs } = _computePhases(elements);
  const holdMs = timeline.holdDuration || 0;
  const { inWidth, holdWidth } = _phaseWidths(inMs, holdMs, outMs, totalWidth);

  const xPos = LABEL_WIDTH + inWidth + 2 + holdWidth * 0.5;
  _playheadEl.style.left = `${xPos}px`;
}

/**
 * Go to Start — reset everything to idle state and position playhead
 * at the beginning of the timeline (before IN animations).
 */
function _goToStart() {
  // Kill any active GSAP timeline or hold timer
  if (_masterTl) { _masterTl.kill(); _masterTl = null; }
  if (_holdTimer) { clearTimeout(_holdTimer); _holdTimer = null; }
  _isScrubbing = false;

  // Reset all GSAP transforms so elements are back in their editing state
  _resetAllElements();

  _currentPhase = 'idle';
  _isPlaying = false;
  _atStartPosition = true;

  // Snap playhead to the START of the timeline (left edge) and deactivate
  if (_playheadEl) {
    _playheadEl.style.left = `${LABEL_WIDTH}px`;
    _playheadEl.classList.remove('active');
  }

  _updateTransportButtons();
}

function _expandPanel() {
  if (!_collapsed) return;
  _collapsed = false;
  if (_panelEl) _panelEl.classList.remove('collapsed');
  const toggleBtn = document.getElementById('tlToggleBtn');
  if (toggleBtn) toggleBtn.textContent = '\u25BC';
  requestAnimationFrame(() => renderTimelinePanel());
}
