/**
 * Preview panel - live preview section at the bottom of the right sidebar.
 * Connects to WebSocket to receive real telemetry data and updates data-bound elements.
 */

import { WebSocketClient } from '/js/modules/websocket-client.js';
import { getToken } from '/js/modules/auth.js';

/** @type {WebSocketClient|null} */
let wsClient = null;
/** @type {Function|null} */
let getElements = null;
/** @type {Function|null} */
let onDataUpdate = null;
/** @type {HTMLElement|null} */
let sectionEl = null;
/** @type {boolean} */
let isPreviewActive = false;

/**
 * Initialize the preview panel.
 * @param {object} opts
 * @param {Function} opts.getElements - Returns current elements array
 * @param {Function} opts.onDataUpdate - Called with (elementId, { props: { _previewValue } }) when live data arrives
 */
export function initPreviewPanel(opts) {
  getElements = opts.getElements;
  onDataUpdate = opts.onDataUpdate;
  sectionEl = document.getElementById('previewSection');

  if (!sectionEl) return;

  _render();
}

/**
 * Disconnect and clean up.
 */
export function destroyPreviewPanel() {
  _stopPreview();
}

/* ---- Internal ---- */

function _render() {
  sectionEl.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'sidebar-section-title';
  title.textContent = 'Live Preview';
  title.style.marginBottom = '8px';
  sectionEl.appendChild(title);

  const statusRow = document.createElement('div');
  statusRow.className = 'flex items-center gap-sm';
  statusRow.style.marginBottom = '10px';

  const dot = document.createElement('span');
  dot.className = `status-dot ${isPreviewActive ? 'online' : 'offline'}`;
  dot.id = 'previewStatusDot';
  statusRow.appendChild(dot);

  const statusLabel = document.createElement('span');
  statusLabel.className = 'text-sm';
  statusLabel.id = 'previewStatusLabel';
  statusLabel.textContent = isPreviewActive ? 'Connected' : 'Disconnected';
  statusRow.appendChild(statusLabel);

  sectionEl.appendChild(statusRow);

  const btnRow = document.createElement('div');
  btnRow.className = 'flex gap-sm';

  if (!isPreviewActive) {
    const startBtn = document.createElement('button');
    startBtn.className = 'btn btn-sm btn-success w-full';
    startBtn.textContent = 'Start Preview';
    startBtn.addEventListener('click', () => _startPreview());
    btnRow.appendChild(startBtn);
  } else {
    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn btn-sm btn-danger w-full';
    stopBtn.textContent = 'Stop Preview';
    stopBtn.addEventListener('click', () => _stopPreview());
    btnRow.appendChild(stopBtn);
  }

  sectionEl.appendChild(btnRow);

  // Data element count
  if (getElements) {
    const elements = getElements();
    const dataCount = elements.filter(e => e.type === 'data').length;
    const info = document.createElement('div');
    info.className = 'text-xs text-muted';
    info.style.marginTop = '10px';
    info.textContent = `${dataCount} data element${dataCount !== 1 ? 's' : ''} bound`;
    sectionEl.appendChild(info);
  }
}

function _startPreview() {
  if (wsClient) {
    wsClient.disconnect();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getToken();
  const url = `${protocol}//${window.location.host}/ws/dashboard?token=${encodeURIComponent(token || '')}`;

  wsClient = new WebSocketClient(url);

  wsClient.on('_open', () => {
    isPreviewActive = true;
    _updateStatus(true);
  });

  wsClient.on('_close', () => {
    isPreviewActive = false;
    _updateStatus(false);
  });

  // Handle incoming data — dashboard broadcasts: telemetry, leaderboard, lap, pit, carStatus, flag
  const dataTypes = ['telemetry', 'leaderboard', 'lap', 'pit', 'carStatus', 'flag'];
  for (const type of dataTypes) {
    wsClient.on(type, (data) => _applyLiveData(type, data));
  }

  wsClient.connect();
}

function _stopPreview() {
  if (wsClient) {
    wsClient.disconnect();
    wsClient = null;
  }
  isPreviewActive = false;
  _updateStatus(false);
}

function _updateStatus(connected) {
  const dot = document.getElementById('previewStatusDot');
  const label = document.getElementById('previewStatusLabel');
  if (dot) {
    dot.className = `status-dot ${connected ? 'online' : 'offline'}`;
  }
  if (label) {
    label.textContent = connected ? 'Connected' : 'Disconnected';
  }
  // Re-render buttons
  _render();
}

// Map WS event names to binding source names used in data-binding.js
const SOURCE_NAME_MAP = {
  lap: 'lapData',
  pit: 'pitStatus',
  flag: 'raceState',
};

/**
 * Apply live data to data-bound elements.
 * @param {string} sourceType - e.g. 'telemetry', 'leaderboard'
 * @param {object} data - Incoming data payload
 */
function _applyLiveData(sourceType, data) {
  if (!getElements || !onDataUpdate) return;

  const bindingSource = SOURCE_NAME_MAP[sourceType] || sourceType;
  const elements = getElements();
  const dataElements = elements.filter(e =>
    e.type === 'data' && e.props?.bindingSource === bindingSource
  );

  for (const el of dataElements) {
    const field = el.props.bindingField;
    if (!field || !data) continue;

    // Resolve the value from data (supports nested keys via dot notation)
    let value = _resolveValue(data, field, el.props.carSelector);

    if (value === undefined || value === null) {
      value = el.props.fallback || '---';
    } else {
      value = String(value);
    }

    // Apply format
    value = _applyFormat(value, el.props.format);

    onDataUpdate(el.id, { props: { _previewValue: value } });
  }
}

/**
 * Resolve a value from a data object, potentially selecting by car.
 * @param {object} data
 * @param {string} field
 * @param {string} carSelector
 * @returns {*}
 */
function _resolveValue(data, field, carSelector) {
  // If data is an array (e.g. telemetry, leaderboard entries), use car selector to pick entry
  if (Array.isArray(data)) {
    let entry = null;
    const selectorStr = String(carSelector || '');

    if (selectorStr.match(/^target\d+$/)) {
      const idx = parseInt(selectorStr.replace('target', ''), 10) - 1;
      entry = data[idx];
    } else if (selectorStr.startsWith('byRank:')) {
      const rank = selectorStr.split(':')[1];
      entry = data.find(item => String(item.Rank || item.rank) === rank);
    } else if (selectorStr.startsWith('byCar:')) {
      const car = selectorStr.split(':')[1];
      entry = data.find(item =>
        String(item.carNumber || item.Car || item.car) === car
      );
    } else {
      entry = data[0];
    }
    return entry ? entry[field] : undefined;
  }

  // If data is a plain object, just access the field directly
  return data[field];
}

/**
 * Apply formatting to a value string.
 * @param {string} raw
 * @param {string} format
 * @returns {string}
 */
function _applyFormat(raw, format) {
  switch (format) {
    case 'speed':
      return `${raw} mph`;
    case 'lapTime':
      return raw;
    case 'delta': {
      const num = parseFloat(raw);
      if (isNaN(num)) return raw;
      return num >= 0 ? `+${num.toFixed(3)}` : num.toFixed(3);
    }
    case 'ordinal': {
      const n = parseInt(raw, 10);
      if (isNaN(n)) return raw;
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    case 'percentage':
      return `${raw}%`;
    case 'temperature':
      return `${raw}\u00B0F`;
    case 'raw':
    default:
      return raw;
  }
}
