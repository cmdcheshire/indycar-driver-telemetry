/**
 * Properties panel - right sidebar showing editable properties for the selected element.
 * Dynamically renders inputs based on element type.
 */

/** @type {Function} */
let onPropertyChange = null;

/** @type {HTMLElement} */
let panelEl = null;

/** @type {object|null} */
let currentElement = null;

/**
 * Initialize the properties panel.
 * @param {object} opts
 * @param {Function} opts.onPropertyChange - Called with (elementId, changedProps)
 */
export function initPropertiesPanel(opts) {
  onPropertyChange = opts.onPropertyChange;
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

  // Element name (editable)
  _addGroup('Element', [
    _textInput('Name', element.name, (v) => _emit({ name: v })),
  ]);

  // Position & Size
  _addGroup('Transform', [
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
}

/* ---- Type-specific property sections ---- */

function _addTextProps(p) {
  _addGroup('Typography', [
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
      _colorInput('Color', p.color || '#FFFFFF', (v) => _emitProp({ color: v })),
      _colorInput('BG', p.backgroundColor || 'transparent', (v) => _emitProp({ backgroundColor: v })),
    ]),
    _selectInput('Align', p.textAlign || 'left', [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
    ], (v) => _emitProp({ textAlign: v })),
  ]);

  _addGroup('Text Content', [
    _textareaInput('Text', p.text || '', (v) => _emitProp({ text: v })),
  ]);

  _addGroup('Effects', [
    _textInput('Shadow', p.textShadow || '', (v) => _emitProp({ textShadow: v })),
    _textInput('Stroke', p.textStroke || '', (v) => _emitProp({ textStroke: v })),
  ]);
}

function _addImageProps(p) {
  const srcRow = _textInput('Source URL', p.src || '', (v) => _emitProp({ src: v }));

  // Add upload button next to source input
  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'btn btn-sm';
  uploadBtn.textContent = 'Upload';
  uploadBtn.style.flexShrink = '0';
  uploadBtn.addEventListener('click', () => _triggerImageUpload());

  srcRow.appendChild(uploadBtn);

  _addGroup('Image', [
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

/**
 * Trigger a file picker, upload the selected image, and set it as the current image src.
 */
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

      // Set the uploaded path as the image source
      _emitProp({ src: data.path });

      // Re-render panel to show the new URL
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
  _addGroup('Shape', [
    _selectInput('Type', p.shapeType || 'rectangle', [
      { value: 'rectangle', label: 'Rectangle' },
      { value: 'ellipse', label: 'Ellipse' },
      { value: 'line', label: 'Line' },
    ], (v) => _emitProp({ shapeType: v })),
    _row([
      _colorInput('Fill', p.fill || 'rgba(59,130,246,0.5)', (v) => _emitProp({ fill: v })),
      _colorInput('Stroke', p.strokeColor || '', (v) => _emitProp({ strokeColor: v })),
    ]),
    _row([
      _numberInput('Stroke W', p.strokeWidth || 0, 0, 20, 1, (v) => _emitProp({ strokeWidth: v })),
      _numberInput('Radius', p.borderRadius || 0, 0, 100, 1, (v) => _emitProp({ borderRadius: v })),
    ]),
  ]);
}

function _addDataProps(p) {
  // Text rendering props (same as text)
  _addTextProps(p);

  // The data binding section is handled by data-panel.js but we show a summary here
  _addGroup('Data Binding', [
    _readonlyInput('Source', p.bindingSource || '(none)'),
    _readonlyInput('Field', p.bindingField || '(none)'),
    _readonlyInput('Selector', p.carSelector || '(none)'),
    _textInput('Prefix', p.prefix || '', (v) => _emitProp({ prefix: v })),
    _textInput('Suffix', p.suffix || '', (v) => _emitProp({ suffix: v })),
    _textInput('Fallback', p.fallback || '---', (v) => _emitProp({ fallback: v })),
  ]);
}

/* ---- DOM helpers ---- */

function _addGroup(title, children) {
  const group = document.createElement('div');
  group.className = 'prop-group';

  const titleEl = document.createElement('div');
  titleEl.className = 'prop-group-title';
  titleEl.textContent = title;
  group.appendChild(titleEl);

  for (const child of children) {
    if (child) group.appendChild(child);
  }

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
  input.addEventListener('change', () => {
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
  input.addEventListener('change', () => onChange(input.value));
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
  textarea.addEventListener('change', () => onChange(textarea.value));
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

function _colorInput(label, value, onChange) {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = '4px';
  wrapper.style.flex = '1';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.fontSize = '0.75rem';
  lbl.style.color = 'var(--text-muted)';
  lbl.style.minWidth = '20px';
  wrapper.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'color';
  input.className = 'input';
  // Normalize color value for the color picker
  input.value = _normalizeColor(value);
  input.addEventListener('input', () => onChange(input.value));
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
 * @param {string} color
 * @returns {string}
 */
function _normalizeColor(color) {
  if (!color || color === 'transparent') return '#000000';
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) return color;
  // For rgba/named colors, fall back to black for the picker
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
