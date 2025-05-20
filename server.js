const net = require('net');
const xml2js = require('xml2js');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// Constants - REPLACE THESE WITH YOUR ACTUAL VALUES
const TCP_HOST = 'localhost';
const TCP_PORT = 5000;
const SPREADSHEET_ID = '1UIpgq72cvEUT-qvEB4gmwDjvFU4CDIXf2rllNseYEUM';
const GOOGLE_TELEMETRY_SERVICE_ACCOUNT_KEY_PATH = 'indycar-live-data-telemetry-account.json';
const GOOGLE_LEADERBOARD_SERVICE_ACCOUNT_KEY_PATH = 'indycar-live-data-leaderboard-account.json';
const TARGET_CAR_SHEET_NAME = 'Live Data Controller'; // Sheet containing the target car number and online checkbox
const LEADERBOARD_SHEET_NAME = 'Live Pillar Test'
const TELEMETRY_SHEET_NAME = 'Telemetry Test'; // Sheet to write telemetry data
const DATABASE_SHEET_NAME = 'Database'; // Sheet containing driver and reference data
const CONTROLLER_SHEET_NAME = 'Live Data Controller'; // Sheet for the controller tab
const TELEMETRY_ONLINE_CHECKBOX_CELL = 'B4'; // Cell containing the online checkbox
const TARGET_CAR_CELL = 'B5';    // Cell containing the target car

// Global Variables
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
let latestLeaderboardData = [];
let leaderboardUpdateTime = 2000; // Set time in ms for interval to update leaderboard sheet
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
    };

    // Define the ranges we want to retrieve
    const ranges = [
      `${DATABASE_SHEET_NAME}!A2:H28`, // Driver data
      `${DATABASE_SHEET_NAME}!A31:B33`, // Tire image URLs
      `${DATABASE_SHEET_NAME}!A36:B39`, // Indicator image URLs
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
        if (range === `${DATABASE_SHEET_NAME}!A2:H28`) {
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
        } else if (range === `${DATABASE_SHEET_NAME}!A31:B33`) {
          // Process tire image URLs
          for (let i = 0; i < values.length; i++) {
            const row = values[i];
            const tireType = row[0];
            const tireImageUrl = row[1];
            referenceData.tireImages[tireType] = tireImageUrl;
          }
        } else if (range === `${DATABASE_SHEET_NAME}!A36:B39`) {
          // Process indicator image URLs
          for (let i = 0; i < values.length; i++) {
            const row = values[i];
            const indicatorType = row[0];
            const indicatorImageUrl = row[1];
            referenceData.indicatorImages[indicatorType] = indicatorImageUrl;
          }
        }
      } else {
        console.warn(`Range ${range} in reference data sheet is empty.`);
      }
    }
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
        telemetryData.rank, // Column B is rank number
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
 * Function to update leaderboard data.
 * 
 */
 async function updateLeaderboardSheet(leaderboardData, telemetryData) {
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
      if (leaderboardData[i].Laps_Behind !== "0") {
        //console.log("This car is lapped, changing time behind to laps.")
        thisCarTimeBehind = leaderboardData[i].Time_Behind + leaderboardData[i].Laps_Behind + " laps";
        thisCarIntervalSplit = thisCarTimeBehind;
      } else {
        //console.log("This car is not lapped.")
        thisCarTimeBehind = leaderboardData[i].Time_Behind;
      };

      if (i !== 0 && thisCarIntervalSplit === undefined) {
        thisCarIntervalSplit = '+' + stringToRoundedDecimalString(leaderboardData[i].Time_Behind - leaderboardData[i-1].Time_Behind);
      } else if (thisCarIntervalSplit === undefined) {
        thisCarIntervalSplit = stringToRoundedDecimalString(leaderboardData[i].Time_Behind);
      }

      let thisLineObject = {
        range: LEADERBOARD_SHEET_NAME + '!A' + (i+2) + ':' + 'M' + (i+2),
        majorDimension: 'ROWS',
        values: [[
          leaderboardData[i].Rank, // Column 1 is Rank
          thisCarNumber, // Column 2 is Car Number
          thisDriverReferenceData.carLogo, // Column 3 is Car Number
          thisDriverReferenceData.team, // Column 4 is Car Number
          thisDriverReferenceData.teamLogo, // Column 5 is Car Number
          thisDriverReferenceData.firstName, // Column 6 is Car Number
          thisDriverReferenceData.lastName, // Column 7 is Car Number
          thisDriverReferenceData.displayName, // Column 8 is Car Number
          'total time', // Column 9 is Total Time, not built yet
          thisCarTimeBehind, // Column 10 is Leader Split
          thisCarIntervalSplit,
          '=TEXT(K' + (i + 2) + ', "[s].000")&" "', // Column 12 is last known speed
          'tire compound' // Column 13 is tire compound, not built yet
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
    console.log("Not updating sheet. isOnline: ", isOnline, " data available: ", Object.keys(latestTargetTelemetryData).length > 0);
  }
}

async function periodicUpdateLeaderboardSheet() {
  console.log("periodicUpdateLeaderboardSheet called"); //add
  if (isOnline && latestLeaderboardData.length > 0) {
    try {
      console.log("periodicUpdateTelemetrySheet - Updating sheet"); //add
      await updateLeaderboardSheet(latestLeaderboardData, latestFullTelemetryData); //send the data.
    }
    catch (e) {
      console.error("Error in sending data to sheet", e);
    }
  }
  else {
    console.log("Not updating sheet. isOnline: ", isOnline, " data available: ", latestLeaderboardData.length > 0);
  }
}


/**
 * Main function to connect to the TCP socket, receive data, and process it.
 */
async function main() {
  try {
    
    await authenticateLeaderboardAccount(); // Authenticate Leaderboard update account with Google Sheets API
    await authenticateTelemetryAccount(); // Authenticate Telemetry update account with Google Sheets API
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

      let message = null;

      while (buffer.length > 0) {
        let telemetryStartIndex = buffer.indexOf(telemetryStart);
        //console.log("telemetry data start index... " + telemetryStartIndex);
        let pitStartIndex = buffer.indexOf(pitStart);
        //console.log("pit data start index... " + pitStartIndex);
        let unofficialLeaderboardStartIndex = buffer.indexOf(unofficialLeaderboardStart);
        //console.log("leaderboard data start index... " + unofficialLeaderboardStartIndex);

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
                  let thisCarNumber = result.Position[i].$.Car;
                  let thisCarTelemetryData = {
                    [thisCarNumber]: {
                      carNumber: result.Position[i].$.Car,
                      rank: parseInt(result.Position[i].$.Rank, 10),
                      speed: parseFloat(result.Position[i].$.speed),
                      rpm: parseInt(result.Position[i].$.rpm, 10),
                      throttle: parseInt(result.Position[i].$.throttle, 10),
                      brake: parseInt(result.Position[i].$.brake, 10),
                      battery: parseInt(result.Position[i].$.Battery_Pct_Remaining, 10),
                      pitStop: 0, // Placeholder
                    }
                  };
                  latestFullTelemetryData.push(thisCarTelemetryData);
                };

                console.log("Latest full telemetry data...");
                console.log(latestFullTelemetryData); 

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

    // Main loop: Check online status, read target car, and process data
    setInterval(async () => { // Changed to setInterval without assigning to onlineCheckInterval
      try {
        const onlineStatus = await checkOnlineStatusAndUpdateHeartbeat(); // Await the result
        if (onlineStatus) {
          targetCarNumber = await readTargetCarNumber(); // Read target car number
          console.log(`Target car number: ${targetCarNumber}`);
          if (!telemetryUpdateInterval) { // Check the telemetry update interval variable
            telemetryUpdateInterval = setInterval(periodicUpdateTelemetrySheet, telemetryUpdateTime); // Update Telemetry sheet
            console.log('Telemetry update interval started at ' + telemetryUpdateTime + 'ms');
          }
          if (!leaderboardUpdateInterval) {
            leaderboardUpdateInterval = setInterval(periodicUpdateLeaderboardSheet, leaderboardUpdateTime) // Update Leaderboard sheet
            console.log('Leaderboard update interval started at ' + leaderboardUpdateTime + 'ms');
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
