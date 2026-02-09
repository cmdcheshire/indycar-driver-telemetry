/**
 * Image-to-3D extrusion utilities.
 *
 * Traces alpha-channel contours from a PNG/image URL and builds an extruded
 * Three.js mesh using ExtrudeGeometry. Supports holes (e.g., inside of letters
 * like O, A, D).
 *
 * Requires Three.js loaded globally (THREE.*).
 */

// ---------------------------------------------------------------------------
// Image loading
// ---------------------------------------------------------------------------

/**
 * Load an image from a URL.
 * For same-origin/library URLs that may 302-redirect to S3, fetch as blob
 * first to avoid CORS issues with presigned URLs.
 * @param {string} url
 * @returns {Promise<HTMLImageElement>}
 */
async function _loadImage(url) {
  let src = url;

  // Same-origin URLs (library assets) may redirect to S3 without CORS headers.
  // Fetch as blob so the resulting objectURL is same-origin and canvas-safe.
  if (url.startsWith('/') || url.startsWith(location.origin)) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      src = URL.createObjectURL(blob);
    } catch (e) {
      throw new Error(`[image-extrude] Failed to fetch: ${url} (${e.message})`);
    }
  }

  const isBlob = src !== url;
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!isBlob) img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (isBlob) URL.revokeObjectURL(src);
      resolve(img);
    };
    img.onerror = () => {
      if (isBlob) URL.revokeObjectURL(src);
      reject(new Error(`[image-extrude] Failed to load: ${url}`));
    };
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// Alpha mask extraction
// ---------------------------------------------------------------------------

/**
 * Draw image to canvas (downscaled) and extract binary alpha mask.
 * @param {HTMLImageElement} img
 * @param {number} maxSize - Max dimension for the tracing canvas
 * @returns {{ mask: Uint8Array, w: number, h: number, scaleX: number, scaleY: number }}
 */
function _imageToAlphaMask(img, maxSize = 256) {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;

  // Downscale for performance
  const scale = Math.min(1, maxSize / Math.max(w, h));
  w = Math.round(w * scale);
  h = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  const mask = new Uint8Array(w * h);

  for (let i = 0; i < mask.length; i++) {
    mask[i] = data[i * 4 + 3] > 128 ? 1 : 0; // alpha threshold
  }

  return { mask, w, h, scaleX: w / (img.naturalWidth || img.width), scaleY: h / (img.naturalHeight || img.height) };
}

// ---------------------------------------------------------------------------
// Contour tracing (Moore neighborhood / border following)
// ---------------------------------------------------------------------------

// 8-connected neighbor offsets: starting from right, going clockwise
const DIRS = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * Trace a single contour starting from (startX, startY) using Moore neighbor tracing.
 * @param {Uint8Array} mask - Binary mask (padded)
 * @param {number} pw - Padded width
 * @param {number} startX
 * @param {number} startY
 * @param {number} startDir - Initial backtrack direction index
 * @param {Uint8Array} visited - Visited border pixels
 * @returns {Array<{x: number, y: number}>} Contour points
 */
function _traceContour(mask, pw, startX, startY, startDir, visited) {
  const points = [];
  let x = startX;
  let y = startY;
  let dir = startDir;
  const maxIter = mask.length * 2; // safety limit
  let iter = 0;

  do {
    points.push({ x, y });
    visited[y * pw + x] = 1;

    // Search for next border pixel — start from (dir+1) mod 8
    let found = false;
    for (let i = 0; i < 8; i++) {
      const nd = (dir + i) % 8;
      const nx = x + DIRS[nd][0];
      const ny = y + DIRS[nd][1];

      if (mask[ny * pw + nx] === 1) {
        // Backtrack direction for next iteration
        dir = (nd + 5) % 8; // opposite + 1
        x = nx;
        y = ny;
        found = true;
        break;
      }
    }

    if (!found) break; // isolated pixel
    if (++iter > maxIter) break;
  } while (x !== startX || y !== startY);

  return points;
}

/**
 * Find all contours in a binary mask.
 * @param {Uint8Array} mask - Original unpadded mask
 * @param {number} w - Width
 * @param {number} h - Height
 * @returns {{ outers: Array<Array<{x,y}>>, holes: Array<Array<{x,y}>> }}
 */
function _findContours(mask, w, h) {
  // Pad mask with 1px border of zeros
  const pw = w + 2;
  const ph = h + 2;
  const padded = new Uint8Array(pw * ph);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      padded[(y + 1) * pw + (x + 1)] = mask[y * w + x];
    }
  }

  const visited = new Uint8Array(pw * ph);
  const contours = [];

  // Scan for border pixels
  for (let y = 1; y < ph - 1; y++) {
    for (let x = 1; x < pw - 1; x++) {
      const idx = y * pw + x;
      if (padded[idx] !== 1 || visited[idx]) continue;

      // Check if this is a border pixel (has at least one 0-neighbor)
      let isBorder = false;
      for (let d = 0; d < 8; d++) {
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        if (padded[ny * pw + nx] === 0) {
          isBorder = true;
          break;
        }
      }
      if (!isBorder) continue;

      // Find the backtrack direction (first 0-neighbor)
      let startDir = 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        if (padded[ny * pw + nx] === 0) {
          startDir = d;
          break;
        }
      }

      const pts = _traceContour(padded, pw, x, y, startDir, visited);
      if (pts.length >= 3) {
        // Un-pad coordinates
        const unpadded = pts.map(p => ({ x: p.x - 1, y: p.y - 1 }));
        contours.push(unpadded);
      }
    }
  }

  // Classify contours: compute signed area to determine winding direction.
  // Moore neighbor tracing traces outer contours CW in screen coords (positive area)
  // and inner contours (holes) CCW (negative area).
  const classified = contours.map(pts => {
    const area = _signedArea(pts);
    return { points: pts, area, isHole: area < 0 }; // CCW = negative = hole in screen coords
  });

  const outers = classified.filter(c => !c.isHole).map(c => c.points);
  const holes = classified.filter(c => c.isHole).map(c => c.points);

  return { outers, holes };
}

/**
 * Compute signed area of a polygon (shoelace formula).
 * Positive = CW (outer contour), Negative = CCW (hole) in screen coordinates.
 */
function _signedArea(pts) {
  let area = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i++) {
    area += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  }
  return area / 2;
}

// ---------------------------------------------------------------------------
// Contour simplification (Douglas-Peucker)
// ---------------------------------------------------------------------------

/**
 * Simplify a contour using the Douglas-Peucker algorithm.
 * @param {Array<{x,y}>} points
 * @param {number} tolerance
 * @returns {Array<{x,y}>}
 */
function _simplifyContour(points, tolerance = 1.0) {
  if (points.length <= 3) return points;

  // Find the point with the maximum distance from the line (first → last)
  const first = points[0];
  const last = points[points.length - 1];
  let maxDist = 0;
  let maxIdx = 0;

  for (let i = 1; i < points.length - 1; i++) {
    const d = _pointToLineDistance(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    // Recursively simplify both halves
    const left = _simplifyContour(points.slice(0, maxIdx + 1), tolerance);
    const right = _simplifyContour(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
}

/**
 * Distance from a point to a line segment.
 */
function _pointToLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);

  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

// ---------------------------------------------------------------------------
// Point-in-polygon (ray casting)
// ---------------------------------------------------------------------------

/**
 * Test if a point is inside a polygon.
 */
function _pointInPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Trace contours from an image URL's alpha channel.
 *
 * @param {string} url - Image URL
 * @param {number} [maxSize=256] - Max tracing resolution
 * @returns {Promise<{ outers, holes, w, h, textureCanvas }>}
 */
export async function traceImageContours(url, maxSize = 256) {
  const img = await _loadImage(url);

  // Capture full-resolution texture canvas immediately while image is valid
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = imgW;
  textureCanvas.height = imgH;
  const tCtx = textureCanvas.getContext('2d');
  tCtx.drawImage(img, 0, 0, imgW, imgH);

  const { mask, w, h } = _imageToAlphaMask(img, maxSize);

  let { outers, holes } = _findContours(mask, w, h);

  // Simplify contours
  const tolerance = Math.max(w, h) * 0.005; // 0.5% of image size
  outers = outers.map(c => _simplifyContour(c, tolerance)).filter(c => c.length >= 3);
  holes = holes.map(c => _simplifyContour(c, tolerance)).filter(c => c.length >= 3);

  // If no outer contours found (fully opaque image), create a rectangle
  if (outers.length === 0) {
    outers = [[
      { x: 0, y: 0 },
      { x: w - 1, y: 0 },
      { x: w - 1, y: h - 1 },
      { x: 0, y: h - 1 },
    ]];
    holes = [];
  }

  return { outers, holes, w, h, textureCanvas };
}

/**
 * Build an extruded Three.js mesh from traced contour data.
 *
 * @param {{ outers, holes, w, h, textureCanvas }} contourData - From traceImageContours
 * @param {number} depth - Extrusion depth in scene units
 * @param {object} props - Element properties (modelColor, metalness, roughness)
 * @returns {THREE.Mesh}
 */
export function buildExtrudedMesh(contourData, depth, props) {
  const { outers, holes, w, h, textureCanvas } = contourData;

  // Normalize coordinates: map pixel coords to centered scene coords
  // Image aspect ratio determines width; height = 1
  const aspect = w / h;
  const halfW = aspect / 2;
  const halfH = 0.5;

  // Build shapes for each outer contour
  const shapes = [];

  for (const outer of outers) {
    const shape = new THREE.Shape();
    const first = outer[0];
    shape.moveTo(
      (first.x / w) * aspect - halfW,
      -((first.y / h) - halfH) // flip Y (screen → 3D)
    );
    for (let i = 1; i < outer.length; i++) {
      shape.lineTo(
        (outer[i].x / w) * aspect - halfW,
        -((outer[i].y / h) - halfH)
      );
    }
    shape.closePath();

    // Assign holes to this outer contour
    for (const hole of holes) {
      // Check if hole's first point is inside this outer
      if (_pointInPolygon(hole[0].x, hole[0].y, outer)) {
        const holePath = new THREE.Path();
        holePath.moveTo(
          (hole[0].x / w) * aspect - halfW,
          -((hole[0].y / h) - halfH)
        );
        for (let i = 1; i < hole.length; i++) {
          holePath.lineTo(
            (hole[i].x / w) * aspect - halfW,
            -((hole[i].y / h) - halfH)
          );
        }
        holePath.closePath();
        shape.holes.push(holePath);
      }
    }

    shapes.push(shape);
  }

  // Create extruded geometry
  const extrudeSettings = {
    depth: depth,
    bevelEnabled: false,
  };

  const geometry = new THREE.ExtrudeGeometry(shapes, extrudeSettings);

  // Compute UV mapping for the front/back faces based on image coordinates
  _computeImageUVs(geometry, aspect, halfW, halfH, depth);

  // Create materials
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  // Front/back caps: textured with the image
  const frontBackMat = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.1,
    metalness: props.metalness ?? 0.3,
    roughness: props.roughness ?? 0.6,
    side: THREE.DoubleSide,
  });

  // Sides: solid color, visible from both sides
  const sideMat = new THREE.MeshStandardMaterial({
    color: props.modelColor || '#5865f2',
    metalness: props.metalness ?? 0.3,
    roughness: props.roughness ?? 0.6,
    side: THREE.DoubleSide,
  });

  // ExtrudeGeometry (r150+) group ordering (bevelEnabled=false):
  //   materialIndex 0 = cap faces (front + back)
  //   materialIndex 1 = side faces (walls)
  const mesh = new THREE.Mesh(geometry, [frontBackMat, sideMat]);

  // Center the geometry
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const cx = (box.max.x + box.min.x) / 2;
  const cy = (box.max.y + box.min.y) / 2;
  const cz = (box.max.z + box.min.z) / 2;
  geometry.translate(-cx, -cy, -cz);

  return mesh;
}

/**
 * Compute UV coordinates that map the front/back cap faces to the source image.
 * ExtrudeGeometry's default UVs use world-space XY, which works for our normalized coords.
 * We just need to remap them to 0..1 texture space.
 */
function _computeImageUVs(geometry, aspect, halfW, halfH, depth) {
  const uvAttr = geometry.getAttribute('uv');
  const posAttr = geometry.getAttribute('position');

  if (!uvAttr || !posAttr) return;

  for (let i = 0; i < uvAttr.count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);

    // Map from scene coords [-halfW..halfW, -halfH..halfH] to UV [0..1]
    const u = (x + halfW) / aspect;
    const v = 1 - (y + halfH); // flip V for texture

    uvAttr.setXY(i, u, v);
  }

  uvAttr.needsUpdate = true;
}
