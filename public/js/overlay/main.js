/**
 * Overlay entry point.
 *
 * Connects to the server over WebSocket, receives a template + live data,
 * builds the overlay DOM, and keeps it updated in real-time.
 */

import { buildOverlay } from './template-loader.js';
import { DataBinder } from './data-binder.js';
import { AnimationEngine } from './animation-engine.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ws = null;
let dataBinder = null;
let animationEngine = null;
let domMap = null;           // elementId -> DOM node
let heartbeatTimer = null;
let reconnectTimer = null;
let currentTemplate = null;
let currentConfig = null;

const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONNECT_DELAY_MS    = 3_000;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const accessToken = window.__OVERLAY_ACCESS_TOKEN__ || '';

if (!accessToken) {
  console.warn('[overlay] No access token found in URL. Connection may be rejected.');
}

connect();

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

function buildWsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws/overlay?token=${encodeURIComponent(accessToken)}`;
}

function connect() {
  if (ws) {
    try { ws.close(); } catch (_) { /* ignore */ }
  }

  const url = buildWsUrl();
  console.log('[overlay] Connecting to', url);
  ws = new WebSocket(url);

  ws.addEventListener('open', onOpen);
  ws.addEventListener('message', onMessage);
  ws.addEventListener('close', onClose);
  ws.addEventListener('error', onError);
}

function onOpen() {
  console.log('[overlay] WebSocket connected');
  clearTimeout(reconnectTimer);
  startHeartbeat();
}

function onClose(event) {
  console.warn('[overlay] WebSocket closed', event.code, event.reason);
  stopHeartbeat();
  scheduleReconnect();
}

function onError(err) {
  console.error('[overlay] WebSocket error', err);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    console.log('[overlay] Attempting reconnect...');
    connect();
  }, RECONNECT_DELAY_MS);
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'heartbeat', ts: Date.now() }));
    }
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

function onMessage(event) {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch (err) {
    console.error('[overlay] Failed to parse message', err);
    return;
  }

  switch (msg.type) {
    case 'init':
      handleInit(msg);
      break;

    // Live data feeds
    case 'telemetry':
    case 'leaderboard':
    case 'lap':
    case 'pit':
    case 'carStatus':
    case 'flag':
      handleDataUpdate(msg);
      break;

    case 'visibility':
      handleVisibility(msg);
      break;

    case 'templateUpdate':
      handleTemplateUpdate(msg);
      break;

    case 'configUpdate':
      handleConfigUpdate(msg);
      break;

    default:
      console.log('[overlay] Unknown message type:', msg.type);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function handleInit(msg) {
  const { template, config, referenceData, snapshot } = msg.data || {};

  console.log('[overlay] Received init – building overlay');

  currentTemplate = template;
  currentConfig   = config;

  // Build the DOM from the template
  const rootEl = document.getElementById('overlay-root');
  rootEl.innerHTML = '';

  domMap = buildOverlay(rootEl, template, referenceData);

  // Create binder + animation engine
  dataBinder      = new DataBinder(template.elements, domMap);
  animationEngine = new AnimationEngine(domMap);

  // Apply target cars from config
  if (config && config.targetCars) {
    dataBinder.setTargetCars(config.targetCars);
  }

  // Feed snapshot data (each key is a data type)
  if (snapshot) {
    for (const [dataType, data] of Object.entries(snapshot)) {
      dataBinder.updateData(dataType, data);
    }
    dataBinder.resolveBindings();
  }
}

// ---------------------------------------------------------------------------
// Live data
// ---------------------------------------------------------------------------

function handleDataUpdate(msg) {
  if (!dataBinder) return;

  dataBinder.updateData(msg.type, msg.data);
  dataBinder.resolveBindings();
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

function handleVisibility(msg) {
  if (!animationEngine) return;

  const { visible, elementId, animation } = msg.data || {};

  if (elementId) {
    // Show/hide a specific element
    if (visible) {
      animationEngine.show(elementId, animation);
    } else {
      animationEngine.hide(elementId, animation);
    }
  } else {
    // Show/hide the entire overlay
    const rootEl = document.getElementById('overlay-root');
    if (visible) {
      rootEl.style.display = '';
      if (animation) {
        rootEl.className = `anim-${animation}`;
      }
    } else {
      if (animation) {
        rootEl.className = `anim-${animation}`;
        rootEl.addEventListener('animationend', () => {
          rootEl.style.display = 'none';
          rootEl.className = '';
        }, { once: true });
      } else {
        rootEl.style.display = 'none';
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Template update (hot-reload)
// ---------------------------------------------------------------------------

function handleTemplateUpdate(msg) {
  const { template, referenceData } = msg.data || {};

  console.log('[overlay] Template update received – rebuilding DOM');

  currentTemplate = template;

  const rootEl = document.getElementById('overlay-root');
  rootEl.innerHTML = '';

  domMap = buildOverlay(rootEl, template, referenceData || {});

  dataBinder      = new DataBinder(template.elements, domMap);
  animationEngine = new AnimationEngine(domMap);

  if (currentConfig && currentConfig.targetCars) {
    dataBinder.setTargetCars(currentConfig.targetCars);
  }

  // Re-resolve with whatever data we already have
  dataBinder.resolveBindings();
}

// ---------------------------------------------------------------------------
// Config update
// ---------------------------------------------------------------------------

function handleConfigUpdate(msg) {
  const config = msg.data || {};
  console.log('[overlay] Config update received');

  currentConfig = { ...currentConfig, ...config };

  if (dataBinder && config.targetCars) {
    dataBinder.setTargetCars(config.targetCars);
    dataBinder.resolveBindings();
  }
}
