const { Router } = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth.middleware');
const { getSetting, setSetting } = require('../config/database');
const state = require('../telemetry/race-state');

const router = Router();
router.use(authenticateToken);

// Get full control plane state
router.get('/status', (req, res) => {
  res.json({
    isOnline: state.isOnline,
    tcpHost: state.tcpHost,
    tcpPort: state.tcpPort,
    targetCars: state.targetCarNumbers,
    manualDNF: state.manualDNFOverride.filter(d => d.DNF).map(d => d.carNumber),
    flagColor: state.flagColor,
    currentLap: state.currentLap,
    timeElapsed: state.timeElapsed,
  });
});

// Toggle online/offline
router.put('/online', requireRole('operator', 'admin'), (req, res) => {
  const { isOnline } = req.body;
  if (typeof isOnline !== 'boolean') {
    return res.status(400).json({ error: 'isOnline must be boolean' });
  }

  state.isOnline = isOnline;
  setSetting('is_online', String(isOnline));

  if (!isOnline) {
    state.resetLiveData();
  }

  console.log(`Online status set to: ${isOnline}`);
  // Notify dashboard WS clients
  const wsService = require('../services/websocket.service');
  wsService.broadcastControlUpdate();

  res.json({ isOnline: state.isOnline });
});

// Update TCP config
router.put('/tcp', requireRole('operator', 'admin'), (req, res) => {
  const { host, port } = req.body;
  if (!host || !port) {
    return res.status(400).json({ error: 'host and port required' });
  }

  state.tcpHost = host;
  state.tcpPort = parseInt(port, 10);
  setSetting('tcp_host', host);
  setSetting('tcp_port', String(port));

  console.log(`TCP config updated: ${host}:${port}`);
  const wsService = require('../services/websocket.service');
  wsService.broadcastControlUpdate();

  res.json({ tcpHost: state.tcpHost, tcpPort: state.tcpPort });
});

// Update target cars
router.put('/target-cars', requireRole('operator', 'admin'), (req, res) => {
  const { cars } = req.body;
  if (!Array.isArray(cars) || cars.length !== 3) {
    return res.status(400).json({ error: 'cars must be array of 3 (string|null)' });
  }

  state.targetCarNumbers = cars.map(c => c || null);
  setSetting('target_cars', JSON.stringify(state.targetCarNumbers));

  console.log(`Target cars updated: ${state.targetCarNumbers.join(', ')}`);
  const wsService = require('../services/websocket.service');
  wsService.broadcastControlUpdate();

  res.json({ targetCars: state.targetCarNumbers });
});

// Set manual DNF
router.put('/dnf', requireRole('operator', 'admin'), (req, res) => {
  const { carNumber, isDNF } = req.body;
  if (!carNumber || typeof isDNF !== 'boolean') {
    return res.status(400).json({ error: 'carNumber and isDNF (boolean) required' });
  }

  const entry = state.manualDNFOverride.find(d => d.carNumber === carNumber);
  if (entry) {
    entry.DNF = isDNF;
  }

  // Persist
  const dnfList = state.manualDNFOverride.filter(d => d.DNF).map(d => d.carNumber);
  setSetting('manual_dnf', JSON.stringify(dnfList));

  console.log(`Manual DNF: Car ${carNumber} = ${isDNF}`);
  const wsService = require('../services/websocket.service');
  wsService.broadcastControlUpdate();

  res.json({ carNumber, isDNF });
});

// Get all manual DNF overrides
router.get('/dnf', (req, res) => {
  const dnfList = state.manualDNFOverride.filter(d => d.DNF).map(d => d.carNumber);
  res.json({ dnfOverrides: dnfList });
});

// Force TCP reconnect
router.post('/reconnect', requireRole('operator', 'admin'), (req, res) => {
  // This will be wired up in server.js
  const app = req.app;
  const reconnectFn = app.get('tcpReconnect');
  if (reconnectFn) {
    reconnectFn();
    res.json({ message: 'TCP reconnect initiated' });
  } else {
    res.status(500).json({ error: 'TCP reconnect function not available' });
  }
});

module.exports = router;
