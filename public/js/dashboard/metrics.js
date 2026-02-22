/**
 * Metrics module.
 * Displays per-message-type throughput rates and total message count.
 */

// ── DOM References ──
let rateTelemetryEl = null;
let rateLeaderboardEl = null;
let ratePitEl = null;
let rateCompletedLapEl = null;
let rateCarStatusEl = null;
let rateFlagEl = null;
let totalMessagesEl = null;

/**
 * Initialize the metrics module and cache DOM elements.
 */
export function initMetrics() {
  rateTelemetryEl = document.getElementById('rateTelemetry');
  rateLeaderboardEl = document.getElementById('rateLeaderboard');
  ratePitEl = document.getElementById('ratePit');
  rateCompletedLapEl = document.getElementById('rateCompletedLap');
  rateCarStatusEl = document.getElementById('rateCarStatus');
  rateFlagEl = document.getElementById('rateFlag');
  totalMessagesEl = document.getElementById('totalMessages');
}

/**
 * Update the throughput display with the latest metrics data from the server.
 *
 * @param {Object} data - Metrics payload from the server.
 *   {
 *     messagesPerSecond: { telemetry, leaderboard, pit, completedLap, carStatus, flag },
 *     totalMessages: number,
 *     uptime: number,
 *     connectedOverlayClients: number,
 *     connectedDashboardClients: number
 *   }
 */
export function updateMetrics(data) {
  if (!data) return;

  const rates = data.messagesPerSecond || {};

  if (rateTelemetryEl) {
    rateTelemetryEl.textContent = formatRate(rates.telemetry);
  }
  if (rateLeaderboardEl) {
    rateLeaderboardEl.textContent = formatRate(rates.leaderboard);
  }
  if (ratePitEl) {
    ratePitEl.textContent = formatRate(rates.pit);
  }
  if (rateCompletedLapEl) {
    rateCompletedLapEl.textContent = formatRate(rates.completedLap);
  }
  if (rateCarStatusEl) {
    rateCarStatusEl.textContent = formatRate(rates.carStatus);
  }
  if (rateFlagEl) {
    rateFlagEl.textContent = formatRate(rates.flag);
  }

  if (totalMessagesEl && data.totalMessages !== undefined) {
    totalMessagesEl.textContent = Number(data.totalMessages).toLocaleString();
  }
}

/**
 * Format a rate value for display.
 *
 * @param {number|undefined} value
 * @returns {string}
 */
function formatRate(value) {
  if (value === undefined || value === null) return '0/s';
  return `${value}/s`;
}
