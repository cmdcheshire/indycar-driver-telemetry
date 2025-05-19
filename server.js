const net = require('net');
const xml2js = require('xml2js');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');

// Constants - REPLACE THESE WITH YOUR ACTUAL VALUES
const TCP_HOST = 'localhost';
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
let sheets;  // Store the sheets object
let targetCarNumber;
let referenceData = {}; // Store reference data from the sheet
const MAX_RPM = 12000;
const MAX_THROTTLE = 100;
const MAX_BRAKE = 100;
let onlineCheckInterval; // To store the interval ID
let isOnline = false;
let latestTelemetryData = {};
let carData = {};

/**
 * Function to authenticate with the Google Sheets API using a service account.
 */
async function authenticate() {
  try {
    console.log('Authenticating with Google Sheets API...');
    googleAuthClient = new JWT({
      keyFile: GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    await googleAuthClient.authorize();
    sheets = google.sheets({ version: 'v4', auth: googleAuthClient }); // Store the sheets object here!!!
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
    console.log('Reading target car number from Google Sheet...');
    const response = await sheets.spreadsheets.values.get({ // Use the 'sheets' object
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
    console.log('Updating telemetry data in Google Sheet...');

    // Check if the sheet exists (optional, but good for avoiding errors if the name is wrong)
    let spreadsheetInfo;
    try {
      spreadsheetInfo = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
      });
      const sheetExists = spreadsheetInfo.data.sheets.some(sheet => sheet.properties.title === TELEMETRY_SHEET_NAME);

      if (!sheetExists) {
        console.log(`Sheet "${TELEMETRY_SHEET_NAME}" does not exist. Creating it...`);
        await sheets.spreadsheets.batchUpdate({
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
    const headshotUrl = referenceData.drivers[telemetryData.carNumber]?.headshot || '';
    const rpmImgUrls = [
      rpmPctBools[0] ? referenceData.indicatorImages['RPM 10%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K2
      rpmPctBools[1] ? referenceData.indicatorImages['RPM 20%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K3
      rpmPctBools[2] ? referenceData.indicatorImages['RPM 30%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K4
      rpmPctBools[3] ? referenceData.indicatorImages['RPM 40%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K5
      rpmPctBools[4] ? referenceData.indicatorImages['RPM 50%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K6
      rpmPctBools[5] ? referenceData.indicatorImages['RPM 60%'] || '' : referenceData.indicatorImages['RPM 0%'] || '', // K7
    ];
    const throttleImgUrls = [
      throttlePctBools[0] ? referenceData.indicatorImages['Throttle 20%'] || '' : referenceData.indicatorImages['Throttle 0%'] || '', // R2
      throttlePctBools[1] ? referenceData.indicatorImages['Throttle 40%'] || '' : referenceData.indicatorImages['Throttle 0%'] || '', // S2
      throttlePctBools[2] ? referenceData.indicatorImages['Throttle 60%'] || '' : referenceData.indicatorImages['Throttle 0%'] || '', // T2
      throttlePctBools[3] ? referenceData.indicatorImages['Throttle 80%'] || '' : referenceData.indicatorImages['Throttle 0%'] || '', // U2
      throttlePctBools[4] ? referenceData.indicatorImages['Throttle 100%'] || '' : referenceData.indicatorImages['Throttle 0%'] || '', // V2
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
    console.log(positions);
    if (!Array.isArray(positions)) {
      console.error("Positions is not an array", positions);
      return;
    }
    // Find the position for the target car.
    const targetCarPosition = positions.find(pos => pos.Car === targetCarNumber);
    console.log("targetCarPosition is...");
    console.log(targetCarPosition);

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
      latestTelemetryData = telemetryData;
      console.log("Telemetry data for target car:", telemetryData); // Log the data being processed
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
    console.log('Checking online status and updating heartbeat...');
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${CONTROLLER_SHEET_NAME}!${ONLINE_CHECKBOX_CELL}`,
    });

    const values = response.data.values;
    isOnline = values && values.length > 0 && values[0].length > 0 && values[0][0] === 'TRUE'; // Check if the checkbox is TRUE
    console.log(`Online status from sheet: ${isOnline}`);

    if (isOnline) {
      console.log('Online checkbox is TRUE.  Updating heartbeat.');
      // Update the heartbeat cell (e.g., set it to the current timestamp)
      try {
        await sheets.spreadsheets.values.update({
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
 * Function to periodically update the Google Sheet with telemetry data.
 */
async function periodicUpdateTelemetrySheet() {
  console.log("periodicUpdateTelemetrySheet called"); //add
  if (isOnline && Object.keys(latestTelemetryData).length > 0) {
    try {
      console.log("periodicUpdateTelemetrySheet - Updating sheet"); //add
      await updateTelemetrySheet(latestTelemetryData); //send the  data.
    }
    catch (e) {
      console.error("Error in sending data to sheet", e);
    }
  }
  else {
    console.log("Not updating sheet. isOnline: ", isOnline, " data available: ", Object.keys(latestTelemetryData).length > 0);
  }
}


/**
 * Main function to connect to the TCP socket, receive data, and process it.
 */
async function main() {
  try {
    
    await authenticate(); // Authenticate with Google Sheets API
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
        console.log("telemetry data start index... " + telemetryStartIndex);
        let pitStartIndex = buffer.indexOf(pitStart);
        console.log("pit data start index... " + pitStartIndex);
        let unofficialLeaderboardStartIndex = buffer.indexOf(unofficialLeaderboardStart);
        console.log("leaderboard data start index... " + unofficialLeaderboardStartIndex);

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
          console.log("unofficial leaderboard end index... " + unofficialLeaderboardEndIndex);
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
              console.log("XML parsed successfully.")
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

                  console.log('Telemetry data for target car found:', telemetryForUpdate);
                  latestTelemetryData = telemetryForUpdate;
                } else {
                  console.log(`Telemetry data not found for target car number: ${targetCarNumber}`);
                }
              } else if (pitStartIndex !== -1) {
                //processPitSummaryMessage(result.Pit_Summary);
              } else if (unofficialLeaderboardStartIndex !== -1) {
                //process Unofficial Leaderboard message
                const allCarData = Array.isArray(result.Position)
                for (i = 0; i < result.length; i++) {
                  console.log("Car: " + result[i].Position.$.Car);
                  console.log("Time Behind: " + result[i].$.Time_Behind);
                }
                console.log("allCarData found.. printing processed array.")
                console.log(allCarData);
                for (let i = 0; i < allCarData.length; i++) { // Start at 0, use < instead of <=
                  console.log("All Car data is allCarData");
                  console.log("Car:" + allCarData[i].$.Car + " Time Behind: " + allCarData[i].Time_Behind );
                };
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

    // Main loop: Check online status, read target car, and process data
    setInterval(async () => { // Changed to setInterval without assigning to onlineCheckInterval
      try {
        const onlineStatus = await checkOnlineStatusAndUpdateHeartbeat(); // Await the result
        if (onlineStatus) {
          targetCarNumber = await readTargetCarNumber(); // Read target car number
          console.log(`Target car number: ${targetCarNumber}`);
          if (!telemetryUpdateInterval) { // Check the telemetry update interval variable
            telemetryUpdateInterval = setInterval(periodicUpdateTelemetrySheet, 2000); // Update sheet every 250ms if online
            console.log('Telemetry update interval started.');
          }
        } else {
          // Clear the interval if offline
          if (telemetryUpdateInterval) {
            clearInterval(telemetryUpdateInterval);
            telemetryUpdateInterval = null;
            latestTelemetryData = {};
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
