/**
 * Layer panel - tree-structured layer list in the left sidebar.
 *
 * Renders a nested tree of groups (collapsible folders) and elements.
 * Groups appear as folder rows with expand/collapse, visibility, lock,
 * and exposed toggles. Elements appear as leaf rows with type icon,
 * name, and the same set of toggles.
 *
 * Supports right-click context menus for both groups and elements.
 */

import { buildLayerTree } from '../group-manager.js';

/* ================================================================ *
 *  Module-level state
 * ================================================================ */

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
let onExposedToggle = null;
/** @type {Function} */
let onGroup = null;
/** @type {Function} */
let onUngroup = null;

// New group callbacks
/** @type {Function} */
let onGroupSelect = null;
/** @type {Function} */
let onGroupToggle = null;
/** @type {Function} */
let onGroupVisibilityToggle = null;
/** @type {Function} */
let onGroupLockToggle = null;
/** @type {Function} */
let onGroupRename = null;
/** @type {Function} */
let onGroupContextMenu = null;
/** @type {Function} */
let onContextMenu = null;

/** @type {HTMLElement} */
let layerListEl = null;
/** @type {HTMLElement} */
let contextMenuEl = null;

/** @type {string|null} Right-clicked element ID for context menu */
let contextMenuTargetId = null;
/** @type {string|null} Right-clicked group ID for context menu */
let contextMenuTargetGroupId = null;

/** @type {string|null} Drag-and-drop source element ID */
let _dragSourceId = null;

/* ================================================================ *
 *  Initialization
 * ================================================================ */

/**
 * Initialize the layer panel.
 * @param {object} opts
 * @param {Function} opts.getElements - Returns current elements array
 * @param {Function} opts.getSelectedIds - Returns currently selected element IDs
 * @param {Function} opts.onSelect - Called with (elementId, { shiftKey }) when a layer is clicked
 * @param {Function} [opts.onReorder] - Called with (elementId, newIndex) after drag reorder
 * @param {Function} opts.onVisibilityToggle - Called with element ID
 * @param {Function} opts.onLockToggle - Called with element ID
 * @param {Function} [opts.onDelete] - Called with element ID
 * @param {Function} [opts.onDuplicate] - Called with element ID
 * @param {Function} [opts.onRename] - Called with (elementId, newName)
 * @param {Function} [opts.onMoveToFront] - Called with element ID
 * @param {Function} [opts.onMoveToBack] - Called with element ID
 * @param {Function} [opts.onMoveForward] - Called with element ID
 * @param {Function} [opts.onMoveBackward] - Called with element ID
 * @param {Function} [opts.onExposedToggle] - Called with element ID
 * @param {Function} [opts.onGroup] - Called when group is requested
 * @param {Function} [opts.onUngroup] - Called when ungroup is requested
 * @param {Function} [opts.onContextMenu] - Called with (elementId, event)
 * @param {Function} [opts.onGroupSelect] - Called with groupId
 * @param {Function} [opts.onGroupToggle] - Called with groupId (expand/collapse)
 * @param {Function} [opts.onGroupVisibilityToggle] - Called with groupId
 * @param {Function} [opts.onGroupLockToggle] - Called with groupId
 * @param {Function} [opts.onGroupRename] - Called with (groupId, newName)
 * @param {Function} [opts.onGroupContextMenu] - Called with (groupId, event)
 */
export function initLayerPanel(opts) {
  getElements = opts.getElements;
  getSelectedIds = opts.getSelectedIds;
  onSelect = opts.onSelect;
  onReorder = opts.onReorder || null;
  onVisibilityToggle = opts.onVisibilityToggle;
  onLockToggle = opts.onLockToggle;
  onDelete = opts.onDelete || null;
  onDuplicate = opts.onDuplicate || null;
  onRename = opts.onRename || null;
  onMoveToFront = opts.onMoveToFront || null;
  onMoveToBack = opts.onMoveToBack || null;
  onMoveForward = opts.onMoveForward || null;
  onMoveBackward = opts.onMoveBackward || null;
  onExposedToggle = opts.onExposedToggle || null;
  onGroup = opts.onGroup || null;
  onUngroup = opts.onUngroup || null;
  onContextMenu = opts.onContextMenu || null;

  // Group callbacks
  onGroupSelect = opts.onGroupSelect || null;
  onGroupToggle = opts.onGroupToggle || null;
  onGroupVisibilityToggle = opts.onGroupVisibilityToggle || null;
  onGroupLockToggle = opts.onGroupLockToggle || null;
  onGroupRename = opts.onGroupRename || null;
  onGroupContextMenu = opts.onGroupContextMenu || null;

  layerListEl = document.getElementById('layerList');
  contextMenuEl = document.getElementById('layerContextMenu');

  _initContextMenu();
}

/* ================================================================ *
 *  Render
 * ================================================================ */

/**
 * Render the layer list from the current elements and groups.
 * Accepts optional parameters for tree-based rendering; when omitted
 * it falls back to the flat getElements() / getSelectedIds() approach
 * for backward compatibility.
 *
 * @param {object[]} [elements] - Elements array (optional, falls back to getElements())
 * @param {object[]} [groups] - Groups array (optional, defaults to [])
 * @param {Set<string>|string[]} [selectedIds] - Selected element IDs (optional)
 */
export function renderLayerPanel(elements, groups, selectedIds) {
  if (!layerListEl) return;

  // Resolve arguments with fallbacks for backward compatibility
  const els = elements || (getElements ? getElements() : []);
  const grps = groups || [];
  const selRaw = selectedIds || (getSelectedIds ? getSelectedIds() : []);
  const selSet = selRaw instanceof Set ? selRaw : new Set(selRaw);

  layerListEl.innerHTML = '';

  // Build the tree structure via group-manager
  let tree;
  try {
    tree = buildLayerTree(els, grps);
  } catch (_) {
    // If buildLayerTree is not available, fall back to flat rendering
    tree = _buildFlatTree(els);
  }

  // Render recursively
  _renderTreeNodes(tree, layerListEl, selSet, 0);
}

/**
 * Fallback: build a flat tree from elements (no groups) so the panel
 * still works when buildLayerTree is unavailable.
 * Sorted in reverse z-index order (highest z-index = top of list).
 * @param {object[]} elements
 * @returns {object[]} Tree nodes
 */
function _buildFlatTree(elements) {
  const sorted = [...elements].sort((a, b) => (b.zIndex || 0) - (a.zIndex || 0));
  return sorted.map(el => ({ type: 'element', element: el }));
}

/**
 * Recursively render an array of tree nodes into a parent container.
 * @param {object[]} nodes - Array of { type: 'group'|'element', ... }
 * @param {HTMLElement} container - DOM container to append to
 * @param {Set<string>} selectedIds - Set of selected element IDs
 * @param {number} depth - Current nesting depth (for indentation)
 */
function _renderTreeNodes(nodes, container, selectedIds, depth) {
  for (const node of nodes) {
    if (node.type === 'group') {
      _renderGroupNode(node, container, selectedIds, depth);
    } else {
      _renderElementNode(node.element, container, selectedIds, depth);
    }
  }
}

/* ================================================================ *
 *  Group Row
 * ================================================================ */

/**
 * Render a group folder row and its children.
 * @param {object} node - Tree node { type: 'group', group, children }
 * @param {HTMLElement} container
 * @param {Set<string>} selectedIds
 * @param {number} depth
 */
function _renderGroupNode(node, container, selectedIds, depth) {
  const group = node.group;
  const children = node.children || [];
  const isExpanded = group.expanded !== false; // default expanded

  // -- Group folder row --
  const row = document.createElement('div');
  row.className = 'layer-item layer-group-row';
  row.dataset.groupId = group.id;
  row.style.paddingLeft = `${4 + depth * 16}px`;

  // Chevron toggle
  const chevron = document.createElement('span');
  chevron.className = 'layer-group-chevron';
  chevron.innerHTML = isExpanded ? _chevronDownIcon() : _chevronRightIcon();
  chevron.title = isExpanded ? 'Collapse' : 'Expand';
  chevron.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onGroupToggle) onGroupToggle(group.id);
  });
  row.appendChild(chevron);

  // Folder icon
  const folderIcon = document.createElement('span');
  folderIcon.className = 'layer-type-icon';
  folderIcon.innerHTML = isExpanded ? _folderOpenIcon() : _folderIcon();
  row.appendChild(folderIcon);

  // Group name (editable on double-click)
  const nameEl = document.createElement('span');
  nameEl.className = 'layer-name';
  nameEl.textContent = group.name || 'Group';
  nameEl.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    _startGroupRename(row, group);
  });
  row.appendChild(nameEl);

  // Visibility toggle (toggles all members)
  const visBtn = document.createElement('button');
  const groupVisible = group.visible !== false;
  visBtn.className = `layer-ctrl-btn${groupVisible ? '' : ' off'}`;
  visBtn.innerHTML = groupVisible ? _eyeIcon() : _eyeOffIcon();
  visBtn.title = groupVisible ? 'Hide group' : 'Show group';
  visBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onGroupVisibilityToggle) onGroupVisibilityToggle(group.id);
  });
  row.appendChild(visBtn);

  // Lock toggle
  const lockBtn = document.createElement('button');
  const groupLocked = !!group.locked;
  lockBtn.className = `layer-ctrl-btn${groupLocked ? '' : ' off'}`;
  lockBtn.innerHTML = groupLocked ? _lockIcon() : _unlockIcon();
  lockBtn.title = groupLocked ? 'Unlock group' : 'Lock group';
  lockBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onGroupLockToggle) onGroupLockToggle(group.id);
  });
  row.appendChild(lockBtn);

  // Exposed toggle
  const expBtn = document.createElement('button');
  const groupExposed = !!group.exposed;
  expBtn.className = `layer-ctrl-btn${groupExposed ? '' : ' off'}`;
  expBtn.innerHTML = _exposedIcon();
  expBtn.title = groupExposed ? 'Hide group from operator' : 'Expose group to operator';
  expBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Group exposed is informational; forward to group callback if exists
    if (onGroupSelect) onGroupSelect(group.id);
  });
  row.appendChild(expBtn);

  // Click to select group
  row.addEventListener('click', (e) => {
    if (onGroupSelect) onGroupSelect(group.id);
  });

  // Right-click for context menu
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuTargetGroupId = group.id;
    contextMenuTargetId = null;
    if (onGroupContextMenu) {
      onGroupContextMenu(group.id, e);
    } else {
      _showContextMenu(e.clientX, e.clientY);
    }
  });

  container.appendChild(row);

  // -- Children container --
  const childContainer = document.createElement('div');
  childContainer.className = 'layer-group-children';
  childContainer.dataset.groupId = group.id;

  if (!isExpanded) {
    childContainer.style.display = 'none';
  }

  // Recursively render children at the next depth level
  _renderTreeNodes(children, childContainer, selectedIds, depth + 1);

  container.appendChild(childContainer);
}

/* ================================================================ *
 *  Element Row
 * ================================================================ */

/**
 * Render a single element row.
 * @param {object} el - Element object
 * @param {HTMLElement} container
 * @param {Set<string>} selectedIds
 * @param {number} depth
 */
function _renderElementNode(el, container, selectedIds, depth) {
  const item = document.createElement('div');
  item.className = `layer-item${selectedIds.has(el.id) ? ' selected' : ''}`;
  item.dataset.elementId = el.id;
  item.style.paddingLeft = `${4 + depth * 16}px`;
  item.draggable = true;

  // Drag handle
  const handle = document.createElement('span');
  handle.className = 'layer-drag-handle';
  handle.innerHTML = _dragHandleIcon();
  item.appendChild(handle);

  // Drag events
  item.addEventListener('dragstart', (e) => {
    _dragSourceId = el.id;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/element-id', el.id);
  });

  item.addEventListener('dragend', () => {
    item.classList.remove('dragging');
    _dragSourceId = null;
    // Clean up any lingering drag-over classes
    layerListEl.querySelectorAll('.layer-item.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (_dragSourceId && _dragSourceId !== el.id) {
      item.classList.add('drag-over');
    }
  });

  item.addEventListener('dragleave', () => {
    item.classList.remove('drag-over');
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
    item.classList.remove('drag-over');
    if (!_dragSourceId || _dragSourceId === el.id || !onReorder) return;

    // Get all element items in visual order (descending zIndex = front at top)
    const allItems = [...layerListEl.querySelectorAll('.layer-item[data-element-id]')];
    const totalElements = allItems.length;
    const targetVisualIdx = allItems.indexOf(item);

    // Visual order is descending zIndex, but _reorderElementToIndex uses ascending.
    // Convert: ascendingIndex = (totalElements - 1) - visualIndex
    const targetAscIdx = (totalElements - 1) - targetVisualIdx;
    onReorder(_dragSourceId, targetAscIdx);
    _dragSourceId = null;
  });

  // Type icon
  const typeIcon = document.createElement('span');
  typeIcon.className = 'layer-type-icon';
  typeIcon.innerHTML = _getTypeIcon(el.type);
  item.appendChild(typeIcon);

  // Name (editable on double-click)
  const nameEl = document.createElement('span');
  nameEl.className = 'layer-name';
  nameEl.textContent = _getDisplayName(el);
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

  // Exposed toggle
  const expBtn = document.createElement('button');
  expBtn.className = `layer-ctrl-btn${el.exposed ? '' : ' off'}`;
  expBtn.innerHTML = _exposedIcon();
  expBtn.title = el.exposed ? 'Hide from operator' : 'Expose to operator';
  expBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onExposedToggle) onExposedToggle(el.id);
  });
  item.appendChild(expBtn);

  // Click to select
  item.addEventListener('click', (e) => {
    if (onSelect) onSelect(el.id, { shiftKey: e.shiftKey });
  });

  // Right-click for context menu
  item.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    contextMenuTargetId = el.id;
    contextMenuTargetGroupId = null;
    if (onSelect) onSelect(el.id);
    if (onContextMenu) {
      onContextMenu(el.id, e);
    }
    _showContextMenu(e.clientX, e.clientY);
  });

  container.appendChild(item);
}

/* ================================================================ *
 *  Inline Rename (elements)
 * ================================================================ */

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

/* ================================================================ *
 *  Inline Rename (groups)
 * ================================================================ */

function _startGroupRename(rowEl, group) {
  const nameEl = rowEl.querySelector('.layer-name');
  if (!nameEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'layer-name-input';
  input.value = group.name || 'Group';

  const finish = () => {
    const newName = input.value.trim();
    if (newName && newName !== group.name && onGroupRename) {
      onGroupRename(group.id, newName);
    }
    renderLayerPanel();
  };

  input.addEventListener('blur', finish);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      input.blur();
    } else if (e.key === 'Escape') {
      input.value = group.name || 'Group';
      input.blur();
    }
  });

  nameEl.replaceWith(input);
  input.focus();
  input.select();
}

/* ================================================================ *
 *  Context Menu
 * ================================================================ */

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

    // If we right-clicked a group, handle group-level actions
    if (contextMenuTargetGroupId) {
      switch (action) {
        case 'rename':
          _triggerGroupRenameFromContextMenu(contextMenuTargetGroupId);
          break;
        case 'ungroup':
          if (onUngroup) onUngroup();
          break;
        case 'delete':
          // Forward to group-level handling if needed
          break;
      }
      _hideContextMenu();
      return;
    }

    // Element-level context menu actions
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
  contextMenuTargetGroupId = null;
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

function _triggerGroupRenameFromContextMenu(groupId) {
  if (!layerListEl) return;
  const rowEl = layerListEl.querySelector(`.layer-group-row[data-group-id="${groupId}"]`);
  if (!rowEl) return;

  // Extract group info from the row's dataset and name element
  const nameEl = rowEl.querySelector('.layer-name');
  const currentName = nameEl ? nameEl.textContent : 'Group';

  // Create a minimal group object for the rename handler
  _startGroupRename(rowEl, { id: groupId, name: currentName });
}

/* ================================================================ *
 *  Display Name
 * ================================================================ */

function _getDisplayName(el) {
  // If element has a custom name that differs from default, use it
  if (el.name && el.name !== el.type && !el.name.startsWith('Element')) {
    return el.name;
  }

  // For data elements, show binding info
  if (el.type === 'data' && el.props) {
    const source = el.props.bindingSource;
    const field = el.props.bindingField;
    if (source && field) {
      // Capitalize first letter of field name and camelCase to readable
      const readable = field.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
      return readable;
    }
  }

  return el.name || el.type;
}

/* ================================================================ *
 *  Type Icons
 * ================================================================ */

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
    case 'arcGauge':
      return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 12a6 6 0 0 1 10 0"/><path d="M8 3v1.5"/><path d="M8 8l2-2"/></svg>';
    case 'barGauge':
      return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="6" width="12" height="4" rx="1"/><rect x="2" y="6" width="7" height="4" rx="1" fill="currentColor" opacity="0.3"/></svg>';
    case 'ringSegment':
      return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a6 6 0 0 1 2.5-5"/><path d="M6.5 4.5a6 6 0 0 1 3 0"/><path d="M10.5 7a6 6 0 0 1 2.5 5"/></svg>';
    default:
      return type.charAt(0).toUpperCase();
  }
}

/* ================================================================ *
 *  Control Icons
 * ================================================================ */

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

function _exposedIcon() {
  return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 3h8v8"/><path d="M14 3L6 11"/><path d="M2 13h4v-4"/></svg>';
}

/* ================================================================ *
 *  Group / Chevron Icons
 * ================================================================ */

function _chevronRightIcon() {
  return '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></svg>';
}

function _chevronDownIcon() {
  return '<svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
}

function _folderIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v8a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5A1 1 0 005.8 3H3a1 1 0 00-1 1z"/></svg>';
}

function _folderOpenIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v8a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3.5A1 1 0 005.8 3H3a1 1 0 00-1 1z"/><path d="M2 8h12"/></svg>';
}

function _dragHandleIcon() {
  return '<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1.2"/><circle cx="6" cy="2" r="1.2"/><circle cx="2" cy="7" r="1.2"/><circle cx="6" cy="7" r="1.2"/><circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/></svg>';
}
