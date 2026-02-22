/**
 * Manages element selection state and renders visual selection handles.
 */

export class SelectionManager {
  /** @type {Set<string>} */
  #selected = new Set();
  /** @type {HTMLElement} */
  #container;
  /** @type {HTMLElement|null} */
  #selectionOverlay = null;
  /** @type {Function|null} */
  #onSelectionChange = null;

  /**
   * @param {HTMLElement} canvasContainer - The .canvas-container element
   * @param {Function} [onSelectionChange] - Callback when selection changes
   */
  constructor(canvasContainer, onSelectionChange = null) {
    this.#container = canvasContainer;
    this.#onSelectionChange = onSelectionChange;
  }

  /**
   * Select a single element, deselecting all others.
   * @param {string} id
   */
  selectElement(id) {
    this.#selected.clear();
    this.#selected.add(id);
    this.#notifyChange();
  }

  /**
   * Add element to multi-selection.
   * @param {string} id
   */
  addToSelection(id) {
    this.#selected.add(id);
    this.#notifyChange();
  }

  /**
   * Toggle an element in the selection.
   * @param {string} id
   */
  toggleSelection(id) {
    if (this.#selected.has(id)) {
      this.#selected.delete(id);
    } else {
      this.#selected.add(id);
    }
    this.#notifyChange();
  }

  /**
   * Select multiple elements.
   * @param {string[]} ids
   */
  multiSelect(ids) {
    this.#selected.clear();
    for (const id of ids) {
      this.#selected.add(id);
    }
    this.#notifyChange();
  }

  /**
   * Deselect all elements.
   */
  deselectAll() {
    this.#selected.clear();
    this.clearSelectionHandles();
    this.#notifyChange();
  }

  /**
   * Returns array of currently selected element IDs.
   * @returns {string[]}
   */
  getSelected() {
    return Array.from(this.#selected);
  }

  /**
   * Check if an element is selected.
   * @param {string} id
   * @returns {boolean}
   */
  isSelected(id) {
    return this.#selected.has(id);
  }

  /**
   * Returns the single selected ID (or null if 0 or 2+).
   * @returns {string|null}
   */
  getSingleSelected() {
    return this.#selected.size === 1 ? Array.from(this.#selected)[0] : null;
  }

  /**
   * Render selection handles (blue border + 8 resize handles + rotation handle)
   * around the given element's DOM node.
   * @param {object} element - The element data
   * @param {HTMLElement} node - The element's DOM node
   */
  renderSelectionHandles(element, node) {
    this.clearSelectionHandles();

    if (!node) return;

    this.#selectionOverlay = document.createElement('div');
    this.#selectionOverlay.className = 'selection-overlay';
    this.#selectionOverlay.style.cssText = `
      position: absolute;
      left: ${element.x}%;
      top: ${element.y}%;
      width: ${element.width}%;
      height: ${element.height}%;
      pointer-events: none;
      z-index: 9000;
    `;

    if (element.rotation) {
      this.#selectionOverlay.style.transform = `rotate(${element.rotation}deg)`;
    }

    // Blue selection border
    const outline = document.createElement('div');
    outline.className = 'selection-outline';
    outline.style.cssText = 'inset: 0; position: absolute;';
    this.#selectionOverlay.appendChild(outline);

    // Rotation line + handle
    const rotLine = document.createElement('div');
    rotLine.className = 'rotation-line';
    this.#selectionOverlay.appendChild(rotLine);

    const rotHandle = document.createElement('div');
    rotHandle.className = 'rotation-handle';
    rotHandle.dataset.handle = 'rotate';
    this.#selectionOverlay.appendChild(rotHandle);

    // 8 resize handles
    const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    for (const pos of handles) {
      const handle = document.createElement('div');
      handle.className = `selection-handle ${pos}`;
      handle.dataset.handle = pos;
      this.#selectionOverlay.appendChild(handle);
    }

    this.#container.appendChild(this.#selectionOverlay);
  }

  /**
   * Render a unified selection box for multiple selected elements.
   * Shows only a blue outline without resize/rotation handles.
   * @param {{x: number, y: number, width: number, height: number, rotation: number}} boundingBox
   */
  renderMultiSelectionBox(boundingBox) {
    this.clearSelectionHandles();

    if (!boundingBox) return;

    this.#selectionOverlay = document.createElement('div');
    this.#selectionOverlay.className = 'selection-overlay multi-selection';
    this.#selectionOverlay.style.cssText = `
      position: absolute;
      left: ${boundingBox.x}%;
      top: ${boundingBox.y}%;
      width: ${boundingBox.width}%;
      height: ${boundingBox.height}%;
      pointer-events: none;
      z-index: 9000;
    `;

    if (boundingBox.rotation) {
      this.#selectionOverlay.style.transform = `rotate(${boundingBox.rotation}deg)`;
    }

    // Blue selection border only (no handles for multi-selection)
    const outline = document.createElement('div');
    outline.className = 'selection-outline';
    outline.style.cssText = 'inset: 0; position: absolute;';
    this.#selectionOverlay.appendChild(outline);

    this.#container.appendChild(this.#selectionOverlay);
  }

  /**
   * Update the position/size of the selection handles to match element.
   * @param {object} element
   */
  updateSelectionHandles(element) {
    if (!this.#selectionOverlay) return;
    this.#selectionOverlay.style.left = `${element.x}%`;
    this.#selectionOverlay.style.top = `${element.y}%`;
    this.#selectionOverlay.style.width = `${element.width}%`;
    this.#selectionOverlay.style.height = `${element.height}%`;
    if (element.rotation) {
      this.#selectionOverlay.style.transform = `rotate(${element.rotation}deg)`;
    } else {
      this.#selectionOverlay.style.transform = '';
    }
  }

  /**
   * Remove all selection handle visuals from the canvas.
   */
  clearSelectionHandles() {
    if (this.#selectionOverlay) {
      this.#selectionOverlay.remove();
      this.#selectionOverlay = null;
    }
  }

  /**
   * Get the selection overlay element (for handle hit-testing).
   * @returns {HTMLElement|null}
   */
  getOverlay() {
    return this.#selectionOverlay;
  }

  /**
   * Set the selection change callback.
   * @param {Function} fn
   */
  onSelectionChanged(fn) {
    this.#onSelectionChange = fn;
  }

  #notifyChange() {
    if (this.#onSelectionChange) {
      this.#onSelectionChange(this.getSelected());
    }
  }
}
