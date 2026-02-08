/**
 * DOM-based canvas engine for the overlay builder.
 * Manages element rendering, positioning, and zoom within a 16:9 canvas.
 */

export class CanvasEngine {
  /** @type {HTMLElement} */
  #container;
  /** @type {HTMLElement} */
  #wrapper;
  /** @type {Map<string, {element: object, node: HTMLElement}>} */
  #elements = new Map();
  /** @type {number} */
  #zoom = 1;
  /** @type {number} Canvas logical width in px */
  #canvasWidth = 1920;
  /** @type {number} Canvas logical height in px */
  #canvasHeight = 1080;

  /**
   * @param {HTMLElement} containerEl - The .canvas-container element
   * @param {HTMLElement} wrapperEl  - The .canvas-wrapper element (receives zoom transform)
   */
  constructor(containerEl, wrapperEl) {
    this.#container = containerEl;
    this.#wrapper = wrapperEl;
    this.#container.style.width = `${this.#canvasWidth}px`;
    this.#container.style.height = `${this.#canvasHeight}px`;
    this.setZoom(0.5); // Start at 50% so 1920x1080 fits most screens
  }

  /* -------------------------------------------------- *
   *  Element CRUD
   * -------------------------------------------------- */

  /**
   * Add an element to the canvas and render its DOM node.
   * @param {object} element
   */
  addElement(element) {
    const node = this.#createNode(element);
    this.#container.appendChild(node);
    this.#elements.set(element.id, { element: { ...element }, node });
    this.#applyStyles(element, node);
  }

  /**
   * Remove an element by id.
   * @param {string} id
   */
  removeElement(id) {
    const entry = this.#elements.get(id);
    if (!entry) return;
    entry.node.remove();
    this.#elements.delete(id);
  }

  /**
   * Update an existing element's properties and re-render.
   * @param {string} id
   * @param {object} props - Partial properties to merge
   */
  updateElement(id, props) {
    const entry = this.#elements.get(id);
    if (!entry) return;
    Object.assign(entry.element, props);
    if (props.props) {
      entry.element.props = { ...entry.element.props, ...props.props };
    }
    this.#applyStyles(entry.element, entry.node);
    this.#renderContent(entry.element, entry.node);
  }

  /**
   * Change the z-index of an element.
   * @param {string} id
   * @param {number} newZIndex
   */
  reorderElement(id, newZIndex) {
    const entry = this.#elements.get(id);
    if (!entry) return;
    entry.element.zIndex = newZIndex;
    entry.node.style.zIndex = String(newZIndex);
  }

  /**
   * Full re-render of a single element (create or update).
   * @param {object} element
   */
  renderElement(element) {
    if (this.#elements.has(element.id)) {
      this.updateElement(element.id, element);
    } else {
      this.addElement(element);
    }
  }

  /**
   * Returns a shallow copy of all elements.
   * @returns {object[]}
   */
  getElements() {
    return Array.from(this.#elements.values()).map(e => ({ ...e.element }));
  }

  /**
   * Get a single element by id.
   * @param {string} id
   * @returns {object|undefined}
   */
  getElement(id) {
    const entry = this.#elements.get(id);
    return entry ? { ...entry.element } : undefined;
  }

  /**
   * Get the DOM node for an element.
   * @param {string} id
   * @returns {HTMLElement|undefined}
   */
  getNode(id) {
    return this.#elements.get(id)?.node;
  }

  /**
   * Clear all elements from canvas.
   */
  clear() {
    for (const [, entry] of this.#elements) {
      entry.node.remove();
    }
    this.#elements.clear();
  }

  /**
   * Bulk load elements (e.g. when loading a template).
   * @param {object[]} elements
   */
  loadElements(elements) {
    this.clear();
    for (const el of elements) {
      this.addElement(el);
    }
  }

  /* -------------------------------------------------- *
   *  Zoom
   * -------------------------------------------------- */

  /**
   * Set the canvas zoom level (0.25 to 4.0).
   * @param {number} level
   */
  setZoom(level) {
    this.#zoom = Math.max(0.25, Math.min(4.0, level));
    this.#wrapper.style.transform = `scale(${this.#zoom})`;
    return this.#zoom;
  }

  /** @returns {number} */
  getZoom() {
    return this.#zoom;
  }

  /* -------------------------------------------------- *
   *  Coordinate Conversion
   * -------------------------------------------------- */

  /**
   * Convert screen (client) coordinates to canvas percentage coordinates.
   * @param {number} clientX
   * @param {number} clientY
   * @returns {{ x: number, y: number }} Percentages 0-100
   */
  screenToCanvas(clientX, clientY) {
    const rect = this.#container.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    return { x, y };
  }

  /**
   * Convert canvas percentage to screen pixel position.
   * @param {number} pctX
   * @param {number} pctY
   * @returns {{ x: number, y: number }}
   */
  canvasToScreen(pctX, pctY) {
    const rect = this.#container.getBoundingClientRect();
    return {
      x: rect.left + (pctX / 100) * rect.width,
      y: rect.top + (pctY / 100) * rect.height,
    };
  }

  /** @returns {HTMLElement} */
  get container() {
    return this.#container;
  }

  /** @returns {{ width: number, height: number }} */
  get canvasSize() {
    return { width: this.#canvasWidth, height: this.#canvasHeight };
  }

  /* -------------------------------------------------- *
   *  Private: DOM creation & styling
   * -------------------------------------------------- */

  /**
   * Create the base DOM node for a canvas element.
   * @param {object} element
   * @returns {HTMLElement}
   */
  #createNode(element) {
    const node = document.createElement('div');
    node.className = 'canvas-element';
    node.dataset.elementId = element.id;
    node.dataset.elementType = element.type;
    this.#renderContent(element, node);
    return node;
  }

  /**
   * Render the inner content of an element node based on its type.
   * @param {object} element
   * @param {HTMLElement} node
   */
  #renderContent(element, node) {
    const p = element.props || {};

    switch (element.type) {
      case 'text': {
        node.textContent = p.text || 'Text';
        node.style.fontFamily = p.fontFamily || 'Inter, sans-serif';
        node.style.fontSize = p.fontSize ? `${p.fontSize}px` : '24px';
        node.style.fontWeight = p.fontWeight || '400';
        node.style.color = p.color || '#FFFFFF';
        node.style.backgroundColor = p.backgroundColor || 'transparent';
        node.style.textAlign = p.textAlign || 'left';
        node.style.lineHeight = p.lineHeight || '1.3';
        node.style.display = 'flex';
        node.style.alignItems = 'center';
        node.style.overflow = p.fitText ? 'hidden' : '';
        if (p.textShadow) node.style.textShadow = p.textShadow;
        if (p.textStroke) node.style.webkitTextStroke = p.textStroke;
        if (p.fitText) this.#applyFitText(node, p);
        break;
      }

      case 'image': {
        let img = node.querySelector('img');
        if (!img) {
          node.innerHTML = '';
          img = document.createElement('img');
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.pointerEvents = 'none';
          img.draggable = false;
          node.appendChild(img);
        }
        img.src = p.src || '';
        img.alt = p.alt || '';
        img.style.objectFit = p.fit || 'contain';
        break;
      }

      case 'shape': {
        const shapeType = p.shapeType || 'rectangle';
        node.innerHTML = '';
        if (shapeType === 'ellipse') {
          node.style.borderRadius = '50%';
        } else {
          node.style.borderRadius = p.borderRadius ? `${p.borderRadius}px` : '0';
        }
        node.style.backgroundColor = p.fill || 'rgba(59, 130, 246, 0.5)';
        if (p.strokeColor) {
          node.style.border = `${p.strokeWidth || 2}px solid ${p.strokeColor}`;
        } else {
          node.style.border = 'none';
        }
        break;
      }

      case 'data': {
        // Data elements render like text but show binding info or preview
        const displayText = p._previewValue || p.fallback || `{${p.bindingSource || 'unbound'}.${p.bindingField || '?'}}`;
        node.textContent = (p.prefix || '') + displayText + (p.suffix || '');
        node.style.fontFamily = p.fontFamily || 'Inter, sans-serif';
        node.style.fontSize = p.fontSize ? `${p.fontSize}px` : '24px';
        node.style.fontWeight = p.fontWeight || '600';
        node.style.color = p.color || '#FFFFFF';
        node.style.backgroundColor = p.backgroundColor || 'transparent';
        node.style.textAlign = p.textAlign || 'left';
        node.style.lineHeight = p.lineHeight || '1.3';
        node.style.display = 'flex';
        node.style.alignItems = 'center';
        node.style.overflow = p.fitText ? 'hidden' : '';
        if (p.textShadow) node.style.textShadow = p.textShadow;
        if (p.textStroke) node.style.webkitTextStroke = p.textStroke;
        if (p.fitText) this.#applyFitText(node, p);
        break;
      }

      default:
        node.textContent = element.type;
    }
  }

  /**
   * Apply positional / sizing / transform styles to a node using percentage coords.
   * @param {object} element
   * @param {HTMLElement} node
   */
  #applyStyles(element, node) {
    node.style.left = `${element.x}%`;
    node.style.top = `${element.y}%`;
    node.style.width = `${element.width}%`;
    node.style.height = `${element.height}%`;
    node.style.opacity = String(element.opacity ?? 1);
    node.style.zIndex = String(element.zIndex ?? 0);

    const transforms = [];
    if (element.rotation) {
      transforms.push(`rotate(${element.rotation}deg)`);
    }
    node.style.transform = transforms.join(' ');

    // Visibility / lock states (default to visible if field is undefined)
    node.classList.toggle('hidden-element', element.visible === false);
    node.classList.toggle('locked', !!element.locked);
  }

  /**
   * Shrink font size until text fits within the element bounds.
   * @param {HTMLElement} node
   * @param {object} props
   */
  #applyFitText(node, props) {
    const maxSize = props.fontSize || 24;
    let size = maxSize;

    // Use requestAnimationFrame to ensure the node is laid out
    requestAnimationFrame(() => {
      while (size > 6 && (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight)) {
        size--;
        node.style.fontSize = `${size}px`;
      }
    });
  }
}
