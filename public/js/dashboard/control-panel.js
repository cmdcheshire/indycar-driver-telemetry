/**
 * Control Panel module.
 * Wires up the online toggle, TCP configuration, target car selectors,
 * and manual DNF override checkboxes.
 */
import { authenticatedFetch } from '/js/modules/auth.js';
import { showToast } from '/js/modules/ui.js';

// ── DOM References ──
let onlineToggleEl = null;
let onlineStatusTextEl = null;
let tcpHostEl = null;
let tcpPortEl = null;
let saveTcpBtn = null;
let reconnectBtn = null;
let targetCarEls = [null, null, null];
let dnfListEl = null;

// ── State ──
/** @type {{ car_number: string, driver_name?: string, name?: string }[]} */
let driverList = [];         // { car_number, driver_name, ... }[]
let currentDnfOverrides = []; // carNumber[] that are currently DNF
let isUpdating = false;       // Guard against echoing back our own changes

/**
 * Initialize the control panel module and bind event listeners.
 */
export function initControlPanel() {
  onlineToggleEl = document.getElementById('onlineToggle');
  onlineStatusTextEl = document.getElementById('onlineStatusText');
  tcpHostEl = document.getElementById('tcpHost');
  tcpPortEl = document.getElementById('tcpPort');
  saveTcpBtn = document.getElementById('saveTcpBtn');
  reconnectBtn = document.getElementById('reconnectBtn');
  targetCarEls = [
    document.getElementById('targetCar0'),
    document.getElementById('targetCar1'),
    document.getElementById('targetCar2'),
  ];
  dnfListEl = document.getElementById('dnfList');

  // ── Event: Online Toggle ──
  if (onlineToggleEl) {
    onlineToggleEl.addEventListener('change', async () => {
      const isOnline = onlineToggleEl.checked;
      try {
        const res = await authenticatedFetch('/api/control/online', {
          method: 'PUT',
          body: JSON.stringify({ isOnline }),
        });
        if (!res.ok) throw new Error('Failed to update online status');
        showToast(isOnline ? 'System online' : 'System offline', isOnline ? 'success' : 'warning', 2000);
      } catch (err) {
        console.error('Online toggle error:', err);
        showToast('Failed to update online status', 'error');
        // Revert toggle
        onlineToggleEl.checked = !isOnline;
      }
    });
  }

  // ── Event: Save TCP Config ──
  if (saveTcpBtn) {
    saveTcpBtn.addEventListener('click', async () => {
      const host = tcpHostEl?.value.trim();
      const port = tcpPortEl?.value.trim();

      if (!host || !port) {
        showToast('Host and port are required', 'warning');
        return;
      }

      try {
        const res = await authenticatedFetch('/api/control/tcp', {
          method: 'PUT',
          body: JSON.stringify({ host, port: parseInt(port, 10) }),
        });
        if (!res.ok) throw new Error('Failed to update TCP config');
        showToast('TCP config saved', 'success', 2000);
      } catch (err) {
        console.error('Save TCP error:', err);
        showToast('Failed to save TCP config', 'error');
      }
    });
  }

  // ── Event: Reconnect TCP ──
  if (reconnectBtn) {
    reconnectBtn.addEventListener('click', async () => {
      try {
        reconnectBtn.disabled = true;
        reconnectBtn.textContent = 'Reconnecting...';
        const res = await authenticatedFetch('/api/control/reconnect', {
          method: 'POST',
        });
        if (!res.ok) throw new Error('Failed to reconnect');
        showToast('TCP reconnect initiated', 'success', 2000);
      } catch (err) {
        console.error('Reconnect error:', err);
        showToast('Failed to reconnect TCP', 'error');
      } finally {
        reconnectBtn.disabled = false;
        reconnectBtn.textContent = 'Reconnect TCP';
      }
    });
  }

  // ── Event: Target Car Selectors ──
  for (let i = 0; i < 3; i++) {
    const el = targetCarEls[i];
    if (!el) continue;
    el.addEventListener('change', () => {
      saveTargetCars();
    });
  }
}

/**
 * Load the driver list from the reference data API and populate
 * the target car dropdowns and DNF checkbox list.
 */
export async function loadDriverList() {
  try {
    const res = await authenticatedFetch('/api/reference/drivers');
    if (!res.ok) throw new Error('Failed to load drivers');
    const data = await res.json();
    driverList = data.drivers || [];

    populateTargetCarDropdowns();
    populateDnfList();

    // After populating, load current control state
    await loadControlStatus();
  } catch (err) {
    console.error('Load driver list error:', err);
    showToast('Failed to load driver list', 'error');
  }
}

/**
 * Load the current control status from the server and update the UI.
 */
async function loadControlStatus() {
  try {
    const res = await authenticatedFetch('/api/control/status');
    if (!res.ok) return;
    const data = await res.json();
    updateControlState(data);
  } catch (err) {
    console.error('Load control status error:', err);
  }
}

/**
 * Update the control panel UI from a controlUpdate WebSocket message
 * or from the initial status load.
 *
 * @param {Object} data - Control state.
 *   { isOnline, targetCars, tcpHost, tcpPort, manualDNF }
 */
export function updateControlState(data) {
  if (!data) return;

  isUpdating = true;

  // Online toggle
  if (data.isOnline !== undefined) {
    if (onlineToggleEl) {
      onlineToggleEl.checked = data.isOnline;
    }
    if (onlineStatusTextEl) {
      onlineStatusTextEl.textContent = data.isOnline ? 'ONLINE' : 'OFFLINE';
      onlineStatusTextEl.classList.remove('on', 'off');
      onlineStatusTextEl.classList.add(data.isOnline ? 'on' : 'off');
    }
  }

  // TCP config
  if (data.tcpHost !== undefined && tcpHostEl) {
    tcpHostEl.value = data.tcpHost;
  }
  if (data.tcpPort !== undefined && tcpPortEl) {
    tcpPortEl.value = data.tcpPort;
  }

  // Target cars
  if (Array.isArray(data.targetCars)) {
    for (let i = 0; i < 3; i++) {
      const el = targetCarEls[i];
      if (el) {
        el.value = data.targetCars[i] || '';
      }
    }
  }

  // Manual DNF overrides
  if (Array.isArray(data.manualDNF)) {
    currentDnfOverrides = data.manualDNF;
    syncDnfCheckboxes();
  }

  isUpdating = false;
}

/**
 * Populate the three target car dropdown selects with driver options.
 */
function populateTargetCarDropdowns() {
  for (let i = 0; i < 3; i++) {
    const el = targetCarEls[i];
    if (!el) continue;

    // Preserve current value
    const currentValue = el.value;

    el.innerHTML = '<option value="">-- None --</option>';

    for (const driver of driverList) {
      const opt = document.createElement('option');
      opt.value = driver.car_number;
      opt.textContent = `#${driver.car_number} - ${driver.driver_name || driver.name || 'Unknown'}`;
      el.appendChild(opt);
    }

    // Restore value if it still exists
    if (currentValue) {
      el.value = currentValue;
    }
  }
}

/**
 * Populate the DNF override checkbox list.
 */
function populateDnfList() {
  if (!dnfListEl) return;

  if (driverList.length === 0) {
    dnfListEl.innerHTML = '<div class="empty-state">No drivers loaded</div>';
    return;
  }

  dnfListEl.innerHTML = '';

  for (const driver of driverList) {
    const item = document.createElement('label');
    item.className = 'dnf-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.carNumber = driver.car_number;
    checkbox.addEventListener('change', () => {
      handleDnfToggle(driver.car_number, checkbox.checked);
    });

    const carNum = document.createElement('span');
    carNum.className = 'dnf-car-number';
    carNum.textContent = `#${driver.car_number}`;

    const driverName = document.createElement('span');
    driverName.className = 'dnf-driver-name';
    driverName.textContent = driver.driver_name || driver.name || '';

    item.appendChild(checkbox);
    item.appendChild(carNum);
    item.appendChild(driverName);
    dnfListEl.appendChild(item);
  }
}

/**
 * Sync the DNF checkboxes with the current override state.
 */
function syncDnfCheckboxes() {
  if (!dnfListEl) return;

  const checkboxes = dnfListEl.querySelectorAll('input[type="checkbox"]');
  for (const cb of checkboxes) {
    const carNumber = cb.dataset.carNumber;
    cb.checked = currentDnfOverrides.includes(carNumber);
  }
}

/**
 * Handle a DNF checkbox toggle.
 *
 * @param {string} carNumber
 * @param {boolean} isDNF
 */
async function handleDnfToggle(carNumber, isDNF) {
  try {
    const res = await authenticatedFetch('/api/control/dnf', {
      method: 'PUT',
      body: JSON.stringify({ carNumber, isDNF }),
    });
    if (!res.ok) throw new Error('Failed to update DNF');
    showToast(`Car #${carNumber} ${isDNF ? 'marked DNF' : 'DNF cleared'}`, isDNF ? 'warning' : 'success', 2000);
  } catch (err) {
    console.error('DNF toggle error:', err);
    showToast('Failed to update DNF override', 'error');
    // Revert
    const cb = dnfListEl?.querySelector(`input[data-car-number="${carNumber}"]`);
    if (cb) cb.checked = !isDNF;
  }
}

/**
 * Save the current target car selections to the server.
 */
/**
 * Return the loaded driver list for use by other modules.
 * @returns {{ car_number: string, driver_name?: string, name?: string }[]}
 */
export function getDriverList() {
  return driverList;
}

async function saveTargetCars() {
  if (isUpdating) return;

  const cars = targetCarEls.map(el => {
    const val = el?.value?.trim();
    return val || null;
  });

  try {
    const res = await authenticatedFetch('/api/control/target-cars', {
      method: 'PUT',
      body: JSON.stringify({ cars }),
    });
    if (!res.ok) throw new Error('Failed to update target cars');
    showToast('Target cars updated', 'success', 2000);
  } catch (err) {
    console.error('Save target cars error:', err);
    showToast('Failed to update target cars', 'error');
  }
}
