/**
 * Font loader — shared between builder and overlay.
 * Fetches font assets from the graphics library, registers @font-face rules,
 * and exposes the list of custom fonts for dropdown menus.
 */

/** @type {Array<{id: number, name: string, family: string, url: string}>} */
let _customFonts = [];

/** @type {Set<number>} Track which asset IDs have already been registered */
const _registered = new Set();

/** @type {boolean} */
let _loaded = false;

/**
 * Load all font assets from the library and register @font-face rules.
 * Safe to call multiple times — skips already-registered fonts.
 *
 * @returns {Promise<Array<{id: number, name: string, family: string, url: string}>>}
 */
export async function loadCustomFonts() {
  try {
    const res = await fetch('/api/library/assets');
    if (!res.ok) return _customFonts;

    const data = await res.json();
    const fontMimes = new Set([
      'font/ttf', 'font/otf', 'font/woff', 'font/woff2',
      'application/x-font-ttf', 'application/x-font-otf',
      'application/font-woff', 'application/font-woff2',
      'application/vnd.ms-opentype',
    ]);
    const fontExts = new Set(['.ttf', '.otf', '.woff', '.woff2']);

    const fontAssets = (data.assets || []).filter(a => {
      if (fontMimes.has(a.mime_type)) return true;
      const ext = (a.original_name || a.filename || '').match(/\.[^.]+$/);
      return ext && fontExts.has(ext[0].toLowerCase());
    });

    for (const asset of fontAssets) {
      if (_registered.has(asset.id)) continue;

      const family = _deriveFontFamily(asset.original_name || asset.filename);
      const url = `/api/library/assets/${asset.id}/file`;

      _registerFontFace(family, url, asset.original_name || asset.filename);
      _registered.add(asset.id);

      _customFonts.push({
        id: asset.id,
        name: asset.original_name || asset.filename,
        family,
        url,
      });
    }

    _loaded = true;
  } catch (err) {
    console.error('[font-loader] Failed to load custom fonts:', err);
  }

  return _customFonts;
}

/**
 * Register a single font from an uploaded asset (used immediately after upload).
 *
 * @param {number} assetId
 * @param {string} originalName - Original filename
 * @returns {{family: string, url: string}}
 */
export function registerUploadedFont(assetId, originalName) {
  const family = _deriveFontFamily(originalName);
  const url = `/api/library/assets/${assetId}/file`;

  if (!_registered.has(assetId)) {
    _registerFontFace(family, url, originalName);
    _registered.add(assetId);
    _customFonts.push({ id: assetId, name: originalName, family, url });
  }

  return { family, url };
}

/**
 * Get the list of custom font options for select dropdowns.
 *
 * @returns {Array<{value: string, label: string}>}
 */
export function getCustomFontOptions() {
  return _customFonts.map(f => ({
    value: f.family,
    label: f.name.replace(/\.[^.]+$/, ''),
  }));
}

/**
 * Check if fonts have been loaded.
 * @returns {boolean}
 */
export function fontsLoaded() {
  return _loaded;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derive a CSS font-family name from a filename.
 * "IndycarDisplay.ttf" → "IndycarDisplay"
 * "My Font File.woff2" → "My Font File"
 */
function _deriveFontFamily(filename) {
  return (filename || 'CustomFont')
    .replace(/\.[^.]+$/, '')       // strip extension
    .replace(/_\d+$/, '');         // strip upload timestamp suffix (e.g. _1706...)
}

/**
 * Create and inject a @font-face rule.
 */
function _registerFontFace(family, url, filename) {
  const ext = (filename || '').match(/\.([^.]+)$/);
  const format = ext ? _fontFormat(ext[1].toLowerCase()) : '';

  const rule = `
@font-face {
  font-family: "${family}";
  src: url("${url}")${format ? ` format("${format}")` : ''};
  font-display: swap;
}`;

  const style = document.createElement('style');
  style.textContent = rule;
  document.head.appendChild(style);
}

/**
 * Map file extension to CSS font format string.
 */
function _fontFormat(ext) {
  switch (ext) {
    case 'ttf':   return 'truetype';
    case 'otf':   return 'opentype';
    case 'woff':  return 'woff';
    case 'woff2': return 'woff2';
    default:      return '';
  }
}
