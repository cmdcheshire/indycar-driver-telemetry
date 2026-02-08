/**
 * Graphics Control page entry point.
 * Manages state, initializes all panels, and coordinates data flow between them.
 */
import { initAuth, isAuthenticated, getUser, getToken, logout, authenticatedFetch } from '/js/modules/auth.js';
import { showToast } from '/js/modules/ui.js';
import { WebSocketClient } from '/js/modules/websocket-client.js';
import { initOutputBrowser, renderOutputBrowser, getSelectedOutputId, updateCacheStatus } from '/js/graphics-control/output-browser.js';
import { initRundownPanel, renderRundown, clearRundown } from '/js/graphics-control/rundown-panel.js';
import { initTemplateLibrary, renderTemplateLibrary } from '/js/graphics-control/template-library.js';
import { initPreviewPanel, updatePreview, clearPreview } from '/js/graphics-control/preview-panel.js';

// ── State ──

let folders = [];
let instances = [];
let templates = [];
let selectedOutputId = null;
let wsClient = null;
let overlayClientCache = {};  // instanceId -> client data (including cacheStatus)

// ── Data Fetching ──

async function fetchFolders() {
  try {
    const res = await authenticatedFetch('/api/overlays/folders');
    const data = await res.json();
    folders = data.folders || [];
  } catch (err) {
    console.error('Failed to fetch folders:', err);
    folders = [];
  }
}

async function fetchInstances() {
  try {
    const res = await authenticatedFetch('/api/overlays/instances');
    const data = await res.json();
    instances = data.instances || [];
  } catch (err) {
    console.error('Failed to fetch instances:', err);
    instances = [];
  }
}

async function fetchTemplates() {
  try {
    const res = await authenticatedFetch('/api/overlays/templates');
    const data = await res.json();
    templates = data.templates || [];
  } catch (err) {
    console.error('Failed to fetch templates:', err);
    templates = [];
  }
}

async function fetchRundown(instanceId) {
  try {
    const res = await authenticatedFetch(`/api/overlays/instances/${instanceId}/rundown`);
    const data = await res.json();
    return data.items || [];
  } catch (err) {
    console.error('Failed to fetch rundown:', err);
    return [];
  }
}

// ── Refresh Helpers ──

async function refreshOutputBrowser() {
  await Promise.all([fetchFolders(), fetchInstances()]);
  renderOutputBrowser(folders, instances);
  updateCacheIndicators();
}

async function refreshRundown() {
  if (!selectedOutputId) {
    clearRundown();
    return;
  }
  const items = await fetchRundown(selectedOutputId);

  // Build overlay URL for the selected output
  const instance = instances.find(i => i.id === selectedOutputId);
  const overlayUrl = instance && instance.access_token
    ? `${window.location.origin}/overlay/${instance.access_token}`
    : null;

  renderRundown(selectedOutputId, items, overlayUrl);
}

async function refreshAll() {
  await Promise.all([
    refreshOutputBrowser(),
    fetchTemplates(),
  ]);
  renderTemplateLibrary(templates);
  await refreshRundown();
}

// ── Callbacks ──

function handleOutputSelect(instanceId) {
  selectedOutputId = instanceId;

  // Update preview
  if (instanceId) {
    const instance = instances.find(i => i.id === instanceId);
    if (instance && instance.access_token) {
      updatePreview(instance.access_token);
    } else {
      clearPreview();
    }
  } else {
    clearPreview();
  }

  // Load rundown for the selected output
  refreshRundown();
}

async function handleAddToRundown(templateId) {
  if (!selectedOutputId) {
    showToast('Select an output first', 'warning');
    return;
  }

  try {
    const res = await authenticatedFetch(`/api/overlays/instances/${selectedOutputId}/rundown`, {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to add graphic');
    }

    showToast('Graphic added to rundown', 'success');
    await refreshRundown();
  } catch (err) {
    console.error('Failed to add to rundown:', err);
    showToast(err.message || 'Failed to add graphic', 'error');
  }
}

// ── User Info ──

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

// ── WebSocket (for live overlay client status) ──

function connectWebSocket() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = getToken();
  const url = `${proto}//${window.location.host}/ws/dashboard?token=${encodeURIComponent(token)}`;

  wsClient = new WebSocketClient(url);

  wsClient.on('overlayClientChange', (data) => {
    overlayClientCache = {};
    for (const client of (data.clients || [])) {
      // Use worst-case (lowest loaded ratio) if multiple overlays per instance
      const existing = overlayClientCache[client.instanceId];
      if (!existing || (client.cacheStatus && (!existing.cacheStatus || client.cacheStatus.loaded < existing.cacheStatus.loaded))) {
        overlayClientCache[client.instanceId] = client;
      }
    }
    updateCacheIndicators();
  });

  wsClient.connect();
}

function updateCacheIndicators() {
  updateCacheStatus(overlayClientCache);
}

// ── Bootstrap ──

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

  // Initialize all panels
  initOutputBrowser({
    onSelect: handleOutputSelect,
    onRefresh: refreshOutputBrowser,
  });

  initRundownPanel({
    onRefresh: refreshRundown,
  });

  initTemplateLibrary({
    onAddToRundown: handleAddToRundown,
  });

  initPreviewPanel();

  // Load initial data
  await refreshAll();

  // Connect WebSocket for live overlay client status (cache indicators)
  connectWebSocket();
}

// ── Start ──
init().catch((err) => {
  console.error('Graphics Control initialization failed:', err);
  showToast('Failed to initialize Graphics Control', 'error');
});
