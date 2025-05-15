const net = require('net');
const xml2js = require('xml2js');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// Constants - REPLACE THESE WITH YOUR ACTUAL VALUES
const TCP_HOST = '18.236.162.180';
const TCP_PORT = 5000;
const SPREADSHEET_ID = '1UIpgq72cvEUT-qvEB4gmwDjvFU4CDIXf2rllNseYEUM';
const GOOGLE_SERVICE_ACCOUNT_KEY_PATH = 'indycar-live-data-8bbb32c95e6b.json';
const TARGET_CAR_SHEET_NAME = 'Live Data Controller'; // Sheet containing the target car number and online checkbox
const TELEMETRY_SHEET_NAME = 'Telemetry Test'; // Sheet to write telemetry data
const DATABASE_SHEET_NAME = 'Database'; // Sheet containing driver and reference data
const CONTROLLER_SHEET_NAME = 'Live Data Controller'; // Sheet for the controller tab
const ONLINE_CHECKBOX_CELL = 'B4'; // Cell containing the online checkbox
const TARGET_CAR_CELL = 'B5';    // Cell containing the target car

// Global Variables
let client;
let xmlParser = new xml2js.Parser({ explicitRoot: false, ignoreAttributes: false, trim: true });
let googleAuthClient;
let sheets;
let targetCarNumber;
let referenceData = {}; // Store reference data from the sheet
const MAX_RPM = 12000;
const MAX_THROTTLE = 100;
const MAX_BRAKE = 100;

/**
 * Function to authenticate with the Google Sheets API using a service account.
 */
async function authenticate() {
  try {
    googleAuthClient = new JWT({
      keyFile: GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await googleAuthClient.authorize();
    sheets = google.sheets({ version: 'v4', auth: googleAuthClient });
    console.log('Successfully authenticated with Google Sheets API.');
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
    const response = await sheets.spreadsheets.values.get({
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
      const response = await sheets.spreadsheets.values.get({
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
 * Function to update the Google Sheet with the telemetry data for the target car.
 */
async function updateTelemetrySheet(telemetryData) {
  try {
    const sheet = await sheets.spreadsheets.getSheetByName(TELEMETRY_SHEET_NAME);
    if (!sheet) {
      const ss = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
      const newSheet = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        resource: {
          requests: [{
            addSheet: {
              properties: {
                title: TELEMETRY_SHEET_NAME,
              },
            },
          }, ],
        },
      });
    }

    const rankDisplay = getOrdinal(telemetryData.rank);
    const rpmPctBools = [];
    for (let i = 1; i <= 6; i++) {
      rpmPctBools.push(telemetryData.rpm > (MAX_RPM * i / 10));
    }
    const throttlePctBools = [];
    for (let i = 1; i <= 5; i++) {
      throttlePctBools.push(telemetryData.throttle > (MAX_THROTTLE * i / 10));
    }
    const brakePctBools = [];
    for (let i = 1; i <= 5; i++) {
      brakePctBools.push(telemetryData.brake > (MAX_BRAKE * i / 10));
    }
    const headshotUrl = referenceData[telemetryData.carNumber] ? referenceData[telemetryData.carNumber].headshot : '';
    const rpmImgUrls = [
      rpmPctBools[0] ? referenceData.indicatorImages['RPM 10%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K2
      rpmPctBools[1] ? referenceData.indicatorImages['RPM 20%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K3
      rpmPctBools[2] ? referenceData.indicatorImages['RPM 30%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K4
      rpmPctBools[3] ? referenceData.indicatorImages['RPM 40%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K5
      rpmPctBools[4] ? referenceData.indicatorImages['RPM 50%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K6
      rpmPctBools[5] ? referenceData.indicatorImages['RPM 60%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K7
    ];
    const throttleImgUrls = [
      throttlePctBools[0] ? referenceData.indicatorImages['Throttle 20%'] || '' : referenceData.indicatorImages['Throttle 0%'] || '', // N2
      throttlePctBools[1] ? referenceData.indicatorImages['Throttle 40%'] || '' : referenceData.indicatorImages['Throttle 0%'] || '', // O2
      throttlePctBools[2] ? referenceData.indicatorImages['Throttle 60%'] || '' : referenceData.indicatorImages['Throttle 0%'] || '', // P2
      throttlePctBools[3] ? referenceData.indicatorImages['Throttle 80%'] || '' : referenceData.indicatorImages['Throttle 0%'] || '', // Q2
      throttlePctBools[4] ? referenceData.indicatorImages['Throttle 100%'] || '' : referenceData.indicatorImages['Throttle 0%'] || '', // R2
    ];
    const brakeImgUrls = [
      brakePctBools[0] ? referenceData.indicatorImages['Brake 20%'] || '' : referenceData.indicatorImages['Brake 0%'] || '', // W2
      brakePctBools[1] ? referenceData.indicatorImages['Brake 40%'] || '' : referenceData.indicatorImages['Brake 0%'] || '', // X2
      brakePctBools[2] ? referenceData.indicatorImages['Brake 60%'] || '' : referenceData.indicatorImages['Brake 0%'] || '', // Y2
      brakePctBools[3] ? referenceData.indicatorImages['Brake 80%'] || '' : referenceData.indicatorImages['Brake 0%'] || '', // Z2
      brakePctBools[4] ? referenceData.indicatorImages['Brake 100%'] || '' : referenceData.indicatorImages['Brake 0%'] || '', // AA2
    ];
    const values = [
      ['Car Number', 'Rank', 'Rank End', 'First Name', 'Last Name', 'Display Name', 'Headshot', 'Speed', 'RPM',
        'RPM > 10%', 'RPM > 20%', 'RPM > 30%', 'RPM > 40%', 'RPM > 50%', 'RPM > 60%',
        'RPM 10% Img', 'RPM 20% Img', 'RPM 30% Img', 'RPM 40% Img', 'RPM 50% Img', 'RPM 60% Img',
        'Throttle', 'Throttle > 20%', 'Throttle > 40%', 'Throttle > 60%', 'Throttle > 80%', 'Throttle > 100%',
        'Throttle 20% Img', 'Throttle 40% Img', 'Throttle 60% Img', 'Throttle 80% Img', 'Throttle 100% Img',
        'Brake', 'Brake > 20%', 'Brake > 40%', 'Brake > 60%', 'Brake > 80%', 'Brake > 100%',
        'Brake 20% Img', 'Brake 40% Img', 'Brake 60% Img', 'Brake 80% Img', 'Brake 100% Img',
        'Battery', 'Pit Stop'],
      [
        telemetryData.carNumber, // Car Number in A2
        telemetryData.rank,  // Rank number in B2
        rankDisplay, // Rank ordinal in C2
        telemetryData.firstName, // First Name in D2
        telemetryData.lastName,  // Last Name in E2
        telemetryData.displayName, // Display Name in F2
        headshotUrl,  // Headshot URL in G2
        telemetryData.speed,  // Speed in H2
        telemetryData.rpm,  // RPM in I2
        rpmPctBools[0], // RPM > 10% in J2
        rpmPctBools[1], // RPM > 20% in J3
        rpmPctBools[2], // RPM > 30% in J4
        rpmPctBools[3], // RPM > 40% in J5
        rpmPctBools[4], // RPM > 50% in J6
        rpmPctBools[5], // RPM > 60% in J7
        rpmImgUrls[0], // RPM 10% Img Url in K2
        rpmImgUrls[1], // RPM 20% Img Url in K3
        rpmImgUrls[2], // RPM 30% Img Url in K4
        rpmImgUrls[3], // RPM 40% Img Url in K5
        rpmImgUrls[4], // RPM 50% Img Url in K6
        rpmImgUrls[5], // RPM 60% Img Url in K7
        telemetryData.throttle, // Throttle in L2
        throttlePctBools[0], // Throttle > 20% in M2
        throttlePctBools[1], // Throttle > 40% in N2
        throttlePctBools[2], // Throttle > 60% in O2
        throttlePctBools[3], // Throttle > 80% in P2
        throttlePctBools[4], // Throttle > 100% in Q2
        throttleImgUrls[0], // Throttle 20% Img Url in R2
        throttleImgUrls[1], // Throttle 40% Img Url in S2
        throttleImgUrls[2], // Throttle 60% Img Url in T2
        throttleImgUrls[3], // Throttle 80% Img Url in U2
        throttleImgUrls[4], // Throttle 100% Img Url in V2
        telemetryData.brake,
        brakePctBools[0], // Brake > 20% in W2
        brakePctBools[1], // Brake > 40% in X2
        brakePctBools[2], // Brake > 60% in Y2
        brakePctBools[3], // Brake > 80% in Z2
        brakePctBools[4], // Brake > 100% in AA2
        brakeImgUrls[0], // Brake 20% Img Url in Q2
        brakeImgUrls[1], // Brake 40% Img Url in X2
        brakeImgUrls[2], // Brake 60% Img Url in Y2
        brakeImgUrls[3], // Brake 80% Img Url in Z2
        brakeImgUrls[4], // Brake 100% Img Url in AA2
        telemetryData.battery,
        telemetryData.pitStop,
      ],
    ];


    const response = await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TELEMETRY_SHEET_NAME}!A1`, // Start at A1
      valueInputOption: 'RAW',
      resource: {
        values: values,
      },
    });
    console.log('Telemetry data updated in Google Sheet:', response.data);
  } catch (error) {
    console.error('Error updating Google Sheet with telemetry data:', error);
  }
}

/**
 * Function to process a Telemetry XML message.
 */
function processTelemetryMessage(xml) {
  try {
    const positions = xml.Position;
    if (!Array.isArray(positions)) {
      console.error("Positions is not an array", positions);
      return;
    }
    // Find the position for the target car.
    const targetCarPosition = positions.find(pos => pos.Car === targetCarNumber);

    if (targetCarPosition) {
      const carNumber = targetCarPosition.Car;
      const rank = parseInt(targetCarPosition.Rank, 10);
      const speed = parseFloat(targetCarPosition.speed);
      const rpm = parseInt(xml.rpm, 10);
      const throttle = parseInt(xml.throttle, 10);
      const brake = parseInt(xml.brake, 10);
      const battery = parseInt(xml.Battery_Pct_Remaining, 10);
      const firstName = carData[carNumber]?.firstName || "Unknown";
      const lastName = carData[carNumber]?.lastName || "Driver";
      const displayName = carData[carNumber]?.displayName || "Unknown Driver";
      const carLogo = carData[carNumber]?.carLogo || '';
      const team = carData[carNumber]?.team || '';
      const teamLogo = carData[carNumber]?.teamLogo || '';
      const headshot = carData[carNumber]?.headshot || '';
      const pitStop = 0; // Placeholder.  You'll need to get this from another message, likely from Pit_Summary

      const telemetryData = {
        carNumber,
        rank,
        speed,
        rpm,
        throttle,
        brake,
        battery,
        firstName,
        lastName,
        displayName,
        carLogo,
        team,
        teamLogo,
        headshot,
        pitStop
      };
      updateTelemetrySheet(telemetryData);
    }
    else {
      console.log(`Target car number ${targetCarNumber} not found in Telemetry_Leaderboard`);
    }

  } catch (error) {
    console.error('Error processing Telemetry message:', error);
  }
}

/**
 * Function to process a Pit Summary XML message.
 */
function processPitSummaryMessage(xml) {
  try {
    const carNumber = xml.Car;
    const lapNumber = xml.Lap_Number;
    const pitNumber = xml.Pit_Number;

    console.log(`Pit Summary: Car ${carNumber} pitted on lap ${lapNumber}, Pit Number: ${pitNumber}`);

    //  You would update the Google Sheet here with the pit stop information.
    //  For example, you might have a "Pit Stops" sheet where you record this data.
    //  You'll need to determine how you want to structure that data in your sheet.

  } catch (error) {
    console.error('Error processing Pit Summary message:', error);
  }
}

/**
 * Function to process a Cars XML message.
 */
function processCarsMessage(xml) {
  try {
    const cars = xml.Car;
    if (!Array.isArray(cars)) {
      console.error("Cars is not an array", cars);
      return;
    }


    // Clear the car data cache
    carData = {};


    cars.forEach(car => {
      const carNumber = car.Number;
      const driverId = car.Driver_ID;
      const carLogo = 'https://via.placeholder.com/50'; // Placeholder
      const team = 'Unknown Team'; // Placeholder
      const teamLogo = 'https://via.placeholder.com/50'; // Placeholder
      const firstName = 'Unknown';
      const lastName = 'Driver';
      const displayName = 'Unknown Driver';

      carData[carNumber] = { carLogo, team, teamLogo, firstName, lastName, displayName }; // Store car data by car number for quick lookup
    });


    console.log('Cars Message Processed');
  } catch (error) {
    console.error('Error processing Cars message:', error);
  }
}

/**
 * Function to process a Driver XML message.
 */
function processDriverMessage(xml) {
  try {
    const drivers = xml.Driver;
    if (!Array.isArray(drivers)) {
      console.error("Drivers is not an array", drivers);
      return;
    }

    drivers.forEach(driver => {
      const firstName = driver.First_Name;
      const lastName = driver.Last_Name;
      const displayName = `${firstName} ${lastName}`;

      carData[driver.ID] = { firstName, lastName, displayName };
    })


    console.log('Driver Message Processed');
  } catch (error) {
    console.error('Error processing Driver message:', error);
  }
}


/**
 * Function to check the online checkbox and update the heartbeat cell.
 */
async function checkOnlineStatusAndUpdateHeartbeat() {
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CONTROLLER_SHEET_NAME}!${ONLINE_CHECKBOX_CELL}`,
    });

    const values = response.data.values;
    const isOnline = values && values.length > 0 && values[0].length > 0 && values[0][0] === 'TRUE'; // Check if the checkbox is TRUE

    if (isOnline) {
      console.log('Online checkbox is TRUE.  Updating heartbeat.');
      // Update the heartbeat cell (e.g., set it to the current timestamp)
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${CONTROLLER_SHEET_NAME}!A2`, // Example:  Update cell A2 with the heartbeat
        valueInputOption: 'RAW',
        resource: {
          values: [[new Date().toISOString()]],
        },
      });
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
 * Main function to connect to the TCP socket, receive data, and process it.
 */
async function main() {
  await authenticate(); // Authenticate with Google Sheets API
  await readReferenceData(); //read reference data

  const server = net.connect({ host: TCP_HOST, port: TCP_PORT }, () => {
    console.log(`Connected to ${TCP_HOST}:${TCP_PORT}`);
  });

  let buffer = ''; // Buffer to accumulate data

  server.on('data', (data) => {
    buffer += data.toString(); // Append data to the buffer

    // Process the buffer for complete XML messages
    let messageEndIndex;
    while ((messageEndIndex = buffer.indexOf('</')) >= 0) {
      const message = buffer.substring(0, messageEndIndex + 3);
      buffer = buffer.substring(messageEndIndex + 3);

      // Parse the XML message
      xmlParser.parseString(message, (err, result) => {
        if (err) {
          console.error('Error parsing XML:', err, 'Message:', message);
          return; // Skip this message and continue
        }
        if (!result) {
          console.error('Error: result is null', 'Message:', message);
          return;
        }

        // Process the message based on its type.
        try {
          if (result.Telemetry_Leaderboard) {
            processTelemetryMessage(result.Telemetry_Leaderboard);
          } else if (result.Pit_Summary) {
            processPitSummaryMessage(result.Pit_Summary);
          }
          // Ignore other message types
        } catch (error) {
          console.error('Error processing XML message:', error, 'Message:', message);
        }
      });
    }
  });

  server.on('end', () => {
    console.log('Disconnected from server');
  });

  server.on('error', (err) => {
    console.error('Socket error:', err);
    // Consider implementing a reconnection strategy here (e.g., with a delay).
    server.destroy();
    setTimeout(main, 5000); // Reconnect after 5 seconds
  });

  server.on('close', () => {
    console.log('Socket closed');
  });

  // Main loop: Check online status, read target car, and process data
  setInterval(async () => {
    const isOnline = await checkOnlineStatusAndUpdateHeartbeat();
    if (isOnline) {
      targetCarNumber = await readTargetCarNumber(); // Read target car number
      if (targetCarNumber) {
        // Only process if we have a target car number
        //  No need to read reference data every time, read it once at start.
      }
    }
  }, 5000); // Check every 5 seconds
}

// Start the application.
main().catch(error => {
  console.error('Application failed to start:', error);
  //  Handle the error appropriately (e.g., exit, try to reconnect, send an alert).
});

