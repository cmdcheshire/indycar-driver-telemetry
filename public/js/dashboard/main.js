/**
 * Dashboard entry point.
 * Initializes all dashboard modules, connects the dashboard WebSocket,
 * and routes incoming messages to the appropriate module handlers.
 */
import { initAuth, isAuthenticated, getToken, getUser, logout } from '/js/modules/auth.js';
import { showToast } from '/js/modules/ui.js';
import { WebSocketClient } from '/js/modules/websocket-client.js';

import { initRaceStatus, setDriverMap, updateRaceState, updateTelemetry, updateLeaderboard } from '/js/dashboard/race-status.js';
import { initConnectionStatus, updateTcpStatus, updateWsStatus, updateSimulatorStatus } from '/js/dashboard/connection-status.js';
import { initMetrics, updateMetrics } from '/js/dashboard/metrics.js';
import { initControlPanel, updateControlState, loadDriverList, getDriverList } from '/js/dashboard/control-panel.js';
import { initOverlayClients, updateOverlayClients, updateCacheStatus, loadOverlayInstances } from '/js/dashboard/overlay-clients.js';

let wsClient = null;
let overlayClientCache = {};  // instanceId -> client data (including cacheStatus)

/**
 * Build the WebSocket URL for the dashboard channel.
 */
function buildWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getToken();
  return `${protocol}//${window.location.host}/ws/dashboard?token=${encodeURIComponent(token)}`;
}

/**
 * Populate the user badge in the top bar.
 */
function populateUserInfo() {
  const user = getUser();
  if (!user) return;

  const avatarEl = document.getElementById('userAvatar');
  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');

  if (avatarEl && user.username) {
    avatarEl.textContent = user.username.substring(0, 2).toUpperCase();
  }
  if (nameEl) {
    nameEl.textContent = user.username || '---';
  }
  if (roleEl) {
    roleEl.textContent = user.role || '---';
  }
}

/**
 * Connect the dashboard WebSocket and wire up message routing.
 */
function connectWebSocket() {
  const url = buildWsUrl();
  wsClient = new WebSocketClient(url);

  // Connection lifecycle
  wsClient.on('_open', () => {
    console.log('Dashboard WS connected');
    updateWsStatus(true);
    showToast('Dashboard connected', 'success', 2000);

    // Request a full snapshot on reconnection
    wsClient.send('requestSnapshot', {});
  });

  wsClient.on('_close', () => {
    console.log('Dashboard WS disconnected');
    updateWsStatus(false);
  });

  wsClient.on('_error', () => {
    updateWsStatus(false);
  });

  // ── Message Routing ──

  // Initial race state snapshot (sent on connect)
  wsClient.on('raceState', (data) => {
    updateRaceState(data);
    // Also push control-relevant fields
    updateControlState(data);
  });

  // Live telemetry update (all cars)
  wsClient.on('telemetry', (data) => {
    updateTelemetry(data);
  });

  // Leaderboard update
  wsClient.on('leaderboard', (data) => {
    updateLeaderboard(data);
  });

  // Flag / race control change
  wsClient.on('flag', (data) => {
    updateRaceState(data);
  });

  // TCP connection status
  wsClient.on('tcpStatus', (data) => {
    updateTcpStatus(data);
  });

  // Metrics (throughput, counts)
  wsClient.on('metrics', (data) => {
    updateMetrics(data);
  });

  // Control plane update (online toggle, target cars, TCP config, DNF)
  wsClient.on('controlUpdate', (data) => {
    updateControlState(data);
  });

  // Simulator status
  wsClient.on('simulatorStatus', (data) => {
    updateSimulatorStatus(data);
  });

  // Overlay client connect/disconnect events
  wsClient.on('overlayClientChange', (data) => {
    updateOverlayClients(data);

    // Build cache status lookup for chiclets
    overlayClientCache = {};
    for (const client of (data.clients || [])) {
      const existing = overlayClientCache[client.instanceId];
      if (!existing || (client.cacheStatus && (!existing.cacheStatus || client.cacheStatus.loaded < existing.cacheStatus.loaded))) {
        overlayClientCache[client.instanceId] = client;
      }
    }
    updateCacheStatus(overlayClientCache);
  });

  // Lap, pit, carStatus -- forwarded to race status for potential UI use
  wsClient.on('lap', () => {});
  wsClient.on('pit', () => {});
  wsClient.on('carStatus', () => {});

  wsClient.connect();
}

/**
 * Bootstrap the dashboard.
 */
async function init() {
  // Auth gate
  if (!initAuth() || !isAuthenticated()) {
    window.location.href = '/';
    return;
  }

  // Populate user info in top bar
  populateUserInfo();

  // Wire up logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => logout());
  }

  // Initialize all modules
  initRaceStatus();
  initConnectionStatus();
  initMetrics();
  initControlPanel();
  initOverlayClients();

  // Load reference data into control panel dropdowns
  await loadDriverList();

  // Build driver map for leaderboard name lookups
  const drivers = getDriverList();
  const driverMap = new Map();
  for (const d of drivers) {
    driverMap.set(String(d.car_number), d.display_name || d.driver_name || d.name || '');
  }
  setDriverMap(driverMap);

  // Load overlay instances list
  await loadOverlayInstances();

  // Connect WebSocket
  connectWebSocket();
}

// ── Start ──
init().catch((err) => {
  console.error('Dashboard initialization failed:', err);
  showToast('Failed to initialize dashboard', 'error');
});
