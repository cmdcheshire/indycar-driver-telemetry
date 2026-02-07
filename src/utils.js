/**
 * Returns the ordinal suffix for a number (1 → 'st', 2 → 'nd', 3 → 'rd', etc.).
 */
function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Rounds a numeric string to 3 decimal places. Returns the original string if not a valid number.
 */
function toFixedDecimal(input) {
  const number = parseFloat(input);
  if (isNaN(number)) return input;
  return number.toFixed(3);
}

/**
 * Rounds a numeric string to a whole number. Returns the original string if not a valid number.
 */
function toFixedWhole(input) {
  const number = parseFloat(input);
  if (isNaN(number)) return input;
  return number.toFixed(0);
}

/**
 * Converts a seconds string (e.g. "75.123") to "M:SS.000" format.
 * Returns the original string if the format is invalid.
 */
function secondsToLapTime(timeString) {
  if (typeof timeString !== 'string' || !/^\d+(\.\d*)?$/.test(timeString)) {
    return timeString;
  }

  const parts = timeString.split('.');
  const totalSeconds = parseInt(parts[0], 10);
  const milliseconds = parts[1] ? parts[1].padEnd(3, '0').substring(0, 3) : '000';
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = String(totalSeconds % 60).padStart(2, '0');

  return `${minutes}:${remainingSeconds}.${milliseconds}`;
}

module.exports = { getOrdinal, toFixedDecimal, toFixedWhole, secondsToLapTime };
