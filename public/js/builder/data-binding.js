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
      { field: 'gear', label: 'Gear' },
      { field: 'throttle', label: 'Throttle %' },
      { field: 'brake', label: 'Brake %' },
      { field: 'steeringAngle', label: 'Steering Angle' },
      { field: 'engineTemp', label: 'Engine Temp' },
      { field: 'oilPressure', label: 'Oil Pressure' },
      { field: 'fuelLevel', label: 'Fuel Level' },
      { field: 'fuelConsumption', label: 'Fuel Consumption' },
      { field: 'tireTemp_LF', label: 'Tire Temp LF' },
      { field: 'tireTemp_RF', label: 'Tire Temp RF' },
      { field: 'tireTemp_LR', label: 'Tire Temp LR' },
      { field: 'tireTemp_RR', label: 'Tire Temp RR' },
      { field: 'tirePressure_LF', label: 'Tire Pressure LF' },
      { field: 'tirePressure_RF', label: 'Tire Pressure RF' },
      { field: 'tirePressure_LR', label: 'Tire Pressure LR' },
      { field: 'tirePressure_RR', label: 'Tire Pressure RR' },
    ],
  },
  {
    source: 'leaderboard',
    label: 'Leaderboard',
    fields: [
      { field: 'position', label: 'Position' },
      { field: 'driverName', label: 'Driver Name' },
      { field: 'carNumber', label: 'Car Number' },
      { field: 'teamName', label: 'Team Name' },
      { field: 'gapToLeader', label: 'Gap to Leader' },
      { field: 'gapToAhead', label: 'Gap to Car Ahead' },
      { field: 'lastLapTime', label: 'Last Lap Time' },
      { field: 'bestLapTime', label: 'Best Lap Time' },
      { field: 'lapsCompleted', label: 'Laps Completed' },
      { field: 'lapsLed', label: 'Laps Led' },
      { field: 'positionsGained', label: 'Positions Gained' },
    ],
  },
  {
    source: 'lapData',
    label: 'Lap Data',
    fields: [
      { field: 'currentLap', label: 'Current Lap' },
      { field: 'totalLaps', label: 'Total Laps' },
      { field: 'lapTime', label: 'Lap Time' },
      { field: 'sector1', label: 'Sector 1' },
      { field: 'sector2', label: 'Sector 2' },
      { field: 'sector3', label: 'Sector 3' },
      { field: 'personalBest', label: 'Personal Best' },
      { field: 'sessionBest', label: 'Session Best' },
      { field: 'deltaToPersonalBest', label: 'Delta to PB' },
      { field: 'deltaToSessionBest', label: 'Delta to Session Best' },
    ],
  },
  {
    source: 'carStatus',
    label: 'Car Status',
    fields: [
      { field: 'drsActive', label: 'P2P Active' },
      { field: 'drsAvailable', label: 'P2P Available' },
      { field: 'pitLimiter', label: 'Pit Limiter' },
      { field: 'fuelMix', label: 'Fuel Mix' },
      { field: 'weightAdjust', label: 'Weight Adjust' },
      { field: 'damageLevel', label: 'Damage Level' },
    ],
  },
  {
    source: 'pitStatus',
    label: 'Pit Status',
    fields: [
      { field: 'inPitLane', label: 'In Pit Lane' },
      { field: 'pitStopCount', label: 'Pit Stop Count' },
      { field: 'lastPitDuration', label: 'Last Pit Duration' },
      { field: 'totalPitTime', label: 'Total Pit Time' },
      { field: 'pitWindow', label: 'Pit Window' },
      { field: 'nextPitEstimate', label: 'Next Pit Estimate' },
      { field: 'tireCompound', label: 'Tire Compound' },
      { field: 'tireAge', label: 'Tire Age (laps)' },
    ],
  },
  {
    source: 'raceState',
    label: 'Race State',
    fields: [
      { field: 'flagStatus', label: 'Flag Status' },
      { field: 'sessionType', label: 'Session Type' },
      { field: 'timeRemaining', label: 'Time Remaining' },
      { field: 'lapsRemaining', label: 'Laps Remaining' },
      { field: 'trackTemp', label: 'Track Temp' },
      { field: 'airTemp', label: 'Air Temp' },
      { field: 'windSpeed', label: 'Wind Speed' },
      { field: 'windDirection', label: 'Wind Direction' },
      { field: 'humidity', label: 'Humidity' },
    ],
  },
  {
    source: 'referenceData',
    label: 'Reference Data',
    fields: [
      { field: 'driverFirstName', label: 'First Name' },
      { field: 'driverLastName', label: 'Last Name' },
      { field: 'driverShortName', label: 'Short Name' },
      { field: 'nationality', label: 'Nationality' },
      { field: 'teamColor', label: 'Team Color' },
      { field: 'carNumber', label: 'Car Number' },
      { field: 'engineManufacturer', label: 'Engine Mfr' },
      { field: 'chassisManufacturer', label: 'Chassis Mfr' },
      { field: 'driverHeadshot', label: 'Driver Headshot URL' },
      { field: 'teamLogo', label: 'Team Logo URL' },
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
  'telemetry.speed': '218',
  'telemetry.rpm': '12,450',
  'telemetry.gear': '6',
  'telemetry.throttle': '97',
  'telemetry.brake': '0',
  'telemetry.steeringAngle': '-2.4',
  'telemetry.engineTemp': '225',
  'telemetry.oilPressure': '72',
  'telemetry.fuelLevel': '34.2',
  'telemetry.fuelConsumption': '1.87',
  'telemetry.tireTemp_LF': '198',
  'telemetry.tireTemp_RF': '204',
  'telemetry.tireTemp_LR': '192',
  'telemetry.tireTemp_RR': '197',
  'telemetry.tirePressure_LF': '21.4',
  'telemetry.tirePressure_RF': '21.8',
  'telemetry.tirePressure_LR': '20.1',
  'telemetry.tirePressure_RR': '20.3',
  'leaderboard.position': '3',
  'leaderboard.driverName': 'A. Palou',
  'leaderboard.carNumber': '10',
  'leaderboard.teamName': 'Chip Ganassi Racing',
  'leaderboard.gapToLeader': '+1.234',
  'leaderboard.gapToAhead': '+0.567',
  'leaderboard.lastLapTime': '1:05.432',
  'leaderboard.bestLapTime': '1:04.891',
  'leaderboard.lapsCompleted': '42',
  'leaderboard.lapsLed': '12',
  'leaderboard.positionsGained': '+2',
  'lapData.currentLap': '42',
  'lapData.totalLaps': '200',
  'lapData.lapTime': '1:05.432',
  'lapData.sector1': '22.145',
  'lapData.sector2': '21.890',
  'lapData.sector3': '21.397',
  'lapData.personalBest': '1:04.891',
  'lapData.sessionBest': '1:04.223',
  'lapData.deltaToPersonalBest': '+0.541',
  'lapData.deltaToSessionBest': '+1.209',
  'carStatus.drsActive': 'ON',
  'carStatus.drsAvailable': '150s',
  'carStatus.pitLimiter': 'OFF',
  'carStatus.fuelMix': 'Standard',
  'carStatus.weightAdjust': '0',
  'carStatus.damageLevel': 'None',
  'pitStatus.inPitLane': 'No',
  'pitStatus.pitStopCount': '2',
  'pitStatus.lastPitDuration': '8.12s',
  'pitStatus.totalPitTime': '16.45s',
  'pitStatus.pitWindow': 'Lap 60-70',
  'pitStatus.nextPitEstimate': 'Lap 65',
  'pitStatus.tireCompound': 'Primary',
  'pitStatus.tireAge': '18',
  'raceState.flagStatus': 'Green',
  'raceState.sessionType': 'Race',
  'raceState.timeRemaining': '1:42:15',
  'raceState.lapsRemaining': '158',
  'raceState.trackTemp': '115',
  'raceState.airTemp': '82',
  'raceState.windSpeed': '12',
  'raceState.windDirection': 'NW',
  'raceState.humidity': '45',
  'referenceData.driverFirstName': 'Alex',
  'referenceData.driverLastName': 'Palou',
  'referenceData.driverShortName': 'PAL',
  'referenceData.nationality': 'ESP',
  'referenceData.teamColor': '#DC0000',
  'referenceData.carNumber': '10',
  'referenceData.engineManufacturer': 'Honda',
  'referenceData.chassisManufacturer': 'Dallara',
  'referenceData.driverHeadshot': '/assets/headshots/palou.png',
  'referenceData.teamLogo': '/assets/logos/ganassi.png',
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
