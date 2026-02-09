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
    exposedSettings: [],
    groupId: null,
    clipMask: null,
    x,
    y,
    width: 15,
    height: 4,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    z: 0,
    perspective: 0,
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
    bindings: [],
    animation: {
      enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
      exit: { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
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
    exposedSettings: [],
    groupId: null,
    clipMask: null,
    x,
    y,
    width: 10,
    height: 10,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    z: 0,
    perspective: 0,
    opacity: 1,
    zIndex: 0,
    props: {
      src: '',
      alt: '',
      fit: 'contain', // contain | cover | fill
    },
    bindings: [],
    animation: {
      enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
      exit: { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
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
    exposedSettings: [],
    groupId: null,
    clipMask: null,
    x,
    y,
    width: 12,
    height: 8,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    z: 0,
    perspective: 0,
    opacity: 1,
    zIndex: 0,
    props: {
      shapeType: 'rectangle', // rectangle | ellipse | line
      fill: 'rgba(59, 130, 246, 0.5)',
      strokeColor: '',
      strokeWidth: 0,
      borderRadius: 0,
    },
    bindings: [],
    animation: {
      enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
      exit: { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
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
    exposedSettings: [],
    groupId: null,
    clipMask: null,
    x,
    y,
    width: 15,
    height: 4,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    z: 0,
    perspective: 0,
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
    bindings: [],
    animation: {
      enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
      exit: { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    },
  };
}

/**
 * Create an arc gauge element at the given canvas position.
 * @param {number} x - X position as percentage
 * @param {number} y - Y position as percentage
 * @returns {object}
 */
export function createArcGaugeElement(x = 10, y = 10) {
  return {
    id: _uuid(),
    type: 'arcGauge',
    name: 'Arc Gauge',
    visible: true,
    locked: false,
    exposed: false,
    exposedSettings: [],
    groupId: null,
    clipMask: null,
    x,
    y,
    width: 10,
    height: 10,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    z: 0,
    perspective: 0,
    opacity: 1,
    zIndex: 0,
    props: {
      startAngle: -135,
      endAngle: 135,
      thickness: 12,
      min: 0,
      max: 100,
      fillColor: '#00e676',
      bgColor: 'rgba(255,255,255,0.15)',
      // Binding configuration
      bindingSource: '',
      bindingField: '',
      carSelector: '',
      format: 'raw',
      smoothing: 0,
      _previewValue: 50,
    },
    bindings: [],
    animation: {
      enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
      exit: { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    },
  };
}

/**
 * Create a bar gauge element at the given canvas position.
 * @param {number} x - X position as percentage
 * @param {number} y - Y position as percentage
 * @returns {object}
 */
export function createBarGaugeElement(x = 10, y = 10) {
  return {
    id: _uuid(),
    type: 'barGauge',
    name: 'Bar Gauge',
    visible: true,
    locked: false,
    exposed: false,
    exposedSettings: [],
    groupId: null,
    clipMask: null,
    x,
    y,
    width: 15,
    height: 3,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    z: 0,
    perspective: 0,
    opacity: 1,
    zIndex: 0,
    props: {
      orientation: 'horizontal',
      min: 0,
      max: 100,
      fillColor: '#00e676',
      bgColor: 'rgba(255,255,255,0.15)',
      borderRadius: 0,
      // Binding configuration
      bindingSource: '',
      bindingField: '',
      carSelector: '',
      format: 'raw',
      smoothing: 0,
      _previewValue: 50,
    },
    bindings: [],
    animation: {
      enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
      exit: { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    },
  };
}

/**
 * Create a ring segment gauge element at the given canvas position.
 * @param {number} x - X position as percentage
 * @param {number} y - Y position as percentage
 * @returns {object}
 */
export function createRingSegmentElement(x = 10, y = 10) {
  return {
    id: _uuid(),
    type: 'ringSegment',
    name: 'Ring Segment',
    visible: true,
    locked: false,
    exposed: false,
    exposedSettings: [],
    groupId: null,
    clipMask: null,
    x,
    y,
    width: 10,
    height: 10,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    z: 0,
    perspective: 0,
    opacity: 1,
    zIndex: 0,
    props: {
      startAngle: -135,
      endAngle: 135,
      segments: 10,
      segmentGap: 3,
      thickness: 12,
      min: 0,
      max: 100,
      colorStops: [
        { value: 0, color: '#00e676' },
        { value: 50, color: '#ffeb3b' },
        { value: 100, color: '#ff5252' },
      ],
      bgColor: 'rgba(255,255,255,0.15)',
      // Binding configuration
      bindingSource: '',
      bindingField: '',
      carSelector: '',
      format: 'raw',
      smoothing: 0,
      _previewValue: 50,
    },
    bindings: [],
    animation: {
      enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
      exit: { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
    },
  };
}

/**
 * Create a 3D scene element at the given canvas position.
 * @param {number} x - X position as percentage
 * @param {number} y - Y position as percentage
 * @returns {object}
 */
export function createScene3dElement(x = 10, y = 10, subType = 'text3d') {
  const nameMap = { modelViewer: '3D Model', text3d: '3D Text', particles: 'Particles' };
  return {
    id: _uuid(),
    type: 'scene3d',
    name: nameMap[subType] || '3D Scene',
    visible: true,
    locked: false,
    exposed: false,
    exposedSettings: [],
    groupId: null,
    clipMask: null,
    x,
    y,
    width: 15,
    height: 15,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    z: 0,
    perspective: 0,
    opacity: 1,
    zIndex: 0,
    props: {
      subType,
      // Camera
      cameraFov: 50,
      cameraPosition: { x: 0, y: 0, z: 3 },
      // Lighting
      ambientColor: '#ffffff',
      ambientIntensity: 0.6,
      directionalColor: '#ffffff',
      directionalIntensity: 1.0,
      directionalPosition: { x: 2, y: 3, z: 5 },
      // Auto-rotation
      autoRotate: true,
      rotateSpeed: 0.01,
      // Model viewer props
      modelUrl: '',
      modelColor: '#5865f2',
      metalness: 0.3,
      roughness: 0.6,
      modelDepth: 0.2,
      // 3D text props
      text3d: '3D',
      text3dColor: '#ffffff',
      text3dSideColor: '#5865f2',
      text3dDepth: 0.3,
      text3dFontSize: 120,
      text3dFont: 'Arial',
      // Particle props
      particleCount: 200,
      particleSpread: 3,
      particleSize: 0.05,
      particleColor: '#5865f2',
      particleOpacity: 0.8,
      // Binding configuration
      bindingSource: '',
      bindingField: '',
      carSelector: '',
    },
    bindings: [],
    animation: {
      enter: { type: 'none', duration: 300, delay: 0, easing: 'power2.out' },
      exit: { type: 'none', duration: 300, delay: 0, easing: 'power2.in' },
      update: { type: 'none', duration: 300, easing: 'power1.inOut' },
      emphasis: { type: 'none', duration: 400, trigger: 'onChange', repeat: 0 },
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
  clone.clipMask = null;
  return clone;
}
