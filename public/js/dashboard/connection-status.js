/**
 * Connection Status module.
 * Displays TCP feed and WebSocket connection states with colored indicator dots.
 */

// ── DOM References ──
let tcpDotEl = null;
let tcpDetailEl = null;
let tcpBadgeEl = null;
let wsDotEl = null;
let wsDetailEl = null;
let wsBadgeEl = null;

/**
 * Initialize the connection status module and cache DOM elements.
 */
export function initConnectionStatus() {
  tcpDotEl = document.getElementById('tcpDot');
  tcpDetailEl = document.getElementById('tcpDetail');
  tcpBadgeEl = document.getElementById('tcpBadge');
  wsDotEl = document.getElementById('wsDot');
  wsDetailEl = document.getElementById('wsDetail');
  wsBadgeEl = document.getElementById('wsBadge');
}

/**
 * Update the TCP connection status display.
 *
 * @param {Object} data - TCP status object from server.
 *   { connected: boolean, host: string|null, port: number|null, connectedAt: string|null }
 */
export function updateTcpStatus(data) {
  if (!data) return;

  const connected = !!data.connected;

  // Dot indicator
  if (tcpDotEl) {
    tcpDotEl.classList.remove('online', 'offline', 'warning');
    tcpDotEl.classList.add(connected ? 'online' : 'offline');
  }

  // Detail text
  if (tcpDetailEl) {
    if (connected && data.host) {
      tcpDetailEl.textContent = `${data.host}:${data.port}`;
    } else {
      tcpDetailEl.textContent = 'Not connected';
    }
  }

  // Badge
  if (tcpBadgeEl) {
    tcpBadgeEl.classList.remove('connected', 'disconnected');
    tcpBadgeEl.classList.add(connected ? 'connected' : 'disconnected');
    tcpBadgeEl.textContent = connected ? 'Connected' : 'Offline';
  }
}

/**
 * Update the WebSocket connection status display.
 *
 * @param {boolean} connected - Whether the dashboard WebSocket is connected.
 */
export function updateWsStatus(connected) {
  // Dot indicator
  if (wsDotEl) {
    wsDotEl.classList.remove('online', 'offline', 'warning');
    wsDotEl.classList.add(connected ? 'online' : 'offline');
  }

  // Detail text
  if (wsDetailEl) {
    wsDetailEl.textContent = connected ? 'Active' : 'Disconnected';
  }

  // Badge
  if (wsBadgeEl) {
    wsBadgeEl.classList.remove('connected', 'disconnected');
    wsBadgeEl.classList.add(connected ? 'connected' : 'disconnected');
    wsBadgeEl.textContent = connected ? 'Connected' : 'Offline';
  }
}
