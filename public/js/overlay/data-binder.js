/**
 * Data binder.
 *
 * Receives live data updates (telemetry, leaderboard, lap, pit, carStatus, flag),
 * resolves template bindings, and updates the DOM only when values change.
 */

import { updateElementText, updateElementStyle, updateGaugeValue } from './element-renderer.js';
import { GsapAnimationEngine } from './gsap-animation-engine.js';

// ---------------------------------------------------------------------------
// Formatting utilities
// ---------------------------------------------------------------------------

/**
 * Convert a time in seconds to a lap-time string.
 *   75.234 -> "1:15.234"
 *   62.1   -> "1:02.100"
 *    9.45  -> "0:09.450"
 *
 * @param {number|string} seconds
 * @returns {string}
 */
export function secondsToLapTime(seconds) {
  const s = parseFloat(seconds);
  if (isNaN(s)) return '--:--.---';

  const mins       = Math.floor(s / 60);
  const secs       = s - mins * 60;
  const secsWhole  = Math.floor(secs);
  const millis     = Math.round((secs - secsWhole) * 1000);

  const secsPad   = String(secsWhole).padStart(2, '0');
  const millisPad = String(millis).padStart(3, '0');

  return `${mins}:${secsPad}.${millisPad}`;
}

/**
 * Return the ordinal suffix for a number.
 *   1 -> "st", 2 -> "nd", 3 -> "rd", 4 -> "th", 11 -> "th", 21 -> "st"
 *
 * @param {number|string} n
 * @returns {string}
 */
export function getOrdinal(n) {
  const num = parseInt(n, 10);
  if (isNaN(num)) return '';

  const mod100 = num % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';

  switch (num % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

// ---------------------------------------------------------------------------
// DataBinder class
// ---------------------------------------------------------------------------

export class DataBinder {
  /**
   * @param {Array}  elements        - The template elements array (from template.elements).
   * @param {Map}    domMap          - Map of element.id -> DOM node.
   * @param {GsapAnimationEngine} [animationEngine] - Shared engine (creates own if omitted).
   */
  constructor(elements, domMap, animationEngine) {
    /** All template element definitions */
    this._elements = elements || [];

    /** element.id -> DOM node */
    this._domMap = domMap || new Map();

    /** Data store keyed by type: { telemetry: {...}, leaderboard: {...}, ... } */
    this._dataStore = {};

    /** Previous resolved values keyed by element id (for dirty checking) */
    this._previousValues = {};

    /** Target car numbers: e.g. ['27', '10'] */
    this._targetCars = [];

    /** Filter to only data-type elements for faster iteration */
    this._dataElements = this._elements.filter(el => el.type === 'data');

    /** Filter to gauge-type elements for visual data binding */
    this._gaugeTypes = new Set(['arcGauge', 'barGauge', 'ringSegment']);
    this._gaugeElements = this._elements.filter(el => this._gaugeTypes.has(el.type));

    /** Previous gauge values for dirty checking */
    this._previousGaugeValues = {};

    /** Smoothed gauge values for interpolation */
    this._smoothedGaugeValues = {};

    /**
     * Previous rank assignments: elementId -> { carNumber, rank }
     * Used to detect when the car at a given byRank slot changes and
     * trigger position transition animations.
     */
    this._previousRanks = new Map();

    /** Animation engine instance for position transitions and emphasis */
    this._animationEngine = animationEngine || new GsapAnimationEngine(domMap);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Store the latest data payload for a given type.
   *
   * @param {string} type - Data type (telemetry, leaderboard, lap, pit, carStatus, flag).
   * @param {*}      data - The data payload.
   */
  updateData(type, data) {
    this._dataStore[type] = data;
  }

  /**
   * Merge a single-car data object into the existing array for a given type.
   * Used for events (lap, pit, carStatus) that emit one car at a time.
   *
   * @param {string} type - Data type key.
   * @param {Object} carData - Single car data object.
   */
  mergeCarData(type, carData) {
    if (!carData) return;

    const carNumber = String(carData.carNumber || carData.Car || carData.car || '');
    if (!carNumber) {
      this._dataStore[type] = carData;
      return;
    }

    const existing = this._dataStore[type];
    if (Array.isArray(existing)) {
      const idx = existing.findIndex(item =>
        String(item.carNumber || item.Car || item.car) === carNumber
      );
      if (idx !== -1) {
        existing[idx] = carData;
      } else {
        existing.push(carData);
      }
    } else {
      this._dataStore[type] = [carData];
    }
  }

  /**
   * Set target car numbers (used to resolve selectors like target1, target2).
   *
   * @param {Array<string|number>} cars - Array of car numbers.
   */
  setTargetCars(cars) {
    this._targetCars = (cars || []).map(String);
  }

  /**
   * Walk every data-bound element, resolve its current value from the store,
   * and update the DOM if it has changed.
   */
  resolveBindings() {
    // Build a snapshot of current rank -> carNumber mapping for position tracking
    const currentRankMap = this._buildCurrentRankMap();

    for (const element of this._dataElements) {
      const domNode = this._domMap.get(element.id);
      if (!domNode) continue;

      const binding = {
        source:   element.source,
        field:    element.field,
        car:      element.car,
        format:   element.format,
        prefix:   element.prefix   || '',
        suffix:   element.suffix   || '',
        fallback: element.fallback || '',
      };

      // Check for byRank position changes and trigger animations
      this._checkRankTransition(element, currentRankMap);

      // Resolve the raw value
      const rawValue = this.resolveValue(binding);

      // Format it
      const formatted = this.formatValue(rawValue, binding);

      // Build the display string
      const display = rawValue !== undefined && rawValue !== null && rawValue !== ''
        ? `${binding.prefix}${formatted}${binding.suffix}`
        : binding.fallback;

      // Dirty check: only touch the DOM if the value changed
      if (this._previousValues[element.id] !== display) {
        const isFirstRender = this._previousValues[element.id] === undefined;
        this._previousValues[element.id] = display;

        // Use crossfade transition on subsequent renders if configured
        if (!isFirstRender && element.updateAnimation === 'crossfade') {
          this._animationEngine.updateValue(element.id, display, 'crossfade', element.updateAnimationDuration || 300);
        } else {
          updateElementText(domNode, display);
        }

        // Evaluate conditional styles
        this.evaluateConditionalStyles(element, rawValue, domNode);

        // Trigger emphasis animation on value change
        if (element.emphasisType && element.emphasisType !== 'none') {
          const trigger = element.emphasisTrigger || 'onChange';
          if (trigger === 'onChange') {
            this._animationEngine.playEmphasis(element.id, {
              type: element.emphasisType,
              duration: element.emphasisDuration || 400,
              repeat: element.emphasisRepeat || 0,
            });
          }
        }
      }
    }
  }

  /**
   * Walk every gauge-bound element, resolve its current numeric value,
   * and update the DOM gauge visual if it has changed.
   * Supports optional smoothing for low-frequency data sources.
   */
  resolveGaugeBindings() {
    for (const element of this._gaugeElements) {
      const domNode = this._domMap.get(element.id);
      if (!domNode) continue;

      const binding = {
        source: element.source,
        field:  element.field,
        car:    element.car,
      };

      const rawValue = this.resolveValue(binding);
      if (rawValue === undefined || rawValue === null) continue;

      const numValue = parseFloat(rawValue);
      if (isNaN(numValue)) continue;

      // Apply smoothing if enabled
      const smoothing = element.smoothing || parseFloat(domNode.getAttribute('data-smoothing')) || 0;
      let displayValue = numValue;

      if (smoothing > 0) {
        const prev = this._smoothedGaugeValues[element.id];
        if (prev !== undefined) {
          // Exponential moving average: factor 0–1, higher = smoother
          const alpha = Math.max(0.05, Math.min(1, 1 - smoothing));
          displayValue = prev + alpha * (numValue - prev);
        }
        this._smoothedGaugeValues[element.id] = displayValue;
      }

      // Dirty check — only update DOM if value changed (with small epsilon for floats)
      const prev = this._previousGaugeValues[element.id];
      if (prev !== undefined && Math.abs(prev - displayValue) < 0.01) continue;
      this._previousGaugeValues[element.id] = displayValue;

      // Update gauge visual via GSAP micro-tween or direct DOM update
      if (this._animationEngine && smoothing > 0) {
        this._animationEngine.tweenGauge(element.id, displayValue, element, 100);
      } else {
        updateGaugeValue(domNode, displayValue, element);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Value resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve the raw value for a binding from the data store.
   *
   * @param {Object} binding - { source, field, car }
   * @returns {*} The resolved value, or undefined.
   */
  resolveValue(binding) {
    const { source, field, car } = binding;
    if (!source || !field) return undefined;

    const data = this._dataStore[source];
    if (!data) return undefined;

    // If the data is an array of car entries (telemetry, leaderboard, carStatus, etc.)
    if (Array.isArray(data)) {
      const carNumber = this.resolveCarNumber(car);
      if (!carNumber) return undefined;

      // Find the entry matching the car number
      const entry = data.find(item =>
        String(item.carNumber || item.Car || item.car) === String(carNumber)
      );

      return entry ? entry[field] : undefined;
    }

    // If the data is a plain object (flag, race info, etc.)
    if (typeof data === 'object') {
      // If there is a car selector, look inside a nested car structure
      if (car) {
        const carNumber = this.resolveCarNumber(car);
        if (carNumber && data[carNumber]) {
          return data[carNumber][field];
        }
      }
      return data[field];
    }

    return undefined;
  }

  /**
   * Resolve a car selector to a concrete car number.
   *
   * Supported selectors:
   *   "target1"      -> targetCars[0]
   *   "target2"      -> targetCars[1]
   *   "targetN"      -> targetCars[N-1]
   *   "byRank:N"     -> find car at rank N in telemetry/leaderboard data
   *   "byCar:X"      -> literal car number X
   *   plain number   -> literal car number
   *
   * @param {string} selector
   * @returns {string|undefined}
   */
  resolveCarNumber(selector) {
    if (!selector) return undefined;

    const selectorStr = String(selector);

    // target1, target2, etc.
    const targetMatch = selectorStr.match(/^target(\d+)$/);
    if (targetMatch) {
      const idx = parseInt(targetMatch[1], 10) - 1;
      return this._targetCars[idx] || undefined;
    }

    // byRank:N - look up the car occupying rank N
    const rankMatch = selectorStr.match(/^byRank:(\d+)$/);
    if (rankMatch) {
      const targetRank = rankMatch[1];
      return this._findCarByRank(targetRank);
    }

    // byCar:X - literal car number
    const carMatch = selectorStr.match(/^byCar:(.+)$/);
    if (carMatch) {
      return carMatch[1];
    }

    // Plain number or string
    return selectorStr;
  }

  // -----------------------------------------------------------------------
  // Formatting
  // -----------------------------------------------------------------------

  /**
   * Apply a format to a raw value.
   *
   * @param {*}      value   - The raw value.
   * @param {Object} binding - The binding descriptor.
   * @returns {string}
   */
  formatValue(value, binding) {
    if (value === undefined || value === null || value === '') {
      return '';
    }

    const format = binding.format;
    if (!format) return String(value);

    switch (format) {
      case 'speed':
        return parseFloat(value).toFixed(0);

      case 'rpm':
        return parseFloat(value).toFixed(0);

      case 'throttle':
      case 'brake':
        return parseFloat(value).toFixed(0);

      case 'lapTime':
        return secondsToLapTime(value);

      case 'delta': {
        const num = parseFloat(value);
        if (isNaN(num)) return String(value);
        const sign = num >= 0 ? '+' : '';
        return `${sign}${num.toFixed(3)}`;
      }

      case 'ordinal': {
        const num = parseInt(value, 10);
        if (isNaN(num)) return String(value);
        return `${num}${getOrdinal(num)}`;
      }

      case 'integer':
        return parseInt(value, 10).toString();

      case 'float1':
        return parseFloat(value).toFixed(1);

      case 'float2':
        return parseFloat(value).toFixed(2);

      case 'float3':
        return parseFloat(value).toFixed(3);

      case 'percentage':
        return `${parseFloat(value).toFixed(0)}%`;

      case 'boolean':
        return value === 'True' || value === true || value === '1' ? 'YES' : 'NO';

      case 'time':
        // Pass through HH:MM:SS.mmm formatted times
        return String(value);

      default:
        return String(value);
    }
  }

  // -----------------------------------------------------------------------
  // Conditional styles
  // -----------------------------------------------------------------------

  /**
   * Evaluate and apply conditional styles based on value.
   *
   * @param {Object}      element - The template element definition.
   * @param {*}            value   - The raw resolved value.
   * @param {HTMLElement}  domNode - The DOM node to style.
   */
  evaluateConditionalStyles(element, value, domNode) {
    // If the element defines explicit conditions, use those
    if (element.conditions && Array.isArray(element.conditions)) {
      for (const condition of element.conditions) {
        if (this._evaluateCondition(condition, value)) {
          updateElementStyle(domNode, condition.styles);
          return;
        }
      }
      // No condition matched: reset to default styles if provided
      if (element.defaultStyles) {
        updateElementStyle(domNode, element.defaultStyles);
      }
      return;
    }

    // Built-in heuristics for common patterns
    if (element.format === 'delta') {
      const num = parseFloat(value);
      if (!isNaN(num)) {
        if (num < 0) {
          updateElementStyle(domNode, { color: '#00e676' }); // green (gaining)
        } else if (num > 0) {
          updateElementStyle(domNode, { color: '#ff5252' }); // red (losing)
        } else {
          updateElementStyle(domNode, { color: element.color || '#ffffff' });
        }
      }
    }

    // DNF / retired statuses
    const strVal = String(value).toUpperCase();
    if (strVal === 'DNF' || strVal === 'RETIRED' || strVal === 'OUT') {
      updateElementStyle(domNode, { color: '#ff5252' });
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build a map of rank (string) -> carNumber (string) from the current
   * leaderboard data. Used for detecting position changes between resolves.
   *
   * @returns {Map<string, string>} rank -> carNumber
   */
  _buildCurrentRankMap() {
    const rankMap = new Map();
    const leaderboard = this._dataStore.leaderboard;
    if (Array.isArray(leaderboard)) {
      for (const entry of leaderboard) {
        const rank = String(entry.Rank || entry.rank || '');
        const carNumber = String(entry.carNumber || entry.Car || entry.car || '');
        if (rank && carNumber) {
          rankMap.set(rank, carNumber);
        }
      }
    }
    return rankMap;
  }

  /**
   * Check whether the car occupying a byRank slot has changed since the
   * last resolve. If so, determine the old rank of the new occupant and
   * trigger a position transition animation.
   *
   * @param {Object}           element        - The template element definition.
   * @param {Map<string,string>} currentRankMap - Current rank -> carNumber map.
   */
  _checkRankTransition(element, currentRankMap) {
    const carSelector = element.car;
    if (!carSelector) return;

    const selectorStr = String(carSelector);
    const rankMatch = selectorStr.match(/^byRank:(\d+)$/);
    if (!rankMatch) return;

    const currentRank = parseInt(rankMatch[1], 10);
    const currentCar = currentRankMap.get(String(currentRank));
    if (!currentCar) return;

    const prev = this._previousRanks.get(element.id);

    if (prev && prev.carNumber !== currentCar) {
      // The car at this rank slot changed - find where the new car was before
      const previousRankOfNewCar = prev.carNumber !== currentCar
        ? this._findPreviousRank(currentCar)
        : null;

      if (previousRankOfNewCar !== null && previousRankOfNewCar !== currentRank) {
        // Determine row height from the DOM element or use a sensible default
        const domNode = this._domMap.get(element.id);
        const rowHeight = domNode
          ? (domNode.offsetHeight || domNode.getBoundingClientRect().height || 40)
          : 40;

        this._animationEngine.animatePosition(
          element.id,
          previousRankOfNewCar,
          currentRank,
          rowHeight,
          400
        );
      }
    }

    // Store the current assignment for next comparison
    this._previousRanks.set(element.id, { carNumber: currentCar, rank: currentRank });
  }

  /**
   * Look up the previous rank of a car number from stored _previousRanks data.
   *
   * @param {string} carNumber - The car number to find.
   * @returns {number|null} The previous rank, or null if not found.
   */
  _findPreviousRank(carNumber) {
    for (const [, entry] of this._previousRanks) {
      if (entry.carNumber === carNumber) {
        return entry.rank;
      }
    }
    return null;
  }

  /**
   * Find a car number by its rank in available leaderboard/telemetry data.
   */
  _findCarByRank(rank) {
    const targetRank = String(rank);

    // Try leaderboard first
    const leaderboard = this._dataStore.leaderboard;
    if (Array.isArray(leaderboard)) {
      const entry = leaderboard.find(item => String(item.Rank || item.rank) === targetRank);
      if (entry) return String(entry.carNumber || entry.Car || entry.car);
    }

    // Fall back to telemetry
    const telemetry = this._dataStore.telemetry;
    if (Array.isArray(telemetry)) {
      const entry = telemetry.find(item => String(item.Rank || item.rank) === targetRank);
      if (entry) return String(entry.carNumber || entry.Car || entry.car);
    }

    return undefined;
  }

  /**
   * Evaluate a single condition object against a value.
   *
   * Condition shape:
   *   { operator: 'lt'|'gt'|'eq'|'lte'|'gte'|'neq'|'contains', threshold: ..., styles: {...} }
   */
  _evaluateCondition(condition, value) {
    const { operator, threshold } = condition;
    const numVal = parseFloat(value);
    const numThreshold = parseFloat(threshold);

    switch (operator) {
      case 'lt':
        return !isNaN(numVal) && numVal < numThreshold;
      case 'gt':
        return !isNaN(numVal) && numVal > numThreshold;
      case 'eq':
        return String(value) === String(threshold);
      case 'lte':
        return !isNaN(numVal) && numVal <= numThreshold;
      case 'gte':
        return !isNaN(numVal) && numVal >= numThreshold;
      case 'neq':
        return String(value) !== String(threshold);
      case 'contains':
        return String(value).includes(String(threshold));
      default:
        return false;
    }
  }
}
