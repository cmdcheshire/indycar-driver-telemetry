/**
 * Handles drag, resize, and rotate interactions on canvas elements.
 * All positioning is done in canvas percentage coordinates.
 */

export class DragEngine {
  /** @type {import('./canvas-engine.js').CanvasEngine} */
  #canvas;
  /** @type {import('./snap-engine.js').SnapEngine} */
  #snapEngine;
  /** @type {Function} */
  #onUpdate;
  /** @type {Function} */
  #onDragEnd;

  // Active operation state
  #active = false;
  #mode = null; // 'drag' | 'resize' | 'rotate'
  #elementId = null;
  #handle = null;
  #startMouse = { x: 0, y: 0 };
  #startElement = { x: 0, y: 0, width: 0, height: 0, rotation: 0 };

  // Bound event handlers
  #onMouseMove = null;
  #onMouseUp = null;

  /**
   * @param {import('./canvas-engine.js').CanvasEngine} canvasEngine
   * @param {import('./snap-engine.js').SnapEngine} snapEngine
   * @param {Function} onUpdate - Called with (id, updatedProps) during drag
   * @param {Function} onDragEnd - Called with (id) when drag completes
   */
  constructor(canvasEngine, snapEngine, onUpdate, onDragEnd) {
    this.#canvas = canvasEngine;
    this.#snapEngine = snapEngine;
    this.#onUpdate = onUpdate;
    this.#onDragEnd = onDragEnd;

    this.#onMouseMove = this.#handleMouseMove.bind(this);
    this.#onMouseUp = this.#handleMouseUp.bind(this);
  }

  /** @returns {boolean} Whether a drag operation is active */
  get isActive() {
    return this.#active;
  }

  /**
   * Begin dragging (moving) an element.
   * @param {object} element - Element data object
   * @param {MouseEvent} event
   */
  startDrag(element, event) {
    if (element.locked) return;
    this.#begin('drag', element, event);
  }

  /**
   * Begin resizing an element.
   * @param {object} element - Element data object
   * @param {string} handle - nw | n | ne | e | se | s | sw | w
   * @param {MouseEvent} event
   */
  startResize(element, handle, event) {
    if (element.locked) return;
    this.#handle = handle;
    this.#begin('resize', element, event);
  }

  /**
   * Begin rotating an element.
   * @param {object} element - Element data object
   * @param {MouseEvent} event
   */
  startRotate(element, event) {
    if (element.locked) return;
    this.#begin('rotate', element, event);
  }

  /**
   * Cancel any active operation.
   */
  cancel() {
    this.#cleanup();
  }

  /* -------------------------------------------------- *
   *  Private
   * -------------------------------------------------- */

  #begin(mode, element, event) {
    event.preventDefault();
    event.stopPropagation();

    this.#active = true;
    this.#mode = mode;
    this.#elementId = element.id;
    this.#startMouse = this.#canvas.screenToCanvas(event.clientX, event.clientY);
    this.#startElement = {
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      rotation: element.rotation || 0,
    };

    document.addEventListener('mousemove', this.#onMouseMove);
    document.addEventListener('mouseup', this.#onMouseUp);
    document.body.style.cursor = this.#getCursor();
  }

  #handleMouseMove(event) {
    if (!this.#active) return;

    const mouse = this.#canvas.screenToCanvas(event.clientX, event.clientY);
    const dx = mouse.x - this.#startMouse.x;
    const dy = mouse.y - this.#startMouse.y;

    switch (this.#mode) {
      case 'drag':
        this.#processDrag(dx, dy);
        break;
      case 'resize':
        this.#processResize(dx, dy);
        break;
      case 'rotate':
        this.#processRotate(mouse);
        break;
    }
  }

  #handleMouseUp() {
    if (!this.#active) return;
    const id = this.#elementId;
    this.#cleanup();
    this.#snapEngine.clearGuides();
    if (this.#onDragEnd) {
      this.#onDragEnd(id);
    }
  }

  #processDrag(dx, dy) {
    let newX = this.#startElement.x + dx;
    let newY = this.#startElement.y + dy;

    // Snap
    const allElements = this.#canvas.getElements();
    const targets = this.#snapEngine.getSnapTargets(this.#elementId, allElements);

    const snappedX = this.#snapEngine.snap(newX, targets.x);
    const snappedXRight = this.#snapEngine.snap(newX + this.#startElement.width, targets.x);
    const snappedXCenter = this.#snapEngine.snap(newX + this.#startElement.width / 2, targets.x);

    const snappedY = this.#snapEngine.snap(newY, targets.y);
    const snappedYBottom = this.#snapEngine.snap(newY + this.#startElement.height, targets.y);
    const snappedYCenter = this.#snapEngine.snap(newY + this.#startElement.height / 2, targets.y);

    let guidesX = null;
    let guidesY = null;

    // Apply closest snap
    if (snappedX !== null) { newX = snappedX; guidesX = snappedX; }
    else if (snappedXCenter !== null) { newX = snappedXCenter - this.#startElement.width / 2; guidesX = snappedXCenter; }
    else if (snappedXRight !== null) { newX = snappedXRight - this.#startElement.width; guidesX = snappedXRight; }

    if (snappedY !== null) { newY = snappedY; guidesY = snappedY; }
    else if (snappedYCenter !== null) { newY = snappedYCenter - this.#startElement.height / 2; guidesY = snappedYCenter; }
    else if (snappedYBottom !== null) { newY = snappedYBottom - this.#startElement.height; guidesY = snappedYBottom; }

    this.#snapEngine.renderGuides(guidesX, guidesY);

    this.#onUpdate(this.#elementId, { x: newX, y: newY });
  }

  #processResize(dx, dy) {
    const s = this.#startElement;
    let { x, y, width, height } = s;
    const minSize = 1; // 1% minimum

    switch (this.#handle) {
      case 'se':
        width = Math.max(minSize, s.width + dx);
        height = Math.max(minSize, s.height + dy);
        break;
      case 'sw':
        x = s.x + dx;
        width = Math.max(minSize, s.width - dx);
        height = Math.max(minSize, s.height + dy);
        break;
      case 'ne':
        width = Math.max(minSize, s.width + dx);
        height = Math.max(minSize, s.height - dy);
        y = s.y + dy;
        break;
      case 'nw':
        x = s.x + dx;
        y = s.y + dy;
        width = Math.max(minSize, s.width - dx);
        height = Math.max(minSize, s.height - dy);
        break;
      case 'n':
        y = s.y + dy;
        height = Math.max(minSize, s.height - dy);
        break;
      case 's':
        height = Math.max(minSize, s.height + dy);
        break;
      case 'e':
        width = Math.max(minSize, s.width + dx);
        break;
      case 'w':
        x = s.x + dx;
        width = Math.max(minSize, s.width - dx);
        break;
    }

    this.#onUpdate(this.#elementId, { x, y, width, height });
  }

  #processRotate(mouse) {
    const el = this.#startElement;
    const centerX = el.x + el.width / 2;
    const centerY = el.y + el.height / 2;

    const angle = Math.atan2(mouse.y - centerY, mouse.x - centerX);
    let degrees = (angle * 180) / Math.PI + 90; // +90 because 0deg is "up"

    // Snap to 15-degree increments when close
    const snapped = Math.round(degrees / 15) * 15;
    if (Math.abs(degrees - snapped) < 3) {
      degrees = snapped;
    }

    // Normalize to 0-360
    degrees = ((degrees % 360) + 360) % 360;

    this.#onUpdate(this.#elementId, { rotation: Math.round(degrees * 10) / 10 });
  }

  #getCursor() {
    switch (this.#mode) {
      case 'drag': return 'move';
      case 'resize': return `${this.#handle}-resize`;
      case 'rotate': return 'grabbing';
      default: return 'default';
    }
  }

  #cleanup() {
    this.#active = false;
    this.#mode = null;
    this.#elementId = null;
    this.#handle = null;
    document.removeEventListener('mousemove', this.#onMouseMove);
    document.removeEventListener('mouseup', this.#onMouseUp);
    document.body.style.cursor = '';
  }
}
