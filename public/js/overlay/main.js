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
import { getEnterPreset, migrateEasing } from '/js/shared/animation-presets.js';
import { resolveEasing } from '/js/shared/motorsport-easings.js';

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
let exitHideTimer = null;      // Timer to hide root after exit animations finish
let playoutTimeline = null;    // GSAP master timeline for IN phase (pause points + enter anims)
let initPromise = null;        // Tracks async init to queue messages during await
let pendingMessages = [];      // Messages queued while init is running

const HEARTBEAT_INTERVAL_MS = 10_000;
const RECONNECT_DELAY_MS    = 3_000;

// ---------------------------------------------------------------------------
// Connection status indicator
// ---------------------------------------------------------------------------

const statusEl = document.getElementById('overlay-status');
const statusTextEl = statusEl ? statusEl.querySelector('.status-text') : null;
let statusHideTimer = null;

function setConnectionStatus(state, text) {
  if (!statusEl) return;
  statusEl.className = `${state} visible`;
  if (statusTextEl) statusTextEl.textContent = text;

  clearTimeout(statusHideTimer);

  // Auto-hide "connected" indicator after 3 seconds
  if (state === 'connected') {
    statusHideTimer = setTimeout(() => {
      statusEl.classList.remove('visible');
    }, 3000);
  }
}

// Show initial connecting state
setConnectionStatus('connecting', 'Connecting...');

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
  setConnectionStatus('connected', 'Connected');
}

function onClose(event) {
  console.warn('[overlay] WebSocket closed', event.code, event.reason);
  stopHeartbeat();
  setConnectionStatus('disconnected', 'Disconnected — Reconnecting...');
  scheduleReconnect();
}

function onError(err) {
  console.error('[overlay] WebSocket error', err);
  setConnectionStatus('disconnected', 'Connection Error');
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    console.log('[overlay] Attempting reconnect...');
    setConnectionStatus('connecting', 'Reconnecting...');
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

    case 'resume':
      if (playoutTimeline && playoutTimeline.paused()) {
        console.log('[overlay] Resuming playout timeline (advancing past pause point)');
        playoutTimeline.play();
      }
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

  currentTemplate = template || { elements: [] };
  currentConfig   = config;

  // Kill previous animation engine (reverts gsap.context, frees GPU memory)
  if (animationEngine) animationEngine.killAll();

  // Build the DOM from the template
  const rootEl = document.getElementById('overlay-root');
  rootEl.innerHTML = '';

  domMap = buildOverlay(rootEl, currentTemplate, referenceData);

  // Create shared animation engine + binder
  animationEngine = new GsapAnimationEngine(domMap);
  dataBinder      = new DataBinder(currentTemplate.elements, domMap, animationEngine);

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
    dataBinder.resolveGaugeBindings();
  }

  // Apply element overrides from config
  if (config && config.elementOverrides && domMap) {
    applyElementOverrides(config.elementOverrides);
  }

  // Respect initial visibility — hide overlay if nothing is on-air
  if (!config || config.visible === false) {
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
  dataBinder.resolveGaugeBindings();
}

// ---------------------------------------------------------------------------
// Visibility — GSAP master timeline playout system
// ---------------------------------------------------------------------------

function handleVisibility(msg) {
  if (!animationEngine) return;

  const { visible, elementId, animation, elementAnimations, timeline } = msg.data || {};

  console.log('[overlay] Visibility:', { visible, elementId, animation, elementAnimCount: elementAnimations?.length, timeline });

  // Single-element show/hide (not part of the playout lifecycle)
  if (elementId) {
    if (visible) {
      animationEngine.show(elementId, { type: animation });
    } else {
      animationEngine.hide(elementId, { type: animation });
    }
    return;
  }

  if (visible) {
    // ── TAKE ON ──
    // Clean up any previous playout state
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (exitHideTimer) { clearTimeout(exitHideTimer); exitHideTimer = null; }
    if (playoutTimeline) { playoutTimeline.kill(); playoutTimeline = null; }

    const rootEl = document.getElementById('overlay-root');
    rootEl.style.display = '';

    if (elementAnimations && elementAnimations.length > 0) {
      // Build a GSAP master timeline for the IN phase with pause points
      console.log('[overlay] Building playout timeline with', elementAnimations.length, 'enter animations');
      buildPlayoutTimeline(elementAnimations, timeline);
    } else if (animation) {
      // Simple root-level animation (no per-element orchestration)
      console.log('[overlay] Using root-level animation:', animation);
      animationEngine.show('__root__', { type: animation, duration: 400, easing: 'power2.out' });
    } else {
      console.log('[overlay] No animations and no fallback animation — graphic shown without playout');
    }
  } else {
    // ── TAKE OFF ──
    console.log('[overlay] TAKE OFF received');
    performTakeOff();
  }
}

/**
 * Build a GSAP master timeline for the IN (enter) phase.
 * Adds pause points so the operator can step through with RESUME.
 * On completion, enters the HOLD phase (loop or timed auto-exit).
 */
function buildPlayoutTimeline(elementAnimations, timeline) {
  let tweenCount = 0;
  const tl = gsap.timeline({
    onComplete: () => {
      console.log('[overlay] IN phase complete — entering HOLD. Timeline duration was:', tl.duration(), 's, tweens:', tweenCount);
      playoutTimeline = null;
      onEnterComplete();
    },
  });

  for (const config of elementAnimations) {
    const node = domMap ? domMap.get(config.elementId) : null;
    if (!node) { console.warn('[overlay] DOM node not found for', config.elementId); continue; }

    // ── Check for keyframe animation override (enter) ──
    const templateEl = currentTemplate?.elements?.find(e => e.id === config.elementId);
    const enterKf = templateEl?.enterKeyframeAnimation || templateEl?.keyframeAnimation;
    if (enterKf?.enabled && enterKf.tracks?.length > 0) {
      node.style.opacity = '';
      node.style.willChange = 'transform, opacity';

      const subTl = animationEngine.showWithKeyframes(config.elementId, enterKf);
      if (subTl) {
        const delay = (config.delay || 0) / 1000;
        tl.add(subTl, delay);
        tweenCount++;
        console.log('[overlay] Using enter keyframe animation for', config.elementId);
      }
      continue;
    }

    // ── Standard preset animation ──
    const presetName = config.type || 'fadeIn';
    if (presetName === 'none') continue;

    const preset = getEnterPreset(presetName);
    if (!preset) continue;

    const duration = (config.duration || 300) / 1000;
    const delay = (config.delay || 0) / 1000;
    const rawEasing = config.easing || preset.defaultEase || 'power2.out';
    const easing = resolveEasing(migrateEasing(rawEasing));

    // Reset opacity and promote to GPU layer for animation
    node.style.opacity = '';
    node.style.willChange = 'transform, opacity';

    // Add enter animation to the master timeline at absolute offset
    tl.from(node, {
      ...preset.vars,
      duration,
      ease: easing,
      onComplete: () => {
        // Clear GSAP-set inline transforms so element returns to CSS-defined position
        const clearStr = preset.clearProps || Object.keys(preset.vars).join(',');
        gsap.set(node, { clearProps: clearStr });
        // Restore mask clip-path if set
        const maskClip = node.dataset?.maskClipPath;
        if (maskClip) node.style.clipPath = maskClip;
        // Schedule GPU layer cleanup
        setTimeout(() => { node.style.willChange = ''; }, 5000);
      },
    }, delay);
    tweenCount++;
  }

  console.log('[overlay] Playout timeline built:', tweenCount, 'tweens, duration:', tl.duration(), 's');

  // Add pause points (sorted by time, only within the IN duration)
  if (timeline && Array.isArray(timeline.pausePoints)) {
    const sorted = [...timeline.pausePoints].sort((a, b) => a.time - b.time);
    const tlDuration = tl.duration();
    for (const pp of sorted) {
      const ppSec = pp.time / 1000;
      if (ppSec > 0 && ppSec < tlDuration) {
        tl.addPause(ppSec);
      }
    }
  }

  playoutTimeline = tl;
  return tl;
}

/**
 * Called when the IN phase master timeline completes. Enters HOLD phase.
 * The graphic stays visible indefinitely until the operator fires TAKE OFF.
 * Emphasis animations continue to trigger on data change via DataBinder.
 */
function onEnterComplete() {
  console.log('[overlay] onEnterComplete — entering HOLD (waiting for TAKE OFF)');
}

/**
 * Perform a clean TAKE OFF from any playout state.
 * Kills emphasis, plays exit animations, then hides the root.
 */
function performTakeOff() {
  const rootEl = document.getElementById('overlay-root');
  if (!rootEl) return;

  // Kill active playout timeline (if still in IN phase)
  if (playoutTimeline) {
    playoutTimeline.kill();
    playoutTimeline = null;
  }

  // Clear hold timer
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }

  // Clear any previous exit-hide timer (rapid TAKE OFF / TAKE ON cycles)
  if (exitHideTimer) {
    clearTimeout(exitHideTimer);
    exitHideTimer = null;
  }

  // Kill emphasis animations for a clean exit (no mid-animation jitter)
  if (animationEngine) {
    animationEngine.killEmphasis();
  }

  // Extract exit animations from the current template
  const exitConfigs = extractExitAnimations(currentTemplate);

  // Check for exit keyframe animations
  const exitKfElements = (currentTemplate?.elements || []).filter(
    el => el.exitKeyframeAnimation?.enabled && el.exitKeyframeAnimation.tracks?.length > 0
  );

  // Separate preset exits from keyframe exits
  const kfExitIds = new Set(exitKfElements.map(el => el.id));
  const presetExitConfigs = exitConfigs.filter(c => !kfExitIds.has(c.elementId));

  if ((presetExitConfigs.length > 0 || exitKfElements.length > 0) && animationEngine) {
    // Build exit keyframe timeline if any elements have keyframe exits
    let kfDurMs = 0;
    if (exitKfElements.length > 0) {
      const exitTl = gsap.timeline();
      for (const el of exitKfElements) {
        const exitDelay = (el.exitAnimationDelay || 0) / 1000;
        const subTl = animationEngine.hideWithKeyframes(el.id, el.exitKeyframeAnimation);
        if (subTl) {
          exitTl.add(subTl, exitDelay);
          console.log('[overlay] Using exit keyframe animation for', el.id);
        }
      }
      kfDurMs = exitTl.duration() * 1000;
    }

    // Fire preset exit animations
    for (const config of presetExitConfigs) {
      animationEngine.hide(config.elementId, config);
    }

    // Calculate max preset exit duration
    const maxPresetDur = presetExitConfigs.reduce(
      (max, ea) => Math.max(max, (ea.delay || 0) + (ea.duration || 300)), 0
    );

    // Hide root after the longer of keyframe or preset exits finish
    const hideDurMs = Math.max(kfDurMs, maxPresetDur);
    exitHideTimer = setTimeout(() => {
      exitHideTimer = null;
      rootEl.style.display = 'none';
    }, hideDurMs + 50);
  } else {
    rootEl.style.display = 'none';
  }
}

/**
 * Extract exit animation configs from the current template's elements.
 * Uses the normalized flat properties set by template-loader.
 */
function extractExitAnimations(template) {
  if (!template || !Array.isArray(template.elements)) return [];
  return template.elements
    .filter(el => el.exitAnimation && el.exitAnimation !== 'none')
    .map(el => ({
      elementId: el.id,
      type: el.exitAnimation,
      duration: el.exitAnimationDuration || 300,
      delay: el.exitAnimationDelay || 0,
      easing: el.exitAnimationEasing || 'power2.in',
    }));
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

  animationEngine = new GsapAnimationEngine(domMap);
  dataBinder      = new DataBinder(template.elements, domMap, animationEngine);

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
  dataBinder.resolveGaugeBindings();

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
    // Re-resolve bindings in case prefix/suffix/fallback/car changed
    if (dataBinder) dataBinder.resolveBindings();
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
      // Map text-align to flex justify-content + set textAlign for multiline
      const alignMap = { left: 'flex-start', center: 'center', right: 'flex-end' };
      styleMap.justifyContent = alignMap[props.textAlign] || 'flex-start';
      styleMap.textAlign = props.textAlign;
    }
    if (props.verticalAlign !== undefined) {
      const vMap = { top: 'flex-start', center: 'center', middle: 'center', bottom: 'flex-end' };
      styleMap.alignItems = vMap[props.verticalAlign] || 'center';
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

    // Text transform (uppercase, lowercase, capitalize)
    if (props.textTransform !== undefined) {
      node.style.textTransform = props.textTransform || '';
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

    // Gauge-specific overrides
    if (props.fillColor !== undefined) {
      const fillEl = node.querySelector('[data-role="fill"]');
      if (fillEl) {
        if (fillEl.tagName === 'path' || fillEl.tagName === 'PATH') {
          fillEl.setAttribute('stroke', props.fillColor);
        } else {
          fillEl.style.backgroundColor = props.fillColor;
        }
      }
    }
    if (props.bgColor !== undefined) {
      const gaugeType = node.getAttribute('data-gauge-type');
      if (gaugeType === 'bar') {
        // Bar gauge container background
        const container = node.querySelector('div');
        if (container) container.style.background = props.bgColor;
      }
      // For arc/ring, bg paths use bgColor — would need full re-render; skip for now
    }
    if (props.min !== undefined) node.setAttribute('data-min', String(props.min));
    if (props.max !== undefined) node.setAttribute('data-max', String(props.max));
  }
}
