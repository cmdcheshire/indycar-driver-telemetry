/**
 * Layer panel - vertical list of layers in the left sidebar.
 * Each row: drag handle | type icon | name (double-click to rename) | animation badge | visibility | lock
 * Supports drag-to-reorder and right-click context menu.
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
/** @type {Function} */
let onDelete = null;
/** @type {Function} */
let onDuplicate = null;
/** @type {Function} */
let onRename = null;
/** @type {Function} */
let onMoveToFront = null;
/** @type {Function} */
let onMoveToBack = null;
/** @type {Function} */
let onMoveForward = null;
/** @type {Function} */
let onMoveBackward = null;
/** @type {Function} */
let onGroup = null;
/** @type {Function} */
let onUngroup = null;

/** @type {HTMLElement} */
let layerListEl = null;
/** @type {HTMLElement} */
let contextMenuEl = null;

/** @type {string|null} Dragged element ID */
let draggedId = null;
/** @type {string|null} Right-clicked element ID for context menu */
let contextMenuTargetId = null;

/**
 * Initialize the layer panel.
 * @param {object} opts
 * @param {Function} opts.getElements - Returns current elements array
 * @param {Function} opts.getSelectedIds - Returns currently selected element IDs
 * @param {Function} opts.onSelect - Called with element ID when a layer is clicked
 * @param {Function} opts.onReorder - Called with (elementId, newIndex) after drag reorder
 * @param {Function} opts.onVisibilityToggle - Called with element ID
 * @param {Function} opts.onLockToggle - Called with element ID
 * @param {Function} [opts.onDelete] - Called with element ID
 * @param {Function} [opts.onDuplicate] - Called with element ID
 * @param {Function} [opts.onRename] - Called with (elementId, newName)
 * @param {Function} [opts.onMoveToFront] - Called with element ID
 * @param {Function} [opts.onMoveToBack] - Called with element ID
 * @param {Function} [opts.onMoveForward] - Called with element ID
 * @param {Function} [opts.onMoveBackward] - Called with element ID
 * @param {Function} [opts.onGroup] - Called when group is requested
 * @param {Function} [opts.onUngroup] - Called when ungroup is requested
 */
export function initLayerPanel(opts) {
  getElements = opts.getElements;
  getSelectedIds = opts.getSelectedIds;
  onSelect = opts.onSelect;
  onReorder = opts.onReorder;
  onVisibilityToggle = opts.onVisibilityToggle;
  onLockToggle = opts.onLockToggle;
  onDelete = opts.onDelete || null;
  onDuplicate = opts.onDuplicate || null;
  onRename = opts.onRename || null;
  onMoveToFront = opts.onMoveToFront || null;
  onMoveToBack = opts.onMoveToBack || null;
  onMoveForward = opts.onMoveForward || null;
  onMoveBackward = opts.onMoveBackward || null;
  onGroup = opts.onGroup || null;
  onUngroup = opts.onUngroup || null;

  layerListEl = document.getElementById('layerList');
  contextMenuEl = document.getElementById('layerContextMenu');

  _initContextMenu();
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

  // Render in reverse z-index order (highest z-index = top of list, matching visual stack)
  const sorted = [...elements].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));

  for (const el of sorted) {
    const item = document.createElement('div');
    item.className = `layer-item${selectedIds.includes(el.id) ? ' selected' : ''}`;
    item.dataset.elementId = el.id;
    item.draggable = true;

    // Drag handle
    const handle = document.createElement('span');
    handle.className = 'layer-drag-handle';
    handle.innerHTML = '&#x2630;'; // hamburger icon
    item.appendChild(handle);

    // Type icon
    const typeIcon = document.createElement('span');
    typeIcon.className = 'layer-type-icon';
    typeIcon.innerHTML = _getTypeIcon(el.type);
    item.appendChild(typeIcon);

    // Name (editable on double-click)
    const nameEl = document.createElement('span');
    nameEl.className = 'layer-name';
    nameEl.textContent = el.name || el.type;
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      _startRename(item, el);
    });
    item.appendChild(nameEl);

    // Animation badge (if has non-none enter or exit animation)
    const hasAnim = el.animation &&
      ((el.animation.enter && el.animation.enter.type !== 'none') ||
       (el.animation.exit && el.animation.exit.type !== 'none'));
    if (hasAnim) {
      const badge = document.createElement('span');
      badge.className = 'layer-anim-badge';
      badge.title = 'Has animation';
      item.appendChild(badge);
    }

    // Visibility toggle
    const visBtn = document.createElement('button');
    visBtn.className = `layer-ctrl-btn${el.visible ? '' : ' off'}`;
    visBtn.innerHTML = el.visible ? _eyeIcon() : _eyeOffIcon();
    visBtn.title = el.visible ? 'Hide' : 'Show';
    visBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onVisibilityToggle) onVisibilityToggle(el.id);
    });
    item.appendChild(visBtn);

    // Lock toggle
    const lockBtn = document.createElement('button');
    lockBtn.className = `layer-ctrl-btn${el.locked ? '' : ' off'}`;
    lockBtn.innerHTML = el.locked ? _lockIcon() : _unlockIcon();
    lockBtn.title = el.locked ? 'Unlock' : 'Lock';
    lockBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (onLockToggle) onLockToggle(el.id);
    });
    item.appendChild(lockBtn);

    // Click to select
    item.addEventListener('click', () => {
      if (onSelect) onSelect(el.id);
    });

    // Right-click for context menu
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      contextMenuTargetId = el.id;
      if (onSelect) onSelect(el.id);
      _showContextMenu(e.clientX, e.clientY);
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
        // Find the target index in the original (ascending z-index) array
        const ascSorted = [...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        const targetIndex = ascSorted.findIndex(s => s.id === el.id);
        onReorder(draggedId, targetIndex);
      }
    });

    layerListEl.appendChild(item);
  }
}

/* ---- Inline Rename ---- */

function _startRename(itemEl, element) {
  const nameEl = itemEl.querySelector('.layer-name');
  if (!nameEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'layer-name-input';
  input.value = element.name || element.type;

  const finish = () => {
    const newName = input.value.trim();
    if (newName && newName !== element.name && onRename) {
      onRename(element.id, newName);
    }
    renderLayerPanel();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = element.name || element.type;
      input.blur();
    }
  });

  nameEl.replaceWith(input);
  input.focus();
  input.select();
}

/* ---- Context Menu ---- */

function _initContextMenu() {
  if (!contextMenuEl) return;

  // Close on click outside
  document.addEventListener('click', () => _hideContextMenu());
  document.addEventListener('contextmenu', (e) => {
    // Only hide if right-click is outside the layer list
    if (!e.target.closest('.layer-item')) {
      _hideContextMenu();
    }
  });

  // Handle menu item clicks
  contextMenuEl.addEventListener('click', (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;

    const action = item.dataset.action;
    if (!contextMenuTargetId) return;

    switch (action) {
      case 'duplicate':
        if (onDuplicate) onDuplicate(contextMenuTargetId);
        break;
      case 'delete':
        if (onDelete) onDelete(contextMenuTargetId);
        break;
      case 'rename':
        _triggerRenameFromContextMenu(contextMenuTargetId);
        break;
      case 'moveToFront':
        if (onMoveToFront) onMoveToFront(contextMenuTargetId);
        break;
      case 'moveForward':
        if (onMoveForward) onMoveForward(contextMenuTargetId);
        break;
      case 'moveBackward':
        if (onMoveBackward) onMoveBackward(contextMenuTargetId);
        break;
      case 'moveToBack':
        if (onMoveToBack) onMoveToBack(contextMenuTargetId);
        break;
      case 'group':
        if (onGroup) onGroup();
        break;
      case 'ungroup':
        if (onUngroup) onUngroup();
        break;
    }

    _hideContextMenu();
  });
}

function _showContextMenu(x, y) {
  if (!contextMenuEl) return;

  contextMenuEl.style.display = '';
  contextMenuEl.style.left = `${x}px`;
  contextMenuEl.style.top = `${y}px`;

  // Keep within viewport
  const rect = contextMenuEl.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenuEl.style.left = `${window.innerWidth - rect.width - 4}px`;
  }
  if (rect.bottom > window.innerHeight) {
    contextMenuEl.style.top = `${window.innerHeight - rect.height - 4}px`;
  }
}

function _hideContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.style.display = 'none';
  }
  contextMenuTargetId = null;
}

function _triggerRenameFromContextMenu(elementId) {
  if (!layerListEl) return;
  const itemEl = layerListEl.querySelector(`[data-element-id="${elementId}"]`);
  if (!itemEl) return;

  const elements = getElements ? getElements() : [];
  const el = elements.find(e => e.id === elementId);
  if (!el) return;

  _startRename(itemEl, el);
}

/* ---- Type Icons ---- */

function _getTypeIcon(type) {
  switch (type) {
    case 'text':
      return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 3h8M8 3v10"/></svg>';
    case 'image':
      return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="12" height="12" rx="1.5"/><circle cx="5.5" cy="5.5" r="1.2"/><path d="M14 10l-3-3L3 14"/></svg>';
    case 'shape':
      return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="1"/></svg>';
    case 'data':
      return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 4h2M10 4h2M4 8h8M4 12h2M10 12h2"/></svg>';
    default:
      return type.charAt(0).toUpperCase();
  }
}

/* ---- Control Icons ---- */

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
