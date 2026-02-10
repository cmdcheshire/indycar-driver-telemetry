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
import { computeClipPath, offsetMaskBounds } from '/js/shared/clip-path.js';

// ---------------------------------------------------------------------------
// State - Dual-root architecture
// ---------------------------------------------------------------------------

// Dual roots allow one template on-air while precomputing another during CUE
let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let initPromise = null;
let pendingMessages = [];

// Active root (currently on-air or ready for on-air)
let activeRootId = 'overlay-root-a';
let activeRoot = null;
let activeTemplate = null;
let activeConfig = null;
let activeDomMap = null;
let activeAnimationEngine = null;
let activeDataBinder = null;
let activePlayoutTimeline = null;
let activeHoldTimer = null;
let activeExitHideTimer = null;

// Cued root (being prepared in background during CUE)
let cuedRootId = 'overlay-root-b';
let cuedRoot = null;
let cuedTemplate = null;
let cuedConfig = null;
let cuedDomMap = null;
let cuedAnimationEngine = null;
let cuedDataBinder = null;
let cuedPrebuiltTimeline = null;  // GSAP timeline built but not played

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
// Dual-root helpers
// ---------------------------------------------------------------------------

function initializeRoots() {
  activeRoot = document.getElementById(activeRootId);
  cuedRoot = document.getElementById(cuedRootId);

  if (!activeRoot || !cuedRoot) {
    console.error('[overlay] Dual roots not found in DOM');
  }
}

function swapRoots() {
  // Swap the root IDs and references
  [activeRootId, cuedRootId] = [cuedRootId, activeRootId];
  [activeRoot, cuedRoot] = [cuedRoot, activeRoot];
  [activeTemplate, cuedTemplate] = [cuedTemplate, activeTemplate];
  [activeConfig, cuedConfig] = [cuedConfig, activeConfig];
  [activeDomMap, cuedDomMap] = [cuedDomMap, activeDomMap];
  [activeAnimationEngine, cuedAnimationEngine] = [cuedAnimationEngine, activeAnimationEngine];
  [activeDataBinder, cuedDataBinder] = [cuedDataBinder, activeDataBinder];

  console.log(`[overlay] Swapped roots - active: ${activeRootId}, cued: ${cuedRootId}`);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const accessToken = window.__OVERLAY_ACCESS_TOKEN__ || '';

if (!accessToken) {
  console.warn('[overlay] No access token found in URL. Connection may be rejected.');
}

initializeRoots();
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

    case 'cue':
      // NEW: Pre-build template in cued root with full precomputation
      initPromise = handleCue(msg).finally(() => {
        initPromise = null;
        drainPendingMessages();
      });
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
      if (activePlayoutTimeline && activePlayoutTimeline.paused()) {
        console.log('[overlay] Resuming playout timeline (advancing past pause point)');
        activePlayoutTimeline.play();
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

  console.log('[overlay] Received init – building into active root');

  // Load custom fonts from library before rendering
  await loadCustomFonts();

  // Normalize builder elements to flat format for renderer/binder
  if (template && template.elements) {
    template.elements = normalizeElements(template.elements);
  }

  activeTemplate = template || { elements: [] };
  activeConfig   = config;

  // Kill previous animation engine (reverts gsap.context, frees GPU memory)
  if (activeAnimationEngine) activeAnimationEngine.killAll();

  // Build the DOM from the template into ACTIVE root
  // Dispose scene3d controllers before clearing DOM (frees WebGL resources)
  activeRoot.querySelectorAll('[data-scene3d-type]').forEach(node => {
    if (node.__scene3dController) node.__scene3dController.dispose();
  });
  activeRoot.innerHTML = '';

  activeDomMap = buildOverlay(activeRoot, activeTemplate, referenceData);

  // Create shared animation engine + binder
  activeAnimationEngine = new GsapAnimationEngine(activeDomMap);
  activeDataBinder      = new DataBinder(activeTemplate.elements, activeDomMap, activeAnimationEngine);

  // Apply target cars from config
  if (config && config.targetCars) {
    activeDataBinder.setTargetCars(config.targetCars);
  }

  // Store reference data as a flat array for data binding
  if (referenceData && referenceData.drivers) {
    const driversArray = Object.entries(referenceData.drivers).map(([carNum, d]) => ({
      carNumber: carNum, ...d,
    }));
    activeDataBinder.updateData('referenceData', driversArray);
  }

  // Feed snapshot data (each key is a data type)
  if (snapshot) {
    for (const [dataType, data] of Object.entries(snapshot)) {
      activeDataBinder.updateData(dataType, data);
    }
    activeDataBinder.resolveBindings();
    activeDataBinder.resolveGaugeBindings();
    activeDataBinder.resolveScene3dBindings();
    activeDataBinder.resolveUniversalBindings();
  }

  // Apply element overrides from config
  if (config && config.elementOverrides && activeDomMap) {
    applyElementOverrides(config.elementOverrides);
  }

  // Respect initial visibility — hide overlay if nothing is on-air
  if (!config || config.visible === false) {
    activeRoot.style.display = 'none';
  }

  // Pre-cache image assets for this template
  precacheTemplate(activeTemplate, referenceData || {}, activeConfig || {});
}

// ---------------------------------------------------------------------------
// CUE - Pre-build template with full precomputation (performance critical!)
// ---------------------------------------------------------------------------

/**
 * Yield control to the main thread to prevent blocking on-air graphics.
 * @param {number} delayMs - Milliseconds to wait (default 10ms for ~60fps headroom)
 */
function yieldToMainThread(delayMs = 10) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function handleCue(msg) {
  const { template, config, referenceData, elementAnimations, timeline } = msg.data || {};

  console.log('[overlay] CUE received – pre-building in cued root with async precomputation (protects on-air graphics)');

  // Load custom fonts from library before rendering
  await loadCustomFonts();

  // Normalize builder elements to flat format
  if (template && template.elements) {
    template.elements = normalizeElements(template.elements);
  }

  cuedTemplate = template || { elements: [] };
  cuedConfig = config;

  // Kill previous cued animation engine (if re-cueing)
  if (cuedAnimationEngine) cuedAnimationEngine.killAll();

  // Yield after cleanup to give main thread headroom
  await yieldToMainThread(10);

  // Build DOM into CUED root
  // Dispose scene3d controllers before clearing
  cuedRoot.querySelectorAll('[data-scene3d-type]').forEach(node => {
    if (node.__scene3dController) node.__scene3dController.dispose();
  });
  cuedRoot.innerHTML = '';

  cuedDomMap = buildOverlay(cuedRoot, cuedTemplate, referenceData);

  // Yield after DOM build (potentially heavy operation with many elements)
  await yieldToMainThread(15);

  // Create animation engine + binder for cued root
  cuedAnimationEngine = new GsapAnimationEngine(cuedDomMap);
  cuedDataBinder = new DataBinder(cuedTemplate.elements, cuedDomMap, cuedAnimationEngine);

  // Apply target cars from config
  if (config && config.targetCars) {
    cuedDataBinder.setTargetCars(config.targetCars);
  }

  // Store reference data
  if (referenceData && referenceData.drivers) {
    const driversArray = Object.entries(referenceData.drivers).map(([carNum, d]) => ({
      carNumber: carNum, ...d,
    }));
    cuedDataBinder.updateData('referenceData', driversArray);
  }

  // Apply element overrides
  if (config && config.elementOverrides && cuedDomMap) {
    applyElementOverrides(config.elementOverrides, cuedDomMap);
  }

  // CRITICAL: Keep cued root hidden (will be shown on TAKE ON)
  cuedRoot.style.display = 'none';

  // Yield before asset precaching
  await yieldToMainThread(10);

  // Pre-cache assets
  precacheTemplate(cuedTemplate, referenceData || {}, cuedConfig || {});

  // Yield before timeline precomputation (most intensive operation)
  await yieldToMainThread(20);

  // **PRECOMPUTATION: Build the GSAP timeline now but don't play it**
  if (elementAnimations && elementAnimations.length > 0) {
    console.log('[overlay] CUE: Pre-building GSAP timeline with', elementAnimations.length, 'element animations');

    // Build the playout timeline (will be played on TAKE ON)
    cuedPrebuiltTimeline = buildPlayoutTimeline(
      cuedDomMap,
      cuedAnimationEngine,
      elementAnimations,
      timeline,
      { buildOnly: true }  // Flag to build but not play
    );

    console.log('[overlay] CUE: Timeline pre-built and ready (duration:', cuedPrebuiltTimeline?.duration(), 's)');
  }

  console.log('[overlay] CUE complete - template ready for instant TAKE ON');
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
  const dataType = DATA_TYPE_MAP[msg.type] || msg.type;

  // Update ACTIVE binder (on-air or ready to go on-air)
  if (activeDataBinder) {
    if (SINGLE_CAR_TYPES.has(msg.type)) {
      activeDataBinder.mergeCarData(dataType, msg.data);
    } else {
      activeDataBinder.updateData(dataType, msg.data);
    }
    activeDataBinder.resolveBindings();
    activeDataBinder.resolveGaugeBindings();
    activeDataBinder.resolveScene3dBindings();
    activeDataBinder.resolveUniversalBindings();
  }

  // Update CUED binder (pre-built graphic waiting in background)
  // This keeps cued graphics in sync with live data
  if (cuedDataBinder) {
    if (SINGLE_CAR_TYPES.has(msg.type)) {
      cuedDataBinder.mergeCarData(dataType, msg.data);
    } else {
      cuedDataBinder.updateData(dataType, msg.data);
    }
    cuedDataBinder.resolveBindings();
    cuedDataBinder.resolveGaugeBindings();
    cuedDataBinder.resolveScene3dBindings();
    cuedDataBinder.resolveUniversalBindings();
  }
}

// ---------------------------------------------------------------------------
// Visibility — GSAP master timeline playout system
// ---------------------------------------------------------------------------

function handleVisibility(msg) {
  const { visible, elementId, animation, elementAnimations, timeline } = msg.data || {};

  console.log('[overlay] Visibility:', { visible, elementId, animation, elementAnimCount: elementAnimations?.length, timeline });

  // Single-element show/hide (not part of the playout lifecycle)
  if (elementId) {
    if (activeAnimationEngine) {
      if (visible) {
        activeAnimationEngine.show(elementId, { type: animation });
      } else {
        activeAnimationEngine.hide(elementId, { type: animation });
      }
    }
    return;
  }

  if (visible) {
    // ── TAKE ON ──

    // Check if we have a pre-built cued template ready
    const hasCuedTemplate = cuedPrebuiltTimeline !== null && cuedDomMap !== null && cuedDomMap.size > 0;

    if (hasCuedTemplate) {
      console.log('[overlay] TAKE ON: Using cued template - instant root swap!');

      // Take off old active root (if visible)
      if (activeRoot && activeRoot.style.display !== 'none') {
        activeRoot.style.display = 'none';
        if (activeHoldTimer) { clearTimeout(activeHoldTimer); activeHoldTimer = null; }
        if (activeExitHideTimer) { clearTimeout(activeExitHideTimer); activeExitHideTimer = null; }
        if (activePlayoutTimeline) { activePlayoutTimeline.kill(); activePlayoutTimeline = null; }
        if (activeAnimationEngine) activeAnimationEngine.killAll();
      }

      // Swap roots: cued becomes active
      swapRoots();

      // Use the prebuilt timeline directly — no rebuild needed!
      // After swapping, activeAnimationEngine points to the same engine object
      // that the timeline was built with, so all callbacks are still valid.
      activeRoot.style.display = 'block';  // Explicit value to override CSS class
      activePlayoutTimeline = cuedPrebuiltTimeline;
      cuedPrebuiltTimeline = null;

      console.log('[overlay] Playing prebuilt timeline (instant!)', activePlayoutTimeline.duration(), 's');
      activePlayoutTimeline.play();
      return;  // Done!
    }

    // No cued template - build timeline now (normal flow)
    console.log('[overlay] TAKE ON: No cued template, building now');

    // **FIX: Verify activeDomMap exists before attempting to build**
    if (!activeDomMap || activeDomMap.size === 0) {
      console.error('[overlay] TAKE ON failed: activeDomMap is empty. No INIT or CUE was received.');
      return;
    }

    // Clean up any previous playout state
    if (activeHoldTimer) { clearTimeout(activeHoldTimer); activeHoldTimer = null; }
    if (activeExitHideTimer) { clearTimeout(activeExitHideTimer); activeExitHideTimer = null; }
    if (activePlayoutTimeline) { activePlayoutTimeline.kill(); activePlayoutTimeline = null; }

    activeRoot.style.display = 'block';  // Explicit value to override CSS class

    // Reset display on ALL elements (not just animated ones) so scene3d and
    // other elements hidden by exit animations become visible again.
    // Skip mask elements that are intentionally hidden by clip-path system.
    // Also restore mask clip-paths that may have been cleared by killed exit animations.
    if (activeDomMap) {
      for (const [elementId, node] of activeDomMap) {
        // Restore display for elements hidden by exit animations (skip mask-hidden and operator-hidden)
        if (node.style.display === 'none' && node.dataset.maskHidden !== 'true' && node.dataset.operatorHidden !== 'true') {
          node.style.display = node.dataset.baseDisplay || '';
        }
        // Mask-hidden elements use visibility:hidden (not display:none) so they stay in layout for transform tracking
        if (node.dataset.maskHidden === 'true') {
          console.log(`[overlay] Keeping mask-hidden element ${elementId} invisible (visibility:hidden)`);
          node.style.visibility = 'hidden';
        }
        if (node.dataset.maskClipPath) {
          node.style.clipPath = node.dataset.maskClipPath;
        }
      }
    }

    if (elementAnimations && elementAnimations.length > 0) {
      // Build a GSAP master timeline for the IN phase with pause points
      console.log('[overlay] Building playout timeline with', elementAnimations.length, 'enter animations');
      activePlayoutTimeline = buildPlayoutTimeline(activeDomMap, activeAnimationEngine, elementAnimations, timeline);
    } else if (animation) {
      // Simple root-level animation (no per-element orchestration)
      console.log('[overlay] Using root-level animation:', animation);
      if (activeAnimationEngine) {
        activeAnimationEngine.show('__root__', { type: animation, duration: 400, easing: 'power2.out' });
      }
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
 *
 * @param {Map} domMapToUse - The domMap to use (activeDomMap or cuedDomMap)
 * @param {Object} animEngineToUse - The animation engine to use
 * @param {Array} elementAnimations - Per-element animation configs
 * @param {Object} timeline - Timeline config (pausePoints, holdDuration, loopRegion)
 * @param {Object} options - { buildOnly: boolean } - if true, build but don't auto-play
 * @returns {gsap.core.Timeline} - The built timeline
 */
function buildPlayoutTimeline(domMapToUse, animEngineToUse, elementAnimations, timeline, options = {}) {
  const { buildOnly = false } = options;
  let tweenCount = 0;

  const tl = gsap.timeline({
    paused: buildOnly,  // For CUE: build but don't play
    onComplete: () => {
      console.log('[overlay] IN phase complete — entering HOLD. Timeline duration was:', tl.duration(), 's, tweens:', tweenCount);
      if (!buildOnly) {
        activePlayoutTimeline = null;
        onEnterComplete();
      }
    },
  });

  const templateToUse = buildOnly ? cuedTemplate : activeTemplate;

  for (const config of elementAnimations) {
    const node = domMapToUse ? domMapToUse.get(config.elementId) : null;
    if (!node) { console.warn('[overlay] DOM node not found for', config.elementId); continue; }

    // Kill any lingering tweens on this node
    gsap.killTweensOf(node);

    // Reset display and restore base styles
    // For mask-hidden elements: keep them invisible but in layout (for transform tracking)
    if (node.dataset.maskHidden === 'true') {
      console.log(`[overlay] Playing animation for mask-hidden element ${config.elementId} but keeping it invisible`);
      node.style.visibility = 'hidden';
      node.style.display = node.dataset.baseDisplay || '';
    } else {
      node.style.display = node.dataset.baseDisplay || '';
    }
    node.style.opacity = node.dataset.baseOpacity || '';
    if (node.dataset.baseColor) node.style.color = node.dataset.baseColor;
    if (node.dataset.baseBg) node.style.backgroundColor = node.dataset.baseBg;
    if (node.dataset.baseTextShadow) node.style.textShadow = node.dataset.baseTextShadow;
    if (node.dataset.baseTransform) node.style.transform = node.dataset.baseTransform;
    // Restore mask clip-path (may have been cleared by killed exit animation)
    if (node.dataset.maskClipPath) node.style.clipPath = node.dataset.maskClipPath;
    node.style.willChange = 'transform, opacity';

    // ── Check for keyframe animation override (enter) ──
    const templateEl = templateToUse?.elements?.find(e => e.id === config.elementId);
    const enterKf = templateEl?.enterKeyframeAnimation || templateEl?.keyframeAnimation;
    if (enterKf?.enabled && enterKf.tracks?.length > 0) {
      const subTl = animEngineToUse.showWithKeyframes(config.elementId, enterKf);
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

    // Add enter animation to the master timeline at absolute offset
    // immediateRender: true ensures from-state is applied at t=0 (prevents flash
    // where element is visible in final state during its delay period)
    tl.from(node, {
      ...preset.vars,
      duration,
      ease: easing,
      immediateRender: true,
      onComplete: () => {
        // Clear GSAP-set inline transforms so element returns to CSS-defined position
        const clearStr = preset.clearProps || Object.keys(preset.vars).join(',');
        gsap.set(node, { clearProps: clearStr });
        // Restore base styles after clearProps (prevents loss on repeat cycles)
        if (node.dataset.baseDisplay) node.style.display = node.dataset.baseDisplay;
        if (node.dataset.baseOpacity) node.style.opacity = node.dataset.baseOpacity;
        if (node.dataset.baseColor) node.style.color = node.dataset.baseColor;
        if (node.dataset.baseBg) node.style.backgroundColor = node.dataset.baseBg;
        if (node.dataset.baseTextShadow) node.style.textShadow = node.dataset.baseTextShadow;
        if (node.dataset.baseTransform) node.style.transform = node.dataset.baseTransform;
        // Restore mask clip-path if set
        if (node.dataset.maskClipPath) node.style.clipPath = node.dataset.maskClipPath;
        // Schedule GPU layer cleanup
        setTimeout(() => { node.style.willChange = ''; }, 5000);
      },
    }, delay);
    tweenCount++;
  }

  // Animated clip-paths: if a mask element has an enter animation, animate
  // the clip-path on its dependent (clipped) elements from offset → rest position.
  // Supports both preset animations (pre-computed fromTo) and keyframe animations
  // (real-time onUpdate tracking of the mask's GSAP transform every frame).
  if (templateToUse?.elements) {
    const canvasW = window.innerWidth || 1920;
    const canvasH = window.innerHeight || 1080;

    for (const el of templateToUse.elements) {
      if (!el.clipMask?.elementId) continue;

      const maskEl = templateToUse.elements.find(m => m.id === el.clipMask.elementId);
      if (!maskEl) continue;

      const clippedNode = domMapToUse?.get(el.id);
      if (!clippedNode) continue;

      // Build bounds objects (normalized elements use left/top)
      const clippedBounds = { x: el.left ?? el.x, y: el.top ?? el.y, width: el.width, height: el.height };
      const maskBounds = {
        x: maskEl.left ?? maskEl.x, y: maskEl.top ?? maskEl.y,
        width: maskEl.width, height: maskEl.height,
        rotation: maskEl.rotation || 0,
        shapeType: maskEl.shapeType, borderRadius: maskEl.borderRadius,
        props: { shapeType: maskEl.shapeType, borderRadius: maskEl.borderRadius },
      };

      // ── Keyframe animation on mask (priority over preset) ──
      const maskEnterKf = maskEl.enterKeyframeAnimation || maskEl.keyframeAnimation;
      if (maskEnterKf?.enabled && maskEnterKf.tracks?.length > 0) {
        const maskNode = domMapToUse?.get(maskEl.id);
        if (!maskNode) continue;

        // Only animate clip-path if keyframes affect position/size/rotation
        const hasPositionTracks = maskEnterKf.tracks.some(t =>
          ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotation'].includes(t.property)
        );
        if (!hasPositionTracks) continue;

        const delay = (maskEl.enterAnimationDelay || 0) / 1000;
        const duration = (maskEnterKf.duration || 2000) / 1000;

        // Add a tracking tween that recomputes clip-path every frame
        tl.to({}, {
          duration,
          onUpdate: () => {
            // Read pixel-based x/y (from presets) and percentage-based xPercent/yPercent (from keyframes)
            const gsapXpx = gsap.getProperty(maskNode, 'x') || 0;
            const gsapYpx = gsap.getProperty(maskNode, 'y') || 0;
            const gsapXpct = gsap.getProperty(maskNode, 'xPercent') || 0;
            const gsapYpct = gsap.getProperty(maskNode, 'yPercent') || 0;
            const gsapScaleX = gsap.getProperty(maskNode, 'scaleX');
            const gsapScaleY = gsap.getProperty(maskNode, 'scaleY');
            const gsapRotation = gsap.getProperty(maskNode, 'rotation') || 0;

            const scaleX = (gsapScaleX != null && gsapScaleX !== '') ? gsapScaleX : 1;
            const scaleY = (gsapScaleY != null && gsapScaleY !== '') ? gsapScaleY : 1;

            // xPercent is % of element's own rendered width; convert to pixels then canvas %
            const maskPxW = (maskBounds.width / 100) * canvasW;
            const maskPxH = (maskBounds.height / 100) * canvasH;
            const gsapX = gsapXpx + (gsapXpct / 100) * maskPxW;
            const gsapY = gsapYpx + (gsapYpct / 100) * maskPxH;

            const offsetXPct = (gsapX / canvasW) * 100;
            const offsetYPct = (gsapY / canvasH) * 100;
            const effectiveW = maskBounds.width * scaleX;
            const effectiveH = maskBounds.height * scaleY;
            const cx = maskBounds.x + maskBounds.width / 2;
            const cy = maskBounds.y + maskBounds.height / 2;

            const effectiveMask = {
              x: cx - effectiveW / 2 + offsetXPct,
              y: cy - effectiveH / 2 + offsetYPct,
              width: effectiveW,
              height: effectiveH,
              rotation: (maskBounds.rotation || 0) + gsapRotation,
              shapeType: maskBounds.shapeType, borderRadius: maskBounds.borderRadius,
              props: maskBounds.props,
            };

            const cp = computeClipPath(clippedBounds, effectiveMask, { forcePolygon: true });
            if (cp) clippedNode.style.clipPath = cp;
          },
          onComplete: () => {
            clippedNode.style.clipPath = clippedNode.dataset.maskClipPath || '';
          },
        }, delay);
        tweenCount++;
        continue;
      }

      // ── Preset animation on mask ──
      const maskAnimType = maskEl.enterAnimation;
      if (!maskAnimType || maskAnimType === 'none') continue;

      const preset = getEnterPreset(maskAnimType);
      if (!preset) continue;

      // Skip clip-path based presets (wipe/reveal) and opacity-only presets
      if (preset.vars.clipPath) continue;
      const posVars = { ...preset.vars };
      delete posVars.opacity;
      if (Object.keys(posVars).length === 0) continue;

      const fromMaskBounds = offsetMaskBounds(maskBounds, preset.vars, canvasW, canvasH);
      const toClipPath = computeClipPath(clippedBounds, maskBounds, { forcePolygon: true });
      const fromClipPath = computeClipPath(clippedBounds, fromMaskBounds, { forcePolygon: true });

      if (!fromClipPath || !toClipPath) continue;

      const delay = (maskEl.enterAnimationDelay || 0) / 1000;
      const duration = (maskEl.enterAnimationDuration || 300) / 1000;
      const rawEasing = maskEl.enterAnimationEasing || preset.defaultEase || 'power2.out';
      const easing = resolveEasing(migrateEasing(rawEasing));

      tl.fromTo(clippedNode,
        { clipPath: fromClipPath },
        { clipPath: toClipPath, duration, ease: easing, overwrite: false,
          onComplete: () => {
            // Restore the static mask clip-path (stored by template-loader)
            clippedNode.style.clipPath = clippedNode.dataset.maskClipPath || toClipPath;
          },
        },
        delay
      );
      tweenCount++;
    }
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
  // **FIX: Use activeRoot instead of non-existent 'overlay-root' element**
  if (!activeRoot) {
    console.error('[overlay] performTakeOff failed: activeRoot is null');
    return;
  }

  console.log('[overlay] Performing TAKE OFF from active root:', activeRootId);

  // Kill active playout timeline (if still in IN phase)
  if (activePlayoutTimeline) {
    activePlayoutTimeline.kill();
    activePlayoutTimeline = null;
  }

  // Clear hold timer
  if (activeHoldTimer) {
    clearTimeout(activeHoldTimer);
    activeHoldTimer = null;
  }

  // Clear any previous exit-hide timer (rapid TAKE OFF / TAKE ON cycles)
  if (activeExitHideTimer) {
    clearTimeout(activeExitHideTimer);
    activeExitHideTimer = null;
  }

  // Kill emphasis animations for a clean exit (no mid-animation jitter)
  if (activeAnimationEngine) {
    activeAnimationEngine.killEmphasis();
  }

  // Extract exit animations from the current template
  const exitConfigs = extractExitAnimations(activeTemplate);

  // Check for exit keyframe animations
  const exitKfElements = (activeTemplate?.elements || []).filter(
    el => el.exitKeyframeAnimation?.enabled && el.exitKeyframeAnimation.tracks?.length > 0
  );

  // Separate preset exits from keyframe exits
  const kfExitIds = new Set(exitKfElements.map(el => el.id));
  const presetExitConfigs = exitConfigs.filter(c => !kfExitIds.has(c.elementId));

  if ((presetExitConfigs.length > 0 || exitKfElements.length > 0) && activeAnimationEngine) {
    // Build exit keyframe timeline if any elements have keyframe exits
    let kfDurMs = 0;
    if (exitKfElements.length > 0) {
      const exitTl = gsap.timeline();
      for (const el of exitKfElements) {
        const exitDelay = (el.exitAnimationDelay || 0) / 1000;
        const subTl = activeAnimationEngine.hideWithKeyframes(el.id, el.exitKeyframeAnimation);
        if (subTl) {
          exitTl.add(subTl, exitDelay);
          console.log('[overlay] Using exit keyframe animation for', el.id);
        }
      }
      kfDurMs = exitTl.duration() * 1000;
    }

    // Fire preset exit animations
    for (const config of presetExitConfigs) {
      activeAnimationEngine.hide(config.elementId, config);
    }

    // Calculate max preset exit duration
    const maxPresetDur = presetExitConfigs.reduce(
      (max, ea) => Math.max(max, (ea.delay || 0) + (ea.duration || 300)), 0
    );

    // Hide root after the longer of keyframe or preset exits finish
    const hideDurMs = Math.max(kfDurMs, maxPresetDur);
    // **FIX: Use activeExitHideTimer instead of exitHideTimer**
    activeExitHideTimer = setTimeout(() => {
      activeExitHideTimer = null;
      activeRoot.style.display = 'none';
      console.log('[overlay] Active root hidden after exit animations');
    }, hideDurMs + 50);
  } else {
    activeRoot.style.display = 'none';
    console.log('[overlay] Active root hidden (no exit animations)');
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

  console.log('[overlay] Template update received – rebuilding ACTIVE root');

  // Reload custom fonts in background
  loadCustomFonts();

  // Normalize builder elements to flat format
  if (template && template.elements) {
    template.elements = normalizeElements(template.elements);
  }

  activeTemplate = template;

  // Clean up playout state from previous template
  if (activePlayoutTimeline) { activePlayoutTimeline.kill(); activePlayoutTimeline = null; }
  if (activeHoldTimer)       { clearTimeout(activeHoldTimer); activeHoldTimer = null; }
  if (activeExitHideTimer)   { clearTimeout(activeExitHideTimer); activeExitHideTimer = null; }

  // Kill previous animation engine
  if (activeAnimationEngine) activeAnimationEngine.killAll();

  // Hide active root BEFORE clearing DOM
  activeRoot.style.display = 'none';
  activeRoot.className = '';

  // Dispose scene3d controllers before clearing DOM
  activeRoot.querySelectorAll('[data-scene3d-type]').forEach(node => {
    if (node.__scene3dController) node.__scene3dController.dispose();
  });
  activeRoot.innerHTML = '';

  activeDomMap = buildOverlay(activeRoot, template, referenceData || {});

  activeAnimationEngine = new GsapAnimationEngine(activeDomMap);
  activeDataBinder      = new DataBinder(template.elements, activeDomMap, activeAnimationEngine);

  if (activeConfig && activeConfig.targetCars) {
    activeDataBinder.setTargetCars(activeConfig.targetCars);
  }

  // Store reference data as a flat array for data binding
  const refData = referenceData || {};
  if (refData.drivers) {
    const driversArray = Object.entries(refData.drivers).map(([carNum, d]) => ({
      carNumber: carNum, ...d,
    }));
    activeDataBinder.updateData('referenceData', driversArray);
  }

  // Re-resolve with whatever data we already have
  activeDataBinder.resolveBindings();
  activeDataBinder.resolveGaugeBindings();
  activeDataBinder.resolveScene3dBindings();
  activeDataBinder.resolveUniversalBindings();

  // Pre-cache image assets for the new template
  precacheTemplate(activeTemplate, referenceData || {}, activeConfig || {});

  // Root stays hidden — visibility message (TAKE ON) will show it
}

// ---------------------------------------------------------------------------
// Config update
// ---------------------------------------------------------------------------

function handleConfigUpdate(msg) {
  const config = msg.data || {};
  console.log('[overlay] Config update received');

  // Update both active and cued configs
  activeConfig = { ...activeConfig, ...config };
  cuedConfig = { ...cuedConfig, ...config };

  // Update active data binder
  if (activeDataBinder && config.targetCars) {
    activeDataBinder.setTargetCars(config.targetCars);
    activeDataBinder.resolveBindings();
  }

  // Update cued data binder (so cued graphics have latest config)
  if (cuedDataBinder && config.targetCars) {
    cuedDataBinder.setTargetCars(config.targetCars);
    cuedDataBinder.resolveBindings();
  }

  // Apply element overrides from exposed elements to active root
  if (activeDomMap && config.elementOverrides) {
    applyElementOverrides(config.elementOverrides, activeDomMap);
    // Re-resolve bindings in case prefix/suffix/fallback/car changed
    if (activeDataBinder) activeDataBinder.resolveBindings();
    // Re-cache in case image sources were overridden
    precacheTemplate(activeTemplate, {}, activeConfig);
  }

  // Also apply to cued root if it exists
  if (cuedDomMap && config.elementOverrides) {
    applyElementOverrides(config.elementOverrides, cuedDomMap);
    if (cuedDataBinder) cuedDataBinder.resolveBindings();
  }
}

/**
 * Apply per-element overrides from the rundown config.
 * @param {Object} overrides - Map of elementId -> { text, src, fill, ... }
 */
function applyElementOverrides(overrides, domMapToUse = activeDomMap) {
  if (!domMapToUse) return;
  for (const [elementId, props] of Object.entries(overrides)) {
    const node = domMapToUse.get(elementId);
    if (!node) continue;

    // Element visibility (operator toggle)
    if (props.visibility !== undefined) {
      if (props.visibility === 'hidden') {
        node.style.display = 'none';
        node.dataset.operatorHidden = 'true';
      } else {
        delete node.dataset.operatorHidden;
        node.style.display = node.dataset.baseDisplay || '';
      }
    }

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
