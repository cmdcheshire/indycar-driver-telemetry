/**
 * Asset pre-cache module for the overlay.
 *
 * Extracts image URLs from template definitions, pre-fetches them into
 * the browser cache using new Image(), and reports cache readiness back
 * to the server via WebSocket so the dashboard can show
 * confidence indicators.
 */

// ── State ──

let _ws = null;
let _cachedUrls = new Set();       // URLs already successfully cached (persists across templates)
let _activeFetches = new Map();    // url -> Image (in-flight requests)
let _status = _freshStatus();
let _reportTimer = null;

function _freshStatus() {
  return { total: 0, loaded: 0, failed: 0, pending: 0, ready: true };
}

// ── Public API ──

/**
 * Set the WebSocket reference used for status reporting.
 * @param {WebSocket} ws
 */
export function init(ws) {
  _ws = ws;
}

/**
 * Pre-cache all image assets referenced by a template + referenceData + config.
 * Call this on init, templateUpdate, and configUpdate.
 *
 * @param {Object} template      - The current template definition
 * @param {Object} referenceData - Reference data (drivers, tireImages, etc.)
 * @param {Object} config        - Current config (may contain elementOverrides)
 */
export function precacheTemplate(template, referenceData, config) {
  // Cancel any in-flight fetches from a previous call
  for (const [, img] of _activeFetches) {
    img.onload = null;
    img.onerror = null;
    img.src = '';
  }
  _activeFetches.clear();

  // Reset counters (but keep _cachedUrls — browser cache persists)
  _status = _freshStatus();

  const urls = _collectImageUrls(template, referenceData, config);

  if (urls.size === 0) {
    _status.ready = true;
    _reportStatus();
    return;
  }

  for (const url of urls) {
    if (_cachedUrls.has(url)) {
      _status.total++;
      _status.loaded++;
    } else {
      _precacheUrl(url);
    }
  }

  // If everything was already cached, report immediately
  if (_status.pending === 0) {
    _status.ready = true;
    _reportStatus();
  }
}

// ── URL Collection ──

/**
 * Collect all image URLs from template elements, reference data, and config overrides.
 * @returns {Set<string>}
 */
function _collectImageUrls(template, referenceData, config) {
  const urls = new Set();

  // 1. Template elements — direct src and imageBinding
  if (template && Array.isArray(template.elements)) {
    for (const el of template.elements) {
      // Direct src (handles both normalized and un-normalized formats)
      const src = el.src || el.props?.src;
      if (src) urls.add(src);

      // Image binding resolved against referenceData
      const binding = el.imageBinding || el.props?.imageBinding;
      if (binding && referenceData) {
        const resolved = _resolveBinding(binding, referenceData);
        if (resolved) urls.add(resolved);
      }
    }
  }

  // 2. Reference data — driver images (headshot, carLogo, teamLogo)
  if (referenceData && referenceData.drivers) {
    const drivers = referenceData.drivers;
    const driverEntries = Array.isArray(drivers) ? drivers : Object.values(drivers);
    for (const d of driverEntries) {
      if (d.headshot) urls.add(d.headshot);
      if (d.carLogo) urls.add(d.carLogo);
      if (d.teamLogo) urls.add(d.teamLogo);
    }
  }

  // 3. Config element overrides — overridden src values
  if (config && config.elementOverrides) {
    for (const override of Object.values(config.elementOverrides)) {
      if (override.src) urls.add(override.src);
    }
  }

  // Remove any empty/falsy entries
  urls.delete('');
  urls.delete(undefined);
  urls.delete(null);

  return urls;
}

/**
 * Resolve an imageBinding string (e.g. "tireImages.soft") against referenceData.
 */
function _resolveBinding(binding, referenceData) {
  // Try direct lookup in common image maps
  const maps = ['images', 'tireImages', 'indicatorImages', 'leaderboardImages'];
  for (const mapName of maps) {
    const map = referenceData[mapName];
    if (map) {
      // Try exact key match
      if (map[binding]) return map[binding];
      // Try with prefix stripped (e.g. "tireImages.soft" → "soft" in tireImages)
      if (binding.startsWith(mapName + '.')) {
        const key = binding.slice(mapName.length + 1);
        if (map[key]) return map[key];
      }
    }
  }

  // Try dotted path (e.g. "tireImages.soft")
  const parts = binding.split('.');
  if (parts.length === 2) {
    const map = referenceData[parts[0]];
    if (map && map[parts[1]]) return map[parts[1]];
  }

  return null;
}

// ── Pre-fetching ──

function _precacheUrl(url) {
  _status.total++;
  _status.pending++;

  const img = new Image();
  _activeFetches.set(url, img);

  img.onload = () => {
    _cachedUrls.add(url);
    _activeFetches.delete(url);
    _status.loaded++;
    _status.pending--;
    _reportStatus();
  };

  img.onerror = () => {
    _activeFetches.delete(url);
    _status.failed++;
    _status.pending--;
    _reportStatus();
  };

  img.src = url;
}

// ── Status Reporting ──

function _reportStatus() {
  _status.ready = _status.pending === 0;

  if (_reportTimer) clearTimeout(_reportTimer);
  _reportTimer = setTimeout(() => {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({
        type: 'cacheStatus',
        data: {
          total: _status.total,
          loaded: _status.loaded,
          failed: _status.failed,
          pending: _status.pending,
          ready: _status.ready,
        },
      }));
    }

    const pct = _status.total > 0
      ? Math.round((_status.loaded / _status.total) * 100)
      : 100;
    console.log(`[asset-cache] ${_status.loaded}/${_status.total} cached (${pct}%)${_status.failed > 0 ? `, ${_status.failed} failed` : ''}`);
  }, 200);
}
