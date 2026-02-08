/**
 * Data Presets - Preset data element configurations organized by category.
 * Provides a UI picker overlay for choosing data bindings when the Data tool is used.
 */

/* ================================================================ *
 *  Preset Definitions
 * ================================================================ */

const PRESET_CATEGORIES = [
  {
    name: 'Speed & Performance',
    presets: [
      { label: 'Speed', desc: 'Current speed in mph', source: 'telemetry', field: 'speed', format: 'speed', fallback: '---', defaultFontSize: 48, defaultWidth: 12 },
      { label: 'RPM', desc: 'Engine RPM', source: 'telemetry', field: 'rpm', format: 'raw', fallback: '---', defaultFontSize: 36, defaultWidth: 10 },
      { label: 'Throttle', desc: 'Throttle percentage', source: 'telemetry', field: 'throttle', format: 'percentage', fallback: '---', defaultFontSize: 36, defaultWidth: 8 },
      { label: 'Brake', desc: 'Brake percentage', source: 'telemetry', field: 'brake', format: 'percentage', fallback: '---', defaultFontSize: 36, defaultWidth: 8 },
      { label: 'Battery', desc: 'Battery level', source: 'telemetry', field: 'battery', format: 'percentage', fallback: '---', defaultFontSize: 36, defaultWidth: 8 },
    ],
  },
  {
    name: 'Race Position',
    presets: [
      { label: 'Position', desc: 'Current race position', source: 'telemetry', field: 'rank', format: 'ordinal', fallback: '---', defaultFontSize: 64, defaultWidth: 8 },
      { label: 'Car Number', desc: 'Car number', source: 'telemetry', field: 'carNumber', format: 'raw', fallback: '---', defaultFontSize: 48, defaultWidth: 6 },
      { label: 'Gap to Leader', desc: 'Time behind leader', source: 'leaderboard', field: 'Time_Behind', format: 'delta', fallback: '---', defaultFontSize: 36, defaultWidth: 12 },
      { label: 'Laps Behind', desc: 'Laps behind leader', source: 'leaderboard', field: 'Laps_Behind', format: 'raw', fallback: '0', defaultFontSize: 36, defaultWidth: 6 },
    ],
  },
  {
    name: 'Timing',
    presets: [
      { label: 'Last Lap Time', desc: 'Most recent lap time', source: 'lapData', field: 'lastLapTime', format: 'lapTime', fallback: '---', defaultFontSize: 36, defaultWidth: 14 },
      { label: 'Fastest Lap', desc: 'Fastest lap number', source: 'lapData', field: 'fastestLap', format: 'raw', fallback: '---', defaultFontSize: 36, defaultWidth: 8 },
      { label: 'Lap Delta', desc: 'Last lap time delta', source: 'lapData', field: 'lastLapDelta', format: 'delta', fallback: '---', defaultFontSize: 36, defaultWidth: 12 },
      { label: 'Total Time', desc: 'Total elapsed time', source: 'lapData', field: 'totalTime', format: 'raw', fallback: '---', defaultFontSize: 32, defaultWidth: 14 },
      { label: 'Avg Speed', desc: 'Average speed', source: 'lapData', field: 'averageSpeed', format: 'speed', fallback: '---', defaultFontSize: 36, defaultWidth: 12 },
    ],
  },
  {
    name: 'Race Info',
    presets: [
      { label: 'Flag Status', desc: 'Current flag color', source: 'raceState', field: 'flagColor', format: 'raw', fallback: 'Green', defaultFontSize: 36, defaultWidth: 10 },
      { label: 'Current Lap', desc: 'Current lap number', source: 'raceState', field: 'currentLap', format: 'raw', fallback: '0', defaultFontSize: 48, defaultWidth: 6 },
      { label: 'Laps Done', desc: 'Laps completed', source: 'raceState', field: 'lapsCompleted', format: 'raw', fallback: '0', defaultFontSize: 36, defaultWidth: 6 },
      { label: 'Time Elapsed', desc: 'Race elapsed time', source: 'raceState', field: 'timeElapsed', format: 'raw', fallback: '0:00:00', defaultFontSize: 32, defaultWidth: 14 },
    ],
  },
  {
    name: 'Pit & Status',
    presets: [
      { label: 'Pit Status', desc: 'In/out of pit lane', source: 'pitStatus', field: 'pitStatus', format: 'raw', fallback: 'Out', defaultFontSize: 36, defaultWidth: 8 },
      { label: 'Pit Stops', desc: 'Number of pit stops', source: 'pitStatus', field: 'pitStops', format: 'raw', fallback: '0', defaultFontSize: 48, defaultWidth: 6 },
      { label: 'Car Status', desc: 'Running/DNF status', source: 'carStatus', field: 'carStatus', format: 'raw', fallback: 'Running', defaultFontSize: 36, defaultWidth: 10 },
    ],
  },
];

/* ================================================================ *
 *  Picker UI
 * ================================================================ */

/** @type {HTMLElement|null} Currently shown overlay element */
let _overlayEl = null;

/**
 * Show the preset picker overlay inside the given container element.
 * @param {HTMLElement} canvasArea - The container to append the overlay to.
 * @param {function} onSelect - Called with the preset object when a preset card is clicked.
 * @param {function} onCustom - Called when "Custom Data Binding" is clicked.
 */
function showPresetPicker(canvasArea, onSelect, onCustom) {
  // Remove any existing picker first
  hidePresetPicker();

  // Create overlay
  const overlay = document.createElement('div');
  overlay.className = 'preset-picker-overlay';

  // Close when clicking overlay background
  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) {
      hidePresetPicker();
    }
  });

  // Create picker container
  const picker = document.createElement('div');
  picker.className = 'preset-picker';

  // Header
  const header = document.createElement('div');
  header.className = 'preset-picker-header';

  const title = document.createElement('div');
  title.className = 'preset-picker-title';
  title.textContent = 'Choose Data Element';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'preset-picker-close';
  closeBtn.textContent = '\u00D7';
  closeBtn.addEventListener('click', () => hidePresetPicker());

  header.appendChild(title);
  header.appendChild(closeBtn);
  picker.appendChild(header);

  // Categories and preset cards
  for (const category of PRESET_CATEGORIES) {
    const categoryTitle = document.createElement('div');
    categoryTitle.className = 'preset-category-title';
    categoryTitle.textContent = category.name;
    picker.appendChild(categoryTitle);

    const grid = document.createElement('div');
    grid.className = 'preset-grid';

    for (const preset of category.presets) {
      const card = document.createElement('div');
      card.className = 'preset-card';

      const nameEl = document.createElement('div');
      nameEl.className = 'preset-card-name';
      nameEl.textContent = preset.label;

      const descEl = document.createElement('div');
      descEl.className = 'preset-card-desc';
      descEl.textContent = preset.desc;

      card.appendChild(nameEl);
      card.appendChild(descEl);

      card.addEventListener('click', () => {
        onSelect(preset);
        hidePresetPicker();
      });

      grid.appendChild(card);
    }

    picker.appendChild(grid);
  }

  // Custom data binding link at bottom
  const customLink = document.createElement('div');
  customLink.className = 'preset-custom-link';
  customLink.textContent = 'Custom Data Binding...';
  customLink.addEventListener('click', () => {
    onCustom();
    hidePresetPicker();
  });
  picker.appendChild(customLink);

  overlay.appendChild(picker);
  canvasArea.appendChild(overlay);
  _overlayEl = overlay;
}

/**
 * Remove the preset picker overlay if it is currently showing.
 */
function hidePresetPicker() {
  if (_overlayEl) {
    _overlayEl.remove();
    _overlayEl = null;
  }
}

/* ================================================================ *
 *  Exports
 * ================================================================ */

export { PRESET_CATEGORIES, showPresetPicker, hidePresetPicker };
