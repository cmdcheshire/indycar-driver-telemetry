/**
 * Layer panel - horizontal list of layers at the bottom of the builder.
 * Each layer card shows element name, visibility toggle, lock toggle, and supports drag-to-reorder.
 */

/** @type {Function} */
let getElements = null;
/** @type {Function} */
let onSelect = null;
/** @type {Function} */
let onReorder = null;
/** @type {Function} */
let onVisibilityToggle = null;
/** @type {Function} */
let onLockToggle = null;
/** @type {Function} */
let getSelectedIds = null;

/** @type {HTMLElement} */
let layerListEl = null;

/** @type {string|null} Dragged element ID */
let draggedId = null;

/**
 * Initialize the layer panel.
 * @param {object} opts
 * @param {Function} opts.getElements - Returns current elements array
 * @param {Function} opts.getSelectedIds - Returns currently selected element IDs
 * @param {Function} opts.onSelect - Called with element ID when a layer is clicked
 * @param {Function} opts.onReorder - Called with (elementId, newIndex) after drag reorder
 * @param {Function} opts.onVisibilityToggle - Called with element ID
 * @param {Function} opts.onLockToggle - Called with element ID
 */
export function initLayerPanel(opts) {
  getElements = opts.getElements;
  getSelectedIds = opts.getSelectedIds;
  onSelect = opts.onSelect;
  onReorder = opts.onReorder;
  onVisibilityToggle = opts.onVisibilityToggle;
  onLockToggle = opts.onLockToggle;

  layerListEl = document.getElementById('layerList');
}

/**
 * Render the layer list from the current elements.
 * Should be called whenever elements change.
 */
export function renderLayerPanel() {
  if (!layerListEl || !getElements) return;

  const elements = getElements();
  const selectedIds = getSelectedIds ? getSelectedIds() : [];

  layerListEl.innerHTML = '';

  // Render in z-index order (highest last = rightmost)
  const sorted = [...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  for (const el of sorted) {
    const item = document.createElement('div');
    item.className = `layer-item${selectedIds.includes(el.id) ? ' selected' : ''}`;
    item.dataset.elementId = el.id;
    item.draggable = true;

    // Preview thumbnail
    const preview = document.createElement('div');
    preview.className = 'layer-preview';
    preview.textContent = _getPreviewLabel(el);
    item.appendChild(preview);

    // Info section
    const info = document.createElement('div');
    info.className = 'layer-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'layer-name';
    nameEl.textContent = el.name || el.type;
    info.appendChild(nameEl);

    const controls = document.createElement('div');
    controls.className = 'layer-controls';

    // Visibility toggle
    const visBtn = document.createElement('button');
    visBtn.className = `layer-ctrl-btn${el.visible ? '' : ' off'}`;
    visBtn.innerHTML = el.visible ? _eyeIcon() : _eyeOffIcon();
    visBtn.title = el.visible ? 'Hide' : 'Show';
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onVisibilityToggle) onVisibilityToggle(el.id);
    });
    controls.appendChild(visBtn);

    // Lock toggle
    const lockBtn = document.createElement('button');
    lockBtn.className = `layer-ctrl-btn${el.locked ? '' : ' off'}`;
    lockBtn.innerHTML = el.locked ? _lockIcon() : _unlockIcon();
    lockBtn.title = el.locked ? 'Unlock' : 'Lock';
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onLockToggle) onLockToggle(el.id);
    });
    controls.appendChild(lockBtn);

    info.appendChild(controls);
    item.appendChild(info);

    // Click to select
    item.addEventListener('click', () => {
      if (onSelect) onSelect(el.id);
    });

    // Drag events for reordering
    item.addEventListener('dragstart', (e) => {
      draggedId = el.id;
      e.dataTransfer.effectAllowed = 'move';
      item.style.opacity = '0.5';
    });

    item.addEventListener('dragend', () => {
      draggedId = null;
      item.style.opacity = '';
      // Remove drag-over class from all items
      layerListEl.querySelectorAll('.layer-item').forEach(i => i.classList.remove('drag-over'));
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      item.classList.add('drag-over');
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (draggedId && draggedId !== el.id && onReorder) {
        // Find the target index in the sorted array
        const targetIndex = sorted.findIndex(s => s.id === el.id);
        onReorder(draggedId, targetIndex);
      }
    });

    layerListEl.appendChild(item);
  }
}

/* ---- Icons ---- */

function _eyeIcon() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></svg>';
}

function _eyeOffIcon() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6.6 6.6a2 2 0 0 0 2.8 2.8"/><path d="M1 8s3-5 7-5c.7 0 1.4.1 2 .4"/><path d="M15 8s-3 5-7 5c-.7 0-1.4-.1-2-.4"/><path d="M1 1l14 14"/></svg>';
}

function _lockIcon() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>';
}

function _unlockIcon() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0"/></svg>';
}

function _getPreviewLabel(element) {
  switch (element.type) {
    case 'text': return element.props?.text?.substring(0, 20) || 'Text';
    case 'image': return 'IMG';
    case 'shape': return element.props?.shapeType || 'Shape';
    case 'data': return `{${element.props?.bindingField || '?'}}`;
    default: return element.type;
  }
}
