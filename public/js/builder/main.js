/**
 * Overlay Builder - Main entry point.
 * Initializes canvas, tools, panels, and wires together all subsystems.
 */

import { initAuth, isAuthenticated } from '/js/modules/auth.js';
import { showToast } from '/js/modules/ui.js';

import { CanvasEngine } from './canvas-engine.js';
import { SelectionManager } from './selection-manager.js';
import { DragEngine } from './drag-engine.js';
import { SnapEngine } from './snap-engine.js';
import { HistoryManager } from './history-manager.js';
import { TemplateManager } from './template-manager.js';
import {
  createTextElement,
  createImageElement,
  createShapeElement,
  createDataElement,
  cloneElement,
} from './element-factory.js';
import {
  createGroup,
  deleteGroup,
  renameGroup,
  toggleGroupExpanded,
  toggleGroupVisibility,
  toggleGroupLocked,
  getGroupMembers,
  getAllGroupDescendantElements,
  ungroupElements,
  buildLayerTree,
} from './group-manager.js';
import { resolveBindingPreview } from './data-binding.js';
import { getEnterPreset, getExitPreset, getEmphasisPreset } from '/js/shared/animation-presets.js';

import { initToolsPanel, getActiveTool, setActiveTool, handleToolShortcut } from './panels/tools-panel.js';
import { initLayerPanel, renderLayerPanel } from './panels/layer-panel.js';
import { initPropertiesPanel, updatePropertiesPanel } from './panels/properties-panel.js';
import { initDataPanel } from './panels/data-panel.js';
import { initPreviewPanel, destroyPreviewPanel } from './panels/preview-panel.js';
import { showPresetPicker, hidePresetPicker } from './panels/data-presets.js';
import { initTimelinePanel, renderTimelinePanel } from './panels/timeline-panel.js';
import { loadCustomFonts } from '/js/shared/font-loader.js';

/* ================================================================ *
 *  State
 * ================================================================ */

/** @type {object[]} Master elements array */
let elements = [];

/** @type {object[]} Master groups array (separate from elements) */
let groups = [];

/** @type {object} Timeline settings (persisted with template) */
let timelineData = {
  holdDuration: 5000,
  pausePoints: [],
  loopRegion: { enabled: false, start: 0, end: 3000 },
};

/** @type {CanvasEngine} */
let canvas;
/** @type {SelectionManager} */
let selection;
/** @type {DragEngine} */
let dragEngine;
/** @type {SnapEngine} */
let snapEngine;
/** @type {HistoryManager} */
let history;
/** @type {TemplateManager} */
let templateManager;

/* ================================================================ *
 *  Bootstrap
 * ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // Auth check
  if (!initAuth() || !isAuthenticated()) {
    window.location.href = '/';
    return;
  }

  _initCanvas();
  _initEngines();
  _initPanels();
  _initToolbar();
  _initKeyboardShortcuts();
  _initCanvasInteractions();

  // Load custom fonts from library before loading template
  loadCustomFonts().then(() => _loadFromUrl());

  // Initial history snapshot
  history.push(_snapshotState());

  console.log('Overlay Builder initialized');
});

/* ================================================================ *
 *  Initialization
 * ================================================================ */

function _initCanvas() {
  const containerEl = document.getElementById('canvasContainer');
  const wrapperEl = document.getElementById('canvasWrapper');
  canvas = new CanvasEngine(containerEl, wrapperEl);
}

function _initEngines() {
  const containerEl = document.getElementById('canvasContainer');

  snapEngine = new SnapEngine(containerEl);

  selection = new SelectionManager(containerEl, (selectedIds) => {
    _onSelectionChanged(selectedIds);
  });

  dragEngine = new DragEngine(
    canvas,
    snapEngine,
    // onUpdate: update element in real-time during drag
    (id, props) => {
      _updateElementInPlace(id, props);
      canvas.updateElement(id, props);
      const el = _getElementById(id);
      if (el) selection.updateSelectionHandles(el);
    },
    // onDragEnd: push history snapshot
    (id) => {
      _pushHistory();
      _refreshPanels();
    },
  );

  history = new HistoryManager((state) => {
    document.getElementById('btnUndo').disabled = !state.canUndo;
    document.getElementById('btnRedo').disabled = !state.canRedo;
  });

  templateManager = new TemplateManager();
}

function _initPanels() {
  // Tools
  initToolsPanel({
    onToolChange: (toolId) => {
      if (toolId !== 'select') {
        selection.deselectAll();
      }
    },
  });

  // Layers
  initLayerPanel({
    getElements: () => elements,
    getSelectedIds: () => selection.getSelected(),
    onSelect: (id, opts) => {
      if (opts?.shiftKey) {
        selection.toggleSelection(id);
      } else {
        selection.selectElement(id);
      }
      setActiveTool('select');
    },
    onReorder: (elementId, newIndex) => {
      _reorderElementToIndex(elementId, newIndex);
      _pushHistory();
    },
    onVisibilityToggle: (id) => {
      const el = _getElementById(id);
      if (el) {
        el.visible = !el.visible;
        canvas.updateElement(id, { visible: el.visible });
        _refreshPanels();
      }
    },
    onLockToggle: (id) => {
      const el = _getElementById(id);
      if (el) {
        el.locked = !el.locked;
        canvas.updateElement(id, { locked: el.locked });
        _refreshPanels();
      }
    },
    onExposedToggle: (id) => {
      const el = _getElementById(id);
      if (el) {
        el.exposed = !el.exposed;
        _refreshPanels();
      }
    },
    onDelete: (id) => {
      canvas.removeElement(id);
      elements = elements.filter(e => e.id !== id);
      selection.deselectAll();
      _pushHistory();
      _refreshPanels();
      showToast('Element deleted', 'info', 2000);
    },
    onDuplicate: (id) => {
      const original = _getElementById(id);
      if (!original) return;
      const clone = cloneElement(original);
      clone.zIndex = elements.length;
      elements.push(clone);
      canvas.addElement(clone);
      selection.selectElement(clone.id);
      _pushHistory();
      _refreshPanels();
      showToast('Element duplicated', 'info', 2000);
    },
    onRename: (id, newName) => {
      const el = _getElementById(id);
      if (el) {
        el.name = newName;
        canvas.updateElement(id, { name: newName });
        _debouncedPushHistory();
      }
    },
    onMoveToFront: (id) => _moveElementZIndex(id, 'front'),
    onMoveToBack: (id) => _moveElementZIndex(id, 'back'),
    onMoveForward: (id) => _moveElementZIndex(id, 'forward'),
    onMoveBackward: (id) => _moveElementZIndex(id, 'backward'),
    onGroup: () => _groupSelected(),
    onUngroup: () => _ungroupSelected(),
    // Group callbacks
    onGroupSelect: (groupId) => {
      // Select all elements within the group
      const memberIds = getAllGroupDescendantElements(groupId, elements, groups);
      if (memberIds.length > 0) {
        selection.multiSelect(memberIds);
      }
      setActiveTool('select');
    },
    onGroupToggle: (groupId) => {
      toggleGroupExpanded(groupId, groups);
      _refreshPanels();
    },
    onGroupVisibilityToggle: (groupId) => {
      toggleGroupVisibility(groupId, elements, groups);
      // Update canvas for all affected elements
      for (const el of elements) {
        canvas.updateElement(el.id, { visible: el.visible });
      }
      _pushHistory();
      _refreshPanels();
    },
    onGroupLockToggle: (groupId) => {
      toggleGroupLocked(groupId, elements, groups);
      // Update canvas for all affected elements
      for (const el of elements) {
        canvas.updateElement(el.id, { locked: el.locked });
      }
      _pushHistory();
      _refreshPanels();
    },
    onGroupRename: (groupId, newName) => {
      renameGroup(groupId, newName, groups);
      _debouncedPushHistory();
    },
  });

  // Properties
  initPropertiesPanel({
    getElements: () => elements,
    onPropertyChange: (id, changes) => {
      _applyPropertyChange(id, changes);
    },
    onQuickAction: (id, action) => {
      switch (action) {
        case 'duplicate': {
          const original = _getElementById(id);
          if (!original) return;
          const clone = cloneElement(original);
          clone.zIndex = elements.length;
          elements.push(clone);
          canvas.addElement(clone);
          selection.selectElement(clone.id);
          _pushHistory();
          _refreshPanels();
          showToast('Element duplicated', 'info', 2000);
          break;
        }
        case 'delete':
          _clearClipMaskRefs(id);
          canvas.removeElement(id);
          elements = elements.filter(e => e.id !== id);
          selection.deselectAll();
          _pushHistory();
          _refreshPanels();
          showToast('Element deleted', 'info', 2000);
          break;
        case 'visibility': {
          const el = _getElementById(id);
          if (el) {
            el.visible = !el.visible;
            canvas.updateElement(id, { visible: el.visible });
            _refreshPanels();
          }
          break;
        }
        case 'lock': {
          const el = _getElementById(id);
          if (el) {
            el.locked = !el.locked;
            canvas.updateElement(id, { locked: el.locked });
            _refreshPanels();
          }
          break;
        }
        case 'front':
        case 'back':
          _moveElementZIndex(id, action);
          break;
        case 'previewAnimation': {
          const el = _getElementById(id);
          const node = canvas.getNode(id);
          if (el && node && el.animation?.enter?.type && el.animation.enter.type !== 'none') {
            _previewGsapEnter(node, el.animation.enter);
          }
          break;
        }
        case 'previewExitAnimation': {
          const el = _getElementById(id);
          const node = canvas.getNode(id);
          if (el && node && el.animation?.exit?.type && el.animation.exit.type !== 'none') {
            _previewGsapExit(node, el.animation.exit);
          }
          break;
        }
        case 'previewEmphasis': {
          const el = _getElementById(id);
          const node = canvas.getNode(id);
          if (el && node && el.animation?.emphasis?.type && el.animation.emphasis.type !== 'none') {
            _previewGsapEmphasis(node, el.animation.emphasis);
          }
          break;
        }
      }
    },
  });

  // Data
  initDataPanel({
    onBindingChange: (id, changes) => {
      _applyPropertyChange(id, changes);
    },
  });

  // Preview
  initPreviewPanel({
    getElements: () => elements,
    onDataUpdate: (id, changes) => {
      _updateElementInPlace(id, changes);
      canvas.updateElement(id, changes);
    },
  });

  // Timeline
  initTimelinePanel({
    getElements: () => elements,
    getTimeline: () => timelineData,
    onTimelineChange: (changes) => {
      Object.assign(timelineData, changes);
    },
    onAnimationChange: (id, animChanges) => {
      _applyPropertyChange(id, { animation: animChanges });
    },
    onElementSelect: (id) => {
      selection.selectElement(id);
      setActiveTool('select');
    },
  });

}

function _initToolbar() {
  // Save
  document.getElementById('btnSave').addEventListener('click', () => _save());

  // Undo / Redo
  document.getElementById('btnUndo').addEventListener('click', () => _undo());
  document.getElementById('btnRedo').addEventListener('click', () => _redo());

  // Zoom
  document.getElementById('btnZoomIn').addEventListener('click', () => {
    const z = canvas.setZoom(canvas.getZoom() + 0.1);
    _updateZoomDisplay(z);
  });
  document.getElementById('btnZoomOut').addEventListener('click', () => {
    const z = canvas.setZoom(canvas.getZoom() - 0.1);
    _updateZoomDisplay(z);
  });
  document.getElementById('btnZoomFit').addEventListener('click', () => {
    _zoomToFit();
  });

  // Snap toggle
  const snapBtn = document.getElementById('btnSnap');
  if (snapBtn) {
    snapBtn.addEventListener('click', () => {
      snapEngine.enabled = !snapEngine.enabled;
      snapBtn.classList.toggle('active', snapEngine.enabled);
      snapBtn.title = snapEngine.enabled ? 'Snapping On (click to disable)' : 'Snapping Off (click to enable)';
    });
  }

  // Group / Ungroup
  document.getElementById('btnGroupLayers').addEventListener('click', () => _groupSelected());
  document.getElementById('btnUngroupLayers').addEventListener('click', () => _ungroupSelected());

}

function _initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

    // Ctrl+S: Save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      _save();
      return;
    }

    // Ctrl+Z: Undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      _undo();
      return;
    }

    // Ctrl+Shift+Z: Redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
      e.preventDefault();
      _redo();
      return;
    }

    // Ctrl+D: Duplicate
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      _duplicateSelected();
      return;
    }

    // Ctrl+G: Group
    if ((e.ctrlKey || e.metaKey) && e.key === 'g' && !e.shiftKey) {
      e.preventDefault();
      _groupSelected();
      return;
    }

    // Ctrl+Shift+G: Ungroup
    if ((e.ctrlKey || e.metaKey) && e.key === 'g' && e.shiftKey) {
      e.preventDefault();
      _ungroupSelected();
      return;
    }

    // Don't handle shortcuts if typing in an input
    if (isInput) return;

    // Delete / Backspace: Remove
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      _deleteSelected();
      return;
    }

    // Escape: Deselect
    if (e.key === 'Escape') {
      selection.deselectAll();
      setActiveTool('select');
      return;
    }

    // Arrow keys: Move selected elements
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const selectedIds = selection.getSelected();
      if (selectedIds.length > 0) {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.1; // 1% with shift, 0.1% without
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;

        for (const id of selectedIds) {
          const el = _getElementById(id);
          if (el && !el.locked) {
            el.x = Math.round((el.x + dx) * 10) / 10;
            el.y = Math.round((el.y + dy) * 10) / 10;
            canvas.updateElement(id, { x: el.x, y: el.y });
          }
        }
        _refreshPanels();
        _pushHistory();
        return;
      }
    }

    // Tool shortcuts (single letter keys)
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      handleToolShortcut(e.key.toLowerCase());
    }
  });
}

function _initCanvasInteractions() {
  const containerEl = document.getElementById('canvasContainer');

  containerEl.addEventListener('mousedown', (e) => {
    const tool = getActiveTool();

    if (tool !== 'select') {
      // Creation tools: create element at click position
      _createElementAtMouse(tool, e);
      return;
    }

    // Check if we clicked on a selection handle
    const handleEl = e.target.closest('[data-handle]');
    if (handleEl) {
      const handleType = handleEl.dataset.handle;
      const selectedId = selection.getSingleSelected();
      const el = selectedId ? _getElementById(selectedId) : null;
      if (el) {
        if (handleType === 'rotate') {
          dragEngine.startRotate(el, e);
        } else {
          dragEngine.startResize(el, handleType, e);
        }
        return;
      }
    }

    // Check if we clicked on a canvas element
    const elementNode = e.target.closest('.canvas-element');
    if (elementNode) {
      const id = elementNode.dataset.elementId;
      const el = _getElementById(id);
      if (!el) return;

      // If element is locked, don't allow interaction
      if (el.locked) return;

      // Multi-select with Shift
      if (e.shiftKey) {
        selection.toggleSelection(id);
      } else {
        // If clicking on an element in a group, select all group members (including nested)
        if (el.groupId) {
          const groupMembers = getAllGroupDescendantElements(el.groupId, elements, groups);
          selection.multiSelect(groupMembers);
        } else {
          selection.selectElement(id);
        }
      }

      // Start drag
      dragEngine.startDrag(el, e);
      return;
    }

    // Clicked on empty canvas: deselect
    selection.deselectAll();
  });

  // Mouse wheel zoom on canvas area
  document.getElementById('canvasArea').addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      const z = canvas.setZoom(canvas.getZoom() + delta);
      _updateZoomDisplay(z);
    }
  }, { passive: false });

  // Spacebar-to-pan: hold spacebar + drag to scroll the canvas area
  _initSpacebarPan();
}

/* ================================================================ *
 *  Spacebar Pan
 * ================================================================ */

function _initSpacebarPan() {
  const canvasArea = document.getElementById('canvasArea');
  let isPanning = false;
  let spaceHeld = false;
  let panStart = { x: 0, y: 0 };
  let scrollStart = { x: 0, y: 0 };

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && !_isInputFocused()) {
      e.preventDefault();
      spaceHeld = true;
      canvasArea.style.cursor = 'grab';
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceHeld = false;
      isPanning = false;
      canvasArea.style.cursor = '';
    }
  });

  canvasArea.addEventListener('mousedown', (e) => {
    if (spaceHeld) {
      e.preventDefault();
      e.stopPropagation();
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      scrollStart = { x: canvasArea.scrollLeft, y: canvasArea.scrollTop };
      canvasArea.style.cursor = 'grabbing';
    }
  }, true); // capture phase to intercept before element interactions

  document.addEventListener('mousemove', (e) => {
    if (isPanning) {
      canvasArea.scrollLeft = scrollStart.x - (e.clientX - panStart.x);
      canvasArea.scrollTop = scrollStart.y - (e.clientY - panStart.y);
    }
  });

  document.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      canvasArea.style.cursor = spaceHeld ? 'grab' : '';
    }
  });
}

function _isInputFocused() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.contentEditable === 'true');
}

/* ================================================================ *
 *  Element operations
 * ================================================================ */

function _createElementAtMouse(tool, event) {
  const pos = canvas.screenToCanvas(event.clientX, event.clientY);
  let el;

  switch (tool) {
    case 'text':
      el = createTextElement(pos.x, pos.y);
      break;
    case 'image':
      el = createImageElement(pos.x, pos.y);
      break;
    case 'shape':
      el = createShapeElement(pos.x, pos.y);
      break;
    case 'data':
      // Show preset picker instead of immediately creating
      _showDataPresetPicker(pos);
      return; // Don't fall through to the rest of the function
    default:
      return;
  }

  // Assign z-index based on current count
  el.zIndex = elements.length;

  elements.push(el);
  canvas.addElement(el);
  _pushHistory();

  // Switch back to select tool and select the new element
  setActiveTool('select');
  selection.selectElement(el.id);

  showToast(`${el.type} element created`, 'info', 2000);
}

/**
 * Show the data preset picker and create a data element based on the user's choice.
 * @param {{ x: number, y: number }} pos - Canvas position where the element should be placed.
 */
function _showDataPresetPicker(pos) {
  const canvasArea = document.getElementById('canvasArea');

  showPresetPicker(
    canvasArea,
    // onSelect: create a data element pre-filled with preset bindings
    (preset) => {
      const el = createDataElement(pos.x, pos.y);

      // Override props with preset values
      el.props.bindingSource = preset.source;
      el.props.bindingField = preset.field;
      el.props.format = preset.format;
      el.props.fallback = preset.fallback;
      el.props.fontSize = preset.defaultFontSize;
      if (preset.car) el.props.carSelector = preset.car;

      // Override top-level properties
      el.width = preset.defaultWidth;
      el.name = preset.label;

      // Set preview value
      el.props._previewValue = resolveBindingPreview(el.props);

      // Add to canvas
      el.zIndex = elements.length;
      elements.push(el);
      canvas.addElement(el);
      _pushHistory();

      // Switch to select tool and select the new element
      setActiveTool('select');
      selection.selectElement(el.id);

      showToast(`${el.name} data element created`, 'info', 2000);
    },
    // onCustom: create a raw data element with default bindings
    () => {
      const el = createDataElement(pos.x, pos.y);
      el.props._previewValue = resolveBindingPreview(el.props);

      el.zIndex = elements.length;
      elements.push(el);
      canvas.addElement(el);
      _pushHistory();

      setActiveTool('select');
      selection.selectElement(el.id);

      showToast('data element created', 'info', 2000);
    },
  );
}

function _deleteSelected() {
  const selectedIds = selection.getSelected();
  if (selectedIds.length === 0) return;

  for (const id of selectedIds) {
    // Clear clipMask references pointing to this element
    _clearClipMaskRefs(id);
    canvas.removeElement(id);
    elements = elements.filter(e => e.id !== id);
  }

  selection.deselectAll();
  _pushHistory();
  _refreshPanels();
  showToast('Element(s) deleted', 'info', 2000);
}

/** Clear clipMask references to a deleted element across all remaining elements. */
function _clearClipMaskRefs(deletedId) {
  for (const el of elements) {
    if (el.clipMask?.elementId === deletedId) {
      el.clipMask = null;
      canvas.updateElement(el.id, { clipMask: null });
    }
  }
}

function _duplicateSelected() {
  const selectedIds = selection.getSelected();
  if (selectedIds.length === 0) return;

  const newIds = [];
  for (const id of selectedIds) {
    const original = _getElementById(id);
    if (!original) continue;
    const clone = cloneElement(original);
    clone.zIndex = elements.length;
    elements.push(clone);
    canvas.addElement(clone);
    newIds.push(clone.id);
  }

  selection.multiSelect(newIds);
  _pushHistory();
  _refreshPanels();
  showToast('Element(s) duplicated', 'info', 2000);
}

function _groupSelected() {
  const selectedIds = selection.getSelected();
  if (selectedIds.length < 2) {
    showToast('Select 2 or more elements to group', 'warning', 3000);
    return;
  }
  const group = createGroup('Group', selectedIds, elements, groups);
  _pushHistory();
  _refreshPanels();
  showToast(`Grouped into "${group.name}"`, 'info', 2000);
}

function _ungroupSelected() {
  const selectedIds = selection.getSelected();
  if (selectedIds.length === 0) return;

  // Collect unique group IDs from selected elements
  const groupIdsToDissolve = new Set();
  for (const id of selectedIds) {
    const el = _getElementById(id);
    if (el && el.groupId) {
      groupIdsToDissolve.add(el.groupId);
    }
  }

  for (const groupId of groupIdsToDissolve) {
    ungroupElements(groupId, elements, groups);
  }

  _pushHistory();
  _refreshPanels();
  showToast('Elements ungrouped', 'info', 2000);
}

function _applyPropertyChange(id, changes) {
  _updateElementInPlace(id, changes);
  canvas.updateElement(id, changes);

  const el = _getElementById(id);
  if (el) {
    selection.updateSelectionHandles(el);
  }

  // Don't push history on every keystroke; debounce
  _debouncedPushHistory();
  renderLayerPanel(elements, groups);
  renderTimelinePanel();
}

function _reorderElementToIndex(elementId, targetIndex) {
  // Re-assign z-indices so that elementId ends up at targetIndex position
  const sorted = [...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const fromIdx = sorted.findIndex(e => e.id === elementId);
  if (fromIdx === -1 || fromIdx === targetIndex) return;

  const [moved] = sorted.splice(fromIdx, 1);
  sorted.splice(targetIndex, 0, moved);

  // Re-assign z-indices
  sorted.forEach((el, i) => {
    el.zIndex = i;
    canvas.reorderElement(el.id, i);
  });

  _refreshPanels();
}

/**
 * Move an element's z-index (front, back, forward, backward).
 * @param {string} elementId
 * @param {'front'|'back'|'forward'|'backward'} direction
 */
function _moveElementZIndex(elementId, direction) {
  const sorted = [...elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  const idx = sorted.findIndex(e => e.id === elementId);
  if (idx === -1) return;

  let targetIndex;
  switch (direction) {
    case 'front':
      targetIndex = sorted.length - 1;
      break;
    case 'back':
      targetIndex = 0;
      break;
    case 'forward':
      targetIndex = Math.min(idx + 1, sorted.length - 1);
      break;
    case 'backward':
      targetIndex = Math.max(idx - 1, 0);
      break;
    default:
      return;
  }

  if (targetIndex === idx) return;

  const [moved] = sorted.splice(idx, 1);
  sorted.splice(targetIndex, 0, moved);

  sorted.forEach((el, i) => {
    el.zIndex = i;
    canvas.reorderElement(el.id, i);
  });

  _pushHistory();
  _refreshPanels();
}


/* ================================================================ *
 *  History
 * ================================================================ */

/** Deep-clone the current elements + groups for history snapshots. */
function _snapshotState() {
  return {
    elements: JSON.parse(JSON.stringify(elements)),
    groups: JSON.parse(JSON.stringify(groups)),
  };
}

function _pushHistory() {
  history.push(_snapshotState());
}

let _historyDebounceTimer = null;
function _debouncedPushHistory() {
  if (_historyDebounceTimer) clearTimeout(_historyDebounceTimer);
  _historyDebounceTimer = setTimeout(() => _pushHistory(), 500);
}

function _undo() {
  const state = history.undo();
  if (state) {
    _restoreState(state);
    showToast('Undo', 'info', 1500);
  }
}

function _redo() {
  const state = history.redo();
  if (state) {
    _restoreState(state);
    showToast('Redo', 'info', 1500);
  }
}

function _restoreState(state) {
  // Support both old format (array) and new format ({ elements, groups })
  if (Array.isArray(state)) {
    elements = state;
    groups = [];
  } else {
    elements = state.elements || [];
    groups = state.groups || [];
  }
  canvas.loadElements(elements);
  selection.deselectAll();
  _refreshPanels();
}

/* ================================================================ *
 *  Save / Load
 * ================================================================ */

async function _save() {
  const name = document.getElementById('templateName').value.trim() || 'Untitled Template';
  const type = document.getElementById('templateType').value;
  const { width, height } = canvas.canvasSize;

  try {
    await templateManager.save(name, type, elements, groups, width, height, timelineData);
    showToast('Template saved', 'success');

    // Update URL with template ID if new
    if (templateManager.currentId) {
      window.history.replaceState({}, '', `/builder/${templateManager.currentId}`);
    }
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
    console.error('Save error:', err);
  }
}

async function _loadFromUrl() {
  // Support both /builder/:id path and ?id=N query param
  const pathMatch = window.location.pathname.match(/\/builder\/(\d+)/);
  const id = pathMatch ? pathMatch[1] : new URLSearchParams(window.location.search).get('id');

  if (!id) {
    // No template specified — redirect to templates page
    window.location.href = '/templates';
    return;
  }

  try {
    const template = await templateManager.load(id);
    document.getElementById('templateName').value = template.name || 'Untitled';
    document.getElementById('templateType').value = template.type || 'custom';
    elements = template.elements || [];
    groups = Array.isArray(template.groups) ? template.groups : [];
    timelineData = template.timeline || { holdDuration: 5000, pausePoints: [], loopRegion: { enabled: false, start: 0, end: 3000 } };

    elements.forEach((el, i) => {
      if (el.zIndex === undefined) el.zIndex = i;
    });

    canvas.loadElements(elements);
    history.clear();
    history.push(_snapshotState());
    _refreshPanels();
    showToast(`Loaded "${template.name}"`, 'success');
  } catch (err) {
    showToast(`Failed to load template: ${err.message}`, 'error');
    console.error('Load error:', err);
  }
}

/* ================================================================ *
 *  Selection / Panel refresh
 * ================================================================ */

function _onSelectionChanged(selectedIds) {
  // Show/hide selection handles
  selection.clearSelectionHandles();

  if (selectedIds.length === 1) {
    const el = _getElementById(selectedIds[0]);
    const node = canvas.getNode(selectedIds[0]);
    if (el && node) {
      selection.renderSelectionHandles(el, node);
      updatePropertiesPanel(el);
    }
  } else {
    updatePropertiesPanel(null);
  }

  renderLayerPanel(elements, groups);
}

function _refreshPanels() {
  renderLayerPanel(elements, groups);
  renderTimelinePanel();

  const selectedIds = selection.getSelected();
  if (selectedIds.length === 1) {
    const el = _getElementById(selectedIds[0]);
    updatePropertiesPanel(el || null);
  } else {
    updatePropertiesPanel(null);
  }
}

/* ================================================================ *
 *  Zoom
 * ================================================================ */

function _updateZoomDisplay(zoom) {
  document.getElementById('zoomDisplay').textContent = `${Math.round(zoom * 100)}%`;
}

function _zoomToFit() {
  const area = document.getElementById('canvasArea');
  const areaRect = area.getBoundingClientRect();
  const padding = 40;
  const scaleX = (areaRect.width - padding * 2) / 1920;
  const scaleY = (areaRect.height - padding * 2) / 1080;
  const z = canvas.setZoom(Math.min(scaleX, scaleY));
  _updateZoomDisplay(z);
}

/* ================================================================ *
 *  Helpers
 * ================================================================ */

function _getElementById(id) {
  return elements.find(e => e.id === id) || null;
}

function _updateElementInPlace(id, changes) {
  const el = _getElementById(id);
  if (!el) return;

  for (const [key, value] of Object.entries(changes)) {
    if (key === 'props' && typeof value === 'object') {
      el.props = { ...el.props, ...value };
    } else if (key === 'animation' && typeof value === 'object') {
      // Deep merge animation sub-objects (enter, exit, update, emphasis)
      el.animation = el.animation || {};
      for (const [sub, subVal] of Object.entries(value)) {
        el.animation[sub] = { ...(el.animation[sub] || {}), ...subVal };
      }
    } else {
      el[key] = value;
    }
  }
}

/* ================================================================ *
 *  GSAP Preview Helpers
 * ================================================================ */

function _previewGsapEnter(node, enterConfig) {
  const preset = getEnterPreset(enterConfig.type);
  if (!preset) return;

  const duration = (enterConfig.duration || 300) / 1000;
  const easing = enterConfig.easing || 'power2.out';

  // Kill any active preview tweens on this node
  gsap.killTweensOf(node);

  // Only clear the properties the preset animates, not 'all',
  // so canvas-engine positioning styles are preserved.
  const safeClearProps = preset.clearProps || Object.keys(preset.vars).join(',');

  gsap.from(node, {
    ...preset.vars,
    duration,
    ease: easing,
    clearProps: safeClearProps,
  });
}

function _previewGsapExit(node, exitConfig) {
  const preset = getExitPreset(exitConfig.type);
  if (!preset) return;

  const duration = (exitConfig.duration || 300) / 1000;
  const easing = exitConfig.easing || 'power2.in';

  gsap.killTweensOf(node);

  const safeClearProps = preset.clearProps || Object.keys(preset.vars).join(',');

  // Animate to the exit state, then snap back
  gsap.to(node, {
    ...preset.vars,
    duration,
    ease: easing,
    onComplete: () => {
      gsap.set(node, { clearProps: safeClearProps });
    },
  });
}

function _previewGsapEmphasis(node, emphasisConfig) {
  const preset = getEmphasisPreset(emphasisConfig.type);
  if (!preset) return;

  gsap.killTweensOf(node);

  const tl = gsap.timeline();
  for (const frame of preset.keyframes) {
    const { duration: frameDur, ease: frameEase, ...props } = frame;
    tl.to(node, {
      ...props,
      duration: frameDur || 0.15,
      ease: frameEase || 'none',
    });
  }
}
