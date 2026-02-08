/**
 * Snap engine for aligning elements to grid, canvas center, and other element edges.
 */

const SNAP_THRESHOLD = 1.5; // percentage
const GRID_INTERVAL = 5;    // percentage

export class SnapEngine {
  /** @type {HTMLElement} */
  #container;
  /** @type {HTMLElement[]} */
  #activeGuides = [];
  /** @type {boolean} */
  #enabled = true;

  /**
   * @param {HTMLElement} canvasContainer - The .canvas-container element
   */
  constructor(canvasContainer) {
    this.#container = canvasContainer;
  }

  /** @returns {boolean} */
  get enabled() { return this.#enabled; }

  /** @param {boolean} val */
  set enabled(val) { this.#enabled = !!val; }

  /**
   * Generate snap target positions (X and Y) from grid, canvas center, and other elements.
   * @param {string} excludeId - Element ID to exclude (the element being moved)
   * @param {object[]} allElements - All canvas elements
   * @returns {{ x: number[], y: number[] }}
   */
  getSnapTargets(excludeId, allElements) {
    const xTargets = new Set();
    const yTargets = new Set();

    // Grid targets at 5% intervals
    for (let i = 0; i <= 100; i += GRID_INTERVAL) {
      xTargets.add(i);
      yTargets.add(i);
    }

    // Canvas center
    xTargets.add(50);
    yTargets.add(50);

    // Other element edges and centers
    for (const el of allElements) {
      if (el.id === excludeId || !el.visible) continue;

      // Left, center, right edges
      xTargets.add(el.x);
      xTargets.add(el.x + el.width / 2);
      xTargets.add(el.x + el.width);

      // Top, center, bottom edges
      yTargets.add(el.y);
      yTargets.add(el.y + el.height / 2);
      yTargets.add(el.y + el.height);
    }

    return {
      x: Array.from(xTargets),
      y: Array.from(yTargets),
    };
  }

  /**
   * Snap a value to the nearest target within threshold.
   * @param {number} value - Current value (percentage)
   * @param {number[]} targets - Array of snap target values
   * @returns {number|null} Snapped value, or null if nothing is close enough
   */
  snap(value, targets) {
    if (!this.#enabled) return null;

    let closest = null;
    let closestDist = SNAP_THRESHOLD;

    for (const target of targets) {
      const dist = Math.abs(value - target);
      if (dist < closestDist) {
        closest = target;
        closestDist = dist;
      }
    }

    return closest;
  }

  /**
   * Render alignment guide lines on the canvas.
   * @param {number|null} snappedX - X position to show vertical guide, or null
   * @param {number|null} snappedY - Y position to show horizontal guide, or null
   */
  renderGuides(snappedX, snappedY) {
    this.clearGuides();
    if (!this.#enabled) return;

    if (snappedX !== null) {
      const guide = document.createElement('div');
      guide.className = 'snap-guide vertical';
      guide.style.left = `${snappedX}%`;
      this.#container.appendChild(guide);
      this.#activeGuides.push(guide);
    }

    if (snappedY !== null) {
      const guide = document.createElement('div');
      guide.className = 'snap-guide horizontal';
      guide.style.top = `${snappedY}%`;
      this.#container.appendChild(guide);
      this.#activeGuides.push(guide);
    }
  }

  /**
   * Remove all visible guide lines.
   */
  clearGuides() {
    for (const guide of this.#activeGuides) {
      guide.remove();
    }
    this.#activeGuides = [];
  }
}
