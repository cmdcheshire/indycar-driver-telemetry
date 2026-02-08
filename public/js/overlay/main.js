/**
 * Overlay entry point.
 *
 * Connects to the server over WebSocket, receives a template + live data,
 * builds the overlay DOM, and keeps it updated in real-time.
 */

import { buildOverlay, normalizeElements } from './template-loader.js';
import { updateElementText, updateElementStyle } from './element-renderer.js';
import { DataBinder } from './data-binder.js';
import { GsapAnimationEngine } from './gsap-animation-engine.js';

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

  // Normalize builder elements to flat format for renderer/binder
  if (template && template.elements) {
    template.elements = normalizeElements(template.elements);
  }

  currentTemplate = template;
  currentConfig   = config;

  // Kill previous animation engine (reverts gsap.context, frees GPU memory)
  if (animationEngine) animationEngine.killAll();

  // Build the DOM from the template
  const rootEl = document.getElementById('overlay-root');
  rootEl.innerHTML = '';

  domMap = buildOverlay(rootEl, template, referenceData);

  // Create binder + animation engine
  dataBinder      = new DataBinder(template.elements, domMap);
  animationEngine = new GsapAnimationEngine(domMap);

  // Apply target cars from config
  if (config && config.targetCars) {
    dataBinder.setTargetCars(config.targetCars);
  }

  // Store reference data as a flat array for data binding
  if (referenceData && referenceData.drivers) {
    const driversArray = Object.entries(referenceData.drivers).map(([carNum, d]) => ({
      carNumber: carNum, ...d,
    }));
    dataBinder.updateData('referenceData', driversArray);
  }

  // Feed snapshot data (each key is a data type)
  if (snapshot) {
    for (const [dataType, data] of Object.entries(snapshot)) {
      dataBinder.updateData(dataType, data);
    }
    dataBinder.resolveBindings();
  }

  // Apply element overrides from config
  if (config && config.elementOverrides && domMap) {
    applyElementOverrides(config.elementOverrides);
  }
}

// ---------------------------------------------------------------------------
// Live data
// ---------------------------------------------------------------------------

// Map WS event names to binding source names used in templates
const DATA_TYPE_MAP = {
  lap: 'lapData',
  pit: 'pitStatus',
  flag: 'raceState',
};

// Single-car event types that need to be merged into existing arrays
const SINGLE_CAR_TYPES = new Set(['lap', 'pit', 'carStatus']);

function handleDataUpdate(msg) {
  if (!dataBinder) return;

  const dataType = DATA_TYPE_MAP[msg.type] || msg.type;

  // Single-car events send one car object; merge into array instead of replacing
  if (SINGLE_CAR_TYPES.has(msg.type)) {
    dataBinder.mergeCarData(dataType, msg.data);
  } else {
    dataBinder.updateData(dataType, msg.data);
  }

  dataBinder.resolveBindings();
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

function handleVisibility(msg) {
  if (!animationEngine) return;

  const { visible, elementId, animation, elementAnimations } = msg.data || {};

  if (elementId) {
    // Show/hide a specific element
    if (visible) {
      animationEngine.show(elementId, { type: animation });
    } else {
      animationEngine.hide(elementId, { type: animation });
    }
  } else if (elementAnimations && elementAnimations.length > 0) {
    // Per-element orchestrated animation
    const rootEl = document.getElementById('overlay-root');
    if (visible) {
      rootEl.style.display = '';
      animationEngine.showAll(elementAnimations);
    } else {
      animationEngine.hideAll(elementAnimations);
      // Hide root after the longest animation completes
      const maxDuration = elementAnimations.reduce(
        (max, ea) => Math.max(max, (ea.delay || 0) + (ea.duration || 300)), 0
      );
      setTimeout(() => { rootEl.style.display = 'none'; }, maxDuration + 50);
    }
  } else {
    // Show/hide the entire overlay with a single animation
    const rootEl = document.getElementById('overlay-root');
    if (visible) {
      rootEl.style.display = '';
      if (animation) {
        animationEngine.show('__root__', { type: animation, duration: 400, easing: 'power2.out' });
      }
    } else {
      if (animation) {
        animationEngine.hide('__root__', {
          type: animation, duration: 300, easing: 'power2.in',
        });
        // Delay hiding the root until animation completes
        setTimeout(() => { rootEl.style.display = 'none'; }, 350);
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

  // Normalize builder elements to flat format
  if (template && template.elements) {
    template.elements = normalizeElements(template.elements);
  }

  currentTemplate = template;

  // Kill previous animation engine (reverts gsap.context, frees GPU memory)
  if (animationEngine) animationEngine.killAll();

  // Hide root BEFORE clearing DOM to prevent flash during CUE
  const rootEl = document.getElementById('overlay-root');
  rootEl.style.display = 'none';
  rootEl.className = '';
  rootEl.innerHTML = '';

  domMap = buildOverlay(rootEl, template, referenceData || {});

  dataBinder      = new DataBinder(template.elements, domMap);
  animationEngine = new GsapAnimationEngine(domMap);

  if (currentConfig && currentConfig.targetCars) {
    dataBinder.setTargetCars(currentConfig.targetCars);
  }

  // Store reference data as a flat array for data binding
  const refData = referenceData || {};
  if (refData.drivers) {
    const driversArray = Object.entries(refData.drivers).map(([carNum, d]) => ({
      carNumber: carNum, ...d,
    }));
    dataBinder.updateData('referenceData', driversArray);
  }

  // Re-resolve with whatever data we already have
  dataBinder.resolveBindings();

  // Root stays hidden — visibility message (TAKE ON) will show it
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

  // Apply element overrides from exposed elements
  if (domMap && config.elementOverrides) {
    applyElementOverrides(config.elementOverrides);
  }
}

/**
 * Apply per-element overrides from the rundown config.
 * @param {Object} overrides - Map of elementId -> { text, src, fill, ... }
 */
function applyElementOverrides(overrides) {
  for (const [elementId, props] of Object.entries(overrides)) {
    const node = domMap.get(elementId);
    if (!node) continue;

    if (props.text !== undefined) {
      updateElementText(node, props.text);
    }
    if (props.src !== undefined) {
      const img = node.querySelector('img');
      if (img) {
        img.src = props.src;
      }
    }
    if (props.fill !== undefined) {
      updateElementStyle(node, { backgroundColor: props.fill });
    }
  }
}
