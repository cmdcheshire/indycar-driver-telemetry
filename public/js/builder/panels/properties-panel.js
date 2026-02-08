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
  }

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
  _addCollapsibleGroup('Typography', [
    _selectInput('Font', p.fontFamily || 'Inter, sans-serif', [
      { value: 'Inter, sans-serif', label: 'Inter' },
      { value: 'Roboto, sans-serif', label: 'Roboto' },
      { value: 'Roboto Mono, monospace', label: 'Roboto Mono' },
      { value: 'Oswald, sans-serif', label: 'Oswald' },
      { value: 'Montserrat, sans-serif', label: 'Montserrat' },
      { value: 'Arial, sans-serif', label: 'Arial' },
      { value: 'Georgia, serif', label: 'Georgia' },
      { value: 'monospace', label: 'Monospace' },
    ], (v) => _emitProp({ fontFamily: v })),
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
    _selectInput('Align', p.textAlign || 'left', [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
    ], (v) => _emitProp({ textAlign: v })),
    _checkboxInput('Fit Text', !!p.fitText, (v) => _emitProp({ fitText: v })),
  ]);

  _addCollapsibleGroup('Text Content', [
    _textareaInput('Text', p.text || '', (v) => _emitProp({ text: v })),
  ]);

  _addCollapsibleGroup('Effects', [
    _textInput('Shadow', p.textShadow || '', (v) => _emitProp({ textShadow: v })),
    _textInput('Stroke', p.textStroke || '', (v) => _emitProp({ textStroke: v })),
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
