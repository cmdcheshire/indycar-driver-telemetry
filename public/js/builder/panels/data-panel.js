/**
 * Data binding panel - shows binding configuration when a data element is selected.
 * Renders source/field/car selector/format dropdowns and conditional style rules.
 */

import {
  BINDING_SOURCES,
  CAR_SELECTORS,
  FORMATTERS,
  getFieldsForSource,
  resolveBindingPreview,
} from '../data-binding.js';

/** @type {Function|null} */
let onBindingChange = null;
/** @type {HTMLElement|null} */
let panelEl = null;
/** @type {object|null} */
let currentElement = null;

/**
 * Initialize the data panel.
 * @param {object} opts
 * @param {Function} opts.onBindingChange - Called with (elementId, changedProps) when binding props change
 */
export function initDataPanel(opts) {
  onBindingChange = opts.onBindingChange;
}

/**
 * Render the data panel for the given element inside a container.
 * @param {HTMLElement} container - DOM element to render into
 * @param {object|null} element - The data element, or null to clear
 */
export function renderDataPanel(container, element) {
  panelEl = container;
  currentElement = element;

  if (!container) return;

  if (!element || element.type !== 'data') {
    container.innerHTML = '';
    return;
  }

  const p = element.props || {};
  container.innerHTML = '';

  // Section title
  const title = document.createElement('div');
  title.className = 'prop-group-title';
  title.textContent = 'Data Binding Configuration';
  title.style.marginBottom = '10px';
  container.appendChild(title);

  // Source dropdown
  container.appendChild(_dropdown('Source', p.bindingSource || '', [
    { value: '', label: '-- Select Source --' },
    ...BINDING_SOURCES.map(s => ({ value: s.source, label: s.label })),
  ], (v) => {
    _emitProp({ bindingSource: v, bindingField: '' });
    // Re-render to update field options
    if (currentElement) {
      currentElement.props.bindingSource = v;
      currentElement.props.bindingField = '';
      renderDataPanel(panelEl, currentElement);
    }
  }));

  // Field dropdown (filtered by selected source)
  const fields = p.bindingSource ? getFieldsForSource(p.bindingSource) : [];
  container.appendChild(_dropdown('Field', p.bindingField || '', [
    { value: '', label: '-- Select Field --' },
    ...fields.map(f => ({ value: f.field, label: f.label })),
  ], (v) => {
    _emitProp({ bindingField: v });
    if (currentElement) {
      currentElement.props.bindingField = v;
      _updatePreview();
    }
  }));

  // Car selector
  container.appendChild(_dropdown('Car Selector', p.carSelector || '', [
    { value: '', label: '-- Default --' },
    ...CAR_SELECTORS.map(s => ({ value: s.value, label: s.label })),
  ], (v) => _emitProp({ carSelector: v })));

  // Format
  container.appendChild(_dropdown('Format', p.format || 'raw',
    FORMATTERS.map(f => ({ value: f.value, label: f.label })),
    (v) => {
      _emitProp({ format: v });
      if (currentElement) {
        currentElement.props.format = v;
        _updatePreview();
      }
    }
  ));

  // Prefix / Suffix / Fallback
  container.appendChild(_textInput('Prefix', p.prefix || '', (v) => _emitProp({ prefix: v })));
  container.appendChild(_textInput('Suffix', p.suffix || '', (v) => _emitProp({ suffix: v })));
  container.appendChild(_textInput('Fallback', p.fallback || '---', (v) => _emitProp({ fallback: v })));

  // Conditional styles section
  _renderConditionalStyles(container, p.conditionalStyles || []);

  // Preview value
  const previewRow = document.createElement('div');
  previewRow.className = 'prop-row';
  previewRow.style.marginTop = '12px';
  previewRow.style.padding = '8px';
  previewRow.style.background = 'var(--surface-alt)';
  previewRow.style.borderRadius = 'var(--radius-sm)';

  const previewLabel = document.createElement('label');
  previewLabel.textContent = 'Preview';
  previewLabel.style.color = 'var(--text-muted)';
  previewRow.appendChild(previewLabel);

  const previewValue = document.createElement('span');
  previewValue.id = 'dataPreviewValue';
  previewValue.style.fontWeight = '600';
  previewValue.style.flex = '1';
  previewValue.style.textAlign = 'right';
  previewValue.textContent = resolveBindingPreview({
    bindingSource: p.bindingSource,
    bindingField: p.bindingField,
    format: p.format,
  });
  previewRow.appendChild(previewValue);
  container.appendChild(previewRow);
}

/* ---- Conditional Styles ---- */

function _renderConditionalStyles(container, rules) {
  const section = document.createElement('div');
  section.style.marginTop = '12px';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.marginBottom = '6px';

  const headerLabel = document.createElement('label');
  headerLabel.textContent = 'Conditional Styles';
  headerLabel.style.fontSize = '0.7rem';
  headerLabel.style.fontWeight = '600';
  headerLabel.style.textTransform = 'uppercase';
  headerLabel.style.letterSpacing = '0.08em';
  headerLabel.style.color = 'var(--text-muted)';
  header.appendChild(headerLabel);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn btn-sm';
  addBtn.textContent = '+ Rule';
  addBtn.addEventListener('click', () => {
    const newRules = [...rules, { operator: 'gt', value: '', color: '#FF0000' }];
    _emitProp({ conditionalStyles: newRules });
    if (currentElement) {
      currentElement.props.conditionalStyles = newRules;
      renderDataPanel(panelEl, currentElement);
    }
  });
  header.appendChild(addBtn);
  section.appendChild(header);

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '4px';
    row.style.alignItems = 'center';
    row.style.marginBottom = '4px';

    const opSelect = document.createElement('select');
    opSelect.className = 'select';
    opSelect.style.width = '60px';
    opSelect.style.fontSize = '0.75rem';
    opSelect.style.padding = '3px 4px';
    for (const op of [
      { value: 'gt', label: '>' },
      { value: 'lt', label: '<' },
      { value: 'eq', label: '=' },
      { value: 'gte', label: '>=' },
      { value: 'lte', label: '<=' },
      { value: 'contains', label: 'has' },
    ]) {
      const opt = document.createElement('option');
      opt.value = op.value;
      opt.textContent = op.label;
      if (op.value === rule.operator) opt.selected = true;
      opSelect.appendChild(opt);
    }
    opSelect.addEventListener('change', () => {
      rules[i].operator = opSelect.value;
      _emitProp({ conditionalStyles: [...rules] });
    });
    row.appendChild(opSelect);

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.className = 'input';
    valInput.style.flex = '1';
    valInput.style.fontSize = '0.75rem';
    valInput.style.padding = '3px 6px';
    valInput.value = rule.value || '';
    valInput.placeholder = 'Value';
    valInput.addEventListener('change', () => {
      rules[i].value = valInput.value;
      _emitProp({ conditionalStyles: [...rules] });
    });
    row.appendChild(valInput);

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = rule.color || '#FF0000';
    colorInput.style.width = '28px';
    colorInput.style.height = '24px';
    colorInput.style.padding = '1px';
    colorInput.style.cursor = 'pointer';
    colorInput.addEventListener('input', () => {
      rules[i].color = colorInput.value;
      _emitProp({ conditionalStyles: [...rules] });
    });
    row.appendChild(colorInput);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'tmpl-action-btn delete';
    removeBtn.textContent = '\u00D7';
    removeBtn.style.fontSize = '1rem';
    removeBtn.addEventListener('click', () => {
      const newRules = rules.filter((_, idx) => idx !== i);
      _emitProp({ conditionalStyles: newRules });
      if (currentElement) {
        currentElement.props.conditionalStyles = newRules;
        renderDataPanel(panelEl, currentElement);
      }
    });
    row.appendChild(removeBtn);

    section.appendChild(row);
  }

  container.appendChild(section);
}

/* ---- DOM helpers ---- */

function _dropdown(label, value, options, onChange) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  row.style.marginBottom = '8px';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.minWidth = '60px';
  row.appendChild(lbl);

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
  row.appendChild(select);
  return row;
}

function _textInput(label, value, onChange) {
  const row = document.createElement('div');
  row.className = 'prop-row';
  row.style.marginBottom = '6px';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  lbl.style.minWidth = '60px';
  row.appendChild(lbl);

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'input';
  input.style.flex = '1';
  input.value = value;
  input.addEventListener('change', () => onChange(input.value));
  row.appendChild(input);
  return row;
}

/* ---- Emit ---- */

function _emitProp(propChanges) {
  if (currentElement && onBindingChange) {
    onBindingChange(currentElement.id, { props: propChanges });
  }
}

function _updatePreview() {
  if (!currentElement) return;
  const p = currentElement.props;
  const preview = resolveBindingPreview({
    bindingSource: p.bindingSource,
    bindingField: p.bindingField,
    format: p.format,
  });
  const previewEl = document.getElementById('dataPreviewValue');
  if (previewEl) previewEl.textContent = preview;

  _emitProp({ _previewValue: preview });
}
