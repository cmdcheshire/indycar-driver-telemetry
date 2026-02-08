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

/** @type {Function} */
let onPropertyChange = null;
/** @type {Function} */
let onQuickAction = null;

/** @type {HTMLElement} */
let panelEl = null;

/** @type {object|null} */
let currentElement = null;

/** Persisted collapsed state for sections */
const _sectionState = {};

const ENTER_ANIMATIONS = [
  { value: 'none', label: 'None' },
  { value: 'fadeIn', label: 'Fade In' },
  { value: 'slideInLeft', label: 'Slide In Left' },
  { value: 'slideInRight', label: 'Slide In Right' },
  { value: 'slideInUp', label: 'Slide In Up' },
  { value: 'slideInDown', label: 'Slide In Down' },
  { value: 'scaleIn', label: 'Scale In' },
];

const EXIT_ANIMATIONS = [
  { value: 'none', label: 'None' },
  { value: 'fadeOut', label: 'Fade Out' },
  { value: 'slideOutLeft', label: 'Slide Out Left' },
  { value: 'slideOutRight', label: 'Slide Out Right' },
  { value: 'slideOutUp', label: 'Slide Out Up' },
  { value: 'slideOutDown', label: 'Slide Out Down' },
  { value: 'scaleOut', label: 'Scale Out' },
];

const EASINGS = [
  { value: 'ease', label: 'Ease' },
  { value: 'ease-in', label: 'Ease In' },
  { value: 'ease-out', label: 'Ease Out' },
  { value: 'ease-in-out', label: 'Ease In-Out' },
  { value: 'linear', label: 'Linear' },
];

/**
 * Initialize the properties panel.
 * @param {object} opts
 * @param {Function} opts.onPropertyChange - Called with (elementId, changedProps)
 * @param {Function} [opts.onQuickAction] - Called with (elementId, action) for quick action buttons
 */
export function initPropertiesPanel(opts) {
  onPropertyChange = opts.onPropertyChange;
  onQuickAction = opts.onQuickAction || null;
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

  // Element name
  _addCollapsibleGroup('Element', [
    _textInput('Name', element.name, (v) => _emit({ name: v })),
  ]);

  // Transform
  _addCollapsibleGroup('Transform', [
    _row([
      _numberInput('X', element.x, 0, 100, 0.1, (v) => _emit({ x: v })),
      _numberInput('Y', element.y, 0, 100, 0.1, (v) => _emit({ y: v })),
    ]),
    _row([
      _numberInput('W', element.width, 0.5, 100, 0.1, (v) => _emit({ width: v })),
      _numberInput('H', element.height, 0.5, 100, 0.1, (v) => _emit({ height: v })),
    ]),
    _row([
      _numberInput('Rot', element.rotation || 0, 0, 360, 1, (v) => _emit({ rotation: v })),
      _numberInput('Opa', element.opacity ?? 1, 0, 1, 0.05, (v) => _emit({ opacity: v })),
    ]),
  ]);

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
    formData.append('image', file);

    try {
      const { getToken } = await import('/js/modules/auth.js');
      const token = getToken();

      const res = await fetch('/api/assets/upload/overlays', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();

      _emitProp({ src: data.path });

      if (currentElement) {
        currentElement.props = { ...(currentElement.props || {}), src: data.path };
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

function _addAnimationSection(element) {
  const anim = element.animation || {};
  const enter = anim.enter || { type: 'none', duration: 300, easing: 'ease' };
  const exit = anim.exit || { type: 'none', duration: 300, easing: 'ease' };
  const update = anim.update || { type: 'none', duration: 300, easing: 'ease' };

  const children = [
    // Enter animation
    _selectInput('Enter', enter.type, ENTER_ANIMATIONS, (v) => {
      _emitAnimation({ enter: { ...enter, type: v } });
    }),
    _row([
      _rangeInput('Duration', enter.duration, 100, 2000, 50, 'ms', (v) => {
        _emitAnimation({ enter: { ...enter, duration: v } });
      }),
    ]),
    _selectInput('Easing', enter.easing, EASINGS, (v) => {
      _emitAnimation({ enter: { ...enter, easing: v } });
    }),

    // Separator
    _separator(),

    // Exit animation
    _selectInput('Exit', exit.type, EXIT_ANIMATIONS, (v) => {
      _emitAnimation({ exit: { ...exit, type: v } });
    }),
    _row([
      _rangeInput('Duration', exit.duration, 100, 2000, 50, 'ms', (v) => {
        _emitAnimation({ exit: { ...exit, duration: v } });
      }),
    ]),
    _selectInput('Easing', exit.easing, EASINGS, (v) => {
      _emitAnimation({ exit: { ...exit, easing: v } });
    }),
  ];

  // Update animation (for data elements)
  if (element.type === 'data') {
    children.push(
      _separator(),
      _selectInput('Update', update.type, [
        { value: 'none', label: 'None' },
        { value: 'crossfade', label: 'Crossfade' },
      ], (v) => {
        _emitAnimation({ update: { ...update, type: v } });
      }),
      _rangeInput('Duration', update.duration, 50, 1000, 25, 'ms', (v) => {
        _emitAnimation({ update: { ...update, duration: v } });
      }),
    );
  }

  // Preview button
  const previewBtn = document.createElement('button');
  previewBtn.className = 'anim-preview-btn';
  previewBtn.title = 'Preview enter animation';
  previewBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg>';
  previewBtn.addEventListener('click', () => {
    if (onQuickAction) onQuickAction(element.id, 'previewAnimation');
  });
  children.push(previewBtn);

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
    enter: { type: 'none', duration: 300, easing: 'ease' },
    exit: { type: 'none', duration: 300, easing: 'ease' },
    update: { type: 'none', duration: 300, easing: 'ease' },
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
