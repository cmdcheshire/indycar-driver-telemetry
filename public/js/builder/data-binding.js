/**
 * Data binding configuration constants and preview resolver for the overlay builder.
 * Defines the available telemetry sources, fields, car selectors, and formatters.
 */

/**
 * Available data binding sources and their fields.
 */
export const BINDING_SOURCES = [
  {
    source: 'telemetry',
    label: 'Telemetry',
    fields: [
      { field: 'speed', label: 'Speed (mph)' },
      { field: 'rpm', label: 'RPM' },
      { field: 'throttle', label: 'Throttle %' },
      { field: 'brake', label: 'Brake %' },
      { field: 'battery', label: 'Battery %' },
      { field: 'rank', label: 'Position' },
      { field: 'carNumber', label: 'Car Number' },
    ],
  },
  {
    source: 'leaderboard',
    label: 'Leaderboard',
    fields: [
      { field: 'Rank', label: 'Position' },
      { field: 'Car', label: 'Car Number' },
      { field: 'Time_Behind', label: 'Time Behind Leader' },
      { field: 'Laps_Behind', label: 'Laps Behind Leader' },
    ],
  },
  {
    source: 'lapData',
    label: 'Lap Data',
    fields: [
      { field: 'lastLapNumber', label: 'Last Lap Number' },
      { field: 'lastLapTime', label: 'Last Lap Time' },
      { field: 'fastestLap', label: 'Fastest Lap Number' },
      { field: 'totalTime', label: 'Total Time' },
      { field: 'lapsBehindLeader', label: 'Laps Behind Leader' },
      { field: 'timeBehindLeader', label: 'Time Behind Leader' },
      { field: 'lastLapDelta', label: 'Last Lap Delta' },
      { field: 'averageSpeed', label: 'Average Speed' },
    ],
  },
  {
    source: 'carStatus',
    label: 'Car Status',
    fields: [
      { field: 'carStatus', label: 'Status (Running/DNF)' },
    ],
  },
  {
    source: 'pitStatus',
    label: 'Pit Status',
    fields: [
      { field: 'pitStatus', label: 'In Pit Lane' },
      { field: 'pitStops', label: 'Pit Stop Count' },
    ],
  },
  {
    source: 'raceState',
    label: 'Race State',
    fields: [
      { field: 'flagColor', label: 'Flag Color' },
      { field: 'currentLap', label: 'Current Lap' },
      { field: 'lapsCompleted', label: 'Laps Completed' },
      { field: 'timeElapsed', label: 'Time Elapsed' },
    ],
  },
];

/**
 * Car selector options - how to target which car's data to show.
 */
export const CAR_SELECTORS = [
  { value: 'target1', label: 'Target 1 (Primary)' },
  { value: 'target2', label: 'Target 2 (Secondary)' },
  { value: 'target3', label: 'Target 3 (Tertiary)' },
  { value: 'byRank', label: 'By Race Position' },
  { value: 'byCar', label: 'By Car Number' },
];

/**
 * Format options for data values.
 */
export const FORMATTERS = [
  { value: 'raw', label: 'Raw Value' },
  { value: 'speed', label: 'Speed (xxx mph)' },
  { value: 'lapTime', label: 'Lap Time (m:ss.xxx)' },
  { value: 'delta', label: 'Delta (+/- x.xxx)' },
  { value: 'ordinal', label: 'Ordinal (1st, 2nd...)' },
  { value: 'number', label: 'Number (comma separated)' },
  { value: 'percentage', label: 'Percentage (xx%)' },
  { value: 'temperature', label: 'Temperature (xxx F)' },
];

/**
 * Sample preview values for the builder, keyed by source.field.
 */
const PREVIEW_VALUES = {
  // Telemetry
  'telemetry.speed': '218',
  'telemetry.rpm': '12450',
  'telemetry.throttle': '97',
  'telemetry.brake': '0',
  'telemetry.battery': '84',
  'telemetry.rank': '3',
  'telemetry.carNumber': '10',
  // Leaderboard
  'leaderboard.Rank': '3',
  'leaderboard.Car': '10',
  'leaderboard.Time_Behind': '1.234',
  'leaderboard.Laps_Behind': '0',
  // Lap Data
  'lapData.lastLapNumber': '42',
  'lapData.lastLapTime': '65.432',
  'lapData.fastestLap': '38',
  'lapData.totalTime': '2745.891',
  'lapData.lapsBehindLeader': '0',
  'lapData.timeBehindLeader': '1.234',
  'lapData.lastLapDelta': '+0.541',
  'lapData.averageSpeed': '218.4',
  // Car Status
  'carStatus.carStatus': 'Running',
  // Pit Status
  'pitStatus.pitStatus': 'false',
  'pitStatus.pitStops': '2',
  // Race State
  'raceState.flagColor': 'Green',
  'raceState.currentLap': '43',
  'raceState.lapsCompleted': '42',
  'raceState.timeElapsed': '0:45:12.345',
};

/**
 * Resolve a binding configuration to a sample preview value for display in the builder.
 * @param {{ bindingSource: string, bindingField: string, format: string }} binding
 * @returns {string} Preview value string
 */
export function resolveBindingPreview(binding) {
  if (!binding || !binding.bindingSource || !binding.bindingField) {
    return '---';
  }

  const key = `${binding.bindingSource}.${binding.bindingField}`;
  const raw = PREVIEW_VALUES[key];

  if (raw === undefined) return '???';

  return applyFormat(raw, binding.format || 'raw');
}

/**
 * Get the fields for a given source.
 * @param {string} sourceName
 * @returns {Array<{field: string, label: string}>}
 */
export function getFieldsForSource(sourceName) {
  const source = BINDING_SOURCES.find(s => s.source === sourceName);
  return source ? source.fields : [];
}

/**
 * Apply a format to a raw value string.
 * @param {string} raw
 * @param {string} format
 * @returns {string}
 */
function applyFormat(raw, format) {
  switch (format) {
    case 'speed':
      return `${raw} mph`;
    case 'lapTime':
      return raw; // Already formatted in preview values
    case 'delta': {
      const num = parseFloat(raw);
      if (isNaN(num)) return raw;
      return num >= 0 ? `+${num.toFixed(3)}` : num.toFixed(3);
    }
    case 'ordinal': {
      const n = parseInt(raw, 10);
      if (isNaN(n)) return raw;
      const s = ['th', 'st', 'nd', 'rd'];
      const v = n % 100;
      return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }
    case 'number': {
      const num = parseFloat(raw.replace(/,/g, ''));
      if (isNaN(num)) return raw;
      return num.toLocaleString();
    }
    case 'percentage':
      return `${raw}%`;
    case 'temperature':
      return `${raw}\u00B0F`;
    case 'raw':
    default:
      return raw;
  }
}
