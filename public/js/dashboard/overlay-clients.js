/**
 * Overlay Clients module.
 * Displays connected overlay instances with show/hide and delay controls
 * in the center column, and a summary of connected overlay clients
 * in the right column system status panel.
 */
import { authenticatedFetch } from '/js/modules/auth.js';
import { showToast } from '/js/modules/ui.js';

// ── DOM References ──
let overlayInstancesListEl = null;  // Center column: overlay instances with controls
let overlayClientListEl = null;     // Right column: connected overlay client summary

// ── State ──
let instances = [];          // All overlay instances from the API
let connectedClients = [];   // Currently connected overlay WS clients (from WS messages)
let visibilityState = {};    // instanceId -> boolean (local tracking)
let createFormVisible = false;

/**
 * Initialize the overlay clients module and cache DOM elements.
 */
export function initOverlayClients() {
  overlayInstancesListEl = document.getElementById('overlayInstancesList');
  overlayClientListEl = document.getElementById('overlayClientList');
}

/**
 * Load all overlay instances from the API and render them.
 */
export async function loadOverlayInstances() {
  try {
    const res = await authenticatedFetch('/api/overlays/instances');
    if (!res.ok) throw new Error('Failed to load overlay instances');
    const data = await res.json();
    instances = data.instances || [];

    // Initialize visibility state (default: visible)
    for (const inst of instances) {
      if (visibilityState[inst.id] === undefined) {
        visibilityState[inst.id] = true;
      }
    }

    renderOverlayInstances();
  } catch (err) {
    console.error('Load overlay instances error:', err);
  }
}

/**
 * Update the connected overlay clients display.
 * Called on 'overlayClientChange' WebSocket messages.
 *
 * @param {Object} data - { clients: Array }
 *   Each client: { instanceId, name, connectedAt, delay, bufferStats }
 */
export function updateOverlayClients(data) {
  if (!data) return;

  connectedClients = data.clients || [];

  renderOverlayInstances();
  renderConnectedClients();
}

/**
 * Render the overlay instances list in the center column.
 * Each instance shows name, connected status, show/hide button, and delay slider.
 */
function renderOverlayInstances() {
  if (!overlayInstancesListEl) return;

  if (instances.length === 0) {
    overlayInstancesListEl.innerHTML = '<div class="empty-state">No overlay instances</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  // "New Instance" button
  const headerRow = document.createElement('div');
  headerRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:8px;';
  const newBtn = document.createElement('button');
  newBtn.className = 'btn btn-sm btn-primary';
  newBtn.textContent = '+ New Instance';
  newBtn.addEventListener('click', () => showCreateForm());
  headerRow.appendChild(newBtn);
  fragment.appendChild(headerRow);

  // Create form (if visible)
  if (createFormVisible) {
    const form = _buildCreateForm();
    fragment.appendChild(form);
  }

  for (const inst of instances) {
    const isConnected = connectedClients.some(c => c.instanceId === inst.id);
    const isVisible = visibilityState[inst.id] !== false;
    const currentDelay = inst.delay_seconds || 0;

    const card = document.createElement('div');
    card.className = 'overlay-instance-card';

    // Info section
    const info = document.createElement('div');
    info.className = 'overlay-instance-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'overlay-instance-name';
    nameEl.textContent = inst.name || `Instance #${inst.id}`;
    info.appendChild(nameEl);

    const meta = document.createElement('div');
    meta.className = 'overlay-instance-meta';
    const statusLabel = isConnected ? 'Connected' : 'Offline';
    const statusColor = isConnected ? 'var(--success)' : 'var(--text-muted)';
    meta.innerHTML = `<span class="status-dot ${isConnected ? 'online' : 'offline'}" style="width:6px;height:6px;margin-right:4px;vertical-align:middle;"></span><span style="color:${statusColor}">${statusLabel}</span><span class="cache-dot" data-cache-instance="${inst.id}"></span>`;
    info.appendChild(meta);

    // URL row
    const urlRow = document.createElement('div');
    urlRow.className = 'overlay-instance-url';
    const overlayUrl = inst.access_token
      ? `${window.location.origin}/overlay/${inst.access_token}`
      : '';
    urlRow.innerHTML = `<span class="overlay-url-text" title="${overlayUrl}">${overlayUrl}</span>`;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-sm';
    copyBtn.textContent = 'Copy URL';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(overlayUrl);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 2000);
      } catch {
        // Fallback for non-HTTPS
        const input = document.createElement('input');
        input.value = overlayUrl;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy URL'; }, 2000);
      }
    });
    urlRow.appendChild(copyBtn);
    info.appendChild(urlRow);

    card.appendChild(info);

    // Controls section
    const controls = document.createElement('div');
    controls.className = 'overlay-instance-controls';

    // Delay slider
    const delayControl = document.createElement('div');
    delayControl.className = 'delay-control';

    const delayLabel = document.createElement('label');
    delayLabel.textContent = 'Delay';
    delayControl.appendChild(delayLabel);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'delay-slider';
    slider.min = '0';
    slider.max = '60';
    slider.step = '1';
    slider.value = currentDelay;
    delayControl.appendChild(slider);

    const delayValue = document.createElement('span');
    delayValue.className = 'delay-value';
    delayValue.textContent = `${currentDelay}s`;
    delayControl.appendChild(delayValue);

    // Slider live update
    slider.addEventListener('input', () => {
      delayValue.textContent = `${slider.value}s`;
    });

    // Slider commit on release
    slider.addEventListener('change', () => {
      updateInstanceDelay(inst.id, parseInt(slider.value, 10));
    });

    controls.appendChild(delayControl);

    // Visibility toggle button
    const visBtn = document.createElement('button');
    visBtn.className = `btn btn-sm visibility-btn${isVisible ? '' : ' is-hidden'}`;
    visBtn.textContent = isVisible ? 'Hide' : 'Show';
    visBtn.addEventListener('click', () => {
      toggleInstanceVisibility(inst.id, !isVisible, visBtn);
    });
    controls.appendChild(visBtn);

    card.appendChild(controls);
    fragment.appendChild(card);
  }

  overlayInstancesListEl.innerHTML = '';
  overlayInstancesListEl.appendChild(fragment);
}

/**
 * Render the connected overlay clients summary in the right column.
 */
function renderConnectedClients() {
  if (!overlayClientListEl) return;

  if (connectedClients.length === 0) {
    overlayClientListEl.innerHTML = '<div class="empty-state">No overlays connected</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const client of connectedClients) {
    const card = document.createElement('div');
    card.className = 'client-card';

    // Header row: name + delay
    const header = document.createElement('div');
    header.className = 'client-card-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'client-name';
    nameEl.textContent = client.name || `Instance #${client.instanceId}`;
    header.appendChild(nameEl);

    const delayEl = document.createElement('span');
    delayEl.className = 'client-delay';
    delayEl.textContent = `${client.delay || 0}s delay`;
    header.appendChild(delayEl);

    card.appendChild(header);

    // Meta row: connected since + health
    const metaEl = document.createElement('div');
    metaEl.className = 'client-meta';

    const connectedSince = formatConnectedTime(client.connectedAt);
    metaEl.textContent = `Connected ${connectedSince}`;

    // Health indicator
    const healthEl = document.createElement('span');
    healthEl.className = 'client-health';
    const bufferSize = client.bufferStats?.size || 0;
    const isHealthy = bufferSize < 100;
    healthEl.innerHTML = `<span class="status-dot ${isHealthy ? 'online' : 'warning'}"></span>${isHealthy ? 'Healthy' : `Buffer: ${bufferSize}`}`;
    metaEl.appendChild(healthEl);

    card.appendChild(metaEl);
    fragment.appendChild(card);
  }

  overlayClientListEl.innerHTML = '';
  overlayClientListEl.appendChild(fragment);
}

// ── API Actions ──

/**
 * Update the delay for a specific overlay instance.
 *
 * @param {number} instanceId
 * @param {number} delaySeconds
 */
async function updateInstanceDelay(instanceId, delaySeconds) {
  try {
    const res = await authenticatedFetch(`/api/overlays/instances/${instanceId}/delay`, {
      method: 'PUT',
      body: JSON.stringify({ delaySeconds }),
    });
    if (!res.ok) throw new Error('Failed to update delay');

    // Update local instance data
    const inst = instances.find(i => i.id === instanceId);
    if (inst) inst.delay_seconds = delaySeconds;

    showToast(`Delay set to ${delaySeconds}s`, 'success', 2000);
  } catch (err) {
    console.error('Update delay error:', err);
    showToast('Failed to update delay', 'error');
  }
}

/**
 * Toggle visibility for a specific overlay instance.
 *
 * @param {number} instanceId
 * @param {boolean} visible
 * @param {HTMLElement} buttonEl - The button to update
 */
async function toggleInstanceVisibility(instanceId, visible, buttonEl) {
  try {
    const res = await authenticatedFetch(`/api/overlays/instances/${instanceId}/visibility`, {
      method: 'PUT',
      body: JSON.stringify({ visible }),
    });
    if (!res.ok) throw new Error('Failed to update visibility');

    // Update local state
    visibilityState[instanceId] = visible;

    // Update button appearance immediately
    if (buttonEl) {
      buttonEl.textContent = visible ? 'Hide' : 'Show';
      buttonEl.classList.toggle('is-hidden', !visible);
    }

    showToast(visible ? 'Overlay shown' : 'Overlay hidden', 'info', 2000);
  } catch (err) {
    console.error('Toggle visibility error:', err);
    showToast('Failed to update visibility', 'error');
  }
}

// ── Create Instance ──

function showCreateForm() {
  createFormVisible = true;
  renderOverlayInstances();
  // Load templates for the dropdown
  _loadTemplatesForDropdown();
}

function hideCreateForm() {
  createFormVisible = false;
  renderOverlayInstances();
}

async function _loadTemplatesForDropdown() {
  try {
    const res = await authenticatedFetch('/api/overlays/templates');
    if (!res.ok) return;
    const data = await res.json();
    const select = document.getElementById('newInstanceTemplate');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select Template --</option>';
    for (const t of (data.templates || [])) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name} (${t.overlay_type})`;
      select.appendChild(opt);
    }
  } catch (err) {
    console.error('Load templates error:', err);
  }
}

function _buildCreateForm() {
  const form = document.createElement('div');
  form.className = 'overlay-create-form';
  form.style.cssText = 'background:var(--card-bg);border:1px solid var(--border);border-radius:var(--radius);padding:12px;margin-bottom:8px;display:flex;gap:8px;align-items:flex-end;';

  form.innerHTML = `
    <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
      <label style="font-size:0.7rem;color:var(--text-muted);font-weight:600;">Template</label>
      <select class="select" id="newInstanceTemplate" style="padding:6px 8px;font-size:0.8rem;">
        <option value="">Loading...</option>
      </select>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
      <label style="font-size:0.7rem;color:var(--text-muted);font-weight:600;">Name</label>
      <input class="input" type="text" id="newInstanceName" placeholder="Instance name" style="padding:6px 8px;font-size:0.8rem;" />
    </div>
    <button class="btn btn-sm btn-primary" id="createInstanceConfirmBtn">Create</button>
    <button class="btn btn-sm" id="createInstanceCancelBtn">Cancel</button>
  `;

  // Wire events after appending
  setTimeout(() => {
    document.getElementById('createInstanceConfirmBtn')?.addEventListener('click', createInstance);
    document.getElementById('createInstanceCancelBtn')?.addEventListener('click', hideCreateForm);
  }, 0);

  return form;
}

async function createInstance() {
  const templateId = document.getElementById('newInstanceTemplate')?.value;
  const name = document.getElementById('newInstanceName')?.value.trim();

  if (!templateId) {
    showToast('Select a template', 'warning');
    return;
  }
  if (!name) {
    showToast('Enter an instance name', 'warning');
    return;
  }

  try {
    const res = await authenticatedFetch('/api/overlays/instances', {
      method: 'POST',
      body: JSON.stringify({ template_id: parseInt(templateId, 10), name }),
    });
    if (!res.ok) throw new Error('Failed to create instance');
    const data = await res.json();
    showToast(`Instance created: ${name}`, 'success', 3000);
    createFormVisible = false;
    await loadOverlayInstances();
  } catch (err) {
    console.error('Create instance error:', err);
    showToast('Failed to create instance', 'error');
  }
}

// ── Cache Status Indicators ──

/**
 * Update cache indicator dots on overlay instance cards.
 * @param {Object} clientDataByInstance - Map of instanceId -> { cacheStatus }
 */
export function updateCacheStatus(clientDataByInstance) {
  document.querySelectorAll('.cache-dot').forEach(dot => {
    const instanceId = parseInt(dot.dataset.cacheInstance, 10);
    const client = clientDataByInstance[instanceId];
    const status = client?.cacheStatus;

    // Reset
    dot.className = 'cache-dot';
    dot.title = '';

    if (!status) return;

    const { total, loaded, failed, ready } = status;
    if (total === 0) return;

    if (ready && failed === 0) {
      dot.classList.add('ready');
      dot.title = `${loaded}/${total} assets cached`;
    } else if (ready && failed > 0) {
      dot.classList.add('warn');
      dot.title = `${loaded}/${total} cached, ${failed} failed`;
    } else {
      dot.classList.add('loading');
      dot.title = `Caching assets: ${loaded}/${total}`;
    }
  });
}

// ── Helpers ──

/**
 * Format a connected-at timestamp to a human-readable relative time.
 *
 * @param {string} isoString - ISO timestamp of when the client connected.
 * @returns {string} - Relative time string, e.g. "5m ago"
 */
function formatConnectedTime(isoString) {
  if (!isoString) return '';

  const connectedDate = new Date(isoString);
  const now = Date.now();
  const diffMs = now - connectedDate.getTime();

  if (diffMs < 0) return 'just now';

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;

  return `${Math.floor(hours / 24)}d ago`;
}
