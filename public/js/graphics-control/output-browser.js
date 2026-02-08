/**
 * Output Browser -- left sidebar panel.
 * Renders a folder tree of overlay output instances with create/delete/rename support.
 */
import { authenticatedFetch } from '/js/modules/auth.js';
import { showToast, showPrompt, showConfirm } from '/js/modules/ui.js';

let callbacks = { onSelect: null, onRefresh: null };
let selectedId = null;
let expandedFolders = new Set();

// ── SVG Icons ──

const ICONS = {
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
  output: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  dots: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
};

// ── Public API ──

export function initOutputBrowser({ onSelect, onRefresh }) {
  callbacks.onSelect = onSelect;
  callbacks.onRefresh = onRefresh;

  // Wire up create buttons
  const btnNewOutput = document.getElementById('btnNewOutput');
  const btnNewFolder = document.getElementById('btnNewFolder');

  if (btnNewOutput) {
    btnNewOutput.addEventListener('click', handleCreateOutput);
  }

  if (btnNewFolder) {
    btnNewFolder.addEventListener('click', handleCreateFolder);
  }

  // Close context menu on click elsewhere
  document.addEventListener('click', () => hideContextMenu());
  document.addEventListener('contextmenu', (e) => {
    // Only prevent default on our tree items (handled in renderOutputBrowser)
  });
}

export function renderOutputBrowser(folders, instances) {
  const tree = document.getElementById('outputTree');
  if (!tree) return;

  // Separate instances into foldered and unfoldered
  const folderedInstanceIds = new Set();
  for (const folder of folders) {
    if (folder.instances) {
      for (const inst of folder.instances) {
        folderedInstanceIds.add(inst.id);
      }
    }
  }

  const rootInstances = instances.filter(i => !i.folder_id && !folderedInstanceIds.has(i.id));

  // Build HTML
  if (folders.length === 0 && rootInstances.length === 0) {
    tree.innerHTML = `
      <div class="gc-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M8 7h8M8 12h5"/></svg>
        <span>No outputs yet</span>
      </div>
    `;
    return;
  }

  let html = '';

  // Render folders
  for (const folder of folders) {
    const isExpanded = expandedFolders.has(folder.id);
    const folderInstances = folder.instances || instances.filter(i => i.folder_id === folder.id);

    html += `
      <div class="gc-folder" data-folder-id="${folder.id}">
        <div class="gc-folder-header" data-folder-id="${folder.id}">
          <div class="gc-folder-chevron ${isExpanded ? 'open' : ''}">${ICONS.chevron}</div>
          <div class="gc-folder-icon">${ICONS.folder}</div>
          <div class="gc-folder-name">${escapeHtml(folder.name)}</div>
        </div>
        <div class="gc-folder-children ${isExpanded ? 'open' : ''}">
    `;

    for (const inst of folderInstances) {
      html += renderOutputItem(inst, true);
    }

    if (folderInstances.length === 0) {
      html += '<div class="gc-empty-state" style="padding:12px;font-size:0.75rem;">Empty folder</div>';
    }

    html += '</div></div>';
  }

  // Render root-level instances
  for (const inst of rootInstances) {
    html += renderOutputItem(inst, false);
  }

  tree.innerHTML = html;

  // Wire up folder toggle clicks
  tree.querySelectorAll('.gc-folder-header').forEach(el => {
    el.addEventListener('click', (e) => {
      const folderId = parseInt(el.dataset.folderId, 10);
      toggleFolder(folderId);
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const folderId = parseInt(el.dataset.folderId, 10);
      const folder = folders.find(f => f.id === folderId);
      showFolderContextMenu(e, folder);
    });
  });

  // Wire up output item clicks
  tree.querySelectorAll('.gc-output-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't select if clicking the dots button
      if (e.target.closest('.gc-btn-dots')) return;
      const id = parseInt(el.dataset.instanceId, 10);
      selectOutput(id);
    });
  });

  // Wire up three-dot menu buttons on output items
  tree.querySelectorAll('.gc-btn-dots').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.dotsId, 10);
      const inst = instances.find(i => i.id === id);
      showOutputContextMenu(e, inst, folders);
    });
  });
}

export function getSelectedOutputId() {
  return selectedId;
}

// ── Internals ──

function renderOutputItem(inst, inFolder) {
  const isSelected = inst.id === selectedId;
  const hasOnAir = inst.has_on_air || false;

  return `
    <div class="gc-output-item ${isSelected ? 'selected' : ''}"
         data-instance-id="${inst.id}">
      <div class="gc-output-icon">${ICONS.output}</div>
      <div class="gc-output-name">${escapeHtml(inst.name)}</div>
      <div class="gc-cache-dot" data-cache-instance="${inst.id}"></div>
      <div class="gc-on-air-dot ${hasOnAir ? 'active' : ''}"></div>
      <button class="gc-btn-dots" data-dots-id="${inst.id}" title="Options">${ICONS.dots}</button>
    </div>
  `;
}

function selectOutput(id) {
  selectedId = id;

  // Update visual selection
  document.querySelectorAll('.gc-output-item').forEach(el => {
    el.classList.toggle('selected', parseInt(el.dataset.instanceId, 10) === id);
  });

  // Show the add graphic button
  const addBtn = document.getElementById('btnAddGraphic');
  if (addBtn) {
    addBtn.classList.toggle('hidden', !id);
  }

  if (callbacks.onSelect) {
    callbacks.onSelect(id);
  }
}

function toggleFolder(folderId) {
  if (expandedFolders.has(folderId)) {
    expandedFolders.delete(folderId);
  } else {
    expandedFolders.add(folderId);
  }

  // Update DOM directly for snappy toggle
  const folderEl = document.querySelector(`.gc-folder[data-folder-id="${folderId}"]`);
  if (folderEl) {
    const chevron = folderEl.querySelector('.gc-folder-chevron');
    const children = folderEl.querySelector('.gc-folder-children');
    if (chevron) chevron.classList.toggle('open');
    if (children) children.classList.toggle('open');
  }
}

// ── Create Operations ──

async function handleCreateOutput() {
  const name = await showPrompt('New Output', 'Output name');
  if (!name) return;

  try {
    const res = await authenticatedFetch('/api/overlays/instances', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create output');
    }

    showToast('Output created', 'success');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to create output:', err);
    showToast(err.message || 'Failed to create output', 'error');
  }
}

async function handleCreateFolder() {
  const name = await showPrompt('New Folder', 'Folder name');
  if (!name) return;

  try {
    const res = await authenticatedFetch('/api/overlays/folders', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create folder');
    }

    showToast('Folder created', 'success');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to create folder:', err);
    showToast(err.message || 'Failed to create folder', 'error');
  }
}

// ── Context Menu ──

function showOutputContextMenu(e, instance, folders) {
  if (!instance) return;

  const menu = document.getElementById('contextMenu');
  if (!menu) return;

  // Build folder submenu items
  let moveItems = '';
  if (instance.folder_id) {
    moveItems += `<div class="gc-context-item" data-action="move" data-folder-id="">Move to Root</div>`;
  }
  for (const folder of folders) {
    if (folder.id !== instance.folder_id) {
      moveItems += `<div class="gc-context-item" data-action="move" data-folder-id="${folder.id}">Move to ${escapeHtml(folder.name)}</div>`;
    }
  }

  menu.innerHTML = `
    <div class="gc-context-item" data-action="rename">Rename</div>
    <div class="gc-context-item" data-action="copy-url">Copy URL</div>
    ${moveItems ? '<div class="gc-context-separator"></div>' + moveItems : ''}
    <div class="gc-context-separator"></div>
    <div class="gc-context-item danger" data-action="delete">Delete</div>
  `;

  positionContextMenu(menu, e);

  // Wire up actions
  menu.querySelectorAll('.gc-context-item').forEach(item => {
    item.addEventListener('click', async () => {
      hideContextMenu();
      const action = item.dataset.action;

      if (action === 'rename') {
        await handleRenameOutput(instance);
      } else if (action === 'copy-url') {
        await handleCopyOutputUrl(instance);
      } else if (action === 'move') {
        const folderId = item.dataset.folderId ? parseInt(item.dataset.folderId, 10) : null;
        await handleMoveOutput(instance, folderId);
      } else if (action === 'delete') {
        await handleDeleteOutput(instance);
      }
    });
  });
}

function showFolderContextMenu(e, folder) {
  if (!folder) return;

  const menu = document.getElementById('contextMenu');
  if (!menu) return;

  menu.innerHTML = `
    <div class="gc-context-item" data-action="rename">Rename</div>
    <div class="gc-context-separator"></div>
    <div class="gc-context-item danger" data-action="delete">Delete</div>
  `;

  positionContextMenu(menu, e);

  menu.querySelectorAll('.gc-context-item').forEach(item => {
    item.addEventListener('click', async () => {
      hideContextMenu();
      const action = item.dataset.action;

      if (action === 'rename') {
        await handleRenameFolder(folder);
      } else if (action === 'delete') {
        await handleDeleteFolder(folder);
      }
    });
  });
}

function positionContextMenu(menu, e) {
  // If triggered from a button click, position below the button
  const btn = e.currentTarget || e.target;
  if (btn && btn.getBoundingClientRect) {
    const btnRect = btn.getBoundingClientRect();
    menu.style.left = `${btnRect.left}px`;
    menu.style.top = `${btnRect.bottom + 4}px`;
  } else {
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
  }
  menu.classList.add('show');

  // Adjust if off screen
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 8}px`;
    }
  });
}

function hideContextMenu() {
  const menu = document.getElementById('contextMenu');
  if (menu) menu.classList.remove('show');
}

// ── Context Menu Actions ──

async function handleRenameOutput(instance) {
  const newName = await showPrompt('Rename Output', 'New name', instance.name);
  if (!newName || newName === instance.name) return;

  try {
    const res = await authenticatedFetch(`/api/overlays/instances/${instance.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to rename output');
    }

    showToast('Output renamed', 'success');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to rename output:', err);
    showToast(err.message || 'Failed to rename output', 'error');
  }
}

async function handleCopyOutputUrl(instance) {
  if (!instance.access_token) {
    showToast('No access token available', 'warning');
    return;
  }

  const url = `${window.location.origin}/overlay/${instance.access_token}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast('URL copied to clipboard', 'success');
  } catch {
    // Fallback for non-secure contexts
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast('URL copied to clipboard', 'success');
  }
}

async function handleMoveOutput(instance, folderId) {
  try {
    const res = await authenticatedFetch(`/api/overlays/instances/${instance.id}`, {
      method: 'PUT',
      body: JSON.stringify({ folder_id: folderId }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to move output');
    }

    showToast('Output moved', 'success');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to move output:', err);
    showToast(err.message || 'Failed to move output', 'error');
  }
}

async function handleDeleteOutput(instance) {
  const confirmed = await showConfirm('Delete Output', `Are you sure you want to delete "${instance.name}"? This cannot be undone.`);
  if (!confirmed) return;

  try {
    const res = await authenticatedFetch(`/api/overlays/instances/${instance.id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete output');
    }

    // If the deleted output was selected, clear selection
    if (selectedId === instance.id) {
      selectedId = null;
      if (callbacks.onSelect) callbacks.onSelect(null);
    }

    showToast('Output deleted', 'success');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to delete output:', err);
    showToast(err.message || 'Failed to delete output', 'error');
  }
}

async function handleRenameFolder(folder) {
  const newName = await showPrompt('Rename Folder', 'New name', folder.name);
  if (!newName || newName === folder.name) return;

  try {
    const res = await authenticatedFetch(`/api/overlays/folders/${folder.id}`, {
      method: 'PUT',
      body: JSON.stringify({ name: newName }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to rename folder');
    }

    showToast('Folder renamed', 'success');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to rename folder:', err);
    showToast(err.message || 'Failed to rename folder', 'error');
  }
}

async function handleDeleteFolder(folder) {
  const confirmed = await showConfirm('Delete Folder', `Are you sure you want to delete folder "${folder.name}"? Outputs inside will be moved to root.`);
  if (!confirmed) return;

  try {
    const res = await authenticatedFetch(`/api/overlays/folders/${folder.id}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete folder');
    }

    expandedFolders.delete(folder.id);
    showToast('Folder deleted', 'success');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to delete folder:', err);
    showToast(err.message || 'Failed to delete folder', 'error');
  }
}

// ── Cache Status Indicators ──

/**
 * Update cache indicator dots on output items based on live overlay client data.
 * @param {Object} clientDataByInstance - Map of instanceId -> { cacheStatus }
 */
export function updateCacheStatus(clientDataByInstance) {
  document.querySelectorAll('.gc-cache-dot').forEach(dot => {
    const instanceId = parseInt(dot.dataset.cacheInstance, 10);
    const client = clientDataByInstance[instanceId];
    const status = client?.cacheStatus;

    // Reset
    dot.className = 'gc-cache-dot';
    dot.title = '';

    if (!status) return; // No overlay connected or no cache data

    const { total, loaded, failed, pending, ready } = status;
    if (total === 0) return; // No images — no indicator needed

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

// ── Utilities ──

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
