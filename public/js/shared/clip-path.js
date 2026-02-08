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
 * @param {object} mask    - The mask element: { x, y, width, height, props? }
 * @returns {string|null}  CSS clip-path value, or null if inputs are invalid
 */
export function computeClipPath(clipped, mask) {
  if (!clipped || !mask) return null;
  if (!clipped.width || !clipped.height) return null;

  // Mask's position relative to the clipped element, as percentages of the clipped element's size
  const relLeft = ((mask.x - clipped.x) / clipped.width) * 100;
  const relTop = ((mask.y - clipped.y) / clipped.height) * 100;
  const relRight = (((mask.x + mask.width) - clipped.x) / clipped.width) * 100;
  const relBottom = (((mask.y + mask.height) - clipped.y) / clipped.height) * 100;

  const shapeType = mask.props?.shapeType || mask.shapeType || 'rectangle';

  if (shapeType === 'ellipse') {
    const rx = (relRight - relLeft) / 2;
    const ry = (relBottom - relTop) / 2;
    const cx = relLeft + rx;
    const cy = relTop + ry;
    return `ellipse(${rx}% ${ry}% at ${cx}% ${cy}%)`;
  }

  // Rectangle: clip-path: inset(top right bottom left [round borderRadius])
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
