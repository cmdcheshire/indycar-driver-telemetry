/**
 * Animation Designer — keyframe-based animation editor.
 *
 * Opens in place of the properties panel for detailed per-element
 * entrance choreography. Each "track" controls one animatable property
 * (opacity, x, y, scale, rotation, etc.) across keyframes in time.
 *
 * Data model stored on element.animation.keyframes:
 *   { enabled, duration, tracks: [{ property, keyframes: [{ time, value, easing }] }] }
 */

import { GSAP_EASINGS } from '/js/shared/animation-presets.js';
import { resolveEasing } from '/js/shared/motorsport-easings.js';

// ---------------------------------------------------------------------------
// Animatable property definitions
// ---------------------------------------------------------------------------

const ANIMATABLE_PROPERTIES = [
  { key: 'opacity',    label: 'Opacity',  type: 'number', min: 0,    max: 1,    step: 0.01, default: 1 },
  { key: 'x',          label: 'X',        type: 'number', min: -200, max: 200,  step: 1,    default: 0, unit: '%' },
  { key: 'y',          label: 'Y',        type: 'number', min: -200, max: 200,  step: 1,    default: 0, unit: '%' },
  { key: 'scale',      label: 'Scale',    type: 'number', min: 0,    max: 5,    step: 0.01, default: 1 },
  { key: 'scaleX',     label: 'Scale X',  type: 'number', min: 0,    max: 5,    step: 0.01, default: 1 },
  { key: 'scaleY',     label: 'Scale Y',  type: 'number', min: 0,    max: 5,    step: 0.01, default: 1 },
  { key: 'rotation',   label: 'Rotate',   type: 'number', min: -720, max: 720,  step: 1,    default: 0, unit: '°' },
  { key: 'rotationX',  label: 'Rot X',    type: 'number', min: -720, max: 720,  step: 1,    default: 0, unit: '°' },
  { key: 'rotationY',  label: 'Rot Y',    type: 'number', min: -720, max: 720,  step: 1,    default: 0, unit: '°' },
  { key: 'z',          label: 'Z Depth',  type: 'number', min: -500, max: 500,  step: 1,    default: 0, unit: 'px' },
  { key: 'clipPath',   label: 'Clip',     type: 'text',   default: 'none' },
  { key: 'color',      label: 'Color',    type: 'color',  default: '#FFFFFF' },
  { key: 'backgroundColor', label: 'BG Color', type: 'color', default: 'transparent' },
  { key: 'transformPerspective', label: 'Persp', type: 'number', min: 0, max: 2000, step: 10, default: 0, unit: 'px' },
];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _panelEl = null;
let _element = null;
let _onPropertyChange = null;
let _onClose = null;
let _previewTimeline = null;
let _selectedKeyframe = null;   // { trackIndex, keyframeIndex }
let _isPlaying = false;
let _isLooping = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open the animation designer for the given element.
 * @param {object} element - The element being edited
 * @param {object} opts
 * @param {Function} opts.onPropertyChange - (elementId, changes)
 * @param {Function} opts.onClose - Called when user clicks Back
 * @param {HTMLElement} opts.panelEl - The container to render into
 */
export function openAnimationDesigner(element, { onPropertyChange, onClose, panelEl }) {
  _element = element;
  _onPropertyChange = onPropertyChange;
  _onClose = onClose;
  _panelEl = panelEl;
  _selectedKeyframe = null;
  _isPlaying = false;

  _render();
}

/**
 * Close the animation designer and return to properties panel.
 */
export function closeAnimationDesigner() {
  _killPreview();
  if (_onClose) _onClose();
  _element = null;
  _onPropertyChange = null;
  _onClose = null;
  _selectedKeyframe = null;
}

/**
 * Build a GSAP timeline from keyframe data.
 * Shared between builder preview and overlay runtime.
 *
 * @param {HTMLElement} node - DOM element to animate
 * @param {object} kfData - { duration, tracks: [{ property, keyframes }] }
 * @returns {gsap.core.Timeline}
 */
export function buildGsapTimeline(node, kfData) {
  return _buildGsapTimeline(node, kfData);
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function _getKeyframes() {
  return _element?.animation?.keyframes || { enabled: false, duration: 2000, tracks: [] };
}

function _setKeyframes(kf) {
  if (!_element || !_onPropertyChange) return;
  const animation = { ...(_element.animation || {}), keyframes: kf };
  _element.animation = animation;
  _onPropertyChange(_element.id, { animation });
}

// ---------------------------------------------------------------------------
// Main render
// ---------------------------------------------------------------------------

function _render() {
  if (!_panelEl) return;
  _panelEl.innerHTML = '';

  const kf = _getKeyframes();

  // ── Header ──
  const header = _el('div', 'anim-designer-header');

  const backBtn = _el('button', 'anim-designer-back');
  backBtn.textContent = '← Back';
  backBtn.addEventListener('click', closeAnimationDesigner);
  header.appendChild(backBtn);

  const title = _el('span', 'anim-designer-title');
  title.textContent = 'Keyframe Animation';
  header.appendChild(title);

  const enableLabel = _el('label', 'anim-designer-enable');
  const enableCb = document.createElement('input');
  enableCb.type = 'checkbox';
  enableCb.checked = kf.enabled;
  enableCb.addEventListener('change', () => {
    _setKeyframes({ ..._getKeyframes(), enabled: enableCb.checked });
  });
  enableLabel.appendChild(enableCb);
  enableLabel.appendChild(document.createTextNode(' On'));
  header.appendChild(enableLabel);

  _panelEl.appendChild(header);

  // ── Duration ──
  const durRow = _el('div', 'anim-designer-dur');
  const durLabel = _el('label');
  durLabel.textContent = 'Duration';
  durRow.appendChild(durLabel);

  const durInput = document.createElement('input');
  durInput.type = 'number';
  durInput.className = 'input';
  durInput.value = String(kf.duration);
  durInput.min = '100';
  durInput.max = '10000';
  durInput.step = '100';
  durInput.addEventListener('input', () => {
    const v = parseInt(durInput.value, 10);
    if (!isNaN(v) && v > 0) {
      _setKeyframes({ ..._getKeyframes(), duration: v });
    }
  });
  durRow.appendChild(durInput);

  const durUnit = _el('span', 'anim-designer-dur-unit');
  durUnit.textContent = 'ms';
  durRow.appendChild(durUnit);

  _panelEl.appendChild(durRow);

  // ── Timeline (tracks + keyframes) ──
  _renderTimeline(kf);

  // ── Add track ──
  const addRow = _el('div', 'anim-designer-add-track');
  const addSelect = document.createElement('select');
  addSelect.className = 'select';
  addSelect.style.width = '100%';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '+ Add Track';
  addSelect.appendChild(defaultOpt);

  const existingKeys = new Set(kf.tracks.map(t => t.property));
  for (const prop of ANIMATABLE_PROPERTIES) {
    if (existingKeys.has(prop.key)) continue;
    const opt = document.createElement('option');
    opt.value = prop.key;
    opt.textContent = prop.label;
    addSelect.appendChild(opt);
  }

  addSelect.addEventListener('change', () => {
    const propKey = addSelect.value;
    if (!propKey) return;
    const propDef = ANIMATABLE_PROPERTIES.find(p => p.key === propKey);
    if (!propDef) return;

    const currentKf = _getKeyframes();
    const newTrack = {
      property: propKey,
      keyframes: [
        { time: 0, value: propDef.default, easing: 'power2.out' },
        { time: currentKf.duration, value: propDef.default, easing: 'none' },
      ],
    };
    _setKeyframes({
      ...currentKf,
      tracks: [...currentKf.tracks, newTrack],
    });
    _render();
  });

  addRow.appendChild(addSelect);
  _panelEl.appendChild(addRow);

  // ── Value inspector ──
  _renderValueInspector(kf);

  // ── Transport ──
  _renderTransport(kf);
}

// ---------------------------------------------------------------------------
// Timeline renderer (ruler + tracks + diamonds)
// ---------------------------------------------------------------------------

function _renderTimeline(kf) {
  const container = _el('div', 'anim-designer-timeline');
  const dur = kf.duration || 2000;

  // ── Ruler ──
  const ruler = _el('div', 'anim-designer-ruler');
  const rulerLabel = _el('div', 'anim-designer-track-label');
  ruler.appendChild(rulerLabel);

  const rulerBar = _el('div', 'anim-designer-ruler-bar');
  const tickCount = Math.min(5, Math.max(2, Math.floor(dur / 500)));
  for (let i = 0; i <= tickCount; i++) {
    const t = Math.round((i / tickCount) * dur);
    const tick = _el('span', 'anim-designer-tick');
    tick.style.left = `${(t / dur) * 100}%`;
    tick.textContent = t >= 1000 ? `${(t / 1000).toFixed(1)}s` : `${t}`;
    rulerBar.appendChild(tick);
  }
  ruler.appendChild(rulerBar);
  container.appendChild(ruler);

  // ── Tracks ──
  for (let ti = 0; ti < kf.tracks.length; ti++) {
    const track = kf.tracks[ti];
    const propDef = ANIMATABLE_PROPERTIES.find(p => p.key === track.property);

    const row = _el('div', 'anim-designer-track');

    // Label + delete
    const label = _el('div', 'anim-designer-track-label');
    const labelText = _el('span');
    labelText.textContent = propDef ? propDef.label : track.property;
    label.appendChild(labelText);

    const delBtn = _el('button', 'anim-designer-track-del');
    delBtn.textContent = '×';
    delBtn.title = 'Remove track';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentKf = _getKeyframes();
      const newTracks = [...currentKf.tracks];
      newTracks.splice(ti, 1);
      _setKeyframes({ ...currentKf, tracks: newTracks });
      _selectedKeyframe = null;
      _render();
    });
    label.appendChild(delBtn);
    row.appendChild(label);

    // Keyframe bar
    const bar = _el('div', 'anim-designer-keyframe-bar');

    // Double-click to add keyframe
    bar.addEventListener('dblclick', (e) => {
      const rect = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const time = Math.round(pct * dur);

      const currentKf = _getKeyframes();
      const currentTrack = currentKf.tracks[ti];
      const interpValue = _interpolateValueAtTime(currentTrack.keyframes, time, propDef);

      const newKfs = [...currentTrack.keyframes, { time, value: interpValue, easing: 'power2.out' }];
      newKfs.sort((a, b) => a.time - b.time);

      const newTracks = [...currentKf.tracks];
      newTracks[ti] = { ...currentTrack, keyframes: newKfs };
      _setKeyframes({ ...currentKf, tracks: newTracks });

      // Select the newly added keyframe
      const newIdx = newKfs.findIndex(k => k.time === time);
      _selectedKeyframe = { trackIndex: ti, keyframeIndex: newIdx >= 0 ? newIdx : newKfs.length - 1 };
      _render();
    });

    // Connecting segments (rendered first, behind diamonds)
    const sortedKfs = [...track.keyframes].sort((a, b) => a.time - b.time);
    for (let si = 0; si < sortedKfs.length - 1; si++) {
      const fromPct = (sortedKfs[si].time / dur) * 100;
      const toPct = (sortedKfs[si + 1].time / dur) * 100;
      const seg = _el('div', 'anim-designer-segment');
      seg.style.left = `${fromPct}%`;
      seg.style.width = `${toPct - fromPct}%`;
      bar.appendChild(seg);
    }

    // Diamond keyframe markers
    for (let ki = 0; ki < track.keyframes.length; ki++) {
      const keyframe = track.keyframes[ki];
      const diamond = _el('div', 'anim-designer-diamond');
      diamond.style.left = `${(keyframe.time / dur) * 100}%`;

      if (_selectedKeyframe && _selectedKeyframe.trackIndex === ti && _selectedKeyframe.keyframeIndex === ki) {
        diamond.classList.add('selected');
      }

      // Click to select
      diamond.addEventListener('click', (e) => {
        e.stopPropagation();
        _selectedKeyframe = { trackIndex: ti, keyframeIndex: ki };
        _render();
      });

      // Drag to reposition in time
      diamond.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();

        _selectedKeyframe = { trackIndex: ti, keyframeIndex: ki };
        const barRect = bar.getBoundingClientRect();

        const onMove = (moveE) => {
          const pct = Math.max(0, Math.min(1, (moveE.clientX - barRect.left) / barRect.width));
          diamond.style.left = `${pct * 100}%`;
        };

        const onUp = (upE) => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);

          const pct = Math.max(0, Math.min(1, (upE.clientX - barRect.left) / barRect.width));
          const newTime = Math.round(pct * dur);

          const currentKf = _getKeyframes();
          const currentTrack = currentKf.tracks[ti];
          const newKfs = [...currentTrack.keyframes];
          newKfs[ki] = { ...newKfs[ki], time: newTime };
          newKfs.sort((a, b) => a.time - b.time);

          // Find where the moved keyframe ended up after sort
          const newIdx = newKfs.findIndex(k => k === newKfs.find(kk => kk.time === newTime));

          const newTracks = [...currentKf.tracks];
          newTracks[ti] = { ...currentTrack, keyframes: newKfs };
          _setKeyframes({ ...currentKf, tracks: newTracks });
          _selectedKeyframe = { trackIndex: ti, keyframeIndex: newIdx >= 0 ? newIdx : ki };
          _render();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      bar.appendChild(diamond);
    }

    row.appendChild(bar);
    container.appendChild(row);
  }

  if (kf.tracks.length === 0) {
    const empty = _el('div', 'anim-designer-hint');
    empty.textContent = 'No tracks — add one below';
    empty.style.padding = '12px 0';
    container.appendChild(empty);
  }

  _panelEl.appendChild(container);
}

// ---------------------------------------------------------------------------
// Value inspector (selected keyframe editor)
// ---------------------------------------------------------------------------

function _renderValueInspector(kf) {
  const container = _el('div', 'anim-designer-inspector');

  if (!_selectedKeyframe) {
    const hint = _el('div', 'anim-designer-hint');
    hint.textContent = 'Click a ◆ keyframe to edit';
    container.appendChild(hint);
    _panelEl.appendChild(container);
    return;
  }

  const { trackIndex, keyframeIndex } = _selectedKeyframe;
  const track = kf.tracks[trackIndex];
  if (!track) { _panelEl.appendChild(container); return; }

  const keyframe = track.keyframes[keyframeIndex];
  if (!keyframe) { _panelEl.appendChild(container); return; }

  const propDef = ANIMATABLE_PROPERTIES.find(p => p.key === track.property);

  // Title
  const title = _el('div', 'anim-designer-inspector-title');
  title.textContent = `${propDef ? propDef.label : track.property} @ ${keyframe.time}ms`;
  container.appendChild(title);

  // Time input
  const timeRow = _el('div', 'anim-designer-inspector-row');
  timeRow.appendChild(_label('Time'));
  const timeInput = document.createElement('input');
  timeInput.type = 'number';
  timeInput.className = 'input';
  timeInput.value = String(keyframe.time);
  timeInput.min = '0';
  timeInput.max = String(kf.duration);
  timeInput.step = '10';
  timeInput.addEventListener('change', () => {
    const v = parseInt(timeInput.value, 10);
    if (isNaN(v)) return;
    _updateKeyframe(trackIndex, keyframeIndex, { time: Math.max(0, Math.min(v, kf.duration)) });
  });
  timeRow.appendChild(timeInput);
  timeRow.appendChild(_unit('ms'));
  container.appendChild(timeRow);

  // Value input
  const valRow = _el('div', 'anim-designer-inspector-row');
  valRow.appendChild(_label('Value'));

  if (propDef?.type === 'color') {
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = _normalizeHex(keyframe.value);
    colorInput.style.cssText = 'width:36px; height:26px; border:1px solid var(--border); cursor:pointer;';
    colorInput.addEventListener('input', () => {
      _updateKeyframe(trackIndex, keyframeIndex, { value: colorInput.value });
    });
    valRow.appendChild(colorInput);
  } else if (propDef?.type === 'number') {
    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'input';
    numInput.value = String(keyframe.value);
    numInput.min = String(propDef.min);
    numInput.max = String(propDef.max);
    numInput.step = String(propDef.step);
    numInput.addEventListener('change', () => {
      const v = parseFloat(numInput.value);
      if (!isNaN(v)) _updateKeyframe(trackIndex, keyframeIndex, { value: v });
    });
    valRow.appendChild(numInput);
    if (propDef.unit) valRow.appendChild(_unit(propDef.unit));
  } else {
    const txtInput = document.createElement('input');
    txtInput.type = 'text';
    txtInput.className = 'input';
    txtInput.style.flex = '1';
    txtInput.value = String(keyframe.value);
    txtInput.addEventListener('change', () => {
      _updateKeyframe(trackIndex, keyframeIndex, { value: txtInput.value });
    });
    valRow.appendChild(txtInput);
  }
  container.appendChild(valRow);

  // Easing
  const easeRow = _el('div', 'anim-designer-inspector-row');
  easeRow.appendChild(_label('Easing'));

  const easeSelect = document.createElement('select');
  easeSelect.className = 'select';
  easeSelect.style.flex = '1';

  // None option
  const noneOpt = document.createElement('option');
  noneOpt.value = 'none';
  noneOpt.textContent = 'None (linear)';
  if (!keyframe.easing || keyframe.easing === 'none') noneOpt.selected = true;
  easeSelect.appendChild(noneOpt);

  // Grouped easings
  const groups = new Map();
  for (const e of GSAP_EASINGS) {
    if (!groups.has(e.group)) groups.set(e.group, []);
    groups.get(e.group).push(e);
  }
  for (const [groupName, easings] of groups) {
    const group = document.createElement('optgroup');
    group.label = groupName;
    for (const easing of easings) {
      const opt = document.createElement('option');
      opt.value = easing.value;
      opt.textContent = easing.label;
      if (easing.value === keyframe.easing) opt.selected = true;
      group.appendChild(opt);
    }
    easeSelect.appendChild(group);
  }

  easeSelect.addEventListener('change', () => {
    _updateKeyframe(trackIndex, keyframeIndex, { easing: easeSelect.value });
  });
  easeRow.appendChild(easeSelect);
  container.appendChild(easeRow);

  // Delete keyframe (only if track has > 2)
  if (track.keyframes.length > 2) {
    const delBtn = _el('button', 'btn btn-sm');
    delBtn.textContent = 'Delete Keyframe';
    delBtn.style.cssText = 'margin-top:6px; color:var(--danger); width:100%;';
    delBtn.addEventListener('click', () => {
      const currentKf = _getKeyframes();
      const currentTrack = currentKf.tracks[trackIndex];
      const newKfs = [...currentTrack.keyframes];
      newKfs.splice(keyframeIndex, 1);

      const newTracks = [...currentKf.tracks];
      newTracks[trackIndex] = { ...currentTrack, keyframes: newKfs };
      _setKeyframes({ ...currentKf, tracks: newTracks });
      _selectedKeyframe = null;
      _render();
    });
    container.appendChild(delBtn);
  }

  _panelEl.appendChild(container);
}

// ---------------------------------------------------------------------------
// Transport controls (play / reset / loop)
// ---------------------------------------------------------------------------

function _renderTransport(kf) {
  const container = _el('div', 'anim-designer-transport');

  const playBtn = _el('button', 'anim-designer-transport-btn');
  playBtn.innerHTML = _isPlaying
    ? '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="4" height="12"/><rect x="10" y="2" width="4" height="12"/></svg> Stop'
    : '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg> Play';
  playBtn.addEventListener('click', () => {
    if (_isPlaying) {
      _killPreview();
      _isPlaying = false;
    } else {
      _playPreview(kf);
      _isPlaying = true;
    }
    _render();
  });
  container.appendChild(playBtn);

  const resetBtn = _el('button', 'anim-designer-transport-btn');
  resetBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8a5 5 0 0 1 9-3"/><path d="M13 8a5 5 0 0 1-9 3"/><path d="M3 3v5h4"/></svg> Reset';
  resetBtn.addEventListener('click', () => {
    _killPreview();
    _isPlaying = false;
    _render();
  });
  container.appendChild(resetBtn);

  const loopBtn = _el('button', `anim-designer-transport-btn${_isLooping ? ' active' : ''}`);
  loopBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 6H5l3-3"/><path d="M3 10h8l-3 3"/></svg> Loop';
  loopBtn.addEventListener('click', () => {
    _isLooping = !_isLooping;
    if (_isPlaying && _previewTimeline) {
      _previewTimeline.repeat(_isLooping ? -1 : 0);
    }
    _render();
  });
  container.appendChild(loopBtn);

  _panelEl.appendChild(container);
}

// ---------------------------------------------------------------------------
// Keyframe data manipulation
// ---------------------------------------------------------------------------

function _updateKeyframe(trackIndex, keyframeIndex, changes) {
  const currentKf = _getKeyframes();
  const track = currentKf.tracks[trackIndex];
  if (!track) return;

  const newKfs = [...track.keyframes];
  newKfs[keyframeIndex] = { ...newKfs[keyframeIndex], ...changes };

  // Re-sort if time changed
  if (changes.time !== undefined) {
    const updated = newKfs[keyframeIndex];
    newKfs.sort((a, b) => a.time - b.time);
    const newIdx = newKfs.indexOf(updated);
    _selectedKeyframe = { trackIndex, keyframeIndex: newIdx >= 0 ? newIdx : keyframeIndex };
  }

  const newTracks = [...currentKf.tracks];
  newTracks[trackIndex] = { ...track, keyframes: newKfs };
  _setKeyframes({ ...currentKf, tracks: newTracks });
  _render();
}

/**
 * Linearly interpolate the track value at a given time.
 */
function _interpolateValueAtTime(keyframes, time, propDef) {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return propDef?.default ?? 0;
  if (time <= sorted[0].time) return sorted[0].value;
  if (time >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value;

  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      const t = (time - sorted[i].time) / (sorted[i + 1].time - sorted[i].time);
      if (typeof sorted[i].value === 'number') {
        // Round to step precision
        const raw = sorted[i].value + (sorted[i + 1].value - sorted[i].value) * t;
        const step = propDef?.step || 1;
        return Math.round(raw / step) * step;
      }
      // Non-numeric: snap to nearest
      return t < 0.5 ? sorted[i].value : sorted[i + 1].value;
    }
  }
  return sorted[sorted.length - 1].value;
}

// ---------------------------------------------------------------------------
// Preview playback (GSAP in builder canvas)
// ---------------------------------------------------------------------------

function _playPreview(kf) {
  _killPreview();
  if (!_element || !kf.tracks.length) return;

  const node = document.querySelector(`#canvasContainer [data-element-id="${_element.id}"]`);
  if (!node) return;

  const tl = _buildGsapTimeline(node, kf);
  if (_isLooping) tl.repeat(-1);

  tl.eventCallback('onComplete', () => {
    _isPlaying = false;
    _render();
  });

  _previewTimeline = tl;
}

function _killPreview() {
  if (_previewTimeline) {
    _previewTimeline.kill();
    _previewTimeline = null;
  }
  // Reset element to clean state
  if (_element) {
    const node = document.querySelector(`#canvasContainer [data-element-id="${_element.id}"]`);
    if (node) {
      gsap.set(node, { clearProps: 'transform,opacity,clipPath,color,backgroundColor' });
    }
  }
}

// ---------------------------------------------------------------------------
// GSAP timeline builder (shared between preview and overlay)
// ---------------------------------------------------------------------------

function _buildGsapTimeline(node, kfData) {
  const tl = gsap.timeline();

  for (const track of kfData.tracks) {
    const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
    if (sorted.length < 2) continue;

    // Set the initial value
    gsap.set(node, { [track.property]: sorted[0].value });

    // Build tweens between consecutive keyframes
    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const dur = (to.time - from.time) / 1000;
      const pos = from.time / 1000;
      const ease = to.easing && to.easing !== 'none' ? resolveEasing(to.easing) : 'none';

      tl.to(node, {
        [track.property]: to.value,
        duration: dur,
        ease,
      }, pos);
    }
  }

  return tl;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function _el(tag, className) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}

function _label(text) {
  const lbl = _el('label');
  lbl.textContent = text;
  return lbl;
}

function _unit(text) {
  const span = _el('span');
  span.textContent = text;
  span.style.cssText = 'font-size:0.7rem; color:var(--text-dim); flex-shrink:0;';
  return span;
}

function _normalizeHex(color) {
  if (!color || color === 'transparent') return '#000000';
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;
  return '#000000';
}
