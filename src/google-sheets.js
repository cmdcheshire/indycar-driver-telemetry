const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const config = require('./config');
const state = require('./race-state');
const { getOrdinal, toFixedDecimal, toFixedWhole, secondsToLapTime } = require('./utils');

let sheets_TelemetryAccount;
let sheets_LeaderboardAccount;

// ──────────────────────────────────────────────
// Authentication
// ──────────────────────────────────────────────

async function authenticateTelemetryAccount() {
  console.log('Authenticating Telemetry service account...');
  const auth = new JWT({
    keyFile: config.GOOGLE_TELEMETRY_SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.authorize();
  sheets_TelemetryAccount = google.sheets({ version: 'v4', auth });
  console.log('Telemetry service account authenticated.');
}

async function authenticateLeaderboardAccount() {
  console.log('Authenticating Leaderboard service account...');
  const auth = new JWT({
    keyFile: config.GOOGLE_LEADERBOARD_SERVICE_ACCOUNT_KEY_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.authorize();
  sheets_LeaderboardAccount = google.sheets({ version: 'v4', auth });
  console.log('Leaderboard service account authenticated.');
}

// ──────────────────────────────────────────────
// Reads (control plane)
// ──────────────────────────────────────────────

async function readIpInformation() {
  try {
    const response = await sheets_LeaderboardAccount.spreadsheets.values.get({
      spreadsheetId: config.SPREADSHEET_ID,
      range: `${config.CONTROLLER_SHEET_NAME}!${config.IP_ADDRESS_PORT_RANGE}`,
    });
    const values = response.data.values;
    if (values && values.length > 1 && values[0].length > 0 && values[1].length > 0) {
      state.tcpHost = values[0].toString();
      state.tcpPort = values[1].toString();
      console.log(`TCP target read from sheet: ${state.tcpHost}:${state.tcpPort}`);
    } else {
      console.warn(`TCP info not found in sheet. Using default: ${state.tcpHost}:${state.tcpPort}`);
    }
  } catch (error) {
    console.error('Error reading TCP info:', error.message);
  }
}

async function readTargetCarNumber(cellRange) {
  try {
    const response = await sheets_LeaderboardAccount.spreadsheets.values.get({
      spreadsheetId: config.SPREADSHEET_ID,
      range: `${config.CONTROLLER_SHEET_NAME}!${cellRange}`,
    });
    const values = response.data.values;
    if (values && values.length > 0 && values[0].length > 0) {
      return values[0][0];
    }
    return null;
  } catch (error) {
    console.error(`Error reading target car (${cellRange}):`, error.message);
    return null;
  }
}

async function readAllTargetCars() {
  state.targetCarNumbers[0] = await readTargetCarNumber(config.TARGET_CAR_CELL);
  state.targetCarNumbers[1] = await readTargetCarNumber(config.TARGET_CAR_2_CELL);
  state.targetCarNumbers[2] = await readTargetCarNumber(config.TARGET_CAR_3_CELL);
  console.log(`Target cars: ${state.targetCarNumbers.join(', ')}`);
}

async function readReferenceData() {
  console.log('Reading reference data from Google Sheet...');
  state.referenceData = {
    drivers: {},
    tireImages: {},
    indicatorImages: {},
    leaderboardImages: {},
  };

  const ranges = [
    `${config.DATABASE_SHEET_NAME}!A2:H50`,
    `${config.DATABASE_SHEET_NAME}!A52:B54`,
    `${config.DATABASE_SHEET_NAME}!A57:B60`,
    `${config.DATABASE_SHEET_NAME}!A63:B73`,
  ];

  for (const range of ranges) {
    const response = await sheets_LeaderboardAccount.spreadsheets.values.get({
      spreadsheetId: config.SPREADSHEET_ID,
      range,
    });

    const values = response.data.values;
    if (!values || values.length === 0) {
      console.warn(`Range ${range} is empty.`);
      continue;
    }

    if (range === `${config.DATABASE_SHEET_NAME}!A2:H50`) {
      for (const row of values) {
        state.referenceData.drivers[row[0]] = {
          carLogo: row[1],
          team: row[2],
          teamLogo: row[3],
          firstName: row[4],
          lastName: row[5],
          displayName: row[6],
          headshot: row[7],
        };
      }
    } else if (range === `${config.DATABASE_SHEET_NAME}!A52:B54`) {
      for (const row of values) {
        state.referenceData.tireImages[row[0]] = row[1];
      }
    } else if (range === `${config.DATABASE_SHEET_NAME}!A57:B60`) {
      for (const row of values) {
        state.referenceData.indicatorImages[row[0]] = row[1];
      }
    } else if (range === `${config.DATABASE_SHEET_NAME}!A63:B73`) {
      for (const row of values) {
        state.referenceData.leaderboardImages[row[0]] = row[1];
      }
    }
  }

  // Initialize per-driver data structures
  state.initializeDriverData();
  console.log(`Reference data loaded: ${Object.keys(state.referenceData.drivers).length} drivers`);
}

async function checkOnlineStatusAndUpdateHeartbeat() {
  try {
    const batchResponse = await sheets_LeaderboardAccount.spreadsheets.values.batchGet({
      spreadsheetId: config.SPREADSHEET_ID,
      ranges: [
        `${config.CONTROLLER_SHEET_NAME}!${config.TELEMETRY_ONLINE_CHECKBOX_CELL}`,
        `${config.CONTROLLER_SHEET_NAME}!A13:A23`,
      ],
    });

    const valueRanges = batchResponse.data.valueRanges;

    // Online status
    const onlineValues = valueRanges[0].values;
    state.isOnline = onlineValues && onlineValues.length > 0 &&
      onlineValues[0].length > 0 && onlineValues[0][0] === 'TRUE';

    // Manual DNF overrides — reset all, then re-apply from sheet
    for (const entry of state.manualDNFOverride) {
      entry.DNF = false;
    }
    const dnfValues = valueRanges[1].values;
    if (dnfValues && dnfValues.length > 0) {
      for (const row of dnfValues) {
        const index = state.manualDNFOverride.findIndex(item => item.carNumber === row[0]);
        if (index !== -1) {
          state.manualDNFOverride[index].DNF = true;
        }
      }
    }

    // Heartbeat
    if (state.isOnline) {
      try {
        await sheets_LeaderboardAccount.spreadsheets.values.update({
          spreadsheetId: config.SPREADSHEET_ID,
          range: `${config.CONTROLLER_SHEET_NAME}!A2`,
          valueInputOption: 'RAW',
          resource: { values: [[new Date().toISOString()]] },
        });
      } catch (e) {
        console.error('Error updating heartbeat:', e.message);
      }
    }

    console.log(`Online: ${state.isOnline}`);
    return state.isOnline;
  } catch (error) {
    console.error('Error checking online status:', error.message);
    return false;
  }
}

// ──────────────────────────────────────────────
// Writes (output)
// ──────────────────────────────────────────────

function buildDriverInfoUpdate(carNumber, startingRow) {
  const driverRef = state.referenceData.drivers[carNumber];
  if (!driverRef) return [];

  const lapIndex = state.lapData.findIndex(item => item.carNumber === carNumber);
  const lapInfo = state.lapData[lapIndex];
  if (!lapInfo) return [];

  const lbIndex = state.leaderboard.findIndex(item => item.Car === carNumber);
  const lbInfo = state.leaderboard[lbIndex];
  if (!lbInfo) return [];

  const telIndex = state.telemetry.findIndex(item => item.carNumber === carNumber);
  const telInfo = state.telemetry[telIndex];
  if (!telInfo) return [];

  const avgIndex = state.averageSpeed.findIndex(item => item.carNumber === carNumber);
  const avgInfo = state.averageSpeed[avgIndex];
  if (!avgInfo) return [];

  const ltIndex = state.allLapTimes.findIndex(item => item.carNumber === carNumber);
  const ltInfo = state.allLapTimes[ltIndex];
  if (!ltInfo) return [];

  // Drivers ahead/behind
  const aheadLb = lbIndex > 0 ? state.leaderboard[lbIndex - 1] : null;
  const aheadRef = aheadLb ? state.referenceData.drivers[aheadLb.Car] : null;
  const behindLb = lbIndex < state.leaderboard.length - 1 ? state.leaderboard[lbIndex + 1] : null;
  const behindRef = behindLb ? state.referenceData.drivers[behindLb.Car] : null;

  const carState = state.getCarState(carNumber);
  const result = [];
  const sheet = config.DRIVERINFO_SHEET_NAME;
  const endRow = parseInt(startingRow) + 2;

  // Main data row
  result.push({
    range: `${sheet}!A${startingRow}:O${startingRow}`,
    majorDimension: 'ROWS',
    values: [[
      lbInfo.Car,
      'P' + lbInfo.Rank,
      getOrdinal(lbInfo.Rank),
      driverRef.firstName,
      driverRef.lastName,
      `${driverRef.firstName} ${driverRef.lastName}`,
      driverRef.headshot,
      driverRef.teamLogo + ' ',
      secondsToLapTime(ltInfo.fastestLapTime),
      state.currentLap,
      secondsToLapTime(lapInfo.lastLapTime),
      toFixedWhole(telInfo.speed),
      toFixedDecimal(avgInfo.lastLapAverage),
      aheadRef ? aheadRef.lastName : '-',
      behindRef ? behindRef.lastName : '-',
    ]],
  });

  // Lap delta (Q column — white/green/red in rows)
  const currentDelta = parseFloat(lapInfo.lastLapDelta);
  let deltaDisplay = '';
  if (!isNaN(currentDelta) && lapInfo.lastLapDelta.trim() !== '' && !lapInfo.lastLapDelta.includes('NaN')) {
    deltaDisplay = currentDelta > 0 ? '+' + currentDelta.toFixed(3) : currentDelta.toFixed(3);
  }

  let deltaValues;
  if (isNaN(currentDelta) || lapInfo.lastLapDelta.trim() === '' || lapInfo.lastLapDelta.includes('NaN')) {
    deltaValues = [['', '', '']];
    carState.prevLapDeltaColorState = 'white';
    carState.prevLapDeltaValue = null;
  } else if (currentDelta < 0) {
    deltaValues = [['', deltaDisplay, '']];
    carState.prevLapDeltaColorState = 'green';
    carState.prevLapDeltaValue = currentDelta;
  } else if (currentDelta > 0) {
    deltaValues = [['', '', deltaDisplay]];
    carState.prevLapDeltaColorState = 'red';
    carState.prevLapDeltaValue = currentDelta;
  } else {
    deltaValues = [[deltaDisplay, '', '']];
    carState.prevLapDeltaColorState = 'white';
    carState.prevLapDeltaValue = currentDelta;
  }
  result.push({ range: `${sheet}!Q${startingRow}:Q${endRow}`, majorDimension: 'COLUMNS', values: deltaValues });

  // Driver ahead split (R column)
  result.push(buildSplitColumn(
    sheet, 'R', startingRow, endRow,
    aheadLb ? parseFloat(toFixedDecimal(lbInfo.Time_Behind - aheadLb.Time_Behind)) : null,
    aheadLb !== null,
    carState, 'prevDriverAheadSplit'
  ));

  // Driver behind split (S column)
  result.push(buildSplitColumn(
    sheet, 'S', startingRow, endRow,
    behindLb ? parseFloat(toFixedDecimal(behindLb.Time_Behind - lbInfo.Time_Behind)) : null,
    behindLb !== null,
    carState, 'prevDriverBehindSplit'
  ));

  return result;
}

function buildSplitColumn(sheet, col, startRow, endRow, splitValue, hasOtherDriver, carState, statePrefix) {
  const colorKey = `${statePrefix}ColorState`;
  const valueKey = `${statePrefix}Value`;

  if (!hasOtherDriver || splitValue === null || isNaN(splitValue) || splitValue <= 0) {
    carState[colorKey] = 'white';
    carState[valueKey] = null;
    return { range: `${sheet}!${col}${startRow}:${col}${endRow}`, majorDimension: 'COLUMNS', values: [['-', '', '']] };
  }

  const display = '+' + splitValue.toFixed(3);

  if (carState[valueKey] === null) {
    carState[colorKey] = 'white';
  } else if (splitValue < carState[valueKey]) {
    carState[colorKey] = 'green';
  } else if (splitValue > carState[valueKey]) {
    carState[colorKey] = 'red';
  }
  // else: keep previous color (sticky)

  carState[valueKey] = splitValue;

  if (carState[colorKey] === 'green') {
    return { range: `${sheet}!${col}${startRow}:${col}${endRow}`, majorDimension: 'COLUMNS', values: [['', display, '']] };
  } else if (carState[colorKey] === 'red') {
    return { range: `${sheet}!${col}${startRow}:${col}${endRow}`, majorDimension: 'COLUMNS', values: [['', '', display]] };
  }
  return { range: `${sheet}!${col}${startRow}:${col}${endRow}`, majorDimension: 'COLUMNS', values: [[display, '', '']] };
}

async function updateDriverInfoSheet() {
  try {
    const data = [];
    const rows = [2, 12, 22];
    for (let i = 0; i < 3; i++) {
      if (state.targetCarNumbers[i]) {
        data.push(...buildDriverInfoUpdate(state.targetCarNumbers[i], rows[i]));
      }
    }
    if (data.length === 0) return;

    const response = await sheets_TelemetryAccount.spreadsheets.values.batchUpdate({
      spreadsheetId: config.SPREADSHEET_ID,
      valueInputOption: 'RAW',
      resource: { data },
    });
    console.log(`Driver info updated: ${response.data.totalUpdatedRows} rows`);
  } catch (error) {
    console.error('Error updating driver info sheet:', error.message);
  }
}

async function updateLeaderboardSheet() {
  try {
    const lb = state.leaderboard;
    if (lb.length === 0) return;

    const data = [];
    for (let i = 0; i < lb.length; i++) {
      const carNumber = lb[i].Car;
      const driverRef = state.referenceData.drivers[carNumber];
      if (!driverRef) continue;

      const telData = state.telemetry.find(item => item.carNumber === carNumber);
      const lapInfo = state.lapData.find(item => item.carNumber === carNumber);
      const pitInfo = state.pitStatus.find(item => item.carNumber === carNumber);
      const statusInfo = state.carStatus.find(item => item.carNumber === carNumber);
      const dnfOverride = state.manualDNFOverride.find(item => item.carNumber === carNumber);

      // Car ahead pit status
      let carAheadInPit = false;
      if (i > 0) {
        const aheadPit = state.pitStatus.find(item => item.carNumber === lb[i - 1].Car);
        if (aheadPit) carAheadInPit = aheadPit.pitStatus;
      }

      // Flag images
      let flagColorImg = '';
      let cautionStripImg = '';
      const images = state.referenceData.leaderboardImages;
      if (state.flagColor === 'green') { flagColorImg = images['Green Flag'] || ''; }
      else if (state.flagColor === 'yellow') { flagColorImg = images['Yellow Flag'] || ''; cautionStripImg = images['Caution Strip'] || ''; }
      else if (state.flagColor === 'white') { flagColorImg = images['White Flag'] || ''; }
      else if (state.flagColor === 'red') { flagColorImg = images['Red Flag'] || ''; cautionStripImg = images['Red Strip'] || ''; }
      else if (state.flagColor === 'finish') { flagColorImg = images['Finish Flag'] || ''; }

      // Time behind / laps behind
      let timeBehind;
      let intervalSplit;
      if (lb[i].Laps_Behind !== '0' && lb[i].Laps_Behind !== '1') {
        timeBehind = lb[i].Time_Behind + lb[i].Laps_Behind + ' laps';
        intervalSplit = timeBehind;
      } else if (lb[i].Laps_Behind === '1') {
        timeBehind = lb[i].Time_Behind + lb[i].Laps_Behind + ' lap';
        intervalSplit = timeBehind;
      } else {
        timeBehind = lb[i].Time_Behind;
      }

      // Highlight for target cars
      let highlight = '';
      if (carNumber === state.targetCarNumbers[0]) highlight = images['Highlight_Driver1'] || '';
      else if (carNumber === state.targetCarNumbers[1]) highlight = images['Highlight_Driver2'] || '';
      else if (carNumber === state.targetCarNumbers[2]) highlight = images['Highlight_Driver3'] || '';

      // DNF handling
      let isDNF = false;
      let dnfImg = '';
      let speed = '';
      let lastLapTime = lapInfo ? secondsToLapTime(lapInfo.lastLapTime) : '-';

      if (statusInfo && statusInfo.carStatus === 'DNF') {
        isDNF = true;
      }
      if (dnfOverride && dnfOverride.DNF) {
        isDNF = true;
      }

      if (isDNF) {
        dnfImg = images['DNF'] || '';
        timeBehind = 'DNF';
        intervalSplit = 'DNF';
        speed = 'DNF';
        lastLapTime = 'DNF';
      } else if (telData) {
        speed = telData.speed;
      }

      // Interval split calculation
      if (!isDNF) {
        const delta = i === 0 ? 0 : lb[i].Time_Behind - lb[i - 1].Time_Behind;
        if (pitInfo && pitInfo.pitStatus && intervalSplit === undefined) {
          intervalSplit = 'IN PIT';
        } else if (parseFloat(delta) < 0) {
          intervalSplit = '-';
        } else if (i !== 0 && !carAheadInPit && intervalSplit === undefined && delta > 0) {
          intervalSplit = '+' + toFixedDecimal(delta);
        } else if (i !== 0 && carAheadInPit && intervalSplit === undefined) {
          intervalSplit = '-';
        } else if (intervalSplit === undefined) {
          intervalSplit = toFixedDecimal(lb[i].Time_Behind);
        }
      }

      data.push({
        range: `${config.LEADERBOARD_SHEET_NAME}!A${i + 2}:Q${i + 2}`,
        majorDimension: 'ROWS',
        values: [[
          lb[i].Rank,
          carNumber,
          driverRef.carLogo,
          driverRef.team,
          flagColorImg,
          driverRef.firstName,
          driverRef.lastName,
          driverRef.displayName,
          cautionStripImg,
          timeBehind,
          intervalSplit,
          speed,
          state.currentLap,
          highlight,
          lapInfo ? lapInfo.lastLapNumber : '0',
          lastLapTime,
          dnfImg,
        ]],
      });
    }

    const response = await sheets_LeaderboardAccount.spreadsheets.values.batchUpdate({
      spreadsheetId: config.SPREADSHEET_ID,
      valueInputOption: 'RAW',
      resource: { data },
    });
    console.log(`Leaderboard updated: ${response.data.totalUpdatedRows} rows`);
  } catch (error) {
    console.error('Error updating leaderboard sheet:', error.message);
  }
}

// ──────────────────────────────────────────────
// Periodic update wrappers
// ──────────────────────────────────────────────

async function periodicUpdateLeaderboard() {
  if (state.isOnline && state.leaderboard.length > 0 && state.telemetry.length > 0 && state.lapData.length > 0) {
    await updateLeaderboardSheet();
  }
}

async function periodicUpdateDriverInfo() {
  if (state.isOnline && state.telemetry.length > 0 && state.lapData.length > 0) {
    await updateDriverInfoSheet();
  }
}

module.exports = {
  authenticateTelemetryAccount,
  authenticateLeaderboardAccount,
  readIpInformation,
  readAllTargetCars,
  readReferenceData,
  checkOnlineStatusAndUpdateHeartbeat,
  periodicUpdateLeaderboard,
  periodicUpdateDriverInfo,
};
