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
const TARGET_CAR_2_CELL = 'B6'; 
const TARGET_CAR_3_CELL = 'B7';

// Global Variables
let TCP_HOST = 'localhost';
let TCP_PORT = 5000;
let client;
let xmlParser = new xml2js.Parser({ explicitRoot: false, ignoreAttributes: false, trim: true });
let googleAuthClient;
let sheets_TelemetryAccount;  // Store the telemetry update sheets object
let sheets_LeaderboardAccount; // Store the leaderboard update sheets object
let targetCarNumber;
let targetCar2Number;
let targetCar3Number;
let referenceData = {}; // Store reference data from the sheet
const MAX_RPM = 12000;
const MAX_THROTTLE = 100;
const MAX_BRAKE = 100;
let isOnline = false;
let latestTargetTelemetryData = {}; // Telemetry data for car selected in google sheet
let latestFullTelemetryData = []; // Telemetry data for all cars
let telemetryUpdateTime = 1500; // Set time in ms for interval to update telemetry sheet
let latestLeaderboardData = []; // Leaderboard info for all cars
let leaderboardUpdateTime = 2000; // Set time in ms for interval to update leaderboard sheet
let driverInfoUpdateTime = 2000; // Set time in ms for interval to update driver info sheet
let latestLapData = []; // Store lap times and info for all cars
let carStates = {};
let carStatusData = [];
let manualDNFOverride = [];
let allLapTimesData = [];
let averageSpeedData = [];
let lapsCompleted = 0;
let flagColor;
let timeElapsed;

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
async function readTargetCarNumber(targetCarSheetName, targetCarCellNumber) {
  try {
    console.log('Reading target car number from Google Sheet...');
    const response = await sheets_LeaderboardAccount.spreadsheets.values.get({ // Use the 'sheets' object
      spreadsheetId: SPREADSHEET_ID,
      range: targetCarSheetName + '!' + targetCarCellNumber,
    });

    const values = response.data.values;
    if (values && values.length > 0 && values[0].length > 0) {
      let thisTargetCarNumber = values[0][0];
      console.log(`Target car number: ${thisTargetCarNumber}`);
      return thisTargetCarNumber;
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
      `${DATABASE_SHEET_NAME}!A63:B64`, // Leaderboard image URLs
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
        } else if (range === `${DATABASE_SHEET_NAME}!A63:B64`) {
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

    // Setup structure of per driver data
    let driverKeys = Object.keys(referenceData.drivers);
    //console.log(driverKeys);
    for (i = 0; i < driverKeys.length; i++) {

      // Lap data
      let newLapDataObject = {
        carNumber:driverKeys[i],
        fastestLap:'-',
        lastLapNumber:'0',
        lastLapTime:'-',
        totalTime:'-',
        lapsBehindLeader:'-',
        timeBehindLeader:'-',
        lastLapDelta:' ',
      };
      //console.log(newLapDataObject);
      latestLapData.push(newLapDataObject);

      // All lap times data
      let newLapTimesObject = {
        carNumber:driverKeys[i],
        fastestLapNumber:'0',
        fastestLapTime:'0:00.000',
        lapTimes: [{
          lapNumber:0,
          lapTime:'-',
        }],
      };
      allLapTimesData.push(newLapTimesObject);

      // Car status data
      let newCarStatusDataObject = {
        carNumber:driverKeys[i],
        carStatus:'-',
      };
      //console.log(newLapDataObject);
      carStatusData.push(newCarStatusDataObject);

      // Average speed data
      let newAverageSpeedDataObject = {
        carNumber:driverKeys[i],
        averageSpeedLapNumber:'-',
        lastLapAverage:'-',
        currentLapSpeeds:[],
      };
      averageSpeedData.push(newAverageSpeedDataObject);

      // DNF Override Data
      let newDNFOverrideObject = {
        carNumber:driverKeys[i],
        DNF:false,
      };
      manualDNFOverride.push(newDNFOverrideObject)

    };

    console.log(latestLapData);
    console.log(carStatusData);
    console.log(allLapTimesData);
    console.log(averageSpeedData);
    console.log(manualDNFOverride);

    // Setup structure of manual DNF override object
    for (i = 0; i < driverKeys.length; i++) {
      
    };
    

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
 * Converts a time string from "SS.000" format (or any floating point number) to "M:SS.000" format.
 *
 * @param {string} timeString The input time string (e.g., "75.123", "5.000", "0.5", "12.34567").
 * @returns {string} The formatted time string in "M:SS.000" format (e.g., "1:15.123", "0:05.000", "0:00.500"),
 * or the original string if the input format is invalid.
 */
 function convertSecondsToMinutesSeconds(timeString) {
  // --- Input Validation ---
  // Check if the input is a string and matches a basic numeric format.
  // It now allows for any number of decimal places, but the output will be truncated to 3.
  if (typeof timeString !== 'string' || !/^\d+(\.\d*)?$/.test(timeString)) {
      console.warn(`Invalid input format for time conversion: "${timeString}". Expected a numeric string. Returning original string.`);
      return timeString; // Return the original string for invalid input
  }

  // --- Parsing the Input String ---
  const parts = timeString.split('.');
  const totalSecondsInteger = parseInt(parts[0], 10); // Get the whole seconds part as an integer

  // Get the milliseconds part, ensuring it's always 3 digits.
  // If no milliseconds are provided (e.g., "60"), default to "000".
  // If fewer than 3 digits (e.g., "123.4"), pad with zeros ("400").
  // If more than 3 digits (e.g., "123.4567"), it will be truncated to 3 ("456").
  const milliseconds = parts[1] ? parts[1].padEnd(3, '0').substring(0, 3) : '000';

  // --- Calculation ---
  const minutes = Math.floor(totalSecondsInteger / 60); // Calculate whole minutes
  const remainingSeconds = totalSecondsInteger % 60;   // Calculate remaining whole seconds

  // --- Formatting Output ---
  // Pad the remaining seconds with a leading zero if it's a single digit (e.g., 5 becomes "05")
  const formattedSeconds = String(remainingSeconds).padStart(2, '0');

  // Combine minutes, formatted seconds, and milliseconds
  return `${minutes}:${formattedSeconds}.${milliseconds}`;
}


/**
 * Function to update the Google Sheet with the telemetry data for the target car.
 */

/* ================================= NOT IN USE / DEPRECATED (KEPT FOR REFERENCE) ===================================
async function updateTelemetrySheet(telemetryData) {
  try {
    console.log('Updating telemetry data in Google Sheet...');

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

================================= NOT IN USE / DEPRECATED (KEPT FOR REFERENCE) =================================== */

// A global object to store the previous state for each car

function getDriverInfoForUpdate (driverInfoCarNumber, startingRow, leaderboardData, telemetryData, lapData) {

  let driverInfoForUpdateBuffer = [];

  // Initialize state for this car if it doesn't exist
  if (!carStates[driverInfoCarNumber]) {
    carStates[driverInfoCarNumber] = {
      prevLapDeltaColorState: 'white',
      prevLapDeltaValue: null,
      prevDriverAheadSplitColorState: 'white',
      prevDriverAheadSplitValue: null,
      prevDriverBehindSplitColorState: 'white',
      prevDriverBehindSplitValue: null,
      lapsCompleted: 0 // Initialize lapsCompleted here as well if it's car-specific
    };
  }

  // Get the state specific to this car
  let thisCarState = carStates[driverInfoCarNumber];

  // Define specific data in human-readable way
  let thisDriverReferenceData = referenceData.drivers[driverInfoCarNumber];
  // Handle cases where targetCarNumber might not be in referenceData (e.g., '06' or invalid number)
  if (!thisDriverReferenceData) {
      console.warn(`Reference data not found for target car number: ${driverInfoCarNumber}. Skipping driver info update.`);
      return []; // Return an empty array if no reference data
  }

  let driverInfoLapDataIndex = lapData.findIndex(item => (item.carNumber === driverInfoCarNumber));
  let thisDriverLapData = lapData[driverInfoLapDataIndex];
  // Handle case where lap data might not exist yet for target car
  if (!thisDriverLapData) {
      console.warn(`Lap data not found for target car number: ${driverInfoCarNumber}. Skipping driver info update.`);
      return [];
  }

  let thisDriverLeaderboardDataIndex = leaderboardData.findIndex(item => item.Car === driverInfoCarNumber);
  let thisDriverLeaderboardData = leaderboardData[thisDriverLeaderboardDataIndex];
  // Handle case where leaderboard data might not exist yet for target car
  if (!thisDriverLeaderboardData) {
      console.warn(`Leaderboard data not found for target car number: ${driverInfoCarNumber}. Skipping driver info update.`);
      return [];
  }

  let thisDriverTelemetryDataIndex = telemetryData.findIndex(item => item.carNumber === driverInfoCarNumber);
  let thisDriverTelemetryData = telemetryData[thisDriverTelemetryDataIndex];
  if (!thisDriverTelemetryData) { // Corrected the variable name here, was thisDriverLeaderboardData
    console.warn(`Telemetry data not found for target car number: ${driverInfoCarNumber}. Skipping driver info update.`);
    return [];
  }

  let thisDriverAverageSpeedIndex = averageSpeedData.findIndex(item => item.carNumber === driverInfoCarNumber);
  let thisDriverAverageSpeedData = averageSpeedData[thisDriverAverageSpeedIndex];
  if (!thisDriverAverageSpeedData) {
    console.warn(`Average Speed data not found for target car number: ${driverInfoCarNumber}. Skipping driver info update.`);
    return [];
  }

  let thisDriverAllLapTimesIndex = allLapTimesData.findIndex(item => item.carNumber === driverInfoCarNumber);
  let thisDriverAllLapTimesData = allLapTimesData[thisDriverAllLapTimesIndex];
  if (!thisDriverAllLapTimesData) {
    console.warn(`Lap Time data not found for target car number: ${driverInfoCarNumber}. Skipping driver info update.`);
    return [];
  }

  // Find info about near drivers
  let driverAheadLeaderboardData = null;
  let driverAheadReferenceData = null;
  if (thisDriverLeaderboardDataIndex > 0) { // Check if there's a driver ahead
    driverAheadLeaderboardData = leaderboardData[thisDriverLeaderboardDataIndex - 1];
    driverAheadReferenceData = referenceData.drivers[driverAheadLeaderboardData.Car];
  } else {
      console.log(`No driver ahead of car ${driverInfoCarNumber} (currently P1).`);
  }

  let driverBehindLeaderboardData = null;
  let driverBehindReferenceData = null;
  if (thisDriverLeaderboardDataIndex < leaderboardData.length - 1) { // Check if there's a driver behind
    driverBehindLeaderboardData = leaderboardData[thisDriverLeaderboardDataIndex + 1];
    driverBehindReferenceData = referenceData.drivers[driverBehindLeaderboardData.Car];
  } else {
      console.log(`No driver behind car ${driverInfoCarNumber} (currently last place).`);
  }

  // Build object to push to Google sheet
  let singleDataPoints = {
    range: DRIVERINFO_SHEET_NAME + '!A'+startingRow+':O'+startingRow+'',
    majorDimension: 'ROWS',
    values: [[
      thisDriverLeaderboardData.Car, // Column A is car number
      'P' + thisDriverLeaderboardData.Rank, // Column B is rank number
      getOrdinal(thisDriverLeaderboardData.Rank), // Column C is rank ordinal (e.g. 1st = st, 2nd = nd)
      thisDriverReferenceData.firstName, // Column D is first name
      thisDriverReferenceData.lastName, // Column E is last name
      thisDriverReferenceData.firstName + ' ' + thisDriverReferenceData.lastName, // Column F is display name (in this case full name)
      thisDriverReferenceData.headshot, // Column G is headshot URL (find in the tagboard graphic library and update in the google sheet 'Database')
      thisDriverReferenceData.teamLogo + ' ', // Column H is team logo (added space for formatting)
      convertSecondsToMinutesSeconds(thisDriverAllLapTimesData.fastestLapTime), // Column I is fastest lap time
      lapsCompleted, // Column J is last lap number
      convertSecondsToMinutesSeconds(thisDriverLapData.lastLapTime), // Column K is last lap time (not lapNumber as previously)
      stringToRoundedWholeString(thisDriverTelemetryData.speed), // Column L is speed
      stringToRoundedDecimalString(thisDriverAverageSpeedData.lastLapAverage), // Column M is average speed
      driverAheadReferenceData ? driverAheadReferenceData.lastName : '-', // Column N is driver ahead last name
      driverBehindReferenceData ? driverBehindReferenceData.lastName : '-', // Column O is driver behind last name
    ]]
  };

  driverInfoForUpdateBuffer.push(singleDataPoints);

  // --- Last Lap Delta Logic ---
  let lapDeltaData;
  const currentLapDelta = parseFloat(thisDriverLapData.lastLapDelta); // Convert to number for comparison

  if (isNaN(currentLapDelta) || thisDriverLapData.lastLapDelta.trim() === '' || thisDriverLapData.lastLapDelta.includes('NaN')) {
      // If delta is invalid, empty, or NaN, reset to white
      lapDeltaData = {
          range: DRIVERINFO_SHEET_NAME + '!Q'+startingRow+':Q'+parseInt((parseInt(startingRow)+2)),
          majorDimension: 'COLUMNS',
          values: [['', '', '']] // All white
      };
      thisCarState.prevLapDeltaColorState = 'white';
      thisCarState.prevLapDeltaValue = null;
      console.log(`Car ${driverInfoCarNumber}: Lap delta is invalid or empty. Resetting to white.`);
  } else if (currentLapDelta < 0) { // Better (Green)
      lapDeltaData = {
          range: DRIVERINFO_SHEET_NAME + '!Q'+startingRow+':Q'+parseInt((parseInt(startingRow)+2)),
          majorDimension: 'COLUMNS',
          values: [['', thisDriverLapData.lastLapDelta, '']] // Green
      };
      thisCarState.prevLapDeltaColorState = 'green';
      thisCarState.prevLapDeltaValue = currentLapDelta;
      console.log(`Car ${driverInfoCarNumber}: Lap delta is BETTER (Green).`);
  } else if (currentLapDelta > 0) { // Worse (Red)
      lapDeltaData = {
          range: DRIVERINFO_SHEET_NAME + '!Q'+startingRow+':Q'+parseInt((parseInt(startingRow)+2)),
          majorDimension: 'COLUMNS',
          values: [['', '', thisDriverLapData.lastLapDelta]] // Red
      };
      thisCarState.prevLapDeltaColorState = 'red';
      thisCarState.prevLapDeltaValue = currentLapDelta;
      console.log(`Car ${driverInfoCarNumber}: Lap delta is WORSE (Red).`);
  } else { // Neutral / Zero
      lapDeltaData = {
          range: DRIVERINFO_SHEET_NAME + '!Q'+startingRow+':Q'+parseInt((parseInt(startingRow)+2)),
          majorDimension: 'COLUMNS',
          values: [[thisDriverLapData.lastLapDelta, '', '']] // White
      };
      thisCarState.prevLapDeltaColorState = 'white';
      thisCarState.prevLapDeltaValue = currentLapDelta;
      console.log(`Car ${driverInfoCarNumber}: Lap delta is NEUTRAL (White).`);
  }
  driverInfoForUpdateBuffer.push(lapDeltaData);


  // --- Driver Ahead Split Logic ---
  let driverAheadSplitData;
  let currentDriverAheadSplit = null;

  if (driverAheadLeaderboardData) {
      currentDriverAheadSplit = parseFloat(stringToRoundedDecimalString(
          thisDriverLeaderboardData.Time_Behind - driverAheadLeaderboardData.Time_Behind
      ));
  }

  if (driverAheadLeaderboardData === null || isNaN(currentDriverAheadSplit) || currentDriverAheadSplit === 0) {
      // If no driver ahead, or split is invalid/zero, reset to white
      driverAheadSplitData = {
          range: DRIVERINFO_SHEET_NAME + '!R'+startingRow+':R'+parseInt((parseInt(startingRow)+2)),
          majorDimension: 'COLUMNS',
          values: [['', '', '']] // All white
      };
      thisCarState.prevDriverAheadSplitColorState = 'white';
      thisCarState.prevDriverAheadSplitValue = null;
      console.log(`Car ${driverInfoCarNumber}: Driver ahead split is invalid, zero, or no driver ahead. Resetting to white.`);
  } else {
      // Check current state and apply sticky logic
      let displayValue = '+' + currentDriverAheadSplit.toFixed(3); // Always display as positive with +

      if (thisCarState.prevDriverAheadSplitValue === null) {
          // First time, or previous was reset. Set initial color based on value.
          driverAheadSplitData = {
              range: DRIVERINFO_SHEET_NAME + '!R'+startingRow+':R'+parseInt((parseInt(startingRow)+2)),
              majorDimension: 'COLUMNS',
              values: [[displayValue, '', '']] // Default to white
          };
          thisCarState.prevDriverAheadSplitColorState = 'white'; // Start as white
          console.log(`Car ${driverInfoCarNumber}: Driver ahead split: Initializing to White.`);
      } else if (currentDriverAheadSplit < thisCarState.prevDriverAheadSplitValue) {
          // Split decreased (better)
          driverAheadSplitData = {
              range: DRIVERINFO_SHEET_NAME + '!R'+startingRow+':R'+parseInt((parseInt(startingRow)+2)),
              majorDimension: 'COLUMNS',
              values: [['', displayValue, '']] // Green
          };
          thisCarState.prevDriverAheadSplitColorState = 'green';
          console.log(`Car ${driverInfoCarNumber}: Driver ahead split: Got SMALLER (Green).`);
      } else if (currentDriverAheadSplit > thisCarState.prevDriverAheadSplitValue) {
          // Split increased (worse)
          driverAheadSplitData = {
              range: DRIVERINFO_SHEET_NAME + '!R'+startingRow+':R'+parseInt((parseInt(startingRow)+2)),
              majorDimension: 'COLUMNS',
              values: [['', '', displayValue]] // Red
          };
          thisCarState.prevDriverAheadSplitColorState = 'red';
          console.log(`Car ${driverInfoCarNumber}: Driver ahead split: Got LARGER (Red).`);
      } else {
          // Value stayed the same, or slight fluctuation without crossing a threshold.
          // Stick to the previous color.
          if (thisCarState.prevDriverAheadSplitColorState === 'green') {
              driverAheadSplitData = {
                  range: DRIVERINFO_SHEET_NAME + '!R'+startingRow+':R'+parseInt((parseInt(startingRow)+2)),
                  majorDimension: 'COLUMNS',
                  values: [['', displayValue, '']] // Stick to Green
              };
              console.log(`Car ${driverInfoCarNumber}: Driver ahead split: Sticking to GREEN.`);
          } else if (thisCarState.prevDriverAheadSplitColorState === 'red') {
              driverAheadSplitData = {
                  range: DRIVERINFO_SHEET_NAME + '!R'+startingRow+':R'+parseInt((parseInt(startingRow)+2)),
                  majorDimension: 'COLUMNS',
                  values: [['', '', displayValue]] // Stick to Red
              };
              console.log(`Car ${driverInfoCarNumber}: Driver ahead split: Sticking to RED.`);
          } else {
              // Was white, or no significant change to trigger color change
              driverAheadSplitData = {
                  range: DRIVERINFO_SHEET_NAME + '!R'+startingRow+':R'+parseInt((parseInt(startingRow)+2)),
                  majorDimension: 'COLUMNS',
                  values: [[displayValue, '', '']] // Stick to White
              };
              thisCarState.prevDriverAheadSplitColorState = 'white'; // Explicitly keep as white
              console.log(`Car ${driverInfoCarNumber}: Driver ahead split: Sticking to WHITE.`);
          }
      }
  }
  thisCarState.prevDriverAheadSplitValue = currentDriverAheadSplit; // Update stored value for next comparison
  driverInfoForUpdateBuffer.push(driverAheadSplitData);


  // --- Driver Behind Split Logic ---
  let driverBehindSplitData;
  let currentDriverBehindSplit = null;

  if (driverBehindLeaderboardData) {
      currentDriverBehindSplit = parseFloat(stringToRoundedDecimalString(
          driverBehindLeaderboardData.Time_Behind - thisDriverLeaderboardData.Time_Behind
      ));
  }

  if (driverBehindLeaderboardData === null || isNaN(currentDriverBehindSplit) || currentDriverBehindSplit === 0) {
      // If no driver behind, or split is invalid/zero, reset to white
      driverBehindSplitData = {
          range: DRIVERINFO_SHEET_NAME + '!S'+startingRow+':S'+parseInt((parseInt(startingRow)+2)),
          majorDimension: 'COLUMNS',
          values: [['', '', '']] // All white
      };
      thisCarState.prevDriverBehindSplitColorState = 'white';
      thisCarState.prevDriverBehindSplitValue = null;
      console.log(`Car ${driverInfoCarNumber}: Driver behind split is invalid, zero, or no driver behind. Resetting to white.`);
  } else {
      // Check current state and apply sticky logic
      let displayValue = '+' + currentDriverBehindSplit.toFixed(3); // Always display as positive with +

      if (thisCarState.prevDriverBehindSplitValue === null) {
          // First time, or previous was reset. Set initial color based on value.
          driverBehindSplitData = {
              range: DRIVERINFO_SHEET_NAME + '!S'+startingRow+':S'+parseInt((parseInt(startingRow)+2)),
              majorDimension: 'COLUMNS',
              values: [[displayValue, '', '']] // Default to white
          };
          thisCarState.prevDriverBehindSplitColorState = 'white'; // Start as white
          console.log(`Car ${driverInfoCarNumber}: Driver behind split: Initializing to White.`);
      } else if (currentDriverBehindSplit < thisCarState.prevDriverBehindSplitValue) {
          // Split decreased (better)
          driverBehindSplitData = {
              range: DRIVERINFO_SHEET_NAME + '!S'+startingRow+':S'+parseInt((parseInt(startingRow)+2)),
              majorDimension: 'COLUMNS',
              values: [['', displayValue, '']] // Green
          };
          thisCarState.prevDriverBehindSplitColorState = 'green';
          console.log(`Car ${driverInfoCarNumber}: Driver behind split: Got SMALLER (Green).`);
      } else if (currentDriverBehindSplit > thisCarState.prevDriverBehindSplitValue) {
          // Split increased (worse)
          driverBehindSplitData = {
              range: DRIVERINFO_SHEET_NAME + '!S'+startingRow+':S'+parseInt((parseInt(startingRow)+2)),
              majorDimension: 'COLUMNS',
              values: [['', '', '+' + displayValue]] // Red
          };
          thisCarState.prevDriverBehindSplitColorState = 'red';
          console.log(`Car ${driverInfoCarNumber}: Driver behind split: Got LARGER (Red).`);
      } else {
          // Value stayed the same, or slight fluctuation without crossing a threshold.
          // Stick to the previous color.
          if (thisCarState.prevDriverBehindSplitColorState === 'green') {
              driverBehindSplitData = {
                  range: DRIVERINFO_SHEET_NAME + '!S'+startingRow+':S'+parseInt((parseInt(startingRow)+2)),
                  majorDimension: 'COLUMNS',
                  values: [['', displayValue, '']] // Stick to Green
              };
              console.log(`Car ${driverInfoCarNumber}: Driver behind split: Sticking to GREEN.`);
          } else if (thisCarState.prevDriverBehindSplitColorState === 'red') {
              driverBehindSplitData = {
                  range: DRIVERINFO_SHEET_NAME + '!S'+startingRow+':S'+parseInt((parseInt(startingRow)+2)),
                  majorDimension: 'COLUMNS',
                  values: [['', '', displayValue]] // Stick to Red
              };
              console.log(`Car ${driverInfoCarNumber}: Driver behind split: Sticking to RED.`);
          } else {
              // Was white, or no significant change to trigger color change
              driverBehindSplitData = {
                  range: DRIVERINFO_SHEET_NAME + '!S'+startingRow+':S'+parseInt((parseInt(startingRow)+2)),
                  majorDimension: 'COLUMNS',
                  values: [[displayValue, '', '']] // Stick to White
              };
              thisCarState.prevDriverBehindSplitColorState = 'white'; // Explicitly keep as white
              console.log(`Car ${driverInfoCarNumber}: Driver behind split: Sticking to WHITE.`);
          }
      }
  }
  thisCarState.prevDriverBehindSplitValue = currentDriverBehindSplit; // Update stored value for next comparison
  driverInfoForUpdateBuffer.push(driverBehindSplitData);

  return driverInfoForUpdateBuffer;
}


/**
 * Function to update driver info data.
 */
async function updateDriverInfoSheet(leaderboardData, telemetryData, lapData) {
  try {
    let gsheetDriverInfoUpdateData = [];

    console.log('Updating driver info data in Google Sheet...');

    // Process each car and collect its data
    let car1Data = getDriverInfoForUpdate(targetCarNumber, 2, leaderboardData, telemetryData, lapData);
    gsheetDriverInfoUpdateData.push(...car1Data); // Use spread operator to add all items

    let car2Data = getDriverInfoForUpdate(targetCar2Number, 12, leaderboardData, telemetryData, lapData);
    gsheetDriverInfoUpdateData.push(...car2Data); // Correctly push car2Data

    let car3Data = getDriverInfoForUpdate(targetCar3Number, 22, leaderboardData, telemetryData, lapData);
    gsheetDriverInfoUpdateData.push(...car3Data); // Correctly push car3Data

    // Send the data to the correct cells in the google sheet.
    const response = await sheets_TelemetryAccount.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      valueInputOption: 'RAW',
      resource: {
        data: gsheetDriverInfoUpdateData,
      }
    });

    console.log('Driver info data updated in Google Sheet: ', response.data.totalUpdatedRows + ' rows');

  } catch (error) {
    console.error('Error in updateDriverInfoSheet:', error);
    // On a major error, you might want to reset ALL car states or handle it more gracefully
    // For now, removing the individual variable resets as the carStates object handles it.
  }
}

/**
 * Function to update leaderboard data.
 * 
 */
 async function updateLeaderboardSheet(leaderboardData, telemetryData, lapData) {
  try {
    console.log('Updating leaderboard data in Google Sheet...');

    // Build array to update google sheet
    let gsheetLeaderboardUpdateData = [];
    for (i = 0; i < leaderboardData.length; i++) { // Loop through latest leaderboard and use reference data to find driver info
      let thisCarNumber = leaderboardData[i].Car;
      let thisDriverReferenceData = referenceData.drivers[thisCarNumber];
      //console.log("This car reference data: " + thisDriverReferenceData);

      // Find index of telemetry data for this car
      let thisCarTelemetryData = telemetryData[telemetryData.findIndex(item => item.carNumber === thisCarNumber)];
      // Find index of the lap data for this car
      let thisCarLapData = lapData[lapData.findIndex(item => item.carNumber === thisCarNumber)];

      // Handler for car data
      let thisCarTimeBehind;
      let thisCarIntervalSplit;
      let thisCarSpeed;
      let thisCarLastLapSpeed;
      let thisCarLastLapTime;

      let carAheadInPit;
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

      // Handler for target car DNF indicator, otherwise assign data
      let thisCarDNF;
      let thisCarDNFImg;

      let thisCarStatusIndex = carStatusData.findIndex(item => item.carNumber === thisCarNumber);
      //console.log(thisCarStatusIndex);
      let thisCarStatusCoverImg = '';

      if (carStatusData[thisCarStatusIndex].carStatus === 'DNF') {
        thisCarDNF = true;
        thisCarDNFImg = referenceData.leaderboardImages['DNF'];
        thisCarTimeBehind = 'DNF';
      } else {
        thisCarDNF = false;
        thisCarDNFImg = '';
        thisCarSpeed = thisCarTelemetryData.speed;
        thisCarLastLapSpeed = '000';
        thisCarLastLapTime = convertSecondsToMinutesSeconds(thisCarLapData.lastLapTime);
      }

      //Setup manual DNF override
      let thisCarDNFIndex = manualDNFOverride.findIndex(item => item.carNumber === thisCarNumber);
      if (manualDNFOverride[thisCarDNFIndex].DNF === true) {
        thisCarDNF = true;
        thisCarDNFImg = referenceData.leaderboardImages['DNF'];
        thisCarTimeBehind = 'DNF';
      }

      //Finds interval split and handles if car ahead is in the pit lane
      let thisCarDeltaData;
      if (i === 0) {
        thisCarDeltaData = '0.000';
      } else if (i !== 0) {
        thisCarDeltaData = leaderboardData[i].Time_Behind - leaderboardData[i-1].Time_Behind;
      } else {
        thisCarDelta = '-';
      };

      if (i > 2) {
        if (leaderboardData[i-1].Time_Behind - leaderboardData[i-2].Time_Behind < 0 ) {
        carAheadInPit = true;
        } else {
        carAheadInPit = false;
        }
      } else {
        carAheadInPit = false; // This is a band aid that can't detect if the first car pits
      };

      if (thisCarDNF) {
        thisCarIntervalSplit = 'DNF';
        thisCarStatusCoverImg = referenceData.leaderboardImages['DNF'];
      } else if (i !== 0 && carAheadInPit === false && thisCarIntervalSplit === undefined && thisCarDeltaData > 0) {
        thisCarIntervalSplit = '+' + stringToRoundedDecimalString(leaderboardData[i].Time_Behind - leaderboardData[i-1].Time_Behind);
      } else if (i !== 0 && carAheadInPit === true && thisCarIntervalSplit === undefined) { // Car ahead is in Pit, skip split time for now
        thisCarIntervalSplit = '-';
      } else if (thisCarDeltaData < 0 && thisCarIntervalSplit === undefined) {
        thisCarIntervalSplit = 'IN PIT';
      } else if (thisCarIntervalSplit === undefined) { // This car is the leader, enter time behind (usually 0)
        thisCarIntervalSplit = stringToRoundedDecimalString(leaderboardData[i].Time_Behind);
      }

      

      let thisLineObject = {
        range: LEADERBOARD_SHEET_NAME + '!A' + (i+2) + ':' + 'Q' + (i+2),
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
          thisCarSpeed, // Column 12 is last known speed
          'tire compound', // Column 13 is tire compound, not built yet
          thisCarHighlight, // Column 14 is the link to the highlight graphic URL if this is the target car
          thisCarLapData.lapNumber, // Column 15 is laps completed
          thisCarLastLapTime, // Column 16 is last lap time
          thisCarDNFImg, // Column 16 is DNF URL for handling greyed out overlay
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

    // Use a batchGet to fetch both ranges in a single API call
    const batchResponse = await sheets_LeaderboardAccount.spreadsheets.values.batchGet({
      spreadsheetId: SPREADSHEET_ID,
      ranges: [
        `${CONTROLLER_SHEET_NAME}!${TELEMETRY_ONLINE_CHECKBOX_CELL}`,
        `${CONTROLLER_SHEET_NAME}!A13:A23`, // Range for manual DNF car numbers
      ],
    });

    const valueRanges = batchResponse.data.valueRanges;

    // Process the online status checkbox
    const onlineStatusValues = valueRanges[0].values;
    isOnline = onlineStatusValues && onlineStatusValues.length > 0 && onlineStatusValues[0].length > 0 && onlineStatusValues[0][0] === 'TRUE';
    console.log(`Online status from sheet: ${isOnline}`);

    // Process manual DNF overrides
    for (i = 0; i < manualDNFOverride.length; i++) {
      manualDNFOverride[i].DNF = false; // Reset DNFs if car number is no longer overridden in google sheets
    }
    const dnfValues = valueRanges[1].values;
    //console.log(dnfValues);
    if (dnfValues && dnfValues.length > 0) {
      for (i = 0; i < dnfValues.length; i++) {
        let thisCarNumber = dnfValues[i][0];
        let thisCarDNFIndex = manualDNFOverride.findIndex(item => item.carNumber === thisCarNumber);
        manualDNFOverride[thisCarDNFIndex].DNF = true;
      };
    };

    console.log('Manual DNF Overrides:', manualDNFOverride);
    // You can now use the manualDNFOverride array elsewhere in your code.

    if (isOnline) {
      console.log('Online checkbox is TRUE. Updating heartbeat.');
      // Update the heartbeat cell (e.g., set it to the current timestamp)
      try {
        await sheets_LeaderboardAccount.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${CONTROLLER_SHEET_NAME}!A2`, // Example: Update cell A2 with the heartbeat
          valueInputOption: 'RAW',
          resource: {
            values: [[new Date().toISOString()]],
          },
        });
      } catch (e) {
        console.error("Error updating heartbeat: ", e);
      }
      return true;
    } else {
      console.log('Online checkbox is FALSE. Not processing data.');
      return false;
    }

  } catch (error) {
    console.error('Error checking online status or fetching DNF overrides:', error);
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
      console.log("periodicUpdateLeaderboardSheet - Updating sheet"); //add
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
  if (isOnline && latestLeaderboardData.length > 0 && Object.keys(latestFullTelemetryData).length > 0 && latestLapData.length > 0) {
    try {
      console.log("periodicUpdateDriverInfoSheet - Updating sheet"); //add
      await updateDriverInfoSheet(latestLeaderboardData, latestFullTelemetryData, latestLapData); //send the data.
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
    targetCarNumber = await readTargetCarNumber(TARGET_CAR_SHEET_NAME, TARGET_CAR_CELL);
    targetCar2Number = await readTargetCarNumber(TARGET_CAR_SHEET_NAME, TARGET_CAR_2_CELL);
    targetCar3Number = await readTargetCarNumber(TARGET_CAR_SHEET_NAME, TARGET_CAR_3_CELL);
    console.log(`Target car number: ${targetCarNumber} car 2: ${targetCar2Number} car 3: ${targetCar3Number}`); // Log the target car number
    
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
      const carStatusStart = '<Car_Status';
      const carStatusEnd = '/>';
      const flagStart = '<Flag Elapsed_Time="';
      const flagEnd = '/>';

      let message = null;

      while (buffer.length > 0) {
        let telemetryStartIndex = buffer.indexOf(telemetryStart);
        //console.log("telemetry data start index... " + telemetryStartIndex);
        let pitStartIndex = buffer.indexOf(pitStart);
        //console.log("pit data start index... " + pitStartIndex);
        let unofficialLeaderboardStartIndex = buffer.indexOf(unofficialLeaderboardStart);
        //console.log("leaderboard data start index... " + unofficialLeaderboardStartIndex);
        let completedLapStartIndex = buffer.indexOf(completedLapStart);
        let carStatusStartIndex = buffer.indexOf(carStatusStart);
        let flagStartIndex = buffer.indexOf(flagStart);

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
        } else if (carStatusStartIndex !== -1) {
          let carStatusEndIndex = buffer.indexOf(carStatusEnd, carStatusStartIndex);
          if (carStatusEndIndex !== -1) {
            message = buffer.substring(carStatusStartIndex, carStatusEndIndex + carStatusEnd.length);
            buffer = buffer.substring(carStatusEndIndex + carStatusEnd.length);
          } else {
            break; // Incomplete completed lap message, wait for more data
          }
        } else if (flagStartIndex !== -1) {
          let flagEndIndex = buffer.indexOf(carStatusEnd, carStatusStartIndex);
          if (flagEndIndex !== -1) {
            message = buffer.substring(flagStartIndex, flagEndIndex + flagEnd.length);
            buffer = buffer.substring(flagEndIndex + flagEnd.length);
          };
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
                let fullTelemetryDataBuffer = [];
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
                  fullTelemetryDataBuffer.push(thisCarTelemetryData);
                };
                latestFullTelemetryData = fullTelemetryDataBuffer; // Clears last full telemetry data array

                // Add speeds to current average speed data array
                for (i = 0; i < latestFullTelemetryData.length; i++) {
                  let thisCarNumber = latestFullTelemetryData[i].carNumber;
                  let averageSpeedIndex = averageSpeedData.findIndex(item => item.carNumber === thisCarNumber);
                  if (averageSpeedIndex !== -1){
                    averageSpeedData[averageSpeedIndex].currentLapSpeeds.push(latestFullTelemetryData[i].speed);
                  };
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

                // Update last lap average speed and reset current lap speed array
                let averageSpeedIndex = averageSpeedData.findIndex(item => item.carNumber === thisCarNumber);
                let newAverageSpeed;
                if (averageSpeedIndex !== -1) {
                  let averageSpeedSum = 0;
                  for (i = 0; i < averageSpeedData[averageSpeedIndex].currentLapSpeeds.length; i++) {
                    averageSpeedSum = averageSpeedSum + averageSpeedData[averageSpeedIndex].currentLapSpeeds[i];
                  };
                  newAverageSpeed = averageSpeedSum / averageSpeedData[averageSpeedIndex].currentLapSpeeds.length;

                  averageSpeedData[averageSpeedIndex] = {
                    carNumber:thisCarNumber,
                    averageSpeedLapNumber:result.$.Lap_Number,
                    lastLapAverage:newAverageSpeed,
                    currentLapSpeeds:[],
                  };
                  console.log(averageSpeedData[averageSpeedIndex])
                  console.log('Last lap average speed ',newAverageSpeed,'for car ',thisCarNumber);
                  
                };
                
                if (completedLapCarIndex !== -1) {

                  console.log('Updating lap ' + result.$.Lap_Number + ' data for car ' + thisCarNumber + '...');
                  let lastLapTime = latestLapData[completedLapCarIndex].lastLapTime;
                  let thisLapTime = result.$.Lap_Time;
                  let lapDelta;

                  if (parseFloat(lastLapTime) > parseFloat(thisLapTime)) {
                    lapDelta = '-' + (parseFloat(lastLapTime) - parseFloat(thisLapTime)).toString();
                  } else if (parseFloat(lastLapTime) < parseFloat(thisLapTime)) {
                    lapDelta = '+' + (parseFloat(thisLapTime) - parseFloat(lastLapTime)).toString();
                  } else {
                    lapDelta = '0.000';
                  };

                  let newLapDataObject = {
                    carNumber:result.$.Car,
                    fastestLap:result.$.Fastest_Lap,
                    lastLapNumber:result.$.Lap_Number,
                    lastLapTime:result.$.Lap_Time,
                    totalTime:result.$.Time,
                    lapsBehindLeader:result.$.Laps_Behind_Leader,
                    timeBehindLeader:result.$.Time_Behind_Leader,
                    lastLapDelta:stringToRoundedDecimalString(lapDelta),
                    averageSpeed:newAverageSpeed,
                  };
                  latestLapData[completedLapCarIndex] = newLapDataObject;

                  let lapTimeDataIndex = allLapTimesData.findIndex(item => item.carNumber === result.$.Car);
                  allLapTimesData[lapTimeDataIndex].lapTimes.push({ lapNumber:result.$.Lap_Number, lapTime:result.$.Lap_Time});
                  allLapTimesData[lapTimeDataIndex].fastestLapNumber = result.$.Fastest_Lap;
                  let fastestLapTimeIndex = allLapTimesData[lapTimeDataIndex].lapTimes.findIndex(item => item.lapNumber === result.$.Fastest_Lap);
                  if (fastestLapTimeIndex !== -1 && allLapTimesData[lapTimeDataIndex].lapTimes[fastestLapTimeIndex].lapTime) {
                    allLapTimesData[lapTimeDataIndex].fastestLapTime = allLapTimesData[lapTimeDataIndex].lapTimes[fastestLapTimeIndex].lapTime;
                    console.log(`car ${result.$.Car} new fastest lap of ${allLapTimesData[lapTimeDataIndex].fastestLapTime}`);
                  };
                  console.log(allLapTimesData[lapTimeDataIndex]);


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
                    averageSpeed:'-',
                  };
                  console.log(newLapDataObject);
                  latestLapData.push(newLapDataObject);
                };

              } else if (carStatusStartIndex !== -1) {
                let thisCarNumber = result.$.Car;
                console.log("Checking for existing car status data")

                let carStatusDataIndex = carStatusData.findIndex(item => item.carNumber === thisCarNumber);
                
                if (carStatusDataIndex !== -1) {

                  let newCarStatusObject = {
                    carNumber:result.$.Car,
                    carStatus:result.$.Status,
                  };

                  carStatusData[carStatusDataIndex] = newCarStatusObject;
                  console.log(carStatusData[carStatusDataIndex]);

                } else {
                  console.log('This driver was not found in the reference database...adding')
                  let newCarStatusObject = {
                    carNumber:result.$.Car,
                    carStatus:result.$.Status,
                  };
                  console.log(newLapDataObject);
                  latestLapData.push(carStatusData);
                }
              } else if (flagStartIndex !== -1) {
                //console.log(result);
                lapsCompleted = result.$.Laps_Completed;
                console.log(lapsCompleted);
                flagColor = result.$.Status;
                console.log(flagColor);
                timeElapsed = result.$.Elapsed_Time;
                console.log(timeElapsed);
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
          targetCarNumber = await readTargetCarNumber(TARGET_CAR_SHEET_NAME, TARGET_CAR_CELL);
          targetCar2Number = await readTargetCarNumber(TARGET_CAR_SHEET_NAME, TARGET_CAR_2_CELL);
          targetCar3Number = await readTargetCarNumber(TARGET_CAR_SHEET_NAME, TARGET_CAR_3_CELL);
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
            driverInfoUpdateInterval = setInterval(periodicUpdateDriverInfoSheet, driverInfoUpdateTime) // Update DriverInfo sheet
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
            clearInterval(leaderboardUpdateInterval);
            leaderboardUpdateInterval = null;
            latestLeaderboardData = {};
            latestLapData = {};
            console.log('Leaderboard update interval stopped.');
          }
          if (driverInfoUpdateInterval) {
            clearInterval(driverInfoUpdateInterval);
            driverInfoUpdateInterval = null;
            console.log('Driver Info update interval stopped.');
          }

          console.log('Offline: Not updating sheet.');
        }
      } catch (error) {
        console.error("Error in main interval:", error);
      }
    }, 10000); // Check every 5 seconds
  } catch (error) {
    console.error('Application failed to start:', error);
    //  Handle the error appropriately (e.g., exit, try to reconnect, send an alert).
  }
}

// Start the application.
main();
