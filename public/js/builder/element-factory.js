/**
 * Factory functions for creating default element objects.
 * All coordinates and sizes are in canvas percentages (0-100).
 */

/** Generate a UUID — works in non-secure (HTTP) contexts unlike crypto.randomUUID(). */
function _uuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/**
 * Create a text element at the given canvas position.
 * @param {number} x - X position as percentage
 * @param {number} y - Y position as percentage
 * @returns {object}
 */
export function createTextElement(x = 10, y = 10) {
  return {
    id: _uuid(),
    type: 'text',
    name: 'Text',
    visible: true,
    locked: false,
    exposed: false,
    groupId: null,
    x,
    y,
    width: 15,
    height: 4,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    props: {
      text: 'New Text',
      fontFamily: 'Inter, sans-serif',
      fontSize: 24,
      fontWeight: '400',
      color: '#FFFFFF',
      backgroundColor: 'transparent',
      textAlign: 'left',
      lineHeight: '1.3',
      textShadow: '',
      textStroke: '',
      fitText: false,
    },
    animation: {
      enter: { type: 'none', duration: 300, easing: 'ease' },
      exit: { type: 'none', duration: 300, easing: 'ease' },
      update: { type: 'none', duration: 300, easing: 'ease' },
    },
  };
}

/**
 * Create an image element at the given canvas position.
 * @param {number} x - X position as percentage
 * @param {number} y - Y position as percentage
 * @returns {object}
 */
export function createImageElement(x = 10, y = 10) {
  return {
    id: _uuid(),
    type: 'image',
    name: 'Image',
    visible: true,
    locked: false,
    exposed: false,
    groupId: null,
    x,
    y,
    width: 10,
    height: 10,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    props: {
      src: '',
      alt: '',
      fit: 'contain', // contain | cover | fill
    },
    animation: {
      enter: { type: 'none', duration: 300, easing: 'ease' },
      exit: { type: 'none', duration: 300, easing: 'ease' },
      update: { type: 'none', duration: 300, easing: 'ease' },
    },
  };
}

/**
 * Create a shape element at the given canvas position.
 * @param {number} x - X position as percentage
 * @param {number} y - Y position as percentage
 * @returns {object}
 */
export function createShapeElement(x = 10, y = 10) {
  return {
    id: _uuid(),
    type: 'shape',
    name: 'Rectangle',
    visible: true,
    locked: false,
    exposed: false,
    groupId: null,
    x,
    y,
    width: 12,
    height: 8,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    props: {
      shapeType: 'rectangle', // rectangle | ellipse | line
      fill: 'rgba(59, 130, 246, 0.5)',
      strokeColor: '',
      strokeWidth: 0,
      borderRadius: 0,
    },
    animation: {
      enter: { type: 'none', duration: 300, easing: 'ease' },
      exit: { type: 'none', duration: 300, easing: 'ease' },
      update: { type: 'none', duration: 300, easing: 'ease' },
    },
  };
}

/**
 * Create a data-bound element at the given canvas position.
 * Inherits text rendering properties with an additional binding config.
 * @param {number} x - X position as percentage
 * @param {number} y - Y position as percentage
 * @returns {object}
 */
export function createDataElement(x = 10, y = 10) {
  return {
    id: _uuid(),
    type: 'data',
    name: 'Data Binding',
    visible: true,
    locked: false,
    exposed: false,
    groupId: null,
    x,
    y,
    width: 15,
    height: 4,
    rotation: 0,
    opacity: 1,
    zIndex: 0,
    props: {
      // Text rendering properties
      fontFamily: 'Inter, sans-serif',
      fontSize: 24,
      fontWeight: '600',
      color: '#FFFFFF',
      backgroundColor: 'transparent',
      textAlign: 'left',
      lineHeight: '1.3',
      textShadow: '',
      textStroke: '',
      fitText: false,
      // Binding configuration
      bindingSource: '',
      bindingField: '',
      carSelector: '',
      format: 'raw',
      prefix: '',
      suffix: '',
      fallback: '---',
      // Conditional style rules
      conditionalStyles: [],
      // Preview value (populated by builder)
      _previewValue: '',
    },
    animation: {
      enter: { type: 'none', duration: 300, easing: 'ease' },
      exit: { type: 'none', duration: 300, easing: 'ease' },
      update: { type: 'none', duration: 300, easing: 'ease' },
    },
  };
}

/**
 * Clone an element with a new ID.
 * @param {object} element
 * @returns {object}
 */
export function cloneElement(element) {
  const clone = JSON.parse(JSON.stringify(element));
  clone.id = _uuid();
  clone.name = `${element.name} Copy`;
  clone.x += 2;
  clone.y += 2;
  return clone;
}
