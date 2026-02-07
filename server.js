const config = require('./src/config');
const state = require('./src/race-state');
const sheets = require('./src/google-sheets');
const TcpClient = require('./src/tcp-client');
const { processMessage } = require('./src/message-processor');

let leaderboardInterval = null;
let driverInfoInterval = null;

async function main() {
  // Authenticate with Google Sheets (two accounts for rate-limit headroom)
  await sheets.authenticateLeaderboardAccount();
  await sheets.authenticateTelemetryAccount();

  // Load configuration and reference data from control sheet
  await sheets.readIpInformation();
  await sheets.readReferenceData();
  await sheets.readAllTargetCars();

  // Connect to IndyCar telemetry TCP stream
  const tcp = new TcpClient();
  tcp.on('message', processMessage);
  tcp.on('error', () => {
    tcp.destroy();
    console.log(`Reconnecting in ${config.RECONNECT_DELAY / 1000}s...`);
    setTimeout(() => tcp.connect(state.tcpHost, state.tcpPort), config.RECONNECT_DELAY);
  });
  tcp.connect(state.tcpHost, state.tcpPort);

  // Periodic control-plane check: online status, target cars, DNF overrides
  setInterval(async () => {
    try {
      const online = await sheets.checkOnlineStatusAndUpdateHeartbeat();

      if (online) {
        await sheets.readAllTargetCars();

        // Start periodic sheet updates if not already running
        if (!leaderboardInterval) {
          leaderboardInterval = setInterval(sheets.periodicUpdateLeaderboard, config.LEADERBOARD_UPDATE_INTERVAL);
          console.log(`Leaderboard updates started (${config.LEADERBOARD_UPDATE_INTERVAL}ms)`);
        }
        if (!driverInfoInterval) {
          driverInfoInterval = setInterval(sheets.periodicUpdateDriverInfo, config.DRIVER_INFO_UPDATE_INTERVAL);
          console.log(`Driver info updates started (${config.DRIVER_INFO_UPDATE_INTERVAL}ms)`);
        }
      } else {
        // Stop updates when offline
        if (leaderboardInterval) {
          clearInterval(leaderboardInterval);
          leaderboardInterval = null;
          console.log('Leaderboard updates stopped.');
        }
        if (driverInfoInterval) {
          clearInterval(driverInfoInterval);
          driverInfoInterval = null;
          console.log('Driver info updates stopped.');
        }
        state.resetLiveData();
      }
    } catch (error) {
      console.error('Error in control loop:', error.message);
    }
  }, config.ONLINE_CHECK_INTERVAL);
}

main().catch(err => {
  console.error('Application failed to start:', err);
  process.exit(1);
});
