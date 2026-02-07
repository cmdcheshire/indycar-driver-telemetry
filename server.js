require('dotenv').config();

const http = require('http');
const express = require('express');
const path = require('path');

const constants = require('./src/config/constants');
const { initializeDatabase, getSetting } = require('./src/config/database');
const { registerRoutes } = require('./src/routes/index');
const { httpLogger } = require('./src/middleware/logging.middleware');
const wsService = require('./src/services/websocket.service');
const metricsService = require('./src/services/metrics.service');
const referenceService = require('./src/services/reference-data.service');
const overlayService = require('./src/services/overlay.service');
const { initializeFirstRun } = require('./src/utils/init.util');
const authService = require('./src/services/auth.service');

const state = require('./src/telemetry/race-state');
const TcpClient = require('./src/telemetry/tcp-client');
const { processMessage } = require('./src/telemetry/message-processor');
const simulatorService = require('./src/services/simulator.service');

let tcp = null;

async function main() {
  console.log(`\n${constants.APP_NAME} v${constants.APP_VERSION}`);
  console.log('─'.repeat(50));

  // Initialize database
  initializeDatabase();
  await initializeFirstRun();

  // Load settings into state
  state.tcpHost = getSetting('tcp_host') || constants.DEFAULT_TCP_HOST;
  state.tcpPort = parseInt(getSetting('tcp_port'), 10) || constants.DEFAULT_TCP_PORT;
  state.isOnline = getSetting('is_online') === 'true';
  state.targetCarNumbers = JSON.parse(getSetting('target_cars') || '[null,null,null]');

  // Load manual DNF from settings
  const dnfList = JSON.parse(getSetting('manual_dnf') || '[]');

  // Load reference data from database
  referenceService.loadReferenceData();

  // Apply stored DNF overrides after driver data is initialized
  for (const carNumber of dnfList) {
    const entry = state.manualDNFOverride.find(d => d.carNumber === carNumber);
    if (entry) entry.DNF = true;
  }

  // Create Express app
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(httpLogger);
  app.use(express.static(path.join(__dirname, 'public')));

  // Register API routes
  registerRoutes(app);

  // Overlay renderer route (public, token-based auth)
  app.get('/overlay/:accessToken', (req, res) => {
    const instance = overlayService.getInstanceByToken(req.params.accessToken);
    if (!instance) return res.status(404).send('Overlay not found');
    res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
  });

  // SPA fallback
  app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
  app.get('/builder', (req, res) => res.sendFile(path.join(__dirname, 'public', 'builder.html')));
  app.get('/builder/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'builder.html')));
  app.get('/drivers', (req, res) => res.sendFile(path.join(__dirname, 'public', 'drivers.html')));
  app.get('/simulator', (req, res) => res.sendFile(path.join(__dirname, 'public', 'simulator.html')));

  // Create HTTP server
  const server = http.createServer(app);

  // Initialize WebSocket on the HTTP server
  wsService.initialize(server);
  metricsService.start();

  // TCP connection management
  function connectTcp() {
    if (tcp) tcp.destroy();

    tcp = new TcpClient();

    tcp.on('message', ({ type, raw }) => {
      metricsService.recordMessage(type);
      processMessage({ type, raw });
    });

    tcp.on('connected', () => {
      wsService.setTcpStatus({
        connected: true,
        host: state.tcpHost,
        port: state.tcpPort,
        connectedAt: new Date().toISOString(),
      });
    });

    tcp.on('disconnected', () => {
      wsService.setTcpStatus({ connected: false, host: state.tcpHost, port: state.tcpPort, connectedAt: null });
    });

    tcp.on('error', () => {
      wsService.setTcpStatus({ connected: false, host: state.tcpHost, port: state.tcpPort, connectedAt: null });
      tcp.destroy();
      console.log(`TCP reconnecting in ${constants.RECONNECT_DELAY / 1000}s...`);
      setTimeout(() => connectTcp(), constants.RECONNECT_DELAY);
    });

    tcp.connect(state.tcpHost, state.tcpPort);
  }

  app.set('tcpReconnect', connectTcp);

  // Give simulator service TCP control so it can disconnect during playback
  simulatorService.setTcpControl({
    disconnect: () => { if (tcp) { tcp.destroy(); tcp = null; } },
    reconnect: connectTcp,
  });

  connectTcp();

  // Periodic session cleanup
  setInterval(() => authService.cleanExpiredSessions(), 3600000);

  // Start HTTP server
  server.listen(constants.PORT, () => {
    console.log(`\nServer running at http://localhost:${constants.PORT}`);
    console.log(`Dashboard:  http://localhost:${constants.PORT}/dashboard`);
    console.log(`Builder:    http://localhost:${constants.PORT}/builder`);
    console.log(`Simulator:  http://localhost:${constants.PORT}/simulator`);
    console.log(`TCP target: ${state.tcpHost}:${state.tcpPort}`);
    console.log(`Online:     ${state.isOnline}`);
    console.log('─'.repeat(50));
  });

  // Graceful shutdown
  process.on('SIGTERM', () => shutdown(server));
  process.on('SIGINT', () => shutdown(server));
}

function shutdown(server) {
  console.log('\nShutting down...');
  metricsService.stop();
  wsService.shutdown();
  if (tcp) tcp.destroy();
  const { closeDatabase } = require('./src/config/database');
  closeDatabase();
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
  // Force exit if graceful shutdown stalls (e.g. open WebSocket connections)
  setTimeout(() => {
    console.log('Forcing exit.');
    process.exit(0);
  }, 3000).unref();
}

main().catch(err => {
  console.error('Application failed to start:', err);
  process.exit(1);
});
