const path = require('path');

module.exports = {
  // Google Sheets
  SPREADSHEET_ID: '1UIpgq72cvEUT-qvEB4gmwDjvFU4CDIXf2rllNseYEUM',
  GOOGLE_TELEMETRY_SERVICE_ACCOUNT_KEY_PATH: path.resolve(__dirname, '..', 'indycar-live-data-telemetry-account.json'),
  GOOGLE_LEADERBOARD_SERVICE_ACCOUNT_KEY_PATH: path.resolve(__dirname, '..', 'indycar-live-data-leaderboard-account.json'),

  // Sheet names
  CONTROLLER_SHEET_NAME: 'Live Data Controller',
  LEADERBOARD_SHEET_NAME: 'Live Leaderboard',
  TELEMETRY_SHEET_NAME: 'Live Telemetry',
  DRIVERINFO_SHEET_NAME: 'Live Driver Info',
  DATABASE_SHEET_NAME: 'Database',

  // Control cells
  IP_ADDRESS_PORT_RANGE: 'E8:E9',
  TELEMETRY_ONLINE_CHECKBOX_CELL: 'B4',
  TARGET_CAR_CELL: 'B5',
  TARGET_CAR_2_CELL: 'B6',
  TARGET_CAR_3_CELL: 'B7',

  // Update intervals (ms)
  LEADERBOARD_UPDATE_INTERVAL: 2000,
  DRIVER_INFO_UPDATE_INTERVAL: 2000,
  ONLINE_CHECK_INTERVAL: 10000,

  // TCP defaults
  DEFAULT_TCP_HOST: 'localhost',
  DEFAULT_TCP_PORT: 5000,
  RECONNECT_DELAY: 5000,
};
