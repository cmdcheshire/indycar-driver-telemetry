/**
 * Three.js scene controller for scene3d overlay elements.
 *
 * Manages a WebGL scene with transparent background for:
 *  - 3D Model Viewer (GLTF/GLB from graphics library, or extruded PNG)
 *  - Extruded 3D Text
 *  - Particle systems
 *
 * Used by both builder (canvas-engine) and overlay (element-renderer).
 * Requires Three.js loaded as global scripts.
 */

import { traceImageContours, buildExtrudedMesh } from '/js/shared/image-extrude.js';

// ---------------------------------------------------------------------------
// Sub-type definitions
// ---------------------------------------------------------------------------

export const SCENE3D_SUBTYPES = [
  { value: 'modelViewer', label: '3D Model' },
  { value: 'text3d',      label: '3D Text' },
  { value: 'particles',   label: 'Particles' },
];

/**
 * Check if a URL points to an image file.
 * Supports direct URLs with extensions and library asset URLs with ?fn= hint.
 */
const _IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function _isImageUrl(url) {
  if (!url) return false;
  if (url.startsWith('data:image/')) return true;

  // Check for ?fn= query parameter (library asset URL hint)
  try {
    const u = new URL(url, location.origin);
    const fn = u.searchParams.get('fn');
    if (fn) {
      const ext = fn.split('.').pop().toLowerCase();
      return _IMAGE_EXTS.has(ext);
    }
  } catch (e) { /* not a valid URL, fall through */ }

  const ext = url.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
  return _IMAGE_EXTS.has(ext);
}

// ---------------------------------------------------------------------------
// Scene3DController
// ---------------------------------------------------------------------------

export class Scene3DController {
  /**
   * @param {HTMLElement} container - DOM element to render into
   * @param {object}      props    - Element properties
   */
  constructor(container, props) {
    this._container = container;
    this._props = { ...props };
    this._disposed = false;
    this._animationId = null;
    this._model = null;
    this._textMesh = null;
    this._particles = null;

    // Ensure Three.js is available
    if (typeof THREE === 'undefined') {
      console.warn('[scene3d] THREE is not defined — Three.js not loaded');
      this._fallback(container);
      return;
    }

    this._initScene(container, props);
  }

  _fallback(container) {
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.color = 'rgba(255,255,255,0.5)';
    container.style.fontSize = '14px';
    container.textContent = '3D (Three.js not loaded)';
  }

  _initScene(container, props) {
    const width = container.clientWidth || 200;
    const height = container.clientHeight || 200;

    // Scene
    this._scene = new THREE.Scene();

    // Camera
    const fov = props.cameraFov || 50;
    this._camera = new THREE.PerspectiveCamera(fov, width / height, 0.1, 1000);
    const camPos = props.cameraPosition || { x: 0, y: 0, z: 3 };
    this._camera.position.set(camPos.x, camPos.y, camPos.z);

    // Renderer (transparent background for overlay compositing)
    this._renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this._renderer.setSize(width, height);
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setClearColor(0x000000, 0);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this._renderer.domElement);

    // Lighting
    this._setupLighting(props);

    // Sub-type setup
    const subType = props.subType || 'text3d';
    switch (subType) {
      case 'modelViewer':
        this._setupModelViewer(props);
        break;
      case 'text3d':
        this._setupText3D(props);
        break;
      case 'particles':
        this._setupParticles(props);
        break;
    }

    // Start render loop
    this._animate();
  }

  // -----------------------------------------------------------------------
  // Lighting
  // -----------------------------------------------------------------------

  _setupLighting(props) {
    // Ambient light
    const ambientColor = props.ambientColor || '#ffffff';
    const ambientIntensity = props.ambientIntensity ?? 0.6;
    this._ambientLight = new THREE.AmbientLight(ambientColor, ambientIntensity);
    this._scene.add(this._ambientLight);

    // Directional light
    const dirColor = props.directionalColor || '#ffffff';
    const dirIntensity = props.directionalIntensity ?? 1.0;
    this._dirLight = new THREE.DirectionalLight(dirColor, dirIntensity);
    const dirPos = props.directionalPosition || { x: 2, y: 3, z: 5 };
    this._dirLight.position.set(dirPos.x, dirPos.y, dirPos.z);
    this._scene.add(this._dirLight);
  }

  // -----------------------------------------------------------------------
  // Sub-type setups
  // -----------------------------------------------------------------------

  _setupModelViewer(props) {
    // Placeholder box while model loads
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: props.modelColor || '#5865f2',
      metalness: props.metalness ?? 0.3,
      roughness: props.roughness ?? 0.6,
    });
    this._model = new THREE.Mesh(geo, mat);
    this._scene.add(this._model);

    // Auto-rotation
    this._autoRotate = props.autoRotate !== false;
    this._rotateSpeed = props.rotateSpeed ?? 0.01;

    // Load model or image if URL provided
    if (props.modelUrl) {
      if (_isImageUrl(props.modelUrl)) {
        this._loadImageModel(props.modelUrl, props);
      } else {
        this.loadModel(props.modelUrl);
      }
    }
  }

  _setupText3D(props) {
    const text = props.text3d || '3D';
    const color = props.text3dColor || '#ffffff';
    const depth = props.text3dDepth ?? 0.3;

    // Use ExtrudeGeometry with a text shape (simplified — no font loading needed for basic shapes)
    // For proper 3D text we'd use TextGeometry + FontLoader, but that needs font JSON files.
    // Use a simple approach: create stacked plane meshes to simulate extruded text,
    // or use a canvas-textured box as a simpler fallback.
    this._createCanvasText(text, color, depth, props);

    this._autoRotate = props.autoRotate ?? true;
    this._rotateSpeed = props.rotateSpeed ?? 0.005;
  }

  _createCanvasText(text, color, depth, props) {
    // Canvas-based texture for the front face
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'transparent';
    ctx.clearRect(0, 0, 512, 256);

    ctx.fillStyle = color;
    ctx.font = `bold ${props.text3dFontSize || 120}px ${props.text3dFont || 'Arial'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;

    // Front material with canvas text
    const frontMat = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      metalness: props.metalness ?? 0.4,
      roughness: props.roughness ?? 0.5,
    });

    // Side/back material
    const sideMat = new THREE.MeshStandardMaterial({
      color: props.text3dSideColor || color,
      metalness: props.metalness ?? 0.4,
      roughness: props.roughness ?? 0.5,
    });

    // Build a box with different materials per face
    const aspect = 2; // 512/256
    const geo = new THREE.BoxGeometry(aspect, 1, depth);
    const materials = [sideMat, sideMat, sideMat, sideMat, frontMat, sideMat]; // +x, -x, +y, -y, +z (front), -z
    this._textMesh = new THREE.Mesh(geo, materials);
    this._scene.add(this._textMesh);
  }

  _setupParticles(props) {
    const count = props.particleCount || 200;
    const spread = props.particleSpread || 3;
    const size = props.particleSize || 0.05;
    const color = props.particleColor || '#5865f2';

    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = (Math.random() - 0.5) * spread;
      positions[i * 3 + 1] = (Math.random() - 0.5) * spread;
      positions[i * 3 + 2] = (Math.random() - 0.5) * spread;

      velocities[i * 3]     = (Math.random() - 0.5) * 0.01;
      velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.01;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity: props.particleOpacity ?? 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this._particles = new THREE.Points(geo, mat);
    this._particleVelocities = velocities;
    this._particleSpread = spread;
    this._scene.add(this._particles);

    this._autoRotate = false;
  }

  // -----------------------------------------------------------------------
  // Model loading
  // -----------------------------------------------------------------------

  async loadModel(url) {
    if (typeof THREE.GLTFLoader === 'undefined' && typeof GLTFLoader === 'undefined') {
      console.warn('[scene3d] GLTFLoader not available');
      return;
    }

    const LoaderClass = typeof GLTFLoader !== 'undefined' ? GLTFLoader : THREE.GLTFLoader;
    const loader = new LoaderClass();

    try {
      const gltf = await new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });

      // Remove placeholder
      if (this._model) {
        this._scene.remove(this._model);
        if (this._model.geometry) this._model.geometry.dispose();
        if (this._model.material) this._model.material.dispose();
      }

      this._model = gltf.scene;

      // Auto-scale to fit in view
      const box = new THREE.Box3().setFromObject(this._model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2 / maxDim;
      this._model.scale.setScalar(scale);

      // Center
      const center = box.getCenter(new THREE.Vector3());
      this._model.position.sub(center.multiplyScalar(scale));

      this._scene.add(this._model);
    } catch (err) {
      console.error('[scene3d] Failed to load model:', err);
    }
  }

  /**
   * Load an image URL and create an extruded 3D shape from its alpha outline.
   * @param {string} url - Image URL
   * @param {object} props - Element properties
   */
  async _loadImageModel(url, props) {
    try {
      const contourData = await traceImageContours(url, 256);
      const mesh = buildExtrudedMesh(contourData, props.modelDepth ?? 0.2, props);

      // Remove placeholder / old model
      if (this._model) {
        this._scene.remove(this._model);
        if (this._model.geometry) this._model.geometry.dispose();
        if (this._model.material) {
          if (Array.isArray(this._model.material)) {
            this._model.material.forEach(m => m.dispose());
          } else {
            this._model.material.dispose();
          }
        }
      }

      this._model = mesh;
      this._isImageSlab = true;
      this._imageUrl = url; // cache for depth rebuild

      // Auto-scale to fit in view
      const box = new THREE.Box3().setFromObject(this._model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      if (maxDim > 0) {
        const scale = 2 / maxDim;
        this._model.scale.setScalar(scale);
      }

      this._scene.add(this._model);
    } catch (err) {
      console.error('[scene3d] Failed to load image model:', err);
    }
  }

  // -----------------------------------------------------------------------
  // Render loop
  // -----------------------------------------------------------------------

  _animate() {
    if (this._disposed) return;
    this._animationId = requestAnimationFrame(() => this._animate());

    // Auto-rotation
    if (this._autoRotate) {
      const target = this._model || this._textMesh;
      if (target) {
        target.rotation.y += this._rotateSpeed || 0.01;
      }
    }

    // Particle animation
    if (this._particles) {
      const positions = this._particles.geometry.attributes.position.array;
      const vel = this._particleVelocities;
      const spread = this._particleSpread || 3;
      const half = spread / 2;

      for (let i = 0; i < positions.length / 3; i++) {
        positions[i * 3]     += vel[i * 3];
        positions[i * 3 + 1] += vel[i * 3 + 1];
        positions[i * 3 + 2] += vel[i * 3 + 2];

        // Wrap particles that go out of bounds
        for (let axis = 0; axis < 3; axis++) {
          if (positions[i * 3 + axis] > half) positions[i * 3 + axis] = -half;
          if (positions[i * 3 + axis] < -half) positions[i * 3 + axis] = half;
        }
      }
      this._particles.geometry.attributes.position.needsUpdate = true;
    }

    this._renderer.render(this._scene, this._camera);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Live-update props from properties panel or data bindings.
   */
  updateProps(newProps) {
    const prev = { ...this._props };
    Object.assign(this._props, newProps);

    // Camera
    if (newProps.cameraFov !== undefined && this._camera) {
      this._camera.fov = newProps.cameraFov;
      this._camera.updateProjectionMatrix();
    }
    if (newProps.cameraPosition && this._camera) {
      this._camera.position.set(
        newProps.cameraPosition.x ?? this._camera.position.x,
        newProps.cameraPosition.y ?? this._camera.position.y,
        newProps.cameraPosition.z ?? this._camera.position.z,
      );
    }

    // Lighting
    if (newProps.ambientIntensity !== undefined && this._ambientLight) {
      this._ambientLight.intensity = newProps.ambientIntensity;
    }
    if (newProps.directionalIntensity !== undefined && this._dirLight) {
      this._dirLight.intensity = newProps.directionalIntensity;
    }

    // Camera Z position (dolly / zoom)
    if (newProps.cameraZ !== undefined && this._camera) {
      this._camera.position.z = newProps.cameraZ;
    }

    // Auto-rotate
    if (newProps.autoRotate !== undefined) this._autoRotate = newProps.autoRotate;
    if (newProps.rotateSpeed !== undefined) this._rotateSpeed = newProps.rotateSpeed;

    // Model color (only for non-image-slab models with simple material)
    if (newProps.modelColor !== undefined && this._model?.material && !this._isImageSlab) {
      if (!Array.isArray(this._model.material)) {
        this._model.material.color.set(newProps.modelColor);
      }
    }

    // Particle updates
    if (newProps.particleColor !== undefined && this._particles?.material) {
      this._particles.material.color.set(newProps.particleColor);
    }
    if (newProps.particleOpacity !== undefined && this._particles?.material) {
      this._particles.material.opacity = newProps.particleOpacity;
    }
    if (newProps.particleSize !== undefined && this._particles?.material) {
      this._particles.material.size = newProps.particleSize;
    }

    // Model URL change — only trigger load when URL actually changed
    if (newProps.modelUrl !== undefined && newProps.modelUrl !== prev.modelUrl) {
      if (newProps.modelUrl && _isImageUrl(newProps.modelUrl)) {
        this._loadImageModel(newProps.modelUrl, this._props);
      } else if (newProps.modelUrl) {
        this._isImageSlab = false;
        this._imageUrl = null;
        this.loadModel(newProps.modelUrl);
      }
    }

    // Model depth change (image slab only) — only when depth actually changed
    const depthChanged = newProps.modelDepth !== undefined && newProps.modelDepth !== prev.modelDepth;
    if (depthChanged && this._isImageSlab && this._imageUrl) {
      this._loadImageModel(this._imageUrl, this._props);
    }

    // 3D text content or color change
    const textChanged = (newProps.text3d !== undefined && newProps.text3d !== prev.text3d) ||
                        (newProps.text3dColor !== undefined && newProps.text3dColor !== prev.text3dColor);
    if (textChanged && this._textMesh) {
      this._scene.remove(this._textMesh);
      if (this._textMesh.geometry) this._textMesh.geometry.dispose();
      this._createCanvasText(
        this._props.text3d || '3D',
        this._props.text3dColor || '#ffffff',
        this._props.text3dDepth || 0.3,
        this._props,
      );
    }
  }

  /**
   * Set a single data-driven property (from binding resolver).
   */
  setBindingValue(property, value) {
    switch (property) {
      case 'rotation':
      case 'rotationY': {
        const target = this._model || this._textMesh;
        if (target) target.rotation.y = (value * Math.PI) / 180;
        break;
      }
      case 'rotationX': {
        const target = this._model || this._textMesh;
        if (target) target.rotation.x = (value * Math.PI) / 180;
        break;
      }
      case 'scale': {
        const target = this._model || this._textMesh;
        if (target) target.scale.setScalar(value);
        break;
      }
      case 'particleColor':
        if (this._particles?.material) {
          this._particles.material.color.set(value);
        }
        break;
    }
  }

  /**
   * Resize renderer to match container.
   */
  resize() {
    if (!this._renderer || !this._camera || this._disposed) return;

    const width = this._container.clientWidth || 200;
    const height = this._container.clientHeight || 200;

    this._camera.aspect = width / height;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(width, height);
  }

  /**
   * Dispose all GPU resources.
   */
  dispose() {
    this._disposed = true;

    if (this._animationId) {
      cancelAnimationFrame(this._animationId);
      this._animationId = null;
    }

    if (this._scene) {
      this._scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    }

    if (this._renderer) {
      this._renderer.dispose();
      const canvas = this._renderer.domElement;
      if (canvas && canvas.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
      this._renderer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a Scene3D controller for a container element.
 *
 * @param {HTMLElement} container
 * @param {object}      props
 * @returns {Scene3DController}
 */
export function createScene3D(container, props) {
  return new Scene3DController(container, props);
}
