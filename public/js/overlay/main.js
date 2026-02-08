/**
 * Overlay entry point.
 *
 * Connects to the server over WebSocket, receives a template + live data,
 * builds the overlay DOM, and keeps it updated in real-time.
 */

import { buildOverlay, normalizeElements } from './template-loader.js';
import { updateElementText, updateElementStyle, fitTextToElement } from './element-renderer.js';
import { DataBinder } from './data-binder.js';
import { GsapAnimationEngine } from './gsap-animation-engine.js';
import { init as initAssetCache, precacheTemplate } from './asset-cache.js';
import { loadCustomFonts } from '/js/shared/font-loader.js';

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
let holdTimer = null;          // Auto-exit timer for hold duration
let initPromise = null;        // Tracks async init to queue messages during await
let pendingMessages = [];      // Messages queued while init is running

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
  initAssetCache(ws);
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

  // If init or templateUpdate is in progress, queue non-init messages
  // so they aren't dropped while awaiting loadCustomFonts()
  if (initPromise && msg.type !== 'init' && msg.type !== 'templateUpdate') {
    pendingMessages.push(msg);
    return;
  }

  processMessage(msg);
}

function processMessage(msg) {
  switch (msg.type) {
    case 'init':
      initPromise = handleInit(msg).finally(() => {
        initPromise = null;
        drainPendingMessages();
      });
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

function drainPendingMessages() {
  const queued = pendingMessages;
  pendingMessages = [];
  for (const msg of queued) {
    processMessage(msg);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function handleInit(msg) {
  const { template, config, referenceData, snapshot } = msg.data || {};

  console.log('[overlay] Received init – building overlay');

  // Load custom fonts from library before rendering
  await loadCustomFonts();

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

  // Respect initial visibility — hide overlay if nothing is on-air
  if (config && config.visible === false) {
    rootEl.style.display = 'none';
  }

  // Pre-cache image assets for this template
  precacheTemplate(currentTemplate, referenceData || {}, currentConfig || {});
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

  const { visible, elementId, animation, elementAnimations, timeline } = msg.data || {};

  // Clear any pending hold timer
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }

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

      // Auto-exit after hold duration (if set)
      scheduleAutoExit(timeline, elementAnimations);
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

      // Auto-exit after hold duration (if set)
      scheduleAutoExit(timeline, null, animation);
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

/**
 * Schedule auto-exit after holdDuration (ms) elapses.
 * holdDuration of 0 or undefined means hold indefinitely (manual TAKE OFF).
 */
function scheduleAutoExit(timeline, elementAnimations, rootAnimation) {
  if (!timeline || !timeline.holdDuration || timeline.holdDuration <= 0) return;

  // Calculate the longest enter animation duration so hold starts AFTER enter completes
  let enterDuration = 0;
  if (elementAnimations && elementAnimations.length > 0) {
    enterDuration = elementAnimations.reduce(
      (max, ea) => Math.max(max, (ea.delay || 0) + (ea.duration || 300)), 0
    );
  } else if (rootAnimation) {
    enterDuration = 400; // default root animation duration
  }

  const totalWait = enterDuration + timeline.holdDuration;

  holdTimer = setTimeout(() => {
    holdTimer = null;
    if (!animationEngine) return;

    const rootEl = document.getElementById('overlay-root');

    if (elementAnimations && elementAnimations.length > 0) {
      // Build exit animations from enter configs (swap enter→exit types)
      const exitAnims = elementAnimations.map(ea => ({
        ...ea,
        type: ea.exitType || ea.type.replace(/In$/, 'Out').replace(/^slide/, 'slide').replace(/^wipe/, 'wipe'),
      }));
      animationEngine.hideAll(exitAnims);
      const maxDur = exitAnims.reduce(
        (max, ea) => Math.max(max, (ea.delay || 0) + (ea.duration || 300)), 0
      );
      setTimeout(() => { rootEl.style.display = 'none'; }, maxDur + 50);
    } else {
      animationEngine.hide('__root__', {
        type: 'fadeOut', duration: 300, easing: 'power2.in',
      });
      setTimeout(() => { rootEl.style.display = 'none'; }, 350);
    }
  }, totalWait);
}

// ---------------------------------------------------------------------------
// Template update (hot-reload)
// ---------------------------------------------------------------------------

function handleTemplateUpdate(msg) {
  const { template, referenceData } = msg.data || {};

  console.log('[overlay] Template update received – rebuilding DOM');

  // Reload custom fonts in background (picks up any newly uploaded fonts)
  // Don't await — fonts from init are already registered
  loadCustomFonts();

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

  // Pre-cache image assets for the new template
  precacheTemplate(currentTemplate, referenceData || {}, currentConfig || {});

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
    // Re-cache in case image sources were overridden
    precacheTemplate(currentTemplate, {}, currentConfig);
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

    // Text content
    if (props.text !== undefined) {
      updateElementText(node, props.text);
    }

    // Image source
    if (props.src !== undefined) {
      const img = node.querySelector('img');
      if (img) img.src = props.src;
    }

    // Image fit
    if (props.fit !== undefined) {
      const img = node.querySelector('img');
      if (img) img.style.objectFit = props.fit;
    }

    // Style properties — map prop keys to CSS
    const styleMap = {};
    if (props.fill !== undefined) styleMap.backgroundColor = props.fill;
    if (props.color !== undefined) styleMap.color = props.color;
    if (props.backgroundColor !== undefined) styleMap.backgroundColor = props.backgroundColor;
    if (props.fontSize !== undefined) styleMap.fontSize = `${props.fontSize}px`;
    if (props.fontWeight !== undefined) styleMap.fontWeight = String(props.fontWeight);
    if (props.fontFamily !== undefined) styleMap.fontFamily = props.fontFamily;
    if (props.textAlign !== undefined) {
      // Map text-align to flex justify-content
      const alignMap = { left: 'flex-start', center: 'center', right: 'flex-end' };
      styleMap.justifyContent = alignMap[props.textAlign] || 'flex-start';
    }
    if (props.strokeColor !== undefined) {
      const sw = props.strokeWidth || 1;
      styleMap.border = `${sw}px solid ${props.strokeColor}`;
    }
    if (props.strokeWidth !== undefined && props.strokeColor === undefined) {
      // Only stroke width changed, preserve existing color
      const existing = node.style.borderColor || '';
      if (existing) {
        styleMap.border = `${props.strokeWidth}px solid ${existing}`;
      }
    }
    if (props.borderRadius !== undefined) styleMap.borderRadius = `${props.borderRadius}px`;

    if (Object.keys(styleMap).length > 0) {
      updateElementStyle(node, styleMap);
    }

    // Fit text (auto-size)
    if (props.fitText !== undefined) {
      const enabled = props.fitText === true || props.fitText === 'true';
      if (enabled) {
        node.dataset.fitText = 'true';
        node.dataset.maxFontSize = String(parseInt(node.style.fontSize, 10) || 24);
        requestAnimationFrame(() => fitTextToElement(node));
      } else {
        delete node.dataset.fitText;
        node.style.overflow = '';
        node.style.whiteSpace = '';
      }
    }

    // Overflow (textbox clipping)
    if (props.overflow !== undefined) {
      node.style.overflow = props.overflow;
    }

    // Data binding props (prefix, suffix, fallback, carSelector)
    if (props.prefix !== undefined) node.setAttribute('data-prefix', props.prefix);
    if (props.suffix !== undefined) node.setAttribute('data-suffix', props.suffix);
    if (props.fallback !== undefined) node.setAttribute('data-fallback', props.fallback);
    if (props.carSelector !== undefined) node.setAttribute('data-car', props.carSelector);
  }
}
