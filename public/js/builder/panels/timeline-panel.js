/**
 * Timeline panel — visual timeline for per-element animation delay & duration.
 *
 * Shows horizontal bars for each element with enter/exit animations.
 * Bars are positioned by delay and sized by duration.
 * Drag bar → updates delay, drag right edge → updates duration.
 * "Play All" previews the orchestrated enter sequence via GSAP.
 */

import { getEnterPreset, getExitPreset } from '/js/shared/animation-presets.js';

/** @type {Function} */
let _getElements = null;

/** @type {Function} */
let _onAnimationChange = null;

/** @type {Function} */
let _onElementSelect = null;

/** @type {HTMLElement} */
let _panelEl = null;

/** @type {HTMLElement} */
let _tracksEl = null;

/** @type {HTMLElement} */
let _rulerEl = null;

let _collapsed = true;
let _mode = 'enter'; // 'enter' | 'exit'

// Timeline scale: how many ms per pixel
const MIN_TIMELINE_MS = 2000;
const TRACK_HEIGHT = 24;
const LABEL_WIDTH = 100;

/**
 * Initialize the timeline panel.
 * @param {object} opts
 * @param {Function} opts.getElements - Returns current elements array
 * @param {Function} opts.onAnimationChange - Called with (elementId, animChanges)
 * @param {Function} opts.onElementSelect - Called with (elementId)
 */
export function initTimelinePanel(opts) {
  _getElements = opts.getElements;
  _onAnimationChange = opts.onAnimationChange;
  _onElementSelect = opts.onElementSelect;

  _panelEl = document.getElementById('timelinePanel');
  _tracksEl = document.getElementById('timelineTracks');
  _rulerEl = document.getElementById('timelineRuler');

  if (!_panelEl) return;

  // Toggle collapse
  const toggleBtn = document.getElementById('timelineToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      _collapsed = !_collapsed;
      _panelEl.classList.toggle('collapsed', _collapsed);
      toggleBtn.textContent = _collapsed ? '\u25B2' : '\u25BC';
      // Re-render after expanding so clientWidth is available for ruler
      if (!_collapsed) {
        requestAnimationFrame(() => renderTimelinePanel());
      }
    });
  }

  // Mode toggle
  const modeToggle = document.getElementById('timelineModeToggle');
  if (modeToggle) {
    modeToggle.addEventListener('click', () => {
      _mode = _mode === 'enter' ? 'exit' : 'enter';
      modeToggle.textContent = _mode === 'enter' ? 'Enter' : 'Exit';
      _expandPanel();
      renderTimelinePanel();
    });
  }

  // Play All
  const playBtn = document.getElementById('timelinePlayAll');
  if (playBtn) {
    playBtn.addEventListener('click', () => {
      _expandPanel();
      _playAll();
    });
  }
}

/**
 * Expand the timeline panel if it is collapsed.
 */
function _expandPanel() {
  if (!_collapsed) return;
  _collapsed = false;
  if (_panelEl) _panelEl.classList.remove('collapsed');
  const toggleBtn = document.getElementById('timelineToggle');
  if (toggleBtn) toggleBtn.textContent = '\u25BC';
}

/**
 * Render the timeline panel based on current elements.
 */
export function renderTimelinePanel() {
  if (!_tracksEl || !_rulerEl || !_getElements) return;

  const elements = _getElements();
  const animKey = _mode; // 'enter' or 'exit'

  // Filter elements that have a non-none animation for the current mode
  const animatedElements = elements.filter(el => {
    const anim = el.animation?.[animKey];
    return anim && anim.type && anim.type !== 'none';
  });

  // Calculate total timeline duration
  let maxEnd = MIN_TIMELINE_MS;
  for (const el of animatedElements) {
    const anim = el.animation[animKey];
    const end = (anim.delay || 0) + (anim.duration || 300);
    if (end > maxEnd) maxEnd = end;
  }
  // Add 20% padding
  const timelineMs = Math.ceil(maxEnd * 1.2);

  // Render ruler
  _renderRuler(timelineMs);

  // Render tracks
  _tracksEl.innerHTML = '';

  if (animatedElements.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'timeline-empty';
    empty.textContent = `No ${_mode} animations configured`;
    _tracksEl.appendChild(empty);
    return;
  }

  for (const el of animatedElements) {
    const anim = el.animation[animKey];
    const track = _createTrack(el, anim, timelineMs, animKey);
    _tracksEl.appendChild(track);
  }
}

// ---------------------------------------------------------------------------
// Ruler
// ---------------------------------------------------------------------------

function _renderRuler(timelineMs) {
  if (!_rulerEl) return;
  _rulerEl.innerHTML = '';

  // Calculate a nice tick interval
  const targetTicks = 8;
  const rawInterval = timelineMs / targetTicks;
  const niceInterval = _niceInterval(rawInterval);

  for (let ms = 0; ms <= timelineMs; ms += niceInterval) {
    const tick = document.createElement('div');
    tick.className = 'timeline-tick';
    // Position ticks using calc: offset by label width, then percentage of remaining space
    const pct = (ms / timelineMs) * 100;
    tick.style.left = `calc(${LABEL_WIDTH}px + (100% - ${LABEL_WIDTH}px) * ${pct / 100})`;
    tick.textContent = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
    _rulerEl.appendChild(tick);
  }
}

function _niceInterval(raw) {
  const candidates = [50, 100, 200, 250, 500, 1000, 2000, 5000];
  for (const c of candidates) {
    if (c >= raw * 0.6) return c;
  }
  return 5000;
}

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------

function _createTrack(element, anim, timelineMs, animKey) {
  const track = document.createElement('div');
  track.className = 'timeline-track';
  track.style.height = `${TRACK_HEIGHT}px`;

  // Label
  const label = document.createElement('div');
  label.className = 'timeline-track-label';
  label.style.width = `${LABEL_WIDTH}px`;
  label.textContent = element.name || element.type;
  label.title = element.name;
  label.addEventListener('click', () => {
    if (_onElementSelect) _onElementSelect(element.id);
  });
  track.appendChild(label);

  // Track area
  const trackArea = document.createElement('div');
  trackArea.className = 'timeline-track-area';

  // Bar
  const delay = anim.delay || 0;
  const duration = anim.duration || 300;
  const bar = document.createElement('div');
  bar.className = 'timeline-bar';
  bar.title = `${anim.type} — ${delay}ms delay, ${duration}ms duration`;

  const leftPct = (delay / timelineMs) * 100;
  const widthPct = (duration / timelineMs) * 100;
  bar.style.left = `${leftPct}%`;
  bar.style.width = `${Math.max(widthPct, 1)}%`;

  // Bar label
  const barLabel = document.createElement('span');
  barLabel.className = 'timeline-bar-label';
  barLabel.textContent = anim.type;
  bar.appendChild(barLabel);

  // Resize handle (right edge)
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'timeline-bar-resize';
  bar.appendChild(resizeHandle);

  // Drag bar → change delay
  _addBarDrag(bar, element, anim, timelineMs, animKey, trackArea);

  // Drag resize handle → change duration
  _addResizeDrag(resizeHandle, bar, element, anim, timelineMs, animKey, trackArea);

  trackArea.appendChild(bar);
  track.appendChild(trackArea);
  return track;
}

// ---------------------------------------------------------------------------
// Bar drag (delay)
// ---------------------------------------------------------------------------

function _addBarDrag(bar, element, anim, timelineMs, animKey, trackArea) {
  let startX = 0;
  let startDelay = 0;

  const onMouseDown = (e) => {
    // Don't start drag if clicking the resize handle
    if (e.target.classList.contains('timeline-bar-resize')) return;

    e.preventDefault();
    e.stopPropagation();
    startX = e.clientX;
    startDelay = anim.delay || 0;

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    bar.classList.add('dragging');
  };

  const onMouseMove = (e) => {
    const trackWidth = trackArea.clientWidth;
    const dx = e.clientX - startX;
    const dMs = (dx / trackWidth) * timelineMs;
    const newDelay = Math.max(0, Math.round((startDelay + dMs) / 50) * 50);

    anim.delay = newDelay;
    const leftPct = (newDelay / timelineMs) * 100;
    bar.style.left = `${leftPct}%`;
    bar.title = `${anim.type} — ${newDelay}ms delay, ${anim.duration || 300}ms duration`;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    bar.classList.remove('dragging');

    // Emit change
    if (_onAnimationChange) {
      _onAnimationChange(element.id, {
        [animKey]: { ...anim },
      });
    }
  };

  bar.addEventListener('mousedown', onMouseDown);
}

// ---------------------------------------------------------------------------
// Resize drag (duration)
// ---------------------------------------------------------------------------

function _addResizeDrag(handle, bar, element, anim, timelineMs, animKey, trackArea) {
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
    const trackWidth = trackArea.clientWidth;
    const dx = e.clientX - startX;
    const dMs = (dx / trackWidth) * timelineMs;
    const newDuration = Math.max(100, Math.round((startDuration + dMs) / 50) * 50);

    anim.duration = newDuration;
    const widthPct = (newDuration / timelineMs) * 100;
    bar.style.width = `${Math.max(widthPct, 1)}%`;
    bar.title = `${anim.type} — ${anim.delay || 0}ms delay, ${newDuration}ms duration`;
  };

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    bar.classList.remove('resizing');

    // Emit change
    if (_onAnimationChange) {
      _onAnimationChange(element.id, {
        [animKey]: { ...anim },
      });
    }
  };

  handle.addEventListener('mousedown', onMouseDown);
}

// ---------------------------------------------------------------------------
// Play All — preview orchestrated animation
// ---------------------------------------------------------------------------

function _playAll() {
  if (!_getElements) return;

  const elements = _getElements();
  const animKey = _mode;

  const animatedElements = elements.filter(el => {
    const anim = el.animation?.[animKey];
    return anim && anim.type && anim.type !== 'none';
  });

  if (animatedElements.length === 0) return;

  // Build a GSAP timeline
  const tl = gsap.timeline();

  for (const el of animatedElements) {
    const anim = el.animation[animKey];
    const presetFn = animKey === 'enter' ? getEnterPreset : getExitPreset;
    const preset = presetFn(anim.type);
    if (!preset) continue;

    // Find the DOM node on canvas (scope to canvas container to avoid layer panel matches)
    const node = document.querySelector(`#canvasContainer [data-element-id="${el.id}"]`);
    if (!node) continue;

    const delay = (anim.delay || 0) / 1000;
    const duration = (anim.duration || 300) / 1000;
    const easing = anim.easing || (animKey === 'enter' ? 'power2.out' : 'power2.in');

    // Only clear the properties the preset actually animates (not 'all'),
    // so canvas-engine positioning styles are preserved.
    const safeClearProps = preset.clearProps || Object.keys(preset.vars).join(',');

    if (animKey === 'enter') {
      tl.from(node, {
        ...preset.vars,
        duration,
        ease: easing,
        clearProps: safeClearProps,
      }, delay); // absolute position in timeline
    } else {
      tl.to(node, {
        ...preset.vars,
        duration,
        ease: easing,
      }, delay);
    }
  }

  // If exit mode, reset elements after timeline completes
  if (animKey === 'exit') {
    tl.then(() => {
      for (const el of animatedElements) {
        const node = document.querySelector(`#canvasContainer [data-element-id="${el.id}"]`);
        if (!node) continue;
        const anim = el.animation[animKey];
        const preset = getExitPreset(anim.type);
        const props = preset ? (preset.clearProps || Object.keys(preset.vars).join(',')) : 'opacity';
        gsap.set(node, { clearProps: props });
      }
    });
  }
}
