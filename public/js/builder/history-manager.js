/**
 * Undo/redo history manager.
 * Stores deep-cloned snapshots of the element array.
 */

const MAX_HISTORY = 50;

export class HistoryManager {
  /** @type {object[][]} */
  #undoStack = [];
  /** @type {object[][]} */
  #redoStack = [];
  /** @type {Function|null} */
  #onChange = null;

  /**
   * @param {Function} [onChange] - Called whenever undo/redo availability changes
   */
  constructor(onChange = null) {
    this.#onChange = onChange;
  }

  /**
   * Push a snapshot of the current state onto the undo stack.
   * Clears the redo stack (new branch of history).
   * @param {object[]} state - Array of element objects to snapshot
   */
  push(state) {
    const snapshot = this.#deepClone(state);
    this.#undoStack.push(snapshot);

    // Trim to max size
    if (this.#undoStack.length > MAX_HISTORY) {
      this.#undoStack.shift();
    }

    // Clear redo stack on new action
    this.#redoStack = [];
    this.#notifyChange();
  }

  /**
   * Undo the last action.
   * @returns {object[]|null} The state to restore, or null if nothing to undo
   */
  undo() {
    if (this.#undoStack.length === 0) return null;

    const state = this.#undoStack.pop();
    this.#redoStack.push(state);
    this.#notifyChange();

    // Return the previous state (top of undo stack), or empty if at beginning
    if (this.#undoStack.length > 0) {
      return this.#deepClone(this.#undoStack[this.#undoStack.length - 1]);
    }
    return [];
  }

  /**
   * Redo the last undone action.
   * @returns {object[]|null} The state to restore, or null if nothing to redo
   */
  redo() {
    if (this.#redoStack.length === 0) return null;

    const state = this.#redoStack.pop();
    this.#undoStack.push(state);
    this.#notifyChange();

    return this.#deepClone(state);
  }

  /** @returns {boolean} */
  get canUndo() {
    return this.#undoStack.length > 1; // Need at least 2 to undo (current + previous)
  }

  /** @returns {boolean} */
  get canRedo() {
    return this.#redoStack.length > 0;
  }

  /**
   * Clear all history.
   */
  clear() {
    this.#undoStack = [];
    this.#redoStack = [];
    this.#notifyChange();
  }

  /**
   * Set the change callback.
   * @param {Function} fn
   */
  onChanged(fn) {
    this.#onChange = fn;
  }

  /**
   * Deep clone an array of element objects.
   * @param {object[]} state
   * @returns {object[]}
   */
  #deepClone(state) {
    return JSON.parse(JSON.stringify(state));
  }

  #notifyChange() {
    if (this.#onChange) {
      this.#onChange({ canUndo: this.canUndo, canRedo: this.canRedo });
    }
  }
}
