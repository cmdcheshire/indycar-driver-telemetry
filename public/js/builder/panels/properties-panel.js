/**
 * Properties panel - right sidebar showing editable properties for the selected element.
 * Features: quick actions bar, collapsible sections, color swatches, animation controls.
 */

import {
  BINDING_SOURCES,
  CAR_SELECTORS,
  FORMATTERS,
  getFieldsForSource,
  resolveBindingPreview,
} from '../data-binding.js';

import {
  ENTER_ANIMATION_CATEGORIES,
  EXIT_ANIMATION_CATEGORIES,
  EMPHASIS_ANIMATIONS,
  GSAP_EASINGS,
} from '/js/shared/animation-presets.js';

import { getExposableSettings } from '/js/shared/exposed-settings.js';
import { getCustomFontOptions, registerUploadedFont } from '/js/shared/font-loader.js';
import { openAnimationDesigner } from './animation-designer.js';
import { BINDABLE_PROPERTIES } from '/js/shared/expression-engine.js';
import { SCENE3D_SUBTYPES } from '/js/shared/scene3d-utils.js';

/** @type {Function} */
let onPropertyChange = null;
/** @type {Function} */
let onQuickAction = null;
/** @type {Function|null} */
let getElements = null;

/** @type {HTMLElement} */
let panelEl = null;

/** @type {object|null} */
let currentElement = null;

/** Persisted collapsed state for sections */
const _sectionState = {};


/**
 * Initialize the properties panel.
 * @param {object} opts
 * @param {Function} opts.onPropertyChange - Called with (elementId, changedProps)
 * @param {Function} [opts.onQuickAction] - Called with (elementId, action) for quick action buttons
 */
export function initPropertiesPanel(opts) {
  onPropertyChange = opts.onPropertyChange;
  onQuickAction = opts.onQuickAction || null;
  getElements = opts.getElements || null;
  panelEl = document.getElementById('propertiesPanel');
}

/**
 * Update the panel to show properties for the given element.
 * Pass null to show "no selection" state.
 * @param {object|null} element
 */
export function updatePropertiesPanel(element) {
  if (!panelEl) return;
  currentElement = element;

  if (!element) {
    panelEl.innerHTML = '<div class="no-selection-msg">Select an element to view its properties</div>';
    return;
  }

  panelEl.innerHTML = '';

  // Quick actions bar
  _addQuickActions(element);

  // Element name + exposed toggle + settings picker
  const elementChildren = [
    _textInput('Name', element.name, (v) => _emit({ name: v })),
    _checkboxInput('Expose to Operator', !!element.exposed, (v) => {
      _emit({ exposed: v });
      if (currentElement) {
        currentElement.exposed = v;
        updatePropertiesPanel(currentElement);
      }
    }),
  ];

  // When exposed, show checkboxes for which settings the operator can edit
  if (element.exposed) {
    const availableSettings = getExposableSettings(element.type);
    const currentSettings = element.exposedSettings || [];

    if (availableSettings.length > 0) {
      const settingsContainer = document.createElement('div');
      settingsContainer.className = 'exposed-settings-picker';
      settingsContainer.style.cssText = 'padding:4px 0 0 18px; display:flex; flex-direction:column; gap:2px;';

      const label = document.createElement('div');
      label.textContent = 'Operator can edit:';
      label.style.cssText = 'font-size:0.68rem; color:var(--text-dim,#8b8fa3); font-weight:600; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:2px;';
      settingsContainer.appendChild(label);

      for (const setting of availableSettings) {
        const isChecked = currentSettings.includes(setting.key);
        const row = document.createElement('label');
        row.style.cssText = 'display:flex; align-items:center; gap:6px; cursor:pointer; font-size:0.75rem; color:var(--text,#e8eaed); padding:1px 0;';

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isChecked;
        cb.style.cssText = 'accent-color:var(--accent,#5865f2); margin:0;';
        cb.addEventListener('change', () => {
          const updated = [...(currentElement?.exposedSettings || [])];
          if (cb.checked) {
            if (!updated.includes(setting.key)) updated.push(setting.key);
          } else {
            const idx = updated.indexOf(setting.key);
            if (idx !== -1) updated.splice(idx, 1);
          }
          _emit({ exposedSettings: updated });
          if (currentElement) currentElement.exposedSettings = updated;
        });

        const span = document.createElement('span');
        span.textContent = setting.label;
        row.appendChild(cb);
        row.appendChild(span);
        settingsContainer.appendChild(row);
      }

      elementChildren.push(settingsContainer);
    }
  }

  _addCollapsibleGroup('Element', elementChildren);

  // Transform
  _addCollapsibleGroup('Transform', [
    _row([
      _numberInput('X', element.x, -100, 200, 0.1, (v) => _emit({ x: v })),
      _numberInput('Y', element.y, -100, 200, 0.1, (v) => _emit({ y: v })),
    ]),
    _row([
      _numberInput('W', element.width, 0.5, 200, 0.1, (v) => _emit({ width: v })),
      _numberInput('H', element.height, 0.5, 200, 0.1, (v) => _emit({ height: v })),
    ]),
    _row([
      _numberInput('Rot', element.rotation || 0, 0, 360, 1, (v) => _emit({ rotation: v })),
      _numberInput('Opa', element.opacity ?? 1, 0, 1, 0.05, (v) => _emit({ opacity: v })),
    ]),
  ]);

  // 3D Transform
  _addCollapsibleGroup('3D Transform', [
    _row([
      _numberInput('Rot X', element.rotationX || 0, -360, 360, 1, (v) => _emit({ rotationX: v })),
      _numberInput('Rot Y', element.rotationY || 0, -360, 360, 1, (v) => _emit({ rotationY: v })),
    ]),
    _row([
      _numberInput('Z', element.z || 0, -500, 500, 1, (v) => _emit({ z: v })),
      _numberInput('Persp', element.perspective || 0, 0, 5000, 50, (v) => _emit({ perspective: v })),
    ]),
  ], true);

  // Clipping mask
  _addClippingSection(element);

  // Type-specific properties
  const p = element.props || {};

  switch (element.type) {
    case 'text':
      _addTextProps(p);
      break;
    case 'image':
      _addImageProps(p);
      break;
    case 'shape':
      _addShapeProps(p);
      break;
    case 'data':
      _addDataProps(p);
      break;
    case 'arcGauge':
      _addArcGaugeProps(p);
      break;
    case 'barGauge':
      _addBarGaugeProps(p);
      break;
    case 'ringSegment':
      _addRingSegmentProps(p);
      break;
    case 'scene3d':
      _addScene3dProps(p);
      break;
  }

  // Universal visual bindings (all element types)
  _addBindingsSection(element);

  // Animation (all element types)
  _addAnimationSection(element);
}

/* ---- Quick Actions ---- */

function _addQuickActions(element) {
  const bar = document.createElement('div');
  bar.className = 'quick-actions';

  bar.appendChild(_quickActionBtn('Duplicate', _svgDuplicate(), () => {
    if (onQuickAction) onQuickAction(element.id, 'duplicate');
  }));

  bar.appendChild(_quickActionBtn(
    element.visible ? 'Hide' : 'Show',
    element.visible ? _svgEye() : _svgEyeOff(),
    () => { if (onQuickAction) onQuickAction(element.id, 'visibility'); }
  ));

  bar.appendChild(_quickActionBtn(
    element.locked ? 'Unlock' : 'Lock',
    element.locked ? _svgLock() : _svgUnlock(),
    () => { if (onQuickAction) onQuickAction(element.id, 'lock'); }
  ));

  bar.appendChild(_quickActionBtn('Move to Front', _svgFront(), () => {
    if (onQuickAction) onQuickAction(element.id, 'front');
  }));

  bar.appendChild(_quickActionBtn('Move to Back', _svgBack(), () => {
    if (onQuickAction) onQuickAction(element.id, 'back');
  }));

  const deleteBtn = _quickActionBtn('Delete', _svgDelete(), () => {
    if (onQuickAction) onQuickAction(element.id, 'delete');
  });
  deleteBtn.classList.add('danger');
  bar.appendChild(deleteBtn);

  panelEl.appendChild(bar);
}

function _quickActionBtn(title, svgHtml, onClick) {
  const btn = document.createElement('button');
  btn.className = 'quick-action-btn';
  btn.title = title;
  btn.innerHTML = svgHtml;
  btn.addEventListener('click', onClick);
  return btn;
}

/* ---- Type-specific property sections ---- */

function _addTextProps(p) {
  // Build font options: built-in + custom uploaded fonts
  const builtInFonts = [
    { value: 'Inter, sans-serif', label: 'Inter' },
    { value: 'Roboto, sans-serif', label: 'Roboto' },
    { value: 'Roboto Mono, monospace', label: 'Roboto Mono' },
    { value: 'Oswald, sans-serif', label: 'Oswald' },
    { value: 'Montserrat, sans-serif', label: 'Montserrat' },
    { value: 'Arial, sans-serif', label: 'Arial' },
    { value: 'Georgia, serif', label: 'Georgia' },
    { value: 'monospace', label: 'Monospace' },
  ];
  const customFonts = getCustomFontOptions();
  const allFontOptions = customFonts.length > 0
    ? [...builtInFonts, ...customFonts]
    : builtInFonts;

  // Font selector row with upload button (custom dropdown for font preview)
  const fontRow = _fontSelectInput('Font', p.fontFamily || 'Inter, sans-serif', allFontOptions,
    (v) => _emitProp({ fontFamily: v }));

  const uploadFontBtn = document.createElement('button');
  uploadFontBtn.className = 'btn btn-sm';
  uploadFontBtn.textContent = '+';
  uploadFontBtn.title = 'Upload font';
  uploadFontBtn.style.flexShrink = '0';
  uploadFontBtn.addEventListener('click', () => _triggerFontUpload());
  fontRow.appendChild(uploadFontBtn);

  _addCollapsibleGroup('Typography', [
    fontRow,
    _row([
      _numberInput('Size', p.fontSize || 24, 8, 200, 1, (v) => _emitProp({ fontSize: v })),
      _selectInput('Weight', p.fontWeight || '400', [
        { value: '300', label: 'Light' },
        { value: '400', label: 'Regular' },
        { value: '500', label: 'Medium' },
        { value: '600', label: 'Semi-Bold' },
        { value: '700', label: 'Bold' },
        { value: '900', label: 'Black' },
      ], (v) => _emitProp({ fontWeight: v })),
    ]),
    _row([
      _colorInputWithSwatch('Color', p.color || '#FFFFFF', (v) => _emitProp({ color: v })),
      _colorInputWithSwatch('BG', p.backgroundColor || 'transparent', (v) => _emitProp({ backgroundColor: v })),
    ]),
    _alignButtonGroup(p.textAlign || 'left', p.verticalAlign || 'top',
      (v) => _emitProp({ textAlign: v }),
      (v) => _emitProp({ verticalAlign: v }),
    ),
    _selectInput('Transform', p.textTransform || '', [
      { value: '', label: 'None' },
      { value: 'uppercase', label: 'Uppercase' },
      { value: 'lowercase', label: 'Lowercase' },
      { value: 'capitalize', label: 'Capitalize' },
    ], (v) => _emitProp({ textTransform: v })),
    _checkboxInput('Fit Text', !!p.fitText, (v) => _emitProp({ fitText: v })),
    _selectInput('Overflow', p.overflow || 'hidden', [
      { value: 'hidden', label: 'Clip' },
      { value: 'visible', label: 'Visible' },
    ], (v) => _emitProp({ overflow: v })),
  ]);

  _addCollapsibleGroup('Text Content', [
    _textareaInput('Text', p.text || '', (v) => _emitProp({ text: v })),
  ]);

  // Parse existing textShadow: "Xpx Ypx Bpx color"
  const shadowParts = _parseTextShadow(p.textShadow || '');
  const strokeParts = _parseTextStroke(p.textStroke || '');

  _addCollapsibleGroup('Effects', [
    _row([
      _numberInput('Sh X', shadowParts.x, -20, 20, 1, (v) => {
        shadowParts.x = v;
        _emitProp({ textShadow: _buildTextShadow(shadowParts) });
      }),
      _numberInput('Sh Y', shadowParts.y, -20, 20, 1, (v) => {
        shadowParts.y = v;
        _emitProp({ textShadow: _buildTextShadow(shadowParts) });
      }),
    ]),
    _row([
      _numberInput('Blur', shadowParts.blur, 0, 30, 1, (v) => {
        shadowParts.blur = v;
        _emitProp({ textShadow: _buildTextShadow(shadowParts) });
      }),
      _colorInputWithSwatch('Color', shadowParts.color, (v) => {
        shadowParts.color = v;
        _emitProp({ textShadow: _buildTextShadow(shadowParts) });
      }),
    ]),
    _row([
      _numberInput('Stroke', strokeParts.width, 0, 10, 0.5, (v) => {
        strokeParts.width = v;
        _emitProp({ textStroke: _buildTextStroke(strokeParts) });
      }),
      _colorInputWithSwatch('Color', strokeParts.color, (v) => {
        strokeParts.color = v;
        _emitProp({ textStroke: _buildTextStroke(strokeParts) });
      }),
    ]),
  ], true); // collapsed by default
}

function _addImageProps(p) {
  const srcRow = _textInput('Source URL', p.src || '', (v) => _emitProp({ src: v }));

  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn btn-sm';
  uploadBtn.textContent = 'Upload';
  uploadBtn.style.flexShrink = '0';
  uploadBtn.addEventListener('click', () => _triggerImageUpload());
  srcRow.appendChild(uploadBtn);

  const browseImgBtn = document.createElement('button');
  browseImgBtn.className = 'btn btn-sm';
  browseImgBtn.textContent = 'Browse';
  browseImgBtn.style.flexShrink = '0';
  browseImgBtn.addEventListener('click', () => _browseLibraryAsset((url) => {
    _emitProp({ src: url });
    if (currentElement) {
      currentElement.props = { ...(currentElement.props || {}), src: url };
      updatePropertiesPanel(currentElement);
    }
  }));
  srcRow.appendChild(browseImgBtn);

  _addCollapsibleGroup('Image', [
    srcRow,
    _textInput('Alt Text', p.alt || '', (v) => _emitProp({ alt: v })),
    _selectInput('Fit', p.fit || 'contain', [
      { value: 'contain', label: 'Contain' },
      { value: 'cover', label: 'Cover' },
      { value: 'fill', label: 'Fill' },
      { value: 'none', label: 'None' },
    ], (v) => _emitProp({ fit: v })),
  ]);
}

async function _triggerImageUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.style.display = 'none';

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('files', file);

    try {
      const { getToken } = await import('/js/modules/auth.js');
      const token = getToken();

      const res = await fetch('/api/library/assets/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();

      const url = data.assets && data.assets[0] ? data.assets[0].url : '';
      _emitProp({ src: url });

      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), src: url };
        updatePropertiesPanel(currentElement);
      }
    } catch (err) {
      console.error('Image upload error:', err);
      const { showToast } = await import('/js/modules/ui.js');
      showToast('Image upload failed', 'error');
    } finally {
      input.remove();
    }
  });

  document.body.appendChild(input);
  input.click();
}

async function _triggerFontUpload() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.ttf,.otf,.woff,.woff2';
  input.style.display = 'none';

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('files', file);

    try {
      const { getToken } = await import('/js/modules/auth.js');
      const token = getToken();

      const res = await fetch('/api/library/assets/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();

      const asset = data.assets && data.assets[0];
      if (!asset) throw new Error('No asset returned');

      // Register the font and get its CSS-ready family name
      const { family, cssFamily } = registerUploadedFont(asset.id, asset.original_name);

      // Apply the new font to the current element (use cssFamily for proper quoting + fallback)
      _emitProp({ fontFamily: cssFamily });

      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), fontFamily: cssFamily };
        updatePropertiesPanel(currentElement);
      }

      const { showToast } = await import('/js/modules/ui.js');
      showToast(`Font "${family}" uploaded`, 'success');
    } catch (err) {
      console.error('Font upload error:', err);
      const { showToast } = await import('/js/modules/ui.js');
      showToast('Font upload failed', 'error');
    } finally {
      input.remove();
    }
  });

  document.body.appendChild(input);
  input.click();
}

// ---------------------------------------------------------------------------
// Library asset picker modal
// ---------------------------------------------------------------------------

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']);

async function _browseLibraryAsset(onSelect) {
  let assets = [];
  try {
    const res = await fetch('/api/library/assets');
    if (!res.ok) throw new Error('Failed to fetch');
    const data = await res.json();
    assets = data.assets || [];
  } catch (err) {
    console.error('[properties] Failed to load library assets:', err);
    const { showToast } = await import('/js/modules/ui.js');
    showToast('Failed to load library', 'error');
    return;
  }

  // Build modal overlay
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', zIndex: '9999',
    background: 'rgba(0,0,0,0.6)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  });

  const modal = document.createElement('div');
  Object.assign(modal.style, {
    background: '#1e1e2e', borderRadius: '8px', width: '640px',
    maxWidth: '90vw', maxHeight: '80vh', display: 'flex',
    flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
  });

  // Header
  const header = document.createElement('div');
  Object.assign(header.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)',
  });
  const title = document.createElement('span');
  title.textContent = 'Select from Library';
  title.style.fontWeight = '600'; title.style.color = '#fff'; title.style.fontSize = '14px';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '\u00d7';
  Object.assign(closeBtn.style, {
    background: 'none', border: 'none', color: '#aaa', fontSize: '20px',
    cursor: 'pointer', padding: '0 4px', lineHeight: '1',
  });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(title);
  header.appendChild(closeBtn);

  // Search bar
  const searchWrap = document.createElement('div');
  searchWrap.style.padding = '8px 16px';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search assets\u2026';
  Object.assign(searchInput.style, {
    width: '100%', padding: '6px 10px', background: '#2a2a3e',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: '4px',
    color: '#fff', fontSize: '13px', outline: 'none', boxSizing: 'border-box',
  });
  searchWrap.appendChild(searchInput);

  // Grid container
  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
    gap: '8px', padding: '8px 16px 16px', overflowY: 'auto', flex: '1',
  });

  function renderGrid(filter = '') {
    grid.innerHTML = '';
    const lc = filter.toLowerCase();
    const filtered = lc
      ? assets.filter(a => (a.original_name || '').toLowerCase().includes(lc))
      : assets;

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = filter ? 'No matching assets' : 'Library is empty';
      Object.assign(empty.style, { color: '#888', gridColumn: '1 / -1', textAlign: 'center', padding: '24px', fontSize: '13px' });
      grid.appendChild(empty);
      return;
    }

    for (const asset of filtered) {
      const card = document.createElement('div');
      Object.assign(card.style, {
        background: '#2a2a3e', borderRadius: '6px', cursor: 'pointer',
        overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', flexDirection: 'column', transition: 'border-color 0.15s',
      });
      card.addEventListener('mouseenter', () => { card.style.borderColor = 'rgba(88,101,242,0.6)'; });
      card.addEventListener('mouseleave', () => { card.style.borderColor = 'rgba(255,255,255,0.08)'; });

      // Thumbnail area
      const thumb = document.createElement('div');
      Object.assign(thumb.style, {
        width: '100%', height: '80px', display: 'flex',
        alignItems: 'center', justifyContent: 'center', background: '#1a1a2a',
      });

      const ext = (asset.original_name || '').split('.').pop().toLowerCase();
      if (IMAGE_EXTS.has(ext)) {
        const img = document.createElement('img');
        img.src = `/api/library/assets/${asset.id}/file`;
        Object.assign(img.style, { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' });
        img.draggable = false;
        thumb.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.textContent = ext.toUpperCase();
        Object.assign(icon.style, {
          color: '#888', fontSize: '12px', fontWeight: '600',
          background: 'rgba(255,255,255,0.06)', padding: '4px 8px', borderRadius: '3px',
        });
        thumb.appendChild(icon);
      }

      // Label
      const label = document.createElement('div');
      label.textContent = asset.original_name || asset.filename;
      Object.assign(label.style, {
        padding: '4px 6px', fontSize: '11px', color: '#ccc',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      });

      card.appendChild(thumb);
      card.appendChild(label);

      card.addEventListener('click', () => {
        const fn = encodeURIComponent(asset.original_name || asset.filename);
        const url = `/api/library/assets/${asset.id}/file?fn=${fn}`;
        onSelect(url);
        overlay.remove();
      });

      grid.appendChild(card);
    }
  }

  searchInput.addEventListener('input', () => renderGrid(searchInput.value));

  modal.appendChild(header);
  modal.appendChild(searchWrap);
  modal.appendChild(grid);
  overlay.appendChild(modal);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close on Escape
  const onKey = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  document.body.appendChild(overlay);
  renderGrid();
  searchInput.focus();
}

function _addShapeProps(p) {
  _addCollapsibleGroup('Shape', [
    _selectInput('Type', p.shapeType || 'rectangle', [
      { value: 'rectangle', label: 'Rectangle' },
      { value: 'ellipse', label: 'Ellipse' },
      { value: 'line', label: 'Line' },
    ], (v) => _emitProp({ shapeType: v })),
    _row([
      _colorInputWithSwatch('Fill', p.fill || 'rgba(59,130,246,0.5)', (v) => _emitProp({ fill: v })),
      _colorInputWithSwatch('Stroke', p.strokeColor || '', (v) => _emitProp({ strokeColor: v })),
    ]),
    _row([
      _numberInput('Stroke W', p.strokeWidth || 0, 0, 20, 1, (v) => _emitProp({ strokeWidth: v })),
      _numberInput('Radius', p.borderRadius || 0, 0, 100, 1, (v) => _emitProp({ borderRadius: v })),
    ]),
  ]);
}

function _addArcGaugeProps(p) {
  _addCollapsibleGroup('Arc Gauge', [
    _row([
      _numberInput('Start °', p.startAngle ?? -135, -360, 360, 1, (v) => _emitProp({ startAngle: v })),
      _numberInput('End °', p.endAngle ?? 135, -360, 360, 1, (v) => _emitProp({ endAngle: v })),
    ]),
    _row([
      _numberInput('Thick', p.thickness ?? 12, 2, 60, 1, (v) => _emitProp({ thickness: v })),
    ]),
    _row([
      _numberInput('Min', p.min ?? 0, -10000, 100000, 1, (v) => _emitProp({ min: v })),
      _numberInput('Max', p.max ?? 100, -10000, 100000, 1, (v) => _emitProp({ max: v })),
    ]),
    _row([
      _colorInputWithSwatch('Fill', p.fillColor || '#00e676', (v) => _emitProp({ fillColor: v })),
      _colorInputWithSwatch('BG', p.bgColor || '#333333', (v) => _emitProp({ bgColor: v })),
    ]),
    _rangeInput('Preview', p._previewValue ?? 50, p.min ?? 0, p.max ?? 100, 1, '', (v) => _emitProp({ _previewValue: v })),
  ]);

  _addBindingControls(p);
}

function _addBarGaugeProps(p) {
  _addCollapsibleGroup('Bar Gauge', [
    _selectInput('Direction', p.orientation || 'horizontal', [
      { value: 'horizontal', label: 'Horizontal' },
      { value: 'vertical', label: 'Vertical' },
    ], (v) => _emitProp({ orientation: v })),
    _row([
      _numberInput('Min', p.min ?? 0, -10000, 100000, 1, (v) => _emitProp({ min: v })),
      _numberInput('Max', p.max ?? 100, -10000, 100000, 1, (v) => _emitProp({ max: v })),
    ]),
    _row([
      _colorInputWithSwatch('Fill', p.fillColor || '#00e676', (v) => _emitProp({ fillColor: v })),
      _colorInputWithSwatch('BG', p.bgColor || '#333333', (v) => _emitProp({ bgColor: v })),
    ]),
    _numberInput('Radius', p.borderRadius ?? 0, 0, 100, 1, (v) => _emitProp({ borderRadius: v })),
    _rangeInput('Preview', p._previewValue ?? 50, p.min ?? 0, p.max ?? 100, 1, '', (v) => _emitProp({ _previewValue: v })),
  ]);

  _addBindingControls(p);
}

function _addRingSegmentProps(p) {
  _addCollapsibleGroup('Ring Segment', [
    _row([
      _numberInput('Start °', p.startAngle ?? -135, -360, 360, 1, (v) => _emitProp({ startAngle: v })),
      _numberInput('End °', p.endAngle ?? 135, -360, 360, 1, (v) => _emitProp({ endAngle: v })),
    ]),
    _row([
      _numberInput('Segments', p.segments ?? 10, 2, 60, 1, (v) => _emitProp({ segments: v })),
      _numberInput('Gap', p.segmentGap ?? 3, 0, 20, 1, (v) => _emitProp({ segmentGap: v })),
    ]),
    _numberInput('Thick', p.thickness ?? 12, 2, 60, 1, (v) => _emitProp({ thickness: v })),
    _row([
      _numberInput('Min', p.min ?? 0, -10000, 100000, 1, (v) => _emitProp({ min: v })),
      _numberInput('Max', p.max ?? 100, -10000, 100000, 1, (v) => _emitProp({ max: v })),
    ]),
    _colorInputWithSwatch('BG', p.bgColor || '#333333', (v) => _emitProp({ bgColor: v })),
    _addColorStopsEditor(p),
    _rangeInput('Preview', p._previewValue ?? 50, p.min ?? 0, p.max ?? 100, 1, '', (v) => _emitProp({ _previewValue: v })),
  ]);

  _addBindingControls(p);
}

/**
 * Color stops editor for ring segment gauge.
 */
function _addColorStopsEditor(p) {
  const stops = p.colorStops || [{ value: 0, color: '#00e676' }, { value: 100, color: '#ff5252' }];
  const container = document.createElement('div');
  container.style.cssText = 'display:flex; flex-direction:column; gap:4px;';

  const label = document.createElement('label');
  label.textContent = 'Color Stops';
  label.style.cssText = 'font-size:0.75rem; color:var(--text-muted);';
  container.appendChild(label);

  function rebuildStops() {
    // Remove all stop rows
    container.querySelectorAll('.color-stop-row').forEach(r => r.remove());

    const currentStops = [...(currentElement?.props?.colorStops || stops)];

    for (let i = 0; i < currentStops.length; i++) {
      const row = document.createElement('div');
      row.className = 'color-stop-row';
      row.style.cssText = 'display:flex; align-items:center; gap:4px;';

      const valInput = document.createElement('input');
      valInput.type = 'number';
      valInput.className = 'input';
      valInput.style.width = '50px';
      valInput.value = String(currentStops[i].value);
      valInput.addEventListener('input', () => {
        currentStops[i] = { ...currentStops[i], value: parseFloat(valInput.value) || 0 };
        _emitProp({ colorStops: [...currentStops] });
      });
      row.appendChild(valInput);

      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.value = currentStops[i].color;
      colorInput.style.cssText = 'width:28px; height:22px; border:none; cursor:pointer;';
      colorInput.addEventListener('input', () => {
        currentStops[i] = { ...currentStops[i], color: colorInput.value };
        _emitProp({ colorStops: [...currentStops] });
      });
      row.appendChild(colorInput);

      if (currentStops.length > 2) {
        const delBtn = document.createElement('button');
        delBtn.className = 'btn btn-sm';
        delBtn.textContent = '×';
        delBtn.style.cssText = 'padding:0 4px; min-width:20px;';
        delBtn.addEventListener('click', () => {
          currentStops.splice(i, 1);
          _emitProp({ colorStops: [...currentStops] });
          if (currentElement) currentElement.props.colorStops = [...currentStops];
          rebuildStops();
        });
        row.appendChild(delBtn);
      }

      container.appendChild(row);
    }

    // Add stop button
    let addBtn = container.querySelector('.add-stop-btn');
    if (addBtn) addBtn.remove();
    addBtn = document.createElement('button');
    addBtn.className = 'btn btn-sm add-stop-btn';
    addBtn.textContent = '+ Add Stop';
    addBtn.addEventListener('click', () => {
      const max = p.max ?? 100;
      currentStops.push({ value: max, color: '#ffffff' });
      _emitProp({ colorStops: [...currentStops] });
      if (currentElement) currentElement.props.colorStops = [...currentStops];
      rebuildStops();
    });
    container.appendChild(addBtn);
  }

  rebuildStops();
  return container;
}

/**
 * Shared binding controls for gauge elements (source, field, car selector).
 */
function _addBindingControls(p) {
  // Parse car selector
  const rawSelector = p.carSelector || '';
  let selectorBase = rawSelector;
  let selectorSecondary = '';
  const colonIdx = rawSelector.indexOf(':');
  if (colonIdx !== -1) {
    selectorBase = rawSelector.substring(0, colonIdx);
    selectorSecondary = rawSelector.substring(colonIdx + 1);
  }

  const sourceSelect = _selectInput('Source', p.bindingSource || '', [
    { value: '', label: '-- Select --' },
    ...BINDING_SOURCES.map(s => ({ value: s.source, label: s.label })),
  ], (v) => {
    _emitProp({ bindingSource: v, bindingField: '' });
    if (currentElement) {
      currentElement.props = { ...(currentElement.props || {}), bindingSource: v, bindingField: '' };
      updatePropertiesPanel(currentElement);
    }
  });

  const fields = p.bindingSource ? getFieldsForSource(p.bindingSource) : [];
  const fieldSelect = _selectInput('Field', p.bindingField || '', [
    { value: '', label: '-- Select --' },
    ...fields.map(f => ({ value: f.field, label: f.label })),
  ], (v) => {
    _emitProp({ bindingField: v });
    if (currentElement) {
      currentElement.props = { ...(currentElement.props || {}), bindingField: v };
    }
  });

  const selectorChildren = [];
  const selectorSelect = _selectInput('Car', selectorBase, [
    { value: '', label: '-- None --' },
    ...CAR_SELECTORS.map(s => ({ value: s.value, label: s.label })),
  ], (v) => {
    if (v === 'byRank' || v === 'byCar') {
      const defaultSec = v === 'byRank' ? '1' : '';
      const fullValue = defaultSec ? `${v}:${defaultSec}` : v;
      _emitProp({ carSelector: fullValue });
      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), carSelector: fullValue };
        updatePropertiesPanel(currentElement);
      }
    } else {
      _emitProp({ carSelector: v });
      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), carSelector: v };
        updatePropertiesPanel(currentElement);
      }
    }
  });
  selectorChildren.push(selectorSelect);

  if (selectorBase === 'byRank') {
    selectorChildren.push(_numberInput('Rank', parseInt(selectorSecondary, 10) || 1, 1, 40, 1, (v) => {
      const fullValue = `byRank:${v}`;
      _emitProp({ carSelector: fullValue });
      if (currentElement) currentElement.props = { ...(currentElement.props || {}), carSelector: fullValue };
    }));
  } else if (selectorBase === 'byCar') {
    selectorChildren.push(_textInput('Car #', selectorSecondary, (v) => {
      const fullValue = v ? `byCar:${v}` : 'byCar';
      _emitProp({ carSelector: fullValue });
      if (currentElement) currentElement.props = { ...(currentElement.props || {}), carSelector: fullValue };
    }));
  }

  const smoothingControl = _rangeInput('Smoothing', p.smoothing ?? 0, 0, 0.95, 0.05, '', (v) => {
    _emitProp({ smoothing: v });
  });

  _addCollapsibleGroup('Data Binding', [
    sourceSelect,
    fieldSelect,
    ...selectorChildren,
    smoothingControl,
  ]);
}

function _addScene3dProps(p) {
  const subType = p.subType || 'text3d';

  // Sub-type selector
  _addCollapsibleGroup('3D Scene', [
    _selectInput('Type', subType, SCENE3D_SUBTYPES.map(t => ({ value: t.value, label: t.label })), (v) => {
      _emitProp({ subType: v });
      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), subType: v };
        updatePropertiesPanel(currentElement);
      }
    }),
  ]);

  // Camera controls
  const camPos = p.cameraPosition || { x: 0, y: 0, z: 3 };
  _addCollapsibleGroup('Camera', [
    _numberInput('FOV', p.cameraFov ?? 50, 10, 120, 1, (v) => _emitProp({ cameraFov: v })),
    _row([
      _numberInput('Cam X', camPos.x, -50, 50, 0.1, (v) => _emitProp({ cameraPosition: { ...camPos, x: v } })),
      _numberInput('Cam Y', camPos.y, -50, 50, 0.1, (v) => _emitProp({ cameraPosition: { ...camPos, y: v } })),
      _numberInput('Cam Z', camPos.z, -50, 50, 0.1, (v) => _emitProp({ cameraPosition: { ...camPos, z: v } })),
    ]),
  ], true);

  // Lighting controls
  _addCollapsibleGroup('Lighting', [
    _row([
      _colorInputWithSwatch('Ambient', p.ambientColor || '#ffffff', (v) => _emitProp({ ambientColor: v })),
      _numberInput('Intensity', p.ambientIntensity ?? 0.6, 0, 3, 0.1, (v) => _emitProp({ ambientIntensity: v })),
    ]),
    _row([
      _colorInputWithSwatch('Direct', p.directionalColor || '#ffffff', (v) => _emitProp({ directionalColor: v })),
      _numberInput('Intensity', p.directionalIntensity ?? 1.0, 0, 5, 0.1, (v) => _emitProp({ directionalIntensity: v })),
    ]),
  ], true);

  // Rotation controls
  _addCollapsibleGroup('Rotation', [
    _selectInput('Auto Rotate', p.autoRotate !== false ? 'true' : 'false', [
      { value: 'true', label: 'On' },
      { value: 'false', label: 'Off' },
    ], (v) => _emitProp({ autoRotate: v === 'true' })),
    _numberInput('Speed', p.rotateSpeed ?? 0.01, 0, 0.1, 0.001, (v) => _emitProp({ rotateSpeed: v })),
  ], true);

  // Drop shadow controls
  _addCollapsibleGroup('Shadow', [
    _selectInput('Drop Shadow', p.dropShadow !== false ? 'true' : 'false', [
      { value: 'true', label: 'On' },
      { value: 'false', label: 'Off' },
    ], (v) => _emitProp({ dropShadow: v === 'true' })),
    _row([
      _numberInput('Opacity', p.shadowOpacity ?? 0.35, 0, 1, 0.05, (v) => _emitProp({ shadowOpacity: v })),
      _numberInput('Blur', p.shadowBlur ?? 4, 0, 50, 1, (v) => _emitProp({ shadowBlur: v })),
    ]),
    _row([
      _colorInputWithSwatch('Color', p.shadowColor || '#000000', (v) => _emitProp({ shadowColor: v })),
      _numberInput('Floor Y', p.shadowY ?? -1.2, -5, 0, 0.1, (v) => _emitProp({ shadowY: v })),
    ]),
  ], true);

  // Sub-type specific controls
  switch (subType) {
    case 'modelViewer': {
      const modelUrlRow = _textInput('Model URL', p.modelUrl || '', (v) => _emitProp({ modelUrl: v }));
      const browseModelBtn = document.createElement('button');
      browseModelBtn.className = 'btn btn-sm';
      browseModelBtn.textContent = 'Browse';
      browseModelBtn.style.flexShrink = '0';
      browseModelBtn.addEventListener('click', () => _browseLibraryAsset((url) => {
        _emitProp({ modelUrl: url });
        if (currentElement) {
          currentElement.props = { ...(currentElement.props || {}), modelUrl: url };
          updatePropertiesPanel(currentElement);
        }
      }));
      modelUrlRow.appendChild(browseModelBtn);

      _addCollapsibleGroup('Model', [
        modelUrlRow,
        _colorInputWithSwatch('Color', p.modelColor || '#5865f2', (v) => _emitProp({ modelColor: v })),
        _row([
          _numberInput('Metal', p.metalness ?? 0.3, 0, 1, 0.05, (v) => _emitProp({ metalness: v })),
          _numberInput('Rough', p.roughness ?? 0.6, 0, 1, 0.05, (v) => _emitProp({ roughness: v })),
        ]),
        _numberInput('Depth', p.modelDepth ?? 0.2, 0.01, 2, 0.01, (v) => _emitProp({ modelDepth: v })),
      ]);
      break;
    }

    case 'text3d':
      _addCollapsibleGroup('3D Text', [
        _textInput('Text', p.text3d || '3D', (v) => _emitProp({ text3d: v })),
        _row([
          _colorInputWithSwatch('Front', p.text3dColor || '#ffffff', (v) => _emitProp({ text3dColor: v })),
          _colorInputWithSwatch('Side', p.text3dSideColor || '#5865f2', (v) => _emitProp({ text3dSideColor: v })),
        ]),
        _row([
          _numberInput('Depth', p.text3dDepth ?? 0.3, 0.05, 2, 0.05, (v) => _emitProp({ text3dDepth: v })),
          _numberInput('Size', p.text3dFontSize ?? 120, 20, 300, 1, (v) => _emitProp({ text3dFontSize: v })),
        ]),
      ]);
      break;

    case 'particles':
      _addCollapsibleGroup('Particles', [
        _row([
          _numberInput('Count', p.particleCount ?? 200, 10, 2000, 10, (v) => _emitProp({ particleCount: v })),
          _numberInput('Spread', p.particleSpread ?? 3, 0.5, 20, 0.5, (v) => _emitProp({ particleSpread: v })),
        ]),
        _row([
          _numberInput('Size', p.particleSize ?? 0.05, 0.01, 0.5, 0.01, (v) => _emitProp({ particleSize: v })),
          _numberInput('Opacity', p.particleOpacity ?? 0.8, 0, 1, 0.05, (v) => _emitProp({ particleOpacity: v })),
        ]),
        _colorInputWithSwatch('Color', p.particleColor || '#5865f2', (v) => _emitProp({ particleColor: v })),
      ]);
      break;
  }

  _addBindingControls(p);
}

function _addDataProps(p) {
  _addTextProps(p);

  // Parse car selector: 'byRank:3' -> base='byRank', secondary='3'
  const rawSelector = p.carSelector || '';
  let selectorBase = rawSelector;
  let selectorSecondary = '';
  const colonIdx = rawSelector.indexOf(':');
  if (colonIdx !== -1) {
    selectorBase = rawSelector.substring(0, colonIdx);
    selectorSecondary = rawSelector.substring(colonIdx + 1);
  }

  // Source dropdown
  const sourceSelect = _selectInput('Source', p.bindingSource || '', [
    { value: '', label: '-- Select --' },
    ...BINDING_SOURCES.map(s => ({ value: s.source, label: s.label })),
  ], (v) => {
    _emitProp({ bindingSource: v, bindingField: '' });
    // Re-render to refresh field options
    if (currentElement) {
      currentElement.props = { ...(currentElement.props || {}), bindingSource: v, bindingField: '' };
      updatePropertiesPanel(currentElement);
    }
  });

  // Field dropdown (filtered by source)
  const fields = p.bindingSource ? getFieldsForSource(p.bindingSource) : [];
  const fieldSelect = _selectInput('Field', p.bindingField || '', [
    { value: '', label: '-- Select --' },
    ...fields.map(f => ({ value: f.field, label: f.label })),
  ], (v) => {
    _emitProp({ bindingField: v });
    if (currentElement) {
      currentElement.props = { ...(currentElement.props || {}), bindingField: v };
      // Update preview value on canvas
      const preview = resolveBindingPreview({
        bindingSource: currentElement.props.bindingSource,
        bindingField: v,
        format: currentElement.props.format,
      });
      _emitProp({ _previewValue: preview });
    }
  });

  // Car selector dropdown + secondary input
  const selectorChildren = [];

  const selectorSelect = _selectInput('Car', selectorBase, [
    { value: '', label: '-- None --' },
    ...CAR_SELECTORS.map(s => ({ value: s.value, label: s.label })),
  ], (v) => {
    if (v === 'byRank' || v === 'byCar') {
      // Set with default secondary value
      const defaultSec = v === 'byRank' ? '1' : '';
      const fullValue = defaultSec ? `${v}:${defaultSec}` : v;
      _emitProp({ carSelector: fullValue });
      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), carSelector: fullValue };
        updatePropertiesPanel(currentElement);
      }
    } else {
      _emitProp({ carSelector: v });
      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), carSelector: v };
        updatePropertiesPanel(currentElement);
      }
    }
  });
  selectorChildren.push(selectorSelect);

  // Secondary input for byRank/byCar
  if (selectorBase === 'byRank') {
    selectorChildren.push(_numberInput('Rank', parseInt(selectorSecondary, 10) || 1, 1, 40, 1, (v) => {
      const fullValue = `byRank:${v}`;
      _emitProp({ carSelector: fullValue });
      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), carSelector: fullValue };
      }
    }));
  } else if (selectorBase === 'byCar') {
    selectorChildren.push(_textInput('Car #', selectorSecondary, (v) => {
      const fullValue = v ? `byCar:${v}` : 'byCar';
      _emitProp({ carSelector: fullValue });
      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), carSelector: fullValue };
      }
    }));
  }

  // Format dropdown
  const formatSelect = _selectInput('Format', p.format || 'raw',
    FORMATTERS.map(f => ({ value: f.value, label: f.label })),
    (v) => {
      _emitProp({ format: v });
      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), format: v };
        const preview = resolveBindingPreview({
          bindingSource: currentElement.props.bindingSource,
          bindingField: currentElement.props.bindingField,
          format: v,
        });
        _emitProp({ _previewValue: preview });
      }
    }
  );

  _addCollapsibleGroup('Data Binding', [
    sourceSelect,
    fieldSelect,
    ...selectorChildren,
    formatSelect,
    _textInput('Prefix', p.prefix || '', (v) => _emitProp({ prefix: v })),
    _textInput('Suffix', p.suffix || '', (v) => _emitProp({ suffix: v })),
    _textInput('Fallback', p.fallback || '---', (v) => _emitProp({ fallback: v })),
  ]);
}

/* ---- Universal Bindings Section ---- */

function _addBindingsSection(element) {
  const bindings = element.bindings || [];
  const children = [];

  if (bindings.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:0.75rem; color:var(--text-dim,#8b8fa3); padding:2px 0;';
    empty.textContent = 'No visual bindings';
    children.push(empty);
  }

  // Render each binding card
  for (let i = 0; i < bindings.length; i++) {
    children.push(_bindingCard(element, bindings[i], i));
  }

  // Add binding button
  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-sm';
  addBtn.style.cssText = 'width:100%; margin-top:4px;';
  addBtn.textContent = '+ Add Binding';
  addBtn.addEventListener('click', () => {
    const newBinding = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
      target: 'opacity',
      source: '',
      field: '',
      car: '',
      mode: 'range',
      range: { inputMin: 0, inputMax: 100, outputMin: 0, outputMax: 1, clamp: true },
      colorRange: { stops: [{ value: 0, color: '#00ff00' }, { value: 100, color: '#ff0000' }] },
      expression: '',
      advanced: false,
      smoothing: 0,
    };
    const updated = [...bindings, newBinding];
    _emit({ bindings: updated });
    if (currentElement) {
      currentElement.bindings = updated;
      updatePropertiesPanel(currentElement);
    }
  });
  children.push(addBtn);

  _addCollapsibleGroup('Bindings', children, true);
}

function _bindingCard(element, binding, index) {
  const card = document.createElement('div');
  card.style.cssText = 'border:1px solid var(--border,#2a2d35); border-radius:6px; padding:6px; margin-bottom:4px; background:var(--bg-elevated,#1e2028);';

  // Header row: target + delete
  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;';

  // Target property dropdown
  const targetOptions = Object.entries(BINDABLE_PROPERTIES).map(([key, def]) => ({
    value: key, label: def.label,
  }));
  const targetSelect = document.createElement('select');
  targetSelect.className = 'select';
  targetSelect.style.cssText = 'flex:1; font-size:0.75rem;';
  for (const opt of targetOptions) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === binding.target) option.selected = true;
    targetSelect.appendChild(option);
  }
  targetSelect.addEventListener('change', () => {
    binding.target = targetSelect.value;
    // Auto-switch mode for color properties
    const propDef = BINDABLE_PROPERTIES[targetSelect.value];
    if (propDef?.type === 'color' && binding.mode === 'range') {
      binding.mode = 'colorRange';
    } else if (propDef?.type === 'boolean') {
      binding.mode = 'visibility';
    } else if (propDef?.type === 'number' && binding.mode === 'colorRange') {
      binding.mode = 'range';
    }
    _emitBindings(element);
    updatePropertiesPanel(currentElement);
  });
  headerRow.appendChild(targetSelect);

  const delBtn = document.createElement('button');
  delBtn.className = 'btn btn-sm';
  delBtn.textContent = '×';
  delBtn.style.cssText = 'padding:0 6px; min-width:20px; margin-left:4px; color:#ff5252;';
  delBtn.addEventListener('click', () => {
    const updated = element.bindings.filter((_, j) => j !== index);
    _emit({ bindings: updated });
    if (currentElement) {
      currentElement.bindings = updated;
      updatePropertiesPanel(currentElement);
    }
  });
  headerRow.appendChild(delBtn);
  card.appendChild(headerRow);

  // Source + Field + Car
  const sourceOptions = [
    { value: '', label: '-- Select --' },
    ...BINDING_SOURCES.map(s => ({ value: s.source, label: s.label })),
  ];
  card.appendChild(_miniSelect('Source', binding.source || '', sourceOptions, (v) => {
    binding.source = v;
    binding.field = '';
    _emitBindings(element);
    updatePropertiesPanel(currentElement);
  }));

  if (binding.source) {
    const fields = getFieldsForSource(binding.source);
    card.appendChild(_miniSelect('Field', binding.field || '', [
      { value: '', label: '-- Select --' },
      ...fields.map(f => ({ value: f.field, label: f.label })),
    ], (v) => {
      binding.field = v;
      _emitBindings(element);
    }));
  }

  // Car selector (simplified)
  const rawCar = binding.car || '';
  let carBase = rawCar;
  let carSecondary = '';
  const colonIdx = rawCar.indexOf(':');
  if (colonIdx !== -1) {
    carBase = rawCar.substring(0, colonIdx);
    carSecondary = rawCar.substring(colonIdx + 1);
  }

  card.appendChild(_miniSelect('Car', carBase, [
    { value: '', label: '-- None --' },
    ...CAR_SELECTORS.map(s => ({ value: s.value, label: s.label })),
  ], (v) => {
    if (v === 'byRank' || v === 'byCar') {
      binding.car = v === 'byRank' ? `${v}:1` : v;
    } else {
      binding.car = v;
    }
    _emitBindings(element);
    updatePropertiesPanel(currentElement);
  }));

  if (carBase === 'byRank') {
    const rankRow = document.createElement('div');
    rankRow.className = 'prop-row';
    rankRow.style.cssText = 'padding:0; margin:2px 0;';
    const rankInput = document.createElement('input');
    rankInput.type = 'number';
    rankInput.className = 'input';
    rankInput.style.cssText = 'width:50px; font-size:0.75rem;';
    rankInput.value = carSecondary || '1';
    rankInput.min = '1';
    rankInput.max = '40';
    rankInput.addEventListener('input', () => {
      binding.car = `byRank:${rankInput.value}`;
      _emitBindings(element);
    });
    const rankLbl = document.createElement('label');
    rankLbl.textContent = 'Rank';
    rankLbl.style.fontSize = '0.7rem';
    rankRow.appendChild(rankLbl);
    rankRow.appendChild(rankInput);
    card.appendChild(rankRow);
  } else if (carBase === 'byCar') {
    const carRow = document.createElement('div');
    carRow.className = 'prop-row';
    carRow.style.cssText = 'padding:0; margin:2px 0;';
    const carInput = document.createElement('input');
    carInput.type = 'text';
    carInput.className = 'input';
    carInput.style.cssText = 'width:50px; font-size:0.75rem;';
    carInput.value = carSecondary || '';
    carInput.placeholder = '#';
    carInput.addEventListener('input', () => {
      binding.car = carInput.value ? `byCar:${carInput.value}` : 'byCar';
      _emitBindings(element);
    });
    const carLbl = document.createElement('label');
    carLbl.textContent = 'Car #';
    carLbl.style.fontSize = '0.7rem';
    carRow.appendChild(carLbl);
    carRow.appendChild(carInput);
    card.appendChild(carRow);
  }

  // Mode selector
  const propDef = BINDABLE_PROPERTIES[binding.target];
  const modeOptions = [];
  if (propDef?.type === 'number') {
    modeOptions.push({ value: 'range', label: 'Range Map' });
    modeOptions.push({ value: 'expression', label: 'Expression' });
  } else if (propDef?.type === 'color') {
    modeOptions.push({ value: 'colorRange', label: 'Color Range' });
    modeOptions.push({ value: 'expression', label: 'Expression' });
  } else if (propDef?.type === 'boolean') {
    modeOptions.push({ value: 'visibility', label: 'Visibility' });
    modeOptions.push({ value: 'expression', label: 'Expression' });
  }
  // Always allow expression
  if (!modeOptions.find(m => m.value === 'expression')) {
    modeOptions.push({ value: 'expression', label: 'Expression' });
  }

  card.appendChild(_miniSelect('Mode', binding.mode || 'range', modeOptions, (v) => {
    binding.mode = v;
    _emitBindings(element);
    updatePropertiesPanel(currentElement);
  }));

  // Mode-specific controls
  if (binding.mode === 'range') {
    const range = binding.range || { inputMin: 0, inputMax: 100, outputMin: 0, outputMax: 1, clamp: true };
    card.appendChild(_miniRow([
      _miniNumber('In Min', range.inputMin, (v) => { range.inputMin = v; binding.range = { ...range }; _emitBindings(element); }),
      _miniNumber('In Max', range.inputMax, (v) => { range.inputMax = v; binding.range = { ...range }; _emitBindings(element); }),
    ]));
    card.appendChild(_miniRow([
      _miniNumber('Out Min', range.outputMin, (v) => { range.outputMin = v; binding.range = { ...range }; _emitBindings(element); }),
      _miniNumber('Out Max', range.outputMax, (v) => { range.outputMax = v; binding.range = { ...range }; _emitBindings(element); }),
    ]));
  }

  if (binding.mode === 'colorRange') {
    const colorRange = binding.colorRange || { stops: [{ value: 0, color: '#00ff00' }, { value: 100, color: '#ff0000' }] };
    card.appendChild(_bindingColorStops(element, binding, colorRange.stops));
  }

  if (binding.mode === 'expression' || binding.mode === 'visibility') {
    const exprRow = document.createElement('div');
    exprRow.style.cssText = 'margin-top:4px;';

    const textarea = document.createElement('textarea');
    textarea.className = 'input';
    textarea.style.cssText = 'width:100%; min-height:36px; resize:vertical; font-size:0.72rem; font-family:monospace;';
    textarea.value = binding.expression || '';
    textarea.placeholder = binding.mode === 'visibility' ? 'speed > 100' : 'map(speed, 0, 200, 0, 1)';
    textarea.addEventListener('input', () => {
      binding.expression = textarea.value;
      _emitBindings(element);
    });
    exprRow.appendChild(textarea);

    // Advanced toggle
    const advRow = document.createElement('label');
    advRow.style.cssText = 'display:flex; align-items:center; gap:4px; font-size:0.7rem; color:var(--text-dim); margin-top:2px; cursor:pointer;';
    const advCb = document.createElement('input');
    advCb.type = 'checkbox';
    advCb.checked = !!binding.advanced;
    advCb.style.cssText = 'accent-color:var(--accent); margin:0;';
    advCb.addEventListener('change', () => {
      binding.advanced = advCb.checked;
      _emitBindings(element);
    });
    advRow.appendChild(advCb);
    advRow.appendChild(document.createTextNode('Advanced (multi-statement)'));
    exprRow.appendChild(advRow);

    card.appendChild(exprRow);
  }

  // Smoothing slider
  if (binding.mode === 'range' || binding.mode === 'colorRange') {
    const smoothRow = document.createElement('div');
    smoothRow.className = 'prop-row';
    smoothRow.style.cssText = 'padding:0; margin:4px 0 0;';

    const smoothLbl = document.createElement('label');
    smoothLbl.textContent = 'Smooth';
    smoothLbl.style.fontSize = '0.7rem';
    smoothRow.appendChild(smoothLbl);

    const smoothRange = document.createElement('input');
    smoothRange.type = 'range';
    smoothRange.min = '0';
    smoothRange.max = '0.95';
    smoothRange.step = '0.05';
    smoothRange.value = String(binding.smoothing || 0);
    smoothRange.style.flex = '1';
    smoothRange.addEventListener('input', () => {
      binding.smoothing = parseFloat(smoothRange.value);
      _emitBindings(element);
    });
    smoothRow.appendChild(smoothRange);

    card.appendChild(smoothRow);
  }

  return card;
}

function _bindingColorStops(element, binding, stops) {
  const container = document.createElement('div');
  container.style.cssText = 'margin-top:4px; display:flex; flex-direction:column; gap:2px;';

  for (let i = 0; i < stops.length; i++) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; gap:4px;';

    const valInput = document.createElement('input');
    valInput.type = 'number';
    valInput.className = 'input';
    valInput.style.cssText = 'width:45px; font-size:0.72rem;';
    valInput.value = String(stops[i].value);
    valInput.addEventListener('input', () => {
      stops[i] = { ...stops[i], value: parseFloat(valInput.value) || 0 };
      binding.colorRange = { stops: [...stops] };
      _emitBindings(element);
    });
    row.appendChild(valInput);

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = stops[i].color;
    colorInput.style.cssText = 'width:24px; height:20px; border:none; cursor:pointer;';
    colorInput.addEventListener('input', () => {
      stops[i] = { ...stops[i], color: colorInput.value };
      binding.colorRange = { stops: [...stops] };
      _emitBindings(element);
    });
    row.appendChild(colorInput);

    if (stops.length > 2) {
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-sm';
      delBtn.textContent = '×';
      delBtn.style.cssText = 'padding:0 3px; min-width:16px; font-size:0.7rem;';
      delBtn.addEventListener('click', () => {
        stops.splice(i, 1);
        binding.colorRange = { stops: [...stops] };
        _emitBindings(element);
        updatePropertiesPanel(currentElement);
      });
      row.appendChild(delBtn);
    }
    container.appendChild(row);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-sm';
  addBtn.style.cssText = 'font-size:0.7rem;';
  addBtn.textContent = '+ Stop';
  addBtn.addEventListener('click', () => {
    stops.push({ value: 100, color: '#ffffff' });
    binding.colorRange = { stops: [...stops] };
    _emitBindings(element);
    updatePropertiesPanel(currentElement);
  });
  container.appendChild(addBtn);

  return container;
}

function _miniSelect(label, value, options, onChange) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; align-items:center; gap:4px; margin:2px 0;';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.cssText = 'font-size:0.7rem; min-width:36px; color:var(--text-dim,#8b8fa3);';
  row.appendChild(lbl);

  const select = document.createElement('select');
  select.className = 'select';
  select.style.cssText = 'flex:1; font-size:0.72rem;';
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  row.appendChild(select);
  return row;
}

function _miniRow(children) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:4px; margin:2px 0;';
  for (const child of children) row.appendChild(child);
  return row;
}

function _miniNumber(label, value, onChange) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'flex:1; display:flex; flex-direction:column; gap:1px;';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.cssText = 'font-size:0.65rem; color:var(--text-dim,#8b8fa3);';
  wrapper.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'input';
  input.style.cssText = 'font-size:0.72rem; width:100%;';
  input.value = String(value ?? 0);
  input.step = 'any';
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!isNaN(v)) onChange(v);
  });
  wrapper.appendChild(input);
  return wrapper;
}

function _emitBindings(element) {
  if (currentElement && onPropertyChange) {
    onPropertyChange(currentElement.id, { bindings: [...(element.bindings || [])] });
  }
}

/* ---- Animation Section ---- */

/* ---- Clipping Mask Section ---- */

function _addClippingSection(element) {
  const allElements = getElements ? getElements() : [];

  // Only shape elements can serve as masks; exclude self and circular refs
  const candidates = allElements.filter(el =>
    el.id !== element.id &&
    el.type === 'shape' &&
    el.clipMask?.elementId !== element.id
  );

  const currentMaskId = element.clipMask?.elementId || '';
  const hideMask = element.clipMask?.hideMask || false;

  const children = [];

  const maskOptions = [
    { value: '', label: '-- None --' },
    ...candidates.map(c => ({
      value: c.id,
      label: c.name || `Shape (${c.id.substring(0, 6)})`,
    })),
  ];

  children.push(
    _selectInput('Mask Layer', currentMaskId, maskOptions, (v) => {
      if (v) {
        _emit({ clipMask: { elementId: v, hideMask: element.clipMask?.hideMask || false } });
      } else {
        _emit({ clipMask: null });
      }
      // Re-render to show/hide the hideMask checkbox
      if (currentElement) {
        currentElement.clipMask = v ? { elementId: v, hideMask: currentElement.clipMask?.hideMask || false } : null;
        updatePropertiesPanel(currentElement);
      }
    })
  );

  if (currentMaskId) {
    children.push(
      _checkboxInput('Hide Mask Layer', hideMask, (v) => {
        _emit({ clipMask: { elementId: currentMaskId, hideMask: v } });
      })
    );
  }

  _addCollapsibleGroup('Clipping', children, true);
}

function _addAnimationSection(element) {
  const anim = element.animation || {};
  const enter = anim.enter || { type: 'none', duration: 300, delay: 0, easing: 'power2.out' };
  const exit = anim.exit || { type: 'none', duration: 300, delay: 0, easing: 'power2.in' };
  const update = anim.update || { type: 'none', duration: 300, easing: 'power1.inOut' };
  const emphasis = anim.emphasis || { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 };

  // ── Enter keyframe Advanced button ──
  const enterKfEnabled = anim.enterKeyframes?.enabled || (!anim.enterKeyframes && anim.keyframes?.enabled);
  const enterAdvBtn = document.createElement('button');
  enterAdvBtn.className = 'anim-preview-btn';
  enterAdvBtn.style.cssText = 'width:100%; justify-content:center; margin-top:2px;';
  enterAdvBtn.innerHTML = enterKfEnabled
    ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3h14v2H1zM3 7h10v2H3zM5 11h6v2H5z"/></svg> Enter Keyframes (On)'
    : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 3h14M3 8h10M5 13h6"/></svg> Enter Advanced...';
  enterAdvBtn.addEventListener('click', () => {
    openAnimationDesigner(element, {
      onPropertyChange: onPropertyChange,
      onClose: () => updatePropertiesPanel(currentElement),
      panelEl: panelEl,
      mode: 'enter',
    });
  });

  // ── Exit keyframe Advanced button ──
  const exitKfEnabled = anim.exitKeyframes?.enabled;
  const exitAdvBtn = document.createElement('button');
  exitAdvBtn.className = 'anim-preview-btn';
  exitAdvBtn.style.cssText = 'width:100%; justify-content:center; margin-top:2px;';
  exitAdvBtn.innerHTML = exitKfEnabled
    ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1 3h14v2H1zM3 7h10v2H3zM5 11h6v2H5z"/></svg> Exit Keyframes (On)'
    : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 3h14M3 8h10M5 13h6"/></svg> Exit Advanced...';
  exitAdvBtn.addEventListener('click', () => {
    openAnimationDesigner(element, {
      onPropertyChange: onPropertyChange,
      onClose: () => updatePropertiesPanel(currentElement),
      panelEl: panelEl,
      mode: 'exit',
    });
  });

  const children = [
    // ── Enter ──
    _groupedSelectInput('Enter', enter.type, ENTER_ANIMATION_CATEGORIES, (v) => {
      _emitAnimation({ enter: { type: v } });
    }),
    _row([
      _rangeInput('Duration', enter.duration, 100, 2000, 50, 'ms', (v) => {
        _emitAnimation({ enter: { duration: v } });
      }),
    ]),
    _row([
      _rangeInput('Delay', enter.delay || 0, 0, 2000, 50, 'ms', (v) => {
        _emitAnimation({ enter: { delay: v } });
      }),
    ]),
    _groupedEasingSelect('Easing', enter.easing, (v) => {
      _emitAnimation({ enter: { easing: v } });
    }),
    enterAdvBtn,

    _separator(),

    // ── Exit ──
    _groupedSelectInput('Exit', exit.type, EXIT_ANIMATION_CATEGORIES, (v) => {
      _emitAnimation({ exit: { type: v } });
    }),
    _row([
      _rangeInput('Duration', exit.duration, 100, 2000, 50, 'ms', (v) => {
        _emitAnimation({ exit: { duration: v } });
      }),
    ]),
    _row([
      _rangeInput('Delay', exit.delay || 0, 0, 2000, 50, 'ms', (v) => {
        _emitAnimation({ exit: { delay: v } });
      }),
    ]),
    _groupedEasingSelect('Easing', exit.easing, (v) => {
      _emitAnimation({ exit: { easing: v } });
    }),
    exitAdvBtn,
  ];

  // ── Update transition (data elements only) ──
  if (element.type === 'data') {
    children.push(
      _separator(),
      _selectInput('Update', update.type, [
        { value: 'none', label: 'None' },
        { value: 'crossfade', label: 'Crossfade' },
      ], (v) => {
        _emitAnimation({ update: { type: v } });
      }),
      _rangeInput('Duration', update.duration, 50, 1000, 25, 'ms', (v) => {
        _emitAnimation({ update: { duration: v } });
      }),

      // ── Emphasis (data elements only) ──
      _separator(),
      _selectInput('Emphasis', emphasis.type, EMPHASIS_ANIMATIONS, (v) => {
        _emitAnimation({ emphasis: { type: v } });
      }),
    );

    // Only show emphasis options if an emphasis type is selected
    if (emphasis.type && emphasis.type !== 'none') {
      children.push(
        _rangeInput('Duration', emphasis.duration, 100, 2000, 50, 'ms', (v) => {
          _emitAnimation({ emphasis: { duration: v } });
        }),
        _selectInput('Trigger', emphasis.trigger || 'onChange', [
          { value: 'onChange', label: 'On Value Change' },
          { value: 'always', label: 'Always (loop)' },
        ], (v) => {
          _emitAnimation({ emphasis: { trigger: v } });
        }),
        _numberInput('Repeat', emphasis.repeat || 0, 0, 10, 1, (v) => {
          _emitAnimation({ emphasis: { repeat: v } });
        }),
      );
    }
  }

  // ── Preview buttons ──
  const previewRow = document.createElement('div');
  previewRow.style.cssText = 'display:flex; gap:4px; margin-top:4px;';

  const enterPreviewBtn = document.createElement('button');
  enterPreviewBtn.className = 'anim-preview-btn';
  enterPreviewBtn.title = 'Preview enter animation';
  enterPreviewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg> Enter';
  enterPreviewBtn.addEventListener('click', () => {
    if (onQuickAction) onQuickAction(element.id, 'previewAnimation');
  });
  previewRow.appendChild(enterPreviewBtn);

  const exitPreviewBtn = document.createElement('button');
  exitPreviewBtn.className = 'anim-preview-btn';
  exitPreviewBtn.title = 'Preview exit animation';
  exitPreviewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12 2L2 8l10 6z"/></svg> Exit';
  exitPreviewBtn.addEventListener('click', () => {
    if (onQuickAction) onQuickAction(element.id, 'previewExitAnimation');
  });
  previewRow.appendChild(exitPreviewBtn);

  if (element.type === 'data' && emphasis.type && emphasis.type !== 'none') {
    const emphPreviewBtn = document.createElement('button');
    emphPreviewBtn.className = 'anim-preview-btn';
    emphPreviewBtn.title = 'Preview emphasis animation';
    emphPreviewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="5"/></svg> Emphasis';
    emphPreviewBtn.addEventListener('click', () => {
      if (onQuickAction) onQuickAction(element.id, 'previewEmphasis');
    });
    previewRow.appendChild(emphPreviewBtn);
  }

  children.push(previewRow);

  _addCollapsibleGroup('Animation', children, true);
}

/* ---- DOM helpers ---- */

function _addCollapsibleGroup(title, children, defaultCollapsed = false) {
  const group = document.createElement('div');
  group.className = 'prop-group';

  // Use persisted state or default
  const isCollapsed = _sectionState[title] !== undefined
    ? _sectionState[title]
    : defaultCollapsed;

  // Header (clickable)
  const header = document.createElement('div');
  header.className = `prop-group-header${isCollapsed ? ' collapsed' : ''}`;

  const titleEl = document.createElement('div');
  titleEl.className = 'prop-group-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);

  const chevron = document.createElement('span');
  chevron.className = 'prop-group-chevron';
  chevron.textContent = '\u25BC'; // down arrow
  header.appendChild(chevron);

  group.appendChild(header);

  // Body
  const body = document.createElement('div');
  body.className = `prop-group-body${isCollapsed ? ' collapsed' : ''}`;

  for (const child of children) {
    if (child) body.appendChild(child);
  }

  group.appendChild(body);

  // Toggle on header click
  header.addEventListener('click', () => {
    const nowCollapsed = !body.classList.contains('collapsed');
    body.classList.toggle('collapsed');
    header.classList.toggle('collapsed');
    _sectionState[title] = nowCollapsed;
  });

  panelEl.appendChild(group);
}

function _row(children) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  for (const child of children) {
    if (child) row.appendChild(child);
  }
  return row;
}

function _separator() {
  const sep = document.createElement('div');
  sep.style.borderTop = '1px solid var(--border)';
  sep.style.margin = '4px 0';
  return sep;
}

function _numberInput(label, value, min, max, step, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';
  wrapper.style.flex = '1';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'input';
  input.value = typeof value === 'number' ? value.toFixed(step < 1 ? 1 : 0) : value;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    if (!isNaN(v)) onChange(v);
  });
  wrapper.appendChild(input);
  return wrapper;
}

function _textInput(label, value, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.style.flex = '1';
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  wrapper.appendChild(input);
  return wrapper;
}

function _textareaInput(label, value, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';
  wrapper.style.flexDirection = 'column';
  wrapper.style.alignItems = 'flex-start';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const textarea = document.createElement('textarea');
  textarea.className = 'input';
  textarea.style.width = '100%';
  textarea.style.minHeight = '60px';
  textarea.style.resize = 'vertical';
  textarea.value = value;
  textarea.addEventListener('input', () => onChange(textarea.value));
  wrapper.appendChild(textarea);
  return wrapper;
}

/**
 * Alignment icon button group — horizontal (left/center/right) + vertical (top/center/bottom).
 */
function _alignButtonGroup(hValue, vValue, onHChange, onVChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';
  wrapper.style.flexDirection = 'column';
  wrapper.style.gap = '4px';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex; gap:2px; align-items:center;';

  const lbl = document.createElement('label');
  lbl.textContent = 'Align';
  lbl.style.minWidth = '36px';
  row.appendChild(lbl);

  // Horizontal align buttons
  const hGroup = document.createElement('div');
  hGroup.className = 'align-btn-group';

  const hOptions = [
    { value: 'left',   title: 'Align left',   svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="10" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="1" y="12" width="8" height="2" rx="0.5"/></svg>' },
    { value: 'center', title: 'Align center', svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="10" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="4" y="12" width="8" height="2" rx="0.5"/></svg>' },
    { value: 'right',  title: 'Align right',  svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="5" y="2" width="10" height="2" rx="0.5"/><rect x="1" y="7" width="14" height="2" rx="0.5"/><rect x="7" y="12" width="8" height="2" rx="0.5"/></svg>' },
  ];

  for (const opt of hOptions) {
    const btn = document.createElement('button');
    btn.className = 'align-btn' + (opt.value === hValue ? ' active' : '');
    btn.title = opt.title;
    btn.innerHTML = opt.svg;
    btn.addEventListener('click', () => {
      hGroup.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onHChange(opt.value);
    });
    hGroup.appendChild(btn);
  }
  row.appendChild(hGroup);

  // Separator
  const sep = document.createElement('div');
  sep.style.cssText = 'width:1px; height:18px; background:var(--border); margin:0 4px;';
  row.appendChild(sep);

  // Vertical align buttons
  const vGroup = document.createElement('div');
  vGroup.className = 'align-btn-group';

  const vOptions = [
    { value: 'top',    title: 'Align top',    svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="1" width="2" height="10" rx="0.5"/><rect x="7" y="1" width="2" height="14" rx="0.5"/><rect x="12" y="1" width="2" height="8" rx="0.5"/></svg>' },
    { value: 'center', title: 'Align middle', svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="3" width="2" height="10" rx="0.5"/><rect x="7" y="1" width="2" height="14" rx="0.5"/><rect x="12" y="4" width="2" height="8" rx="0.5"/></svg>' },
    { value: 'bottom', title: 'Align bottom', svg: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="5" width="2" height="10" rx="0.5"/><rect x="7" y="1" width="2" height="14" rx="0.5"/><rect x="12" y="7" width="2" height="8" rx="0.5"/></svg>' },
  ];

  for (const opt of vOptions) {
    const btn = document.createElement('button');
    btn.className = 'align-btn' + (opt.value === vValue ? ' active' : '');
    btn.title = opt.title;
    btn.innerHTML = opt.svg;
    btn.addEventListener('click', () => {
      vGroup.querySelectorAll('.align-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onVChange(opt.value);
    });
    vGroup.appendChild(btn);
  }
  row.appendChild(vGroup);

  wrapper.appendChild(row);
  return wrapper;
}

/**
 * Custom font selector dropdown that renders each option in its own typeface.
 */
function _fontSelectInput(label, value, options, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';
  wrapper.style.flex = '1';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const container = document.createElement('div');
  container.className = 'font-select-wrapper';

  // Trigger button (shows selected font in its own typeface)
  const trigger = document.createElement('div');
  trigger.className = 'font-select-trigger';
  const selectedOpt = options.find(o => o.value === value) || options[0];
  trigger.innerHTML = `<span class="font-label">${selectedOpt ? selectedOpt.label : ''}</span><span class="chevron">\u25BC</span>`;
  if (selectedOpt) trigger.querySelector('.font-label').style.fontFamily = selectedOpt.value;
  container.appendChild(trigger);

  // Dropdown list
  const dropdown = document.createElement('div');
  dropdown.className = 'font-select-dropdown';

  for (const opt of options) {
    const item = document.createElement('div');
    item.className = 'font-select-option' + (opt.value === value ? ' selected' : '');
    item.textContent = opt.label;
    item.style.fontFamily = opt.value;
    item.dataset.value = opt.value;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      trigger.querySelector('.font-label').textContent = opt.label;
      trigger.querySelector('.font-label').style.fontFamily = opt.value;
      dropdown.querySelectorAll('.font-select-option').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      dropdown.classList.remove('open');
      onChange(opt.value);
    });
    dropdown.appendChild(item);
  }
  container.appendChild(dropdown);

  // Toggle on click
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Close on outside click
  const closeHandler = (e) => {
    if (!container.contains(e.target)) dropdown.classList.remove('open');
  };
  document.addEventListener('click', closeHandler);

  wrapper.appendChild(container);
  return wrapper;
}

function _selectInput(label, value, options, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';
  wrapper.style.flex = '1';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const select = document.createElement('select');
  select.className = 'select';
  select.style.flex = '1';
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  wrapper.appendChild(select);
  return wrapper;
}

/**
 * Grouped select input using <optgroup> for categorized animation presets.
 * categories: [{ name: string, presets: [{ value, label }] }]
 */
function _groupedSelectInput(label, value, categories, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';
  wrapper.style.flex = '1';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const select = document.createElement('select');
  select.className = 'select';
  select.style.flex = '1';

  // Always have a "None" option first
  const noneOpt = document.createElement('option');
  noneOpt.value = 'none';
  noneOpt.textContent = 'None';
  if (value === 'none' || !value) noneOpt.selected = true;
  select.appendChild(noneOpt);

  for (const cat of categories) {
    const group = document.createElement('optgroup');
    group.label = cat.name;
    for (const preset of cat.presets) {
      const opt = document.createElement('option');
      opt.value = preset.value;
      opt.textContent = preset.label;
      if (preset.value === value) opt.selected = true;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }

  select.addEventListener('change', () => onChange(select.value));
  wrapper.appendChild(select);
  return wrapper;
}

/**
 * Grouped easing select with optgroups based on the `group` field in GSAP_EASINGS.
 */
function _groupedEasingSelect(label, value, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';
  wrapper.style.flex = '1';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const select = document.createElement('select');
  select.className = 'select';
  select.style.flex = '1';

  // Group easings by their group field
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
      if (easing.value === value) opt.selected = true;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }

  select.addEventListener('change', () => onChange(select.value));
  wrapper.appendChild(select);
  return wrapper;
}

function _colorInputWithSwatch(label, value, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'color-swatch-wrapper';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.fontSize = '0.75rem';
  lbl.style.color = 'var(--text-muted)';
  lbl.style.minWidth = '20px';
  wrapper.appendChild(lbl);

  // Color swatch
  const swatch = document.createElement('div');
  swatch.className = 'color-swatch';
  const normalizedColor = _normalizeColor(value);
  swatch.style.backgroundColor = value === 'transparent' ? 'transparent' : normalizedColor;
  wrapper.appendChild(swatch);

  // Hidden color input
  const input = document.createElement('input');
  input.type = 'color';
  input.style.position = 'absolute';
  input.style.opacity = '0';
  input.style.width = '0';
  input.style.height = '0';
  input.value = normalizedColor;
  wrapper.appendChild(input);

  // Click swatch to open picker
  swatch.addEventListener('click', () => input.click());

  input.addEventListener('input', () => {
    swatch.style.backgroundColor = input.value;
    onChange(input.value);
  });

  wrapper.style.position = 'relative';
  return wrapper;
}

function _rangeInput(label, value, min, max, step, unit, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';
  wrapper.style.flex = '1';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const rangeWrapper = document.createElement('div');
  rangeWrapper.className = 'prop-range-wrapper';

  const range = document.createElement('input');
  range.type = 'range';
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(value);
  rangeWrapper.appendChild(range);

  const display = document.createElement('span');
  display.className = 'prop-range-value';
  display.textContent = `${value}${unit}`;
  rangeWrapper.appendChild(display);

  range.addEventListener('input', () => {
    const v = parseInt(range.value, 10);
    display.textContent = `${v}${unit}`;
    onChange(v);
  });

  wrapper.appendChild(rangeWrapper);
  return wrapper;
}

function _checkboxInput(label, checked, onChange) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrapper.appendChild(input);
  return wrapper;
}

function _readonlyInput(label, value) {
  const wrapper = document.createElement('div');
  wrapper.className = 'prop-row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  wrapper.appendChild(lbl);

  const span = document.createElement('span');
  span.className = 'text-sm text-muted';
  span.textContent = value;
  span.style.flex = '1';
  wrapper.appendChild(span);
  return wrapper;
}

/**
 * Normalize a color string to a hex value suitable for an <input type="color">.
 */
// Parse "Xpx Ypx Bpx #color" or "" → { x, y, blur, color }
function _parseTextShadow(val) {
  if (!val) return { x: 0, y: 0, blur: 0, color: '#000000' };
  // Match patterns like "2px 2px 4px #ff0000" or "2px 2px 4px rgba(0,0,0,0.5)"
  const m = val.match(/^(-?\d+(?:\.\d+)?)\s*px\s+(-?\d+(?:\.\d+)?)\s*px\s+(\d+(?:\.\d+)?)\s*px\s+(.+)$/);
  if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]), blur: parseFloat(m[3]), color: m[4].trim() };
  return { x: 0, y: 0, blur: 0, color: '#000000' };
}

function _buildTextShadow(p) {
  if (p.x === 0 && p.y === 0 && p.blur === 0) return '';
  return `${p.x}px ${p.y}px ${p.blur}px ${p.color}`;
}

// Parse "Wpx #color" or "" → { width, color }
function _parseTextStroke(val) {
  if (!val) return { width: 0, color: '#000000' };
  const m = val.match(/^(\d+(?:\.\d+)?)\s*px\s+(.+)$/);
  if (m) return { width: parseFloat(m[1]), color: m[2].trim() };
  return { width: 0, color: '#000000' };
}

function _buildTextStroke(p) {
  if (p.width === 0) return '';
  return `${p.width}px ${p.color}`;
}

function _normalizeColor(color) {
  if (!color || color === 'transparent') return '#000000';
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;
  return '#000000';
}

/* ---- Emit helpers ---- */

function _emit(changes) {
  if (currentElement && onPropertyChange) {
    onPropertyChange(currentElement.id, changes);
  }
}

function _emitProp(propChanges) {
  if (currentElement && onPropertyChange) {
    onPropertyChange(currentElement.id, { props: propChanges });
  }
}

function _emitAnimation(animChanges) {
  if (!currentElement) return;
  const current = currentElement.animation || {
    enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
    exit: { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
    update: { type: 'none', duration: 300, easing: 'power1.inOut' },
    emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
  };
  const merged = { ...current };
  for (const [key, val] of Object.entries(animChanges)) {
    merged[key] = { ...(current[key] || {}), ...val };
  }
  _emit({ animation: merged });
}

/* ---- SVG Icons for Quick Actions ---- */

function _svgDuplicate() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M2 11V3a1 1 0 0 1 1-1h8"/></svg>';
}

function _svgDelete() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M6 7v5M10 7v5"/><path d="M3 4l1 10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l1-10"/></svg>';
}

function _svgEye() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>';
}

function _svgEyeOff() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.6 6.6a2 2 0 0 0 2.8 2.8"/><path d="M1 8s3-5 7-5c.7 0 1.4.1 2 .4"/><path d="M15 8s-3 5-7 5c-.7 0-1.4-.1-2-.4"/><path d="M1 1l14 14"/></svg>';
}

function _svgLock() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>';
}

function _svgUnlock() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0"/></svg>';
}

function _svgFront() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4" y="1" width="8" height="8" rx="1"/><path d="M4 12h8M6 15h4"/></svg>';
}

function _svgBack() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="4" y="7" width="8" height="8" rx="1"/><path d="M4 4h8M6 1h4"/></svg>';
}
