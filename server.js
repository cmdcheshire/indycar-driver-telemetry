const net = require('net');
const xml2js = require('xml2js');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// Constants - REPLACE THESE WITH YOUR ACTUAL VALUES
const SPREADSHEET_ID = '1UIpgq72cvEUT-qvEB4gmwDjvFU4CDIXf2rllNseYEUM';
const GOOGLE_TELEMETRY_SERVICE_ACCOUNT_KEY_PATH = 'indycar-live-data-telemetry-account.json';
const GOOGLE_LEADERBOARD_SERVICE_ACCOUNT_KEY_PATH = 'indycar-live-data-leaderboard-account.json';
const TARGET_CAR_SHEET_NAME = 'Live Data Controller'; // Sheet containing the target car number and online checkbox
const LEADERBOARD_SHEET_NAME = 'Live Leaderboard'
const TELEMETRY_SHEET_NAME = 'Live Telemetry'; // Sheet to write telemetry data
const DRIVERINFO_SHEET_NAME = 'Live Driver Info';
const DATABASE_SHEET_NAME = 'Database'; // Sheet containing driver and reference data
const CONTROLLER_SHEET_NAME = 'Live Data Controller'; // Sheet for the controller tab
const IP_ADDRESS_PORT_RANGE = 'E8:E9';
const TELEMETRY_ONLINE_CHECKBOX_CELL = 'B4'; // Cell containing the online checkbox
const TARGET_CAR_CELL = 'B5';    // Cell containing the target car

// Global Variables
let TCP_HOST = 'localhost';
let TCP_PORT = 5000;
let client;
let xmlParser = new xml2js.Parser({ explicitRoot: false, ignoreAttributes: false, trim: true });
let googleAuthClient;
let sheets_TelemetryAccount;  // Store the telemetry update sheets object
let sheets_LeaderboardAccount; // Store the leaderboard update sheets object
let targetCarNumber;
let referenceData = {}; // Store reference data from the sheet
const MAX_RPM = 12000;
const MAX_THROTTLE = 100;
const MAX_BRAKE = 100;
let onlineCheckInterval; // To store the interval ID
let isOnline = false;
let latestTargetTelemetryData = {}; // Telemetry data for car selected in google sheet
let latestFullTelemetryData = []; // Telemetry data for all cars
let telemetryUpdateTime = 1500; // Set time in ms for interval to update telemetry sheet
let latestLeaderboardData = []; // Leaderboard info for all cars
let leaderboardUpdateTime = 2000; // Set time in ms for interval to update leaderboard sheet
let driverInfoUpdateTime = 2000; // Set time in ms for interval to update driver info sheet
let latestLapData = []; // Store lap times and info for all cars
let lastDriverInfoUpdate; // Used to store last driver update info to calculate if splits are better or worse to make them red or green
let carData = {};

/**
 * Function to authenticate with the Google Sheets API using a service account for Telemetry update service account.
 * THIS IS USING TWO DIFFERENT SERVICE ACCOUNTS BECAUSE THE SHEETS API IS RATE LIMITED TO 60 CALLS PER LIMIT (PER ACCOUNT)
 */
async function authenticateTelemetryAccount() {
  try {
    console.log('Authenticating Telemetry update account with Google Sheets API...');
    googleAuthClient = new JWT({
      keyFile: GOOGLE_TELEMETRY_SERVICE_ACCOUNT_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await googleAuthClient.authorize();
    sheets_TelemetryAccount = google.sheets({ version: 'v4', auth: googleAuthClient }); // Store the sheets object here!!!
    console.log('Successfully authenticated Telemetry update account with Google Sheets API.');
  } catch (error) {
    console.error('Error authenticating with Google Sheets API:', error);
    throw error; // Terminate the application if authentication fails
  }
}

/**
 * Function to authenticate with the Google Sheets API using a service account for Leaderboard update service account.
 */
 async function authenticateLeaderboardAccount() {
  try {
    console.log('Authenticating Leaderboard update account with Google Sheets API...');
    googleAuthClient = new JWT({
      keyFile: GOOGLE_LEADERBOARD_SERVICE_ACCOUNT_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await googleAuthClient.authorize();
    sheets_LeaderboardAccount = google.sheets({ version: 'v4', auth: googleAuthClient }); // Store the sheets object here!!!
    console.log('Successfully authenticated Leaderboard update account with Google Sheets API.');
  } catch (error) {
    console.error('Error authenticating with Google Sheets API:', error);
    throw error; // Terminate the application if authentication fails
  }
}

/**
 * Function to read the entered IP information from the Google Sheet.
 */
async function readIpInformation() {
  try {
    const response = await sheets_LeaderboardAccount.spreadsheets.values.get({ // Use the 'sheets' object
      spreadsheetId: SPREADSHEET_ID,
      range: `${TARGET_CAR_SHEET_NAME}!${IP_ADDRESS_PORT_RANGE}`,
    });

    const values = response.data.values;
    if (values && values.length > 0 && values[0].length > 0 && values[1].length > 0) {
      TCP_HOST = values[0].toString();
      TCP_PORT = values[1].toString();
      console.log('Server information read from Google sheet: ' + TCP_HOST + ':' + TCP_PORT);
    } else {
      console.warn('IP information not found in google sheet. Using default: ' + TCP_HOST + ':' + TCP_PORT);
      return null;
    };

  } catch (error) {
    console.error('Error reading server IP information:', error);
    return null;
  }

}

/**
 * Function to read the target car number from the Google Sheet.
 */
async function readTargetCarNumber() {
  try {
    console.log('Reading target car number from Google Sheet...');
    const response = await sheets_LeaderboardAccount.spreadsheets.values.get({ // Use the 'sheets' object
      spreadsheetId: SPREADSHEET_ID,
      range: `${TARGET_CAR_SHEET_NAME}!${TARGET_CAR_CELL}`,
    });

    const values = response.data.values;
    if (values && values.length > 0 && values[0].length > 0) {
      targetCarNumber = values[0][0];
      console.log(`Target car number: ${targetCarNumber}`);
      return targetCarNumber;
    } else {
      console.warn('Target car number not found in the Google Sheet.');
      return null; // Don't throw, return null, and handle it in main
    }
  } catch (error) {
    console.error('Error reading target car number:', error);
    return null; // Don't throw, return null and handle in main
  }
}

/**
 * Function to read reference data (headshot URLs, pct images) from the Google Sheet.
 */
async function readReferenceData() {
  try {
    console.log('Reading reference data from Google Sheet...');
    referenceData = {
      drivers: {},
      tireImages: {},
      indicatorImages: {},
      leaderboardImages: {},
    };

    // Define the ranges we want to retrieve
    const ranges = [
      `${DATABASE_SHEET_NAME}!A2:H50`, // Driver data
      `${DATABASE_SHEET_NAME}!A52:B54`, // Tire image URLs
      `${DATABASE_SHEET_NAME}!A57:B60`, // Indicator image URLs
      `${DATABASE_SHEET_NAME}!A62:B63`, // Leaderboard image URLs
    ];

    // Loop through the ranges and fetch the data for each
    for (const range of ranges) {
      const response = await sheets_LeaderboardAccount.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: range, // Use singular 'range' here
      });

      const values = response.data.values;

      if (values && values.length > 0) {
        // Process data based on the current range
        if (range === `${DATABASE_SHEET_NAME}!A2:H50`) {
          // Process driver data
          for (let i = 0; i < values.length; i++) { // Start from 0
            const row = values[i];
            const carNumber = row[0];
            referenceData.drivers[carNumber] = {
              carLogo: row[1],
              team: row[2],
              teamLogo: row[3],
              firstName: row[4],
              lastName: row[5],
              displayName: row[6],
              headshot: row[7],
            };
          }
        } else if (range === `${DATABASE_SHEET_NAME}!A52:B54`) {
          // Process tire image URLs
          for (let i = 0; i < values.length; i++) {
            const row = values[i];
            const tireType = row[0];
            const tireImageUrl = row[1];
            referenceData.tireImages[tireType] = tireImageUrl;
          }
        } else if (range === `${DATABASE_SHEET_NAME}!A57:B60`) {
          // Process indicator image URLs
          for (let i = 0; i < values.length; i++) {
            const row = values[i];
            const indicatorType = row[0];
            const indicatorImageUrl = row[1];
            referenceData.indicatorImages[indicatorType] = indicatorImageUrl;
          }
        } else if (range === `${DATABASE_SHEET_NAME}!A62:B63`) {
          // Process leaderboard image URLs
          for (let i = 0; i < values.length; i++) {
            const row = values[i];
            const imageType = row[0];
            const imageUrl = row[1];
            referenceData.leaderboardImages[imageType] = imageUrl;
          }
        }
      } else {
        console.warn(`Range ${range} in reference data sheet is empty.`);
      }
    }

    // Setup structure of lap time data
    let driverKeys = Object.keys(referenceData.drivers);
    console.log(driverKeys);
    for (i = 0; i < driverKeys.length; i++) {
      let newLapDataObject = {
        carNumber:driverKeys[i],
        fastestLap:'-',
        lastLapNumber:'-',
        lastLapTime:'-',
        totalTime:'-',
        lapsBehindLeader:'-',
        timeBehindLeader:'-',
        lastLapDelta:' ',
      };
      //console.log(newLapDataObject);
      latestLapData.push(newLapDataObject);
    };
    //console.log(latestLapData);

    console.log('Reference data read from Google Sheet:', referenceData);
  } catch (error) {
    console.error('Error reading reference data:', error);
  }
}


/**
 * Function to get the ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.).
 */
function getOrdinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Converts a string to a number, rounds it to 3 decimal places, and returns the result as a string.
 *
 */
 function stringToRoundedDecimalString(inputString) {
  const number = parseFloat(inputString); // Convert the string to a floating-point number

  if (isNaN(number)) {
    return inputString; // Return the original string if it's not a valid number
  }

  const roundedNumber = number.toFixed(3); // Round to 3 decimal places and convert to string

  return roundedNumber;
}

/**
 * Converts a string to a number, rounds it to 0 decimal places, and returns the result as a string.
 *
 */
 function stringToRoundedWholeString(inputString) {
  const number = parseFloat(inputString); // Convert the string to a floating-point number

  if (isNaN(number)) {
    return inputString; // Return the original string if it's not a valid number
  }

  const roundedNumber = number.toFixed(0); // Round to 3 decimal places and convert to string

  return roundedNumber;
}

/**
 * Function to update the Google Sheet with the telemetry data for the target car.
 */
async function updateTelemetrySheet(telemetryData) {
  try {
    console.log('Updating telemetry data in Google Sheet...');

    // Check if the sheet exists (optional, but good for avoiding errors if the name is wrong)
    let spreadsheetInfo;
    try {
      spreadsheetInfo = await sheets_TelemetryAccount.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });
      const sheetExists = spreadsheetInfo.data.sheets.some(sheet => sheet.properties.title === TELEMETRY_SHEET_NAME);

      if (!sheetExists) {
        console.log(`Sheet "${TELEMETRY_SHEET_NAME}" does not exist. Creating it...`);
        await _TelemetryAccount.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: TELEMETRY_SHEET_NAME,
                },
              },
            }],
          },
        });
        console.log(`Sheet "${TELEMETRY_SHEET_NAME}" created.`);
      }
    } catch (error) {
      console.error('Error checking or creating sheet:', error);
      return; // Stop if there's an error checking/creating the sheet
    }

    // Build telemetry data object to batch update google sheet
    let gsheetTelemetryUpdateData = [];

    let singleDataPoints = {
      range: TELEMETRY_SHEET_NAME + '!A2:M2',
      majorDimension: 'ROWS',
      values: [[
        telemetryData.carNumber, // Column A is car number
        'P' + telemetryData.rank, // Column B is rank number (this has a P in front, e.g. 'P17' to indicate 17th)
        getOrdinal(telemetryData.rank), // Column C is rank ordinal (e.g. 1st = st, 2nd = nd)
        referenceData.drivers[telemetryData.carNumber].firstName, // Column D is first name
        referenceData.drivers[telemetryData.carNumber].lastName, // Column E is last name
        referenceData.drivers[telemetryData.carNumber].firstName + ' ' + referenceData.drivers[telemetryData.carNumber].lastName, // Column F is display name (in this case full name)
        referenceData.drivers[telemetryData.carNumber].headshot, // Column G is headshot URL (find in the tagboard graphic library and update in the google sheet 'Database')
        stringToRoundedWholeString(telemetryData.speed) + ' ', // Column H is speed, space added because text box cutting off right side
        telemetryData.rpm + ' ', // Column I is rpm number, space added because text box cutting off right side
        telemetryData.throttle, // Column J is throttle number
        telemetryData.brake, // Column K is brake percentage
        telemetryData.battery, // Column L is battery percentage
        telemetryData.pitStop,// Column M is pit stop number       
      ]]
    };

    gsheetTelemetryUpdateData.push(singleDataPoints); // adds single data points to the data object

    let rpmBooleans = [];
    let rpmImgBooleans = [];
    if (Number(telemetryData.rpm) >= 2000) { rpmBooleans[0] = true; rpmImgBooleans[0] = referenceData.indicatorImages.RPM } else { rpmBooleans [0] = false; rpmImgBooleans[0] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.rpm) >= 4000) { rpmBooleans[1] = true; rpmImgBooleans[1] = referenceData.indicatorImages.RPM } else { rpmBooleans [1] = false; rpmImgBooleans[1] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.rpm) >= 6000) { rpmBooleans[2] = true; rpmImgBooleans[2] = referenceData.indicatorImages.RPM } else { rpmBooleans [2] = false; rpmImgBooleans[2] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.rpm) >= 8000) { rpmBooleans[3] = true; rpmImgBooleans[3] = referenceData.indicatorImages.RPM } else { rpmBooleans [3] = false; rpmImgBooleans[3] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.rpm) >= 10000) { rpmBooleans[4] = true; rpmImgBooleans[4] = referenceData.indicatorImages.RPM } else { rpmBooleans [4] = false; rpmImgBooleans[4] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.rpm) >= 11000) { rpmBooleans[5] = true; rpmImgBooleans[5] = referenceData.indicatorImages.RPM } else { rpmBooleans [5] = false; rpmImgBooleans[5] = referenceData.indicatorImages.Off };

    let rpmColumns = {
      range: TELEMETRY_SHEET_NAME + '!N2:O7',
      majorDimension: 'COLUMNS',
      values: [
        [
          rpmBooleans[0],
          rpmBooleans[1],
          rpmBooleans[2],
          rpmBooleans[3],
          rpmBooleans[4],
          rpmBooleans[5],
        ],
        [
          rpmImgBooleans[0],
          rpmImgBooleans[1],
          rpmImgBooleans[2],
          rpmImgBooleans[3],
          rpmImgBooleans[4],
          rpmImgBooleans[5],
        ]
      ]
    }

    gsheetTelemetryUpdateData.push(rpmColumns);

    let throttleBooleans = [];
    let throttleImgBooleans = [];
    if (Number(telemetryData.throttle) >= 20) { throttleBooleans[0] = true; throttleImgBooleans[0] = referenceData.indicatorImages.Throttle } else { throttleBooleans [0] = false; throttleImgBooleans[0] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.throttle) >= 40) { throttleBooleans[1] = true; throttleImgBooleans[1] = referenceData.indicatorImages.Throttle } else { throttleBooleans [1] = false; throttleImgBooleans[1] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.throttle) >= 60) { throttleBooleans[2] = true; throttleImgBooleans[2] = referenceData.indicatorImages.Throttle } else { throttleBooleans [2] = false; throttleImgBooleans[2] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.throttle) >= 80) { throttleBooleans[3] = true; throttleImgBooleans[3] = referenceData.indicatorImages.Throttle } else { throttleBooleans [3] = false; throttleImgBooleans[3] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.throttle) >= 95) { throttleBooleans[4] = true; throttleImgBooleans[4] = referenceData.indicatorImages.Throttle } else { throttleBooleans [4] = false; throttleImgBooleans[4] = referenceData.indicatorImages.Off };
    
    let throttleColumns = {
      range: TELEMETRY_SHEET_NAME + '!P2:Q6',
      majorDimension: 'COLUMNS',
      values: [
        [
          throttleBooleans[0],
          throttleBooleans[1],
          throttleBooleans[2],
          throttleBooleans[3],
          throttleBooleans[4],
        ],
        [
          throttleImgBooleans[0],
          throttleImgBooleans[1],
          throttleImgBooleans[2],
          throttleImgBooleans[3],
          throttleImgBooleans[4],
        ]
      ]
    }

    gsheetTelemetryUpdateData.push(throttleColumns);

    let brakeBooleans = [];
    let brakeImgBooleans = [];
    if (Number(telemetryData.brake) >= 20) { brakeBooleans[0] = true; brakeImgBooleans[0] = referenceData.indicatorImages.Brake } else { brakeBooleans [0] = false; brakeImgBooleans[0] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.brake) >= 40) { brakeBooleans[1] = true; brakeImgBooleans[1] = referenceData.indicatorImages.Brake } else { brakeBooleans [1] = false; brakeImgBooleans[1] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.brake) >= 60) { brakeBooleans[2] = true; brakeImgBooleans[2] = referenceData.indicatorImages.Brake } else { brakeBooleans [2] = false; brakeImgBooleans[2] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.brake) >= 80) { brakeBooleans[3] = true; brakeImgBooleans[3] = referenceData.indicatorImages.Brake } else { brakeBooleans [3] = false; brakeImgBooleans[3] = referenceData.indicatorImages.Off };
    if (Number(telemetryData.brake) >= 95) { brakeBooleans[4] = true; brakeImgBooleans[4] = referenceData.indicatorImages.Brake } else { brakeBooleans [4] = false; brakeImgBooleans[4] = referenceData.indicatorImages.Off };
    
    let brakeColumns = {
      range: TELEMETRY_SHEET_NAME + '!R2:S6',
      majorDimension: 'COLUMNS',
      values: [
        [
          brakeBooleans[0],
          brakeBooleans[1],
          brakeBooleans[2],
          brakeBooleans[3],
          brakeBooleans[4],
        ],
        [
          brakeImgBooleans[0],
          brakeImgBooleans[1],
          brakeImgBooleans[2],
          brakeImgBooleans[3],
          brakeImgBooleans[4],
        ]
      ]
    }

    gsheetTelemetryUpdateData.push(brakeColumns);

    const response = await sheets_TelemetryAccount.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      valueInputOption: 'RAW',
      resource: { // The 'resource' object is necessary for batchUpdate
        data: gsheetTelemetryUpdateData,
      }
    });
    console.log('Telemetry data updated in Google Sheet:', response.data);
  } catch (error) {
    console.error('Error updating Google Sheet with telemetry data:', error);
  }
}

/**
 * Function to update driver info data.
 * 
 */
async function updateDriverInfoSheet(leaderboardData, telemetryData, lapData) {
  try {
    console.log('Updating driver info data in Google Sheet...');

    // Check if the sheet exists
    let spreadsheetInfo;
    try {
      spreadsheetInfo = await sheets_TelemetryAccount.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });
      const sheetExists = spreadsheetInfo.data.sheets.some(sheet => sheet.properties.title === DRIVERINFO_SHEET_NAME);

      if (sheetExists) {
        console.log('Leaderboard sheet '+ DRIVERINFO_SHEET_NAME + ' exists. Using...');
      }

      if (!sheetExists) {
        console.log(`Sheet "${DRIVERINFO_SHEET_NAME}" does not exist. Creating it...`);
        await sheets_TelemetryAccount.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: DRIVERINFO_SHEET_NAME,
                },
              },
            }],
          },
        });
        console.log(`Sheet "${DRIVERINFO_SHEET_NAME}" created.`);
      }

    } catch (error) {
      console.error('Error checking or creating sheet:', error);
      return; // Stop if there's an error checking/creating the sheet
    };

    // Define specific data in human-readable way
    let thisDriverReferenceData = referenceData.drivers[targetCarNumber];
    console.log("this driver reference data");
    console.log(thisDriverReferenceData);
    let driverInfoLapDataIndex = lapData.findIndex(item => item.carNumber === targetCarNumber);
    console.log("this driver lap data index");
    console.log(driverInfoLapDataIndex);
    let thisDriverLapData = lapData[driverInfoLapDataIndex];
    console.log("this driver lap data");
    console.log(thisDriverLapData);
    let thisDriverLeaderboardDataIndex = leaderboardData.findIndex(item => item.Car === targetCarNumber);
    console.log("this driver leaderboard data index");
    console.log(thisDriverLeaderboardDataIndex);
    let thisDriverLeaderboardData = leaderboardData[thisDriverLeaderboardDataIndex];
    console.log("this driver leaderboard data");
    console.log(thisDriverLeaderboardData);
    let thisDriverTelemetryData = telemetryData;
    console.log("this driver telemetry data");
    console.log(thisDriverTelemetryData);

    // Find info about near drivers
    let driverAheadLeaderboardDataIndex = thisDriverLeaderboardDataIndex - 1;
    console.log("driver ahead leaderboard data index");
    console.log(driverAheadLeaderboardDataIndex);
    let driverAheadLeaderboardData = leaderboardData[driverAheadLeaderboardDataIndex];
    console.log("driver ahead leaderboard data");
    console.log(driverAheadLeaderboardData);
    let driverAheadReferenceData = referenceData.drivers[driverAheadLeaderboardData.Car];
    console.log("driver ahead reference data");
    console.log(driverAheadReferenceData);
    let driverBehindLeaderboardDataIndex = thisDriverLeaderboardDataIndex + 1;
    console.log("driver behind leaderboard data index");
    console.log(driverBehindLeaderboardDataIndex);
    let driverBehindLeaderboardData = leaderboardData[driverBehindLeaderboardDataIndex];
    console.log("driver behind leaderboard data");
    console.log(driverBehindLeaderboardData);
    let driverBehindReferenceData = referenceData.drivers[driverBehindLeaderboardData.Car];
    console.log("driver behind leaderboard data");
    console.log(driverBehindLeaderboardData);
    
    // Build object to push to Google sheet
    let gsheetDriverInfoUpdateData = [];
    let singleDataPoints = {
      range: DRIVERINFO_SHEET_NAME + '!A2:O2',
      majorDimension: 'ROWS',
      values: [[
        thisDriverLeaderboardData.Car, // Column A is car number
        thisDriverLeaderboardData.Rank, // Column B is rank number
        getOrdinal(thisDriverLeaderboardData.Rank), // Column C is rank ordinal (e.g. 1st = st, 2nd = nd)
        thisDriverReferenceData.firstName, // Column D is first name
        thisDriverReferenceData.lastName, // Column E is last name
        thisDriverReferenceData.firstName + ' ' + referenceData.drivers[telemetryData.carNumber].lastName, // Column F is display name (in this case full name)
        thisDriverReferenceData.headshot, // Column G is headshot URL (find in the tagboard graphic library and update in the google sheet 'Database')
        thisDriverReferenceData.teamLogo + ' ', // Column H is team logo
        thisDriverReferenceData.manufacturerLogo, // Column I is manufacturer logo
        thisDriverLapData.lapNumber, // Column J is lap number
        thisDriverLapData.lapNumber, // Column K is last lap time
        thisDriverTelemetryData.speed, // Column L is speed
        'tbd', // Column M is average speed
        driverAheadReferenceData.lastName, // Column N is driver ahead last name 
        driverBehindReferenceData.lastName, // Column M is driver behind last name        
      ]]
    };

    gsheetDriverInfoUpdateData.push(singleDataPoints);

    // Build lap time delta object
    let lapDeltaData;
    if (thisDriverLapData.lastLapDelta.includes('-')) {
      lapDeltaData = {
        range: DRIVERINFO_SHEET_NAME + '!Q2:Q4',
        majorDimension: 'COLUMNS',
        values: [[
          '',
          thisDriverLapData.lastLapDelta, // this puts makes the delta text GREEN because the lap time got BETTER
          '',
        ]]
      };
    } else if (thisDriverLapData.lastLapDelta.includes('+')) {
      lapDeltaData = {
        range: DRIVERINFO_SHEET_NAME + '!Q2:Q4',
        majorDimension: 'COLUMNS',
        values: [[
          '',
          '', 
          thisDriverLapData.lastLapDelta, // this puts makes the delta text RED because the lap time got WORSE
        ]]
      };
    } else {
      lapDeltaData = {
        range: DRIVERINFO_SHEET_NAME + '!Q2:Q4',
        majorDimension: 'COLUMNS',
        values: [[
          thisDriverLapData.lastLapDelta, // this puts makes the delta text WHITE to handle all other scenarios
          '', 
          '', 
        ]]
      };
    }

    gsheetDriverInfoUpdateData.push(lapDeltaData);

    //Build the driver ahead split object
    let driverAheadSplitData;
    let driverAheadSplit = stringToRoundedDecimalString(thisDriverLeaderboardData.Time_Behind - driverAheadLeaderboardData.Time_Behind);
    console.log('driver ahead split');
    console.log(driverAheadSplit);
    console.log('last driver info update');
    console.log(lastDriverInfoUpdate);
    if (lastDriverInfoUpdate !== undefined) {
      console.log('last driver ahead split ', lastDriverInfoUpdate[2].values[0][0], ' is greater than this split? ', parseInt(driverAheadSplit) < parseInt(lastDriverInfoUpdate[2].values[0][0]));
      if ((parseInt(lastDriverInfoUpdate[2].values[0][0]) && parseInt(driverAheadSplit) < parseInt(lastDriverInfoUpdate[2].values[0][0])) || (parseInt(lastDriverInfoUpdate[2].values[0][1]) && parseInt(driverAheadSplit) < parseInt(lastDriverInfoUpdate[2].values[0][1])) || (parseInt(lastDriverInfoUpdate[2].values[0][2]) && parseInt(driverAheadSplit) < parseInt(lastDriverInfoUpdate[2].values[0][2]))) {
        driverAheadSplitData = {
          range: DRIVERINFO_SHEET_NAME + '!R2:R4',
          majorDimension: 'COLUMNS',
          values: [[
            '',
            '+' + driverAheadSplit, // this puts makes the delta text GREEN because the split got SMALLER
            '', 
          ]]
        };
        console.log('Driver ahead split got smaller.')
      } else if ((parseInt(lastDriverInfoUpdate[2].values[0][0]) && parseInt(driverAheadSplit) > parseInt(lastDriverInfoUpdate[2].values[0][0])) || (parseInt(lastDriverInfoUpdate[2].values[0][1]) && parseInt(driverAheadSplit) > parseInt(lastDriverInfoUpdate[2].values[0][1])) || (parseInt(lastDriverInfoUpdate[2].values[0][2]) && parseInt(driverAheadSplit) > parseInt(lastDriverInfoUpdate[2].values[0][2]))) {
        driverAheadSplitData = {
          range: DRIVERINFO_SHEET_NAME + '!R2:R4',
          majorDimension: 'COLUMNS',
          values: [[
            '',
            '', 
            '+' + driverAheadSplit, // this puts makes the delta text RED because the split got BIGGER
          ]]
        };
        console.log('Driver ahead split got larger.')
      } else {
        driverAheadSplitData = {
          range: DRIVERINFO_SHEET_NAME + '!R2:R4',
          majorDimension: 'COLUMNS',
          values: [[
            '+' + driverAheadSplit, // this puts makes the delta text WHITE to handle all other situations
            '', 
            '', 
          ]]
        };
      }
    } else {
      driverAheadSplitData = {
        range: DRIVERINFO_SHEET_NAME + '!R2:R4',
        majorDimension: 'COLUMNS',
        values: [[
          '', // this puts makes the delta text WHITE to handle all other situations
          '', 
          '', 
        ]]
      };
      console.log('last driver info update:', lastDriverInfoUpdate, ' not updating splits');
    }

    gsheetDriverInfoUpdateData.push(driverAheadSplitData);

    /// STILL NEED TO BUILD DRIVER BEHIND SPLIT UPDATE DATA.

    // Send the data to the correct cells in the google sheet.
    const response = await sheets_TelemetryAccount.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      valueInputOption: 'RAW',
      resource: { // The 'resource' object is necessary for batchUpdate
        data: gsheetDriverInfoUpdateData,
      }
    });

    lastDriverInfoUpdate = gsheetDriverInfoUpdateData;

    console.log('Driver info data updated in Google Sheet: ', response.data.totalUpdatedRows + ' rows');

  } catch (error) {
    console.error('Error: ', error);
    return;
  };

}


/**
 * Function to update leaderboard data.
 * 
 */
 async function updateLeaderboardSheet(leaderboardData, telemetryData, lapData) {
  try {
    console.log('Updating leaderboard data in Google Sheet...');

    // Check if the sheet exists (optional, but good for avoiding errors if the name is wrong)
    let spreadsheetInfo;
    try {
      spreadsheetInfo = await sheets_LeaderboardAccount.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });
      const sheetExists = spreadsheetInfo.data.sheets.some(sheet => sheet.properties.title === LEADERBOARD_SHEET_NAME);

      if (sheetExists) {
        console.log('Leaderboard sheet '+ LEADERBOARD_SHEET_NAME + ' exists. Using...');
      }

      if (!sheetExists) {
        console.log(`Sheet "${LEADERBOARD_SHEET_NAME}" does not exist. Creating it...`);
        await sheets_LeaderboardAccount.spreadsheets.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          resource: {
            requests: [{
              addSheet: {
                properties: {
                  title: LEADERBOARD_SHEET_NAME,
                },
              },
            }],
          },
        });
        console.log(`Sheet "${LEADERBOARD_SHEET_NAME}" created.`);
      }

    } catch (error) {
      console.error('Error checking or creating sheet:', error);
      return; // Stop if there's an error checking/creating the sheet
    }

    // Build array to update google sheet
    let gsheetLeaderboardUpdateData = [];
    for (i = 0; i < leaderboardData.length; i++) { // Loop through latest leaderboard and use reference data to find driver info
      let thisCarNumber = leaderboardData[i].Car;
      let thisDriverReferenceData = referenceData.drivers[thisCarNumber];
      //console.log("This car reference data: " + thisDriverReferenceData);

      // Handler for lapped car data
      let thisCarTimeBehind;
      let thisCarIntervalSplit;
      //console.log("This car laps behind " + leaderboardData[i].Laps_Behind);
      if (leaderboardData[i].Laps_Behind !== "0" && leaderboardData[i].Laps_Behind !== "1") {
        //console.log("This car is lapped multiple times, changing time behind to laps.")
        thisCarTimeBehind = leaderboardData[i].Time_Behind + leaderboardData[i].Laps_Behind + " laps";
        thisCarIntervalSplit = thisCarTimeBehind;
      } else if (leaderboardData[i].Laps_Behind === "1") {
        //console.log("This car is lapped once, changing time behind to lap.")
        thisCarTimeBehind = leaderboardData[i].Time_Behind + leaderboardData[i].Laps_Behind + " lap";
        thisCarIntervalSplit = thisCarTimeBehind;
      } else {
        //console.log("This car is not lapped.")
        thisCarTimeBehind = leaderboardData[i].Time_Behind;
      };

      // Handler for target car highlight
      let thisCarHighlight;
      if (thisCarNumber === targetCarNumber) {
        thisCarHighlight = referenceData.leaderboardImages['Highlight'];
      } else {
        thisCarHighlight = '';
      }

      if (i !== 0 && thisCarIntervalSplit === undefined) {
        thisCarIntervalSplit = '+' + stringToRoundedDecimalString(leaderboardData[i].Time_Behind - leaderboardData[i-1].Time_Behind);
      } else if (thisCarIntervalSplit === undefined) {
        thisCarIntervalSplit = stringToRoundedDecimalString(leaderboardData[i].Time_Behind);
      }

      // Find index of telemetry data for this car
      let thisCarTelemetryData = telemetryData[telemetryData.findIndex(item => item.carNumber === thisCarNumber)];
      // Find index of the lap data for this car
      let thisCarLapData = lapData[lapData.findIndex(item => item.carNumber === thisCarNumber)];

      let thisLineObject = {
        range: LEADERBOARD_SHEET_NAME + '!A' + (i+2) + ':' + 'P' + (i+2),
        majorDimension: 'ROWS',
        values: [[
          leaderboardData[i].Rank, // Column 1 is Rank
          thisCarNumber, // Column 2 is Car Number
          thisDriverReferenceData.carLogo, // Column 3 is Car Logo
          thisDriverReferenceData.team, // Column 4 is Team Name
          thisDriverReferenceData.teamLogo, // Column 5 is Team Logo
          thisDriverReferenceData.firstName, // Column 6 is First Name
          thisDriverReferenceData.lastName, // Column 7 is Last Name
          thisDriverReferenceData.displayName, // Column 8 is Display Name
          'total time', // Column 9 is Total Time, not built yet
          thisCarTimeBehind, // Column 10 is Leader Split
          thisCarIntervalSplit, // Column 10 is Interval Split
          thisCarTelemetryData.speed, // Column 12 is last known speed
          'tire compound', // Column 13 is tire compound, not built yet
          thisCarHighlight, // Column 14 is the link to the highlight graphic URL if this is the target car
          thisCarLapData.lapNumber, // Column 15 is laps completed
          thisCarLapData.lastLapTime, // Column 16 is last lap time
        ]]
      }

      gsheetLeaderboardUpdateData.push(thisLineObject);
    };

    //console.log("Google sheet update data is...");
    //console.log(gsheetLeaderboardUpdateData);

    // Send the data to the correct cells in the google sheet.
    const response = await sheets_LeaderboardAccount.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      valueInputOption: 'RAW',
      resource: { // The 'resource' object is necessary for batchUpdate
        data: gsheetLeaderboardUpdateData,
      }
    });
    console.log('Leaderboard data updated in Google Sheet: ', response.data.totalUpdatedRows + ' rows');

  } catch (error) {
    console.error('Error: ', error);
    return;
  };

};


/**
 * Function to check the online checkbox and update the heartbeat cell.
 */
async function checkOnlineStatusAndUpdateHeartbeat() {
  try {
    console.log('Checking online status and updating heartbeat...');
    const response = await sheets_LeaderboardAccount.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CONTROLLER_SHEET_NAME}!${TELEMETRY_ONLINE_CHECKBOX_CELL}`,
    });

    const values = response.data.values;
    isOnline = values && values.length > 0 && values[0].length > 0 && values[0][0] === 'TRUE'; // Check if the checkbox is TRUE
    console.log(`Online status from sheet: ${isOnline}`);

    if (isOnline) {
      console.log('Online checkbox is TRUE.  Updating heartbeat.');
      // Update the heartbeat cell (e.g., set it to the current timestamp)
      try {
        await sheets_LeaderboardAccount.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${CONTROLLER_SHEET_NAME}!A2`, // Example:  Update cell A2 with the heartbeat
          valueInputOption: 'RAW',
          resource: {
            values: [[new Date().toISOString()]],
          },
        });
      }
      catch (e) {
        console.error("Error updating heartbeat: ", e);
      }
      return true;
    } else {
      console.log('Online checkbox is FALSE.  Not processing data.');
      return false;
    }
  } catch (error) {
    console.error('Error checking online status:', error);
    return false; // Assume offline in case of error to prevent further processing
  }
  
}

/**
 * Function to periodically update the Google Sheet with data.
 */
async function periodicUpdateTelemetrySheet() {
  console.log("periodicUpdateTelemetrySheet called"); //add
  if (isOnline && Object.keys(latestTargetTelemetryData).length > 0) {
    try {
      console.log("periodicUpdateTelemetrySheet - Updating sheet"); //add
      await updateTelemetrySheet(latestTargetTelemetryData); //send the  data.
    }
    catch (e) {
      console.error("Error in sending data to sheet", e);
    }
  }
  else {
    console.log("Not updating telemetry sheet. isOnline: ", isOnline, " data available: ", Object.keys(latestTargetTelemetryData).length > 0);
  }
}

async function periodicUpdateLeaderboardSheet() {
  console.log("periodicUpdateLeaderboardSheet called"); //add
  if (isOnline && latestLeaderboardData.length > 0 && latestFullTelemetryData.length > 0 && latestLapData.length > 0) {
    try {
      console.log("periodicUpdateTelemetrySheet - Updating sheet"); //add
      await updateLeaderboardSheet(latestLeaderboardData, latestFullTelemetryData, latestLapData); //send the data.
    }
    catch (e) {
      console.error("Error in sending data to sheet", e);
    }
  }
  else {
    console.log("Not updating leaderboard sheet. isOnline: ", isOnline, " data available: ", latestLeaderboardData.length > 0);
  }
}

async function periodicUpdateDriverInfoSheet() {
  console.log("periodicUpdateDriverInfoSheet called"); //add
  if (isOnline && latestLeaderboardData.length > 0 && Object.keys(latestTargetTelemetryData).length > 0 && latestLapData.length > 0) {
    try {
      console.log("periodicUpdateTelemetrySheet - Updating sheet"); //add
      await updateDriverInfoSheet(latestLeaderboardData, latestTargetTelemetryData, latestLapData); //send the data.
    }
    catch (e) {
      console.error("Error in sending data to sheet", e);
    }
  }
  else {
    console.log("Not updating Driver info sheet. isOnline: ", isOnline, " leaderboard data available: ", latestLeaderboardData.length > 0, " telemetry data available: ", Object.keys(latestTargetTelemetryData).length > 0, " lap data available: ", latestLapData.length > 0);
  }
}


/**
 * Main function to connect to the TCP socket, receive data, and process it.
 */
async function main() {
  try {
    
    await authenticateLeaderboardAccount(); // Authenticate Leaderboard update account with Google Sheets API
    await authenticateTelemetryAccount(); // Authenticate Telemetry update account with Google Sheets API
    await readIpInformation();
    await readReferenceData(); //read reference data
    targetCarNumber = await readTargetCarNumber();
    //console.log(`Target car number: ${targetCarNumber}`); // Log the target car number
    
    client = net.connect({ host: TCP_HOST, port: TCP_PORT }, () => {
      console.log(`Connected to ${TCP_HOST}:${TCP_PORT}`); // Log connection
    });
    
    client.on('connect', () => {
      console.log(`Successfully connected to TCP server at ${TCP_HOST}:${TCP_PORT}`);
    });
    
    //console.log(client);
    
    let buffer = ''; // Buffer to accumulate data

    client.on('data', async (data) => { // Make the callback async to use await
      console.log('Data received from TCP server.');
      buffer += data.toString(); // Append data to the buffer
      console.log(`Received data: ${data.toString().substring(0, 50)}... (Buffer length: ${buffer.length})`);

      const telemetryStart = '<Telemetry_Leaderboard';
      const telemetryEnd = '</Telemetry_Leaderboard>';
      const pitStart = '<Pit_Summary';
      const pitEnd = '</Pit_Summary>';
      const unofficialLeaderboardStart = '<Unofficial_Leaderboard';
      const unofficialLeaderboardEnd = '</Unofficial_Leaderboard>';
      const completedLapStart = '<Completed_Lap';
      const completedLapEnd = '/>';

      let message = null;

      while (buffer.length > 0) {
        let telemetryStartIndex = buffer.indexOf(telemetryStart);
        //console.log("telemetry data start index... " + telemetryStartIndex);
        let pitStartIndex = buffer.indexOf(pitStart);
        //console.log("pit data start index... " + pitStartIndex);
        let unofficialLeaderboardStartIndex = buffer.indexOf(unofficialLeaderboardStart);
        //console.log("leaderboard data start index... " + unofficialLeaderboardStartIndex);
        let completedLapStartIndex = buffer.indexOf(completedLapStart);

        if (telemetryStartIndex !== -1) {
          let telemetryEndIndex = buffer.indexOf(telemetryEnd, telemetryStartIndex);
          if (telemetryEndIndex !== -1) {
            message = buffer.substring(telemetryStartIndex, telemetryEndIndex + telemetryEnd.length);
            buffer = buffer.substring(telemetryEndIndex + telemetryEnd.length);
          } else {
            break; // Incomplete telemetry message, wait for more data
          }
        } else if (pitStartIndex !== -1) {
          let pitEndIndex = buffer.indexOf(pitEnd, pitStartIndex);
          if (pitEndIndex !== -1) {
            message = buffer.substring(pitStartIndex, pitEndIndex + pitEnd.length);
            buffer = buffer.substring(pitEndIndex + pitEnd.length);
          } else {
            break; // Incomplete pit summary message, wait for more data
          }
        } else if (unofficialLeaderboardStartIndex !== -1) {
          let unofficialLeaderboardEndIndex = buffer.indexOf(unofficialLeaderboardEnd, unofficialLeaderboardStartIndex);
          //console.log("unofficial leaderboard end index... " + unofficialLeaderboardEndIndex);
          if (unofficialLeaderboardEndIndex !== -1) {
            message = buffer.substring(unofficialLeaderboardStartIndex, unofficialLeaderboardEndIndex + unofficialLeaderboardEnd.length);
            buffer = buffer.substring(unofficialLeaderboardEndIndex + unofficialLeaderboardEnd.length);
          } else {
            break; // Incomplete leaderboard message, wait for more data
          }
        } else if (completedLapStartIndex !== -1) {
          let completedLapEndIndex = buffer.indexOf(completedLapEnd, completedLapStartIndex);
          if (completedLapEndIndex !== -1) {
            message = buffer.substring(completedLapStartIndex, completedLapEndIndex + completedLapEnd.length);
            buffer = buffer.substring(completedLapEndIndex + completedLapEnd.length);
          } else {
            break; // Incomplete completed lap message, wait for more data
          }
        } else {
          break; // No recognizable start tag found, exit loop
        }

        if (message) {
          console.log(`Found and attempting to parse message: ${message.substring(0, 50)}... (Length: ${message.length})`);
          xmlParser.parseString(message, async (err, result) => {
            //console.log(JSON.stringify(result, null, 2));
            if (result) {
              //console.log("XML parsed successfully.")
            }
            if (err) {
              console.error('Error parsing XML. Skipping message:', err, 'Message:', message);
              return;
            }
            if (!result) {
              console.error('Error: result is null', 'Message:', message);
              return;
            }

            //console.log(JSON.stringify(result, null, 4));

            try {
              if (telemetryStartIndex !== -1) {
                const targetCarData = Array.isArray(result.Position)
                  ? result.Position.find(pos => pos.$ && pos.$.Car === targetCarNumber)
                  : (result.Position.$ && result.Position.$.Car === targetCarNumber ? result.Position : null);

                if (targetCarData) {
                  const telemetryForUpdate = {
                    carNumber: targetCarData.$.Car,
                    rank: parseInt(targetCarData.$.Rank, 10),
                    speed: parseFloat(targetCarData.$.speed),
                    rpm: parseInt(targetCarData.$.rpm, 10),
                    throttle: parseInt(targetCarData.$.throttle, 10),
                    brake: parseInt(targetCarData.$.brake, 10),
                    battery: parseInt(targetCarData.$.Battery_Pct_Remaining, 10),
                    pitStop: 0, // Placeholder
                  };

                  //console.log('Telemetry data for target car found:', telemetryForUpdate);
                  latestTargetTelemetryData = telemetryForUpdate;
                } else {
                  //console.log(`Telemetry data not found for target car number: ${targetCarNumber}`);
                }

                //console.log(result.Position) // Checking structure of result to store telemetry data
                
                //Store all telemetry data to update leaderboard with speed, etc
                latestFullTelemetryData = []; // Clears last full telemetry data array
                for (i = 0; i < result.Position.length; i++) { 
                  let thisCarTelemetryData = {
                    carNumber: result.Position[i].$.Car,
                    rank: parseInt(result.Position[i].$.Rank, 10),
                    speed: parseFloat(result.Position[i].$.speed),
                    rpm: parseInt(result.Position[i].$.rpm, 10),
                    throttle: parseInt(result.Position[i].$.throttle, 10),
                    brake: parseInt(result.Position[i].$.brake, 10),
                    battery: parseInt(result.Position[i].$.Battery_Pct_Remaining, 10),
                    pitStop: 0, // Placeholder
                  };
                  latestFullTelemetryData.push(thisCarTelemetryData);
                };

                //console.log("Latest full telemetry data...");
                //console.log(latestFullTelemetryData); 

              } else if (pitStartIndex !== -1) {
                //processPitSummaryMessage(result.Pit_Summary);
              } else if (unofficialLeaderboardStartIndex !== -1) {
                //process Unofficial Leaderboard message
                const allCarDataIsArray = Array.isArray(result.Position)
                console.log("unofficial leaderboard is array?... " + allCarDataIsArray);
                //console.log("Structure of result:", JSON.stringify(result, null, 2));
                let updatedUnofficialLeaderboardData = [];
                for (i = 0; i < result.Position.length; i++) {
                  updatedUnofficialLeaderboardData.push(
                    {
                      "Car":result.Position[i].$.Car,
                      "Rank":result.Position[i].$.Rank,
                      "Laps_Behind":result.Position[i].$.Laps_Behind,
                      "Time_Behind":result.Position[i].$.Time_Behind,
                    }
                  );
                  //console.log(i);
                  //console.log("Car: " + result.Position[i].$.Car);
                  //console.log("Time Behind: " + result.Position[i].$.Time_Behind);
                }
                //console.log("updated unofficial leaderboard found.. printing processed array.")
                //console.log(updatedUnofficialLeaderboardData);
                latestLeaderboardData = updatedUnofficialLeaderboardData;
                console.log("latest leaderboard data updated locally.")
              } else if (completedLapStartIndex !== -1) {
                //console.log('Completed lap data found...')
                //console.log(result);
                let thisCarNumber = result.$.Car;
                console.log("Checking for existing lap data")
                //console.log(latestLapData);
                let completedLapCarIndex = latestLapData.findIndex(item => item.carNumber === thisCarNumber);
                
                if (completedLapCarIndex !== -1) {

                  console.log('Updating lap ' + result.$.Lap_Number + ' data for car ' + thisCarNumber + '...');
                  let lastLapTime = latestLapData[completedLapCarIndex].lastLapTime;
                  let thisLapTime = result.$.Lap_Time;
                  let lapDelta;

                  if (lastLapTime > thisLapTime) {
                    lapDelta = '-' + (lastLapTime - thisLapTime);
                  } else if (lastLapTime < thisLapTime) {
                    lapDelta = '+' + (thisLapTime - lastLapTime);
                  } else {
                    lapDelta = ' ';
                  };

                  let newLapDataObject = {
                    carNumber:result.$.Car,
                    fastestLap:result.$.Fastest_Lap,
                    lastLapNumber:result.$.Lap_Number,
                    lastLapTime:result.$.Lap_Time,
                    totalTime:result.$.Time,
                    lapsBehindLeader:result.$.Laps_Behind_Leader,
                    timeBehindLeader:result.$.Time_Behind_Leader,
                    lastLapDelta:lapDelta,
                  };

                  latestLapData[completedLapCarIndex] = newLapDataObject;
                  console.log(latestLapData[completedLapCarIndex]);

                } else {
                  console.log('This driver was not found in the reference database...adding')
                  let newLapDataObject = {
                    carNumber:result.$.Car,
                    fastestLap:result.$.Fastest_Lap,
                    lastLapNumber:result.$.Lap_Number,
                    lastLapTime:result.$.Lap_Time,
                    totalTime:result.$.Time,
                    lapsBehindLeader:result.$.Laps_Behind_Leader,
                    timeBehindLeader:result.$.Time_Behind_Leader,
                    lastLapDelta:' ',
                  };
                  console.log(newLapDataObject);
                  latestLapData.push(newLapDataObject);
                }
              };
            } catch (error) {
              console.error('Error processing XML message:', error, 'Message:', message);
            }
          });
          message = null; // Reset message
        }
      }
    });

    
    client.on('end', () => {
      console.log('Disconnected from server');
    });

    client.on('error', (err) => {
      console.error('Socket error:', err);
      // Consider implementing a reconnection strategy here (e.g., with a delay).
      client.destroy();
      setTimeout(main, 5000); // Reconnect after 5 seconds
    });

    client.on('close', () => {
      console.log('Socket closed');
    });

    let telemetryUpdateInterval; // Separate variable for the telemetry update interval
    let leaderboardUpdateInterval;
    let driverInfoUpdateInterval;

    // Main loop: Check online status, read target car, and process data
    setInterval(async () => { // Changed to setInterval without assigning to onlineCheckInterval
      try {
        const onlineStatus = await checkOnlineStatusAndUpdateHeartbeat(); // Await the result
        if (onlineStatus) {
          targetCarNumber = await readTargetCarNumber(); // Read target car number
          console.log(`Target car number: ${targetCarNumber}`);
          /* Disabling Telemetry Sheet Update =========================================================================================================
          if (!telemetryUpdateInterval) { // Check the telemetry update interval variable
            telemetryUpdateInterval = setInterval(periodicUpdateTelemetrySheet, telemetryUpdateTime); // Update Telemetry sheet
            console.log('Telemetry update interval started at ' + telemetryUpdateTime + 'ms');
          } */
          if (!leaderboardUpdateInterval) {
            leaderboardUpdateInterval = setInterval(periodicUpdateLeaderboardSheet, leaderboardUpdateTime) // Update Leaderboard sheet
            console.log('Leaderboard update interval started at ' + leaderboardUpdateTime + 'ms');
          }
          if (!driverInfoUpdateInterval) {
            leaderboardUpdateInterval = setInterval(periodicUpdateDriverInfoSheet, driverInfoUpdateTime) // Update DriverInfo sheet
            console.log('Driver Info update interval started at ' + driverInfoUpdateTime + 'ms');
          }
        } else {
          // Clear the interval if offline
          if (telemetryUpdateInterval) {
            clearInterval(telemetryUpdateInterval);
            telemetryUpdateInterval = null;
            latestTargetTelemetryData = {};
            latestFullTelemetryData = {};
            console.log('Telemetry update interval stopped.');
          }
          if (leaderboardUpdateInterval) {
            clearInterval(telemetryUpdateInterval);
            leaderboardUpdateInterval = null;
            latestLeaderboardData = {};
            latestLapData = {};
            console.log('Leaderboard update interval stopped.');
          }
          if (driverInfoUpdateInterval) {
            clearInterval(telemetryUpdateInterval);
            driverInfoUpdateInterval = null;
            console.log('Driver Info update interval stopped.');
          }

          console.log('Offline: Not updating sheet.');
        }
      } catch (error) {
        console.error("Error in main interval:", error);
      }
    }, 5000); // Check every 5 seconds
  } catch (error) {
    console.error('Application failed to start:', error);
    //  Handle the error appropriately (e.g., exit, try to reconnect, send an alert).
  }
}

// Start the application.
main();
