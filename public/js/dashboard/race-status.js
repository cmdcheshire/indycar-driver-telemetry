/**
 * Race Status module.
 * Updates the flag color banner, current lap, elapsed time, and leaderboard table.
 */

// ── DOM References ──
let flagBannerEl = null;
let currentLapEl = null;
let elapsedTimeEl = null;
let carCountEl = null;
let leaderboardBodyEl = null;

// ── State ──
let currentFlag = null;
let leaderboardData = [];

/**
 * Map flag color string to display label.
 */
const FLAG_LABELS = {
  green: 'GREEN',
  yellow: 'CAUTION',
  red: 'RED FLAG',
  white: 'WHITE FLAG',
  finish: 'CHECKERED',
};

/**
 * Initialize the race status module and cache DOM elements.
 */
export function initRaceStatus() {
  flagBannerEl = document.getElementById('flagBanner');
  currentLapEl = document.getElementById('currentLap');
  elapsedTimeEl = document.getElementById('elapsedTime');
  carCountEl = document.getElementById('carCount');
  leaderboardBodyEl = document.getElementById('leaderboardBody');
}

/**
 * Update race-level state: flag color, current lap, elapsed time.
 * Called on 'raceState' and 'flag' WebSocket messages.
 *
 * @param {Object} data - { flagColor, currentLap, timeElapsed, lapsCompleted }
 */
export function updateRaceState(data) {
  if (!data) return;

  // Flag banner
  if (data.flagColor !== undefined) {
    setFlagBanner(data.flagColor);
  }

  // Current lap
  if (data.currentLap !== undefined && currentLapEl) {
    currentLapEl.textContent = data.currentLap || '--';
  }

  // Elapsed time
  if (data.timeElapsed !== undefined && elapsedTimeEl) {
    elapsedTimeEl.textContent = formatElapsedTime(data.timeElapsed);
  }
}

/**
 * Update the flag banner element with the given flag color.
 *
 * @param {string|undefined} flagColor - green, yellow, red, white, finish, or undefined
 */
function setFlagBanner(flagColor) {
  if (!flagBannerEl) return;
  if (flagColor === currentFlag) return;

  currentFlag = flagColor;

  // Remove all flag classes
  flagBannerEl.classList.remove('green', 'yellow', 'red', 'white', 'finish');

  if (flagColor && FLAG_LABELS[flagColor]) {
    flagBannerEl.classList.add(flagColor);
    flagBannerEl.textContent = FLAG_LABELS[flagColor];
  } else {
    flagBannerEl.textContent = 'NO SIGNAL';
  }
}

/**
 * Update telemetry data. Currently used to update the car count display.
 * Full telemetry is an array of all car telemetry objects.
 *
 * @param {Array} data - Array of telemetry objects per car
 */
export function updateTelemetry(data) {
  if (!Array.isArray(data)) return;

  if (carCountEl) {
    carCountEl.textContent = data.length;
  }
}

/**
 * Update the leaderboard table with the latest standings data.
 *
 * @param {Array} data - Array of leaderboard entry objects, sorted by position.
 *   Each entry: { rank, carNumber, driverName, speed, timeBehindLeader, interval, ... }
 */
export function updateLeaderboard(data) {
  if (!Array.isArray(data) || !leaderboardBodyEl) return;

  leaderboardData = data;

  if (data.length === 0) {
    leaderboardBodyEl.innerHTML = '<tr><td colspan="6" class="empty-state">Waiting for race data...</td></tr>';
    return;
  }

  // Build rows
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < data.length; i++) {
    const entry = data[i];
    const tr = document.createElement('tr');

    // Position / rank
    const tdRank = document.createElement('td');
    tdRank.className = 'leaderboard-rank';
    tdRank.textContent = entry.rank || entry.position || (i + 1);
    tr.appendChild(tdRank);

    // Car number
    const tdCar = document.createElement('td');
    tdCar.className = 'leaderboard-car';
    tdCar.textContent = entry.carNumber || '--';
    tr.appendChild(tdCar);

    // Driver name
    const tdDriver = document.createElement('td');
    tdDriver.className = 'leaderboard-driver';
    tdDriver.textContent = entry.driverName || entry.driver || '--';
    tr.appendChild(tdDriver);

    // Speed
    const tdSpeed = document.createElement('td');
    tdSpeed.className = 'leaderboard-speed';
    tdSpeed.textContent = formatSpeed(entry.speed || entry.lastSpeed);
    tr.appendChild(tdSpeed);

    // Time behind leader (gap)
    const tdGap = document.createElement('td');
    tdGap.className = 'leaderboard-gap';
    tdGap.textContent = formatGap(entry.timeBehindLeader || entry.gap);
    tr.appendChild(tdGap);

    // Interval to car ahead
    const tdInterval = document.createElement('td');
    tdInterval.className = 'leaderboard-interval';
    tdInterval.textContent = formatGap(entry.interval);
    tr.appendChild(tdInterval);

    fragment.appendChild(tr);
  }

  leaderboardBodyEl.innerHTML = '';
  leaderboardBodyEl.appendChild(fragment);
}

// ── Formatting Helpers ──

/**
 * Format elapsed time for display.
 * Handles both raw seconds and pre-formatted strings.
 *
 * @param {string|number|undefined} value
 * @returns {string}
 */
function formatElapsedTime(value) {
  if (value === undefined || value === null) return '--:--:--';

  // If already formatted as string with colons, return as-is
  if (typeof value === 'string' && value.includes(':')) return value;

  // Convert seconds to hh:mm:ss
  if (typeof value === 'number' || !isNaN(Number(value))) {
    const totalSec = Math.floor(Number(value));
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return String(value);
}

/**
 * Format speed value for display.
 *
 * @param {string|number|undefined} value
 * @returns {string}
 */
function formatSpeed(value) {
  if (value === undefined || value === null || value === '-') return '--';
  const num = Number(value);
  if (isNaN(num)) return String(value);
  return num.toFixed(1);
}

/**
 * Format gap/interval value for display.
 *
 * @param {string|number|undefined} value
 * @returns {string}
 */
function formatGap(value) {
  if (value === undefined || value === null || value === '-' || value === '') return '--';

  // If it is a number of laps (e.g., "2 laps")
  if (typeof value === 'string' && value.toLowerCase().includes('lap')) return value;

  // Leader position
  const num = Number(value);
  if (isNaN(num)) return String(value);
  if (num === 0) return 'Leader';

  // Format as seconds with sign
  return num > 0 ? `+${num.toFixed(3)}` : num.toFixed(3);
}
