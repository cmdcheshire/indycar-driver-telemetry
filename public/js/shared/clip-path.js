/**
 * Shared utility for computing CSS clip-path values from mask element geometry.
 * Used by both the builder (canvas-engine) and overlay (template-loader).
 *
 * Both element bounds use percentage coordinates (0-100) relative to the canvas.
 */

/**
 * Compute a CSS clip-path value for a clipped element based on a mask element's bounds.
 *
 * @param {object} clipped - The element being clipped: { x, y, width, height }
 * @param {object} mask    - The mask element: { x, y, width, height, rotation?, props? }
 * @param {object} [opts]  - Options
 * @param {number} [opts.canvasAspect] - Canvas width/height ratio (default 16/9, for rotation math)
 * @param {boolean} [opts.forcePolygon] - Always use polygon() output (for GSAP animation interpolation)
 * @returns {string|null}  CSS clip-path value, or null if inputs are invalid
 */
export function computeClipPath(clipped, mask, opts = {}) {
  if (!clipped || !mask) return null;
  if (!clipped.width || !clipped.height) return null;

  const canvasAspect = opts.canvasAspect ?? (16 / 9);
  const forcePolygon = opts.forcePolygon ?? false;
  const rotation = mask.rotation || mask.props?.rotation || 0;
  const shapeType = mask.props?.shapeType || mask.shapeType || 'rectangle';

  // Ellipse — use polygon approximation when rotated or forced
  if (shapeType === 'ellipse') {
    if (rotation || forcePolygon) {
      return _rotatedEllipsePolygon(clipped, mask, rotation, canvasAspect);
    }
    const relLeft = ((mask.x - clipped.x) / clipped.width) * 100;
    const relTop = ((mask.y - clipped.y) / clipped.height) * 100;
    const relRight = (((mask.x + mask.width) - clipped.x) / clipped.width) * 100;
    const relBottom = (((mask.y + mask.height) - clipped.y) / clipped.height) * 100;
    const rx = (relRight - relLeft) / 2;
    const ry = (relBottom - relTop) / 2;
    const cx = relLeft + rx;
    const cy = relTop + ry;
    return `ellipse(${rx}% ${ry}% at ${cx}% ${cy}%)`;
  }

  // Rectangle with rotation or forced polygon → polygon()
  if (rotation || forcePolygon) {
    return _rotatedRectPolygon(clipped, mask, rotation, canvasAspect);
  }

  // Unrotated rectangle → inset()
  const relLeft = ((mask.x - clipped.x) / clipped.width) * 100;
  const relTop = ((mask.y - clipped.y) / clipped.height) * 100;
  const relRight = (((mask.x + mask.width) - clipped.x) / clipped.width) * 100;
  const relBottom = (((mask.y + mask.height) - clipped.y) / clipped.height) * 100;

  const insetTop = Math.max(0, relTop);
  const insetRight = Math.max(0, 100 - relRight);
  const insetBottom = Math.max(0, 100 - relBottom);
  const insetLeft = Math.max(0, relLeft);

  const borderRadius = mask.props?.borderRadius || mask.borderRadius || 0;

  let clipPath = `inset(${insetTop}% ${insetRight}% ${insetBottom}% ${insetLeft}%`;
  if (borderRadius > 0) {
    clipPath += ` round ${borderRadius}px`;
  }
  clipPath += ')';

  return clipPath;
}

/**
 * Compute offset mask bounds based on GSAP animation "from" vars.
 * Used to determine where the mask would visually be at the start of its enter animation.
 *
 * @param {object} mask - Mask element bounds { x, y, width, height, rotation?, props? }
 * @param {object} fromVars - GSAP from() vars (e.g. { x: '-105%', opacity: 0 })
 * @param {number} [canvasW=1920] - Canvas pixel width
 * @param {number} [canvasH=1080] - Canvas pixel height
 * @returns {object} Modified mask bounds
 */
export function offsetMaskBounds(mask, fromVars, canvasW = 1920, canvasH = 1080) {
  const result = {
    x: mask.x,
    y: mask.y,
    width: mask.width,
    height: mask.height,
    rotation: mask.rotation || mask.props?.rotation || 0,
    props: mask.props,
    shapeType: mask.props?.shapeType || mask.shapeType,
    borderRadius: mask.props?.borderRadius || mask.borderRadius,
  };

  // X offset
  if (fromVars.x !== undefined) {
    const xVal = fromVars.x;
    if (typeof xVal === 'string' && xVal.endsWith('%')) {
      // GSAP string percentage = translateX(N%) → N% of element's own width
      result.x += mask.width * (parseFloat(xVal) / 100);
    } else {
      // Pixels → convert to canvas percentage
      result.x += (parseFloat(xVal) / canvasW) * 100;
    }
  }
  if (fromVars.xPercent !== undefined) {
    result.x += mask.width * (fromVars.xPercent / 100);
  }

  // Y offset
  if (fromVars.y !== undefined) {
    const yVal = fromVars.y;
    if (typeof yVal === 'string' && yVal.endsWith('%')) {
      result.y += mask.height * (parseFloat(yVal) / 100);
    } else {
      result.y += (parseFloat(yVal) / canvasH) * 100;
    }
  }
  if (fromVars.yPercent !== undefined) {
    result.y += mask.height * (fromVars.yPercent / 100);
  }

  // Scale (from center)
  if (fromVars.scale !== undefined) {
    const s = fromVars.scale;
    const cx = result.x + result.width / 2;
    const cy = result.y + result.height / 2;
    result.width *= s;
    result.height *= s;
    result.x = cx - result.width / 2;
    result.y = cy - result.height / 2;
  }
  if (fromVars.scaleX !== undefined) {
    const cx = result.x + result.width / 2;
    result.width *= fromVars.scaleX;
    result.x = cx - result.width / 2;
  }
  if (fromVars.scaleY !== undefined) {
    const cy = result.y + result.height / 2;
    result.height *= fromVars.scaleY;
    result.y = cy - result.height / 2;
  }

  // Rotation offset
  if (fromVars.rotation !== undefined) {
    result.rotation = (result.rotation || 0) + fromVars.rotation;
  }

  return result;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Rotate points around a center and project to clipped element's local coordinate %.
 * Accounts for canvas aspect ratio when converting between x% and y% spaces.
 *
 * In pixel space: dx_px = dx% * canvasW, dy_px = dy% * canvasH
 * Rotated:  dx_rot% = dx%*cos - dy%*(1/aspect)*sin
 *           dy_rot% = dx%*aspect*sin + dy%*cos
 */
function _rotateAndProject(points, cx, cy, angleDeg, aspect, clipped) {
  const rad = angleDeg * Math.PI / 180;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const invAspect = 1 / aspect;

  const projected = points.map(({ dx, dy }) => {
    const rx = dx * cosA - dy * invAspect * sinA;
    const ry = dx * aspect * sinA + dy * cosA;
    const localX = ((cx + rx) - clipped.x) / clipped.width * 100;
    const localY = ((cy + ry) - clipped.y) / clipped.height * 100;
    return `${localX.toFixed(2)}% ${localY.toFixed(2)}%`;
  });

  return `polygon(${projected.join(', ')})`;
}

/**
 * Compute polygon() clip-path for a (possibly rotated) rectangle mask.
 */
function _rotatedRectPolygon(clipped, mask, angleDeg, aspect) {
  const cx = mask.x + mask.width / 2;
  const cy = mask.y + mask.height / 2;
  const hw = mask.width / 2;
  const hh = mask.height / 2;

  const corners = [
    { dx: -hw, dy: -hh },
    { dx:  hw, dy: -hh },
    { dx:  hw, dy:  hh },
    { dx: -hw, dy:  hh },
  ];

  return _rotateAndProject(corners, cx, cy, angleDeg, aspect, clipped);
}

/**
 * Compute polygon() clip-path for a rotated ellipse mask (24-point approximation).
 */
function _rotatedEllipsePolygon(clipped, mask, angleDeg, aspect) {
  const cx = mask.x + mask.width / 2;
  const cy = mask.y + mask.height / 2;
  const rx = mask.width / 2;
  const ry = mask.height / 2;
  const n = 24;

  const points = [];
  for (let i = 0; i < n; i++) {
    const theta = (2 * Math.PI * i) / n;
    points.push({
      dx: rx * Math.cos(theta),
      dy: ry * Math.sin(theta),
    });
  }

  return _rotateAndProject(points, cx, cy, angleDeg, aspect, clipped);
}
