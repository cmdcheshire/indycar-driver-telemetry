/**
 * Graphics Library page entry point.
 * Asset management with folder tree, file grid, drag-and-drop upload.
 */
import { initAuth, isAuthenticated, getUser, getToken, logout, authenticatedFetch } from '/js/modules/auth.js';
import { showToast, showConfirm, showPrompt } from '/js/modules/ui.js';

// ── State ──

let folders = [];
let assets = [];
let currentFolderId = null; // null = root
let searchQuery = '';
let selectedAssetId = null;
let expandedFolders = new Set();

// ── Constants ──

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico'];
const FONT_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2'];
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi'];

// ── DOM References ──

let folderTreeEl, assetGridEl, assetEmptyEl, breadcrumbEl, searchInputEl;
let uploadZoneEl, uploadInputEl, uploadProgressEl, uploadBarFillEl, uploadStatusEl;
let contextMenuEl, detailOverlayEl, detailPanelEl;

// ── Data Fetching ──

async function loadFolders() {
  try {
    const res = await authenticatedFetch('/api/library/folders');
    if (!res.ok) throw new Error('Failed to load folders');
    const data = await res.json();
    folders = data.folders || [];
  } catch (err) {
    console.error('Failed to load folders:', err);
    folders = [];
  }
}

async function loadAssets(folderId) {
  try {
    const url = folderId
      ? `/api/library/assets?folder_id=${folderId}`
      : '/api/library/assets';
    const res = await authenticatedFetch(url);
    if (!res.ok) throw new Error('Failed to load assets');
    const data = await res.json();
    assets = data.assets || [];
  } catch (err) {
    console.error('Failed to load assets:', err);
    assets = [];
  }
}

async function createFolder(name, parentId) {
  try {
    const body = { name };
    if (parentId) body.parent_id = parentId;
    const res = await authenticatedFetch('/api/library/folders', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create folder');
    }
    showToast('Folder created', 'success');
    await refreshAll();
  } catch (err) {
    console.error('Failed to create folder:', err);
    showToast(err.message || 'Failed to create folder', 'error');
  }
}

async function renameFolder(id, name) {
  try {
    const res = await authenticatedFetch(`/api/library/folders/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to rename folder');
    }
    showToast('Folder renamed', 'success');
    await refreshAll();
  } catch (err) {
    console.error('Failed to rename folder:', err);
    showToast(err.message || 'Failed to rename folder', 'error');
  }
}

async function deleteFolder(id) {
  try {
    const res = await authenticatedFetch(`/api/library/folders/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete folder');
    }
    if (currentFolderId === id) {
      currentFolderId = null;
    }
    showToast('Folder deleted', 'success');
    await refreshAll();
  } catch (err) {
    console.error('Failed to delete folder:', err);
    showToast(err.message || 'Failed to delete folder', 'error');
  }
}

async function deleteAsset(id) {
  try {
    const res = await authenticatedFetch(`/api/library/assets/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete asset');
    }
    showToast('Asset deleted', 'success');
    await loadAssets(currentFolderId);
    renderAssetGrid();
  } catch (err) {
    console.error('Failed to delete asset:', err);
    showToast(err.message || 'Failed to delete asset', 'error');
  }
}

async function renameAsset(id, originalName) {
  try {
    const res = await authenticatedFetch(`/api/library/assets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ original_name: originalName }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to rename asset');
    }
    showToast('Asset renamed', 'success');
    await loadAssets(currentFolderId);
    renderAssetGrid();
  } catch (err) {
    console.error('Failed to rename asset:', err);
    showToast(err.message || 'Failed to rename asset', 'error');
  }
}

async function moveAsset(id, folderId) {
  try {
    const res = await authenticatedFetch(`/api/library/assets/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ folder_id: folderId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to move asset');
    }
    showToast('Asset moved', 'success');
    await loadAssets(currentFolderId);
    renderAssetGrid();
  } catch (err) {
    console.error('Failed to move asset:', err);
    showToast(err.message || 'Failed to move asset', 'error');
  }
}

async function handleUpload(files, folderId) {
  if (!files || files.length === 0) return;

  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  if (folderId) {
    formData.append('folder_id', folderId);
  }

  // Show progress
  uploadProgressEl.classList.add('active');
  uploadBarFillEl.style.width = '0%';
  uploadStatusEl.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`;

  try {
    const token = getToken();
    const xhr = new XMLHttpRequest();

    const result = await new Promise((resolve, reject) => {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          uploadBarFillEl.style.width = pct + '%';
          uploadStatusEl.textContent = `Uploading... ${pct}%`;
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          try {
            const errData = JSON.parse(xhr.responseText);
            reject(new Error(errData.error || `Upload failed (${xhr.status})`));
          } catch {
            reject(new Error(`Upload failed (${xhr.status})`));
          }
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Upload failed')));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

      xhr.open('POST', '/api/library/assets/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });

    uploadBarFillEl.style.width = '100%';
    uploadStatusEl.textContent = 'Upload complete';
    showToast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded`, 'success');

    await loadAssets(currentFolderId);
    renderAssetGrid();
  } catch (err) {
    console.error('Upload failed:', err);
    showToast(err.message || 'Upload failed', 'error');
    uploadStatusEl.textContent = 'Upload failed';
  }

  // Hide progress after a moment
  setTimeout(() => {
    uploadProgressEl.classList.remove('active');
  }, 2000);
}

// ── Utility ──

function getFileExtension(filename) {
  if (!filename) return '';
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

function isImage(filename) {
  return IMAGE_EXTENSIONS.includes(getFileExtension(filename));
}

function isFont(filename) {
  return FONT_EXTENSIONS.includes(getFileExtension(filename));
}

function isVideo(filename) {
  return VIDEO_EXTENSIONS.includes(getFileExtension(filename));
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i++;
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function getAssetUrl(asset) {
  return `/api/library/assets/${asset.id}/file`;
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('URL copied to clipboard', 'success');
  }).catch(() => {
    // Fallback
    const input = document.createElement('input');
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast('URL copied to clipboard', 'success');
  });
}

// ── Folder Tree Helpers ──

function buildFolderTree(folderList) {
  const map = {};
  const roots = [];

  for (const f of folderList) {
    map[f.id] = { ...f, children: [] };
  }

  for (const f of folderList) {
    if (f.parent_id && map[f.parent_id]) {
      map[f.parent_id].children.push(map[f.id]);
    } else {
      roots.push(map[f.id]);
    }
  }

  return roots;
}

function getFolderPath(folderId) {
  const path = [];
  let current = folderId;
  const map = {};
  for (const f of folders) {
    map[f.id] = f;
  }
  while (current && map[current]) {
    path.unshift(map[current]);
    current = map[current].parent_id;
  }
  return path;
}

// ── Rendering: Folder Tree ──

function renderFolderTree() {
  const tree = buildFolderTree(folders);

  let html = '';

  // Root item
  const rootSelected = currentFolderId === null ? ' selected' : '';
  html += `
    <div class="lib-folder-item">
      <div class="lib-folder-row${rootSelected}" data-folder-id="root">
        <span class="lib-folder-chevron empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
        <svg class="lib-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/></svg>
        <span class="lib-folder-name">All Files</span>
      </div>
    </div>
  `;

  html += renderFolderNodes(tree, 0);
  folderTreeEl.innerHTML = html;

  // Bind click events
  folderTreeEl.querySelectorAll('.lib-folder-row').forEach(row => {
    row.addEventListener('click', (e) => {
      // Ignore if clicking action buttons
      if (e.target.closest('.lib-folder-actions') || e.target.closest('.lib-folder-action-btn')) return;

      const folderId = row.dataset.folderId;
      if (folderId === 'root') {
        selectFolder(null);
      } else {
        const id = parseInt(folderId, 10);
        // Toggle expand first so selectFolder's re-render picks it up
        if (expandedFolders.has(id)) {
          expandedFolders.delete(id);
        } else {
          expandedFolders.add(id);
        }
        selectFolder(id);
      }
    });
  });

  // Bind rename/delete buttons
  folderTreeEl.querySelectorAll('.lib-folder-action-btn[data-action="rename"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderId = parseInt(btn.dataset.folderId, 10);
      const folder = folders.find(f => f.id === folderId);
      if (!folder) return;
      const newName = await showPrompt('Rename Folder', 'Folder name', folder.name);
      if (newName && newName !== folder.name) {
        await renameFolder(folderId, newName);
      }
    });
  });

  folderTreeEl.querySelectorAll('.lib-folder-action-btn[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const folderId = parseInt(btn.dataset.folderId, 10);
      const folder = folders.find(f => f.id === folderId);
      if (!folder) return;
      const confirmed = await showConfirm('Delete Folder', `Delete "${folder.name}" and all its contents?`);
      if (confirmed) {
        await deleteFolder(folderId);
      }
    });
  });

  // Drag-and-drop: folders as drop targets
  folderTreeEl.querySelectorAll('.lib-folder-row').forEach(row => {
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      const assetId = e.dataTransfer.getData('text/asset-id');
      if (!assetId) return;
      const folderId = row.dataset.folderId;
      const targetFolderId = folderId === 'root' ? null : parseInt(folderId, 10);
      try {
        const token = getToken();
        const res = await fetch(`/api/library/assets/${assetId}/move`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_id: targetFolderId }),
        });
        if (!res.ok) throw new Error('Move failed');
        await loadAssets(currentFolderId);
        renderAssetGrid();
        showToast('Asset moved', 'success', 2000);
      } catch (err) {
        console.error('Failed to move asset:', err);
      }
    });
  });
}

function renderFolderNodes(nodes, depth) {
  let html = '';
  for (const node of nodes) {
    const isSelected = currentFolderId === node.id;
    const isExpanded = expandedFolders.has(node.id);
    const hasChildren = node.children && node.children.length > 0;

    html += `
      <div class="lib-folder-item">
        <div class="lib-folder-row${isSelected ? ' selected' : ''}" data-folder-id="${node.id}" style="padding-left: ${10 + depth * 16}px">
          <span class="lib-folder-chevron${isExpanded ? ' open' : ''}${!hasChildren ? ' empty' : ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
          <svg class="lib-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/></svg>
          <span class="lib-folder-name">${escapeHtml(node.name)}</span>
          <span class="lib-folder-actions">
            <button class="lib-folder-action-btn" data-action="rename" data-folder-id="${node.id}" title="Rename">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="lib-folder-action-btn danger" data-action="delete" data-folder-id="${node.id}" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </span>
        </div>
        ${hasChildren ? `<div class="lib-folder-children${isExpanded ? ' open' : ''}">${renderFolderNodes(node.children, depth + 1)}</div>` : ''}
      </div>
    `;
  }
  return html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Rendering: Asset Grid ──

function renderAssetGrid() {
  let filtered = assets;

  // Apply search filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = assets.filter(a =>
      (a.original_name || '').toLowerCase().includes(q) ||
      (a.mime_type || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    assetGridEl.innerHTML = `
      <div class="lib-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
        <span>${searchQuery ? 'No assets match your search' : 'No assets in this folder'}</span>
        <span style="font-size:0.75rem; color:var(--text-dim)">${searchQuery ? 'Try a different search term' : 'Upload files using the drop zone below'}</span>
      </div>
    `;
    return;
  }

  let html = '';
  for (const asset of filtered) {
    const ext = getFileExtension(asset.original_name);
    let thumbHtml;

    if (isImage(asset.original_name)) {
      thumbHtml = `<img src="${getAssetUrl(asset)}" alt="${escapeHtml(asset.original_name)}" loading="lazy">`;
    } else if (isFont(asset.original_name)) {
      thumbHtml = `
        <div class="lib-asset-thumb-icon">
          <span class="font-preview">Aa</span>
          <span class="file-ext">.${ext}</span>
        </div>
      `;
    } else if (isVideo(asset.original_name)) {
      thumbHtml = `
        <div class="lib-asset-thumb-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          <span class="file-ext">.${ext}</span>
        </div>
      `;
    } else {
      thumbHtml = `
        <div class="lib-asset-thumb-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          <span class="file-ext">.${ext}</span>
        </div>
      `;
    }

    html += `
      <div class="lib-asset-card${selectedAssetId === asset.id ? ' selected' : ''}" data-asset-id="${asset.id}" draggable="true">
        <button class="lib-asset-dots" data-asset-id="${asset.id}" title="More actions">&#8943;</button>
        <div class="lib-asset-thumb">${thumbHtml}</div>
        <div class="lib-asset-info">
          <div class="lib-asset-name" title="${escapeHtml(asset.original_name)}">${escapeHtml(asset.original_name)}</div>
          <div class="lib-asset-meta">
            <span>${formatFileSize(asset.file_size)}</span>
            <span>${ext.toUpperCase()}</span>
          </div>
        </div>
      </div>
    `;
  }

  assetGridEl.innerHTML = html;

  // Bind card click (show detail)
  assetGridEl.querySelectorAll('.lib-asset-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.lib-asset-dots')) return;
      const assetId = card.dataset.assetId;
      const asset = assets.find(a => a.id === assetId);
      if (asset) showAssetDetail(asset);
    });
  });

  // Bind three-dot menu
  assetGridEl.querySelectorAll('.lib-asset-dots').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const assetId = btn.dataset.assetId;
      const asset = assets.find(a => a.id === assetId);
      if (asset) showAssetContextMenu(e, asset);
    });
  });

  // Bind right-click
  assetGridEl.querySelectorAll('.lib-asset-card').forEach(card => {
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const assetId = card.dataset.assetId;
      const asset = assets.find(a => a.id === assetId);
      if (asset) showAssetContextMenu(e, asset);
    });
  });

  // Drag-and-drop: assets as drag sources
  assetGridEl.querySelectorAll('.lib-asset-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/asset-id', card.dataset.assetId);
      e.dataTransfer.effectAllowed = 'move';
    });
  });
}

// ── Rendering: Breadcrumb ──

function renderBreadcrumb() {
  if (!currentFolderId) {
    breadcrumbEl.innerHTML = '<span class="lib-breadcrumb-item current">All Files</span>';
    return;
  }

  const path = getFolderPath(currentFolderId);
  let html = '<span class="lib-breadcrumb-item" data-folder-id="root">All Files</span>';

  for (let i = 0; i < path.length; i++) {
    html += '<span class="lib-breadcrumb-sep">/</span>';
    const isLast = i === path.length - 1;
    html += `<span class="lib-breadcrumb-item${isLast ? ' current' : ''}" data-folder-id="${path[i].id}">${escapeHtml(path[i].name)}</span>`;
  }

  breadcrumbEl.innerHTML = html;

  // Bind breadcrumb clicks
  breadcrumbEl.querySelectorAll('.lib-breadcrumb-item:not(.current)').forEach(item => {
    item.addEventListener('click', () => {
      const folderId = item.dataset.folderId;
      selectFolder(folderId === 'root' ? null : folderId);
    });
  });
}

// ── Asset Detail Overlay ──

function showAssetDetail(asset) {
  selectedAssetId = asset.id;
  const ext = getFileExtension(asset.original_name);
  const url = `${window.location.origin}${getAssetUrl(asset)}`;

  let previewHtml;
  if (isImage(asset.original_name)) {
    previewHtml = `<img src="${getAssetUrl(asset)}" alt="${escapeHtml(asset.original_name)}">`;
  } else if (isFont(asset.original_name)) {
    previewHtml = `<div class="lib-asset-thumb-icon"><span class="font-preview" style="font-size:3rem">Aa</span></div>`;
  } else if (isVideo(asset.original_name)) {
    previewHtml = `<video src="${getAssetUrl(asset)}" controls style="max-width:100%;max-height:100%"></video>`;
  } else {
    previewHtml = `
      <div class="lib-asset-thumb-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:48px;height:48px"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
      </div>
    `;
  }

  // Find folder name
  const folder = asset.folder_id ? folders.find(f => f.id === asset.folder_id) : null;
  const folderName = folder ? folder.name : 'Root';

  detailPanelEl.innerHTML = `
    <div class="lib-detail-preview">${previewHtml}</div>
    <div class="lib-detail-name">${escapeHtml(asset.original_name)}</div>
    <div class="lib-detail-meta">
      <div class="lib-detail-row">
        <span class="lib-detail-label">Size</span>
        <span class="lib-detail-value">${formatFileSize(asset.file_size)}</span>
      </div>
      <div class="lib-detail-row">
        <span class="lib-detail-label">Type</span>
        <span class="lib-detail-value">${asset.mime_type || ext.toUpperCase()}</span>
      </div>
      <div class="lib-detail-row">
        <span class="lib-detail-label">Folder</span>
        <span class="lib-detail-value">${escapeHtml(folderName)}</span>
      </div>
      ${asset.created_at ? `
      <div class="lib-detail-row">
        <span class="lib-detail-label">Uploaded</span>
        <span class="lib-detail-value">${new Date(asset.created_at).toLocaleDateString()}</span>
      </div>
      ` : ''}
    </div>
    <div class="lib-detail-url">
      <input type="text" value="${url}" readonly id="detailUrlInput">
      <button class="btn btn-sm btn-primary" id="detailCopyBtn">Copy URL</button>
    </div>
    <div class="lib-detail-actions">
      <button class="btn btn-sm btn-danger" id="detailDeleteBtn">Delete</button>
      <button class="btn btn-sm" id="detailCloseBtn">Close</button>
    </div>
  `;

  detailOverlayEl.classList.add('show');

  // Bind detail actions
  document.getElementById('detailCopyBtn').addEventListener('click', () => {
    copyToClipboard(url);
  });

  document.getElementById('detailDeleteBtn').addEventListener('click', async () => {
    const confirmed = await showConfirm('Delete Asset', `Delete "${asset.original_name}"?`);
    if (confirmed) {
      detailOverlayEl.classList.remove('show');
      await deleteAsset(asset.id);
    }
  });

  document.getElementById('detailCloseBtn').addEventListener('click', () => {
    detailOverlayEl.classList.remove('show');
    selectedAssetId = null;
  });
}

// ── Context Menu ──

function showAssetContextMenu(e, asset) {
  const url = `${window.location.origin}${getAssetUrl(asset)}`;

  contextMenuEl.innerHTML = `
    <div class="lib-context-item" data-action="copy-url">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      Copy URL
    </div>
    <div class="lib-context-item" data-action="rename">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Rename
    </div>
    <div class="lib-context-item" data-action="move">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/></svg>
      Move to Folder
    </div>
    <div class="lib-context-separator"></div>
    <div class="lib-context-item danger" data-action="delete">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      Delete
    </div>
  `;

  // Position context menu
  const x = e.clientX;
  const y = e.clientY;
  contextMenuEl.style.left = x + 'px';
  contextMenuEl.style.top = y + 'px';
  contextMenuEl.classList.add('show');

  // Ensure menu stays in viewport
  requestAnimationFrame(() => {
    const rect = contextMenuEl.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      contextMenuEl.style.left = (window.innerWidth - rect.width - 8) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      contextMenuEl.style.top = (window.innerHeight - rect.height - 8) + 'px';
    }
  });

  // Bind actions
  contextMenuEl.querySelector('[data-action="copy-url"]').addEventListener('click', () => {
    copyToClipboard(url);
    hideContextMenu();
  });

  contextMenuEl.querySelector('[data-action="rename"]').addEventListener('click', async () => {
    hideContextMenu();
    const newName = await showPrompt('Rename Asset', 'File name', asset.original_name);
    if (newName && newName !== asset.original_name) {
      await renameAsset(asset.id, newName);
    }
  });

  contextMenuEl.querySelector('[data-action="move"]').addEventListener('click', () => {
    hideContextMenu();
    showMoveModal(asset);
  });

  contextMenuEl.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    hideContextMenu();
    const confirmed = await showConfirm('Delete Asset', `Delete "${asset.original_name}"?`);
    if (confirmed) {
      await deleteAsset(asset.id);
    }
  });
}

function hideContextMenu() {
  contextMenuEl.classList.remove('show');
}

// ── Move-to-Folder Modal ──

function showMoveModal(asset) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  let folderOptions = `<div class="lib-move-folder-option${!asset.folder_id ? ' selected' : ''}" data-folder-id="root">Root (no folder)</div>`;
  for (const f of folders) {
    const isSelected = asset.folder_id === f.id;
    folderOptions += `<div class="lib-move-folder-option${isSelected ? ' selected' : ''}" data-folder-id="${f.id}">${escapeHtml(f.name)}</div>`;
  }

  overlay.innerHTML = `
    <div class="modal">
      <h2>Move "${escapeHtml(asset.original_name)}"</h2>
      <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px">Select destination folder:</p>
      <div class="lib-move-folder-list">${folderOptions}</div>
      <div class="modal-actions">
        <button class="btn" id="move-cancel">Cancel</button>
        <button class="btn btn-primary" id="move-confirm">Move</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  let selectedMoveTarget = asset.folder_id || null;

  // Bind folder option clicks
  overlay.querySelectorAll('.lib-move-folder-option').forEach(opt => {
    opt.addEventListener('click', () => {
      overlay.querySelectorAll('.lib-move-folder-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      const fid = opt.dataset.folderId;
      selectedMoveTarget = fid === 'root' ? null : fid;
    });
  });

  const cleanup = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  };

  overlay.querySelector('#move-cancel').addEventListener('click', cleanup);
  overlay.querySelector('#move-confirm').addEventListener('click', async () => {
    cleanup();
    await moveAsset(asset.id, selectedMoveTarget);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cleanup();
  });
}

// ── Navigation ──

async function selectFolder(folderId) {
  currentFolderId = folderId;
  searchQuery = '';
  searchInputEl.value = '';
  await loadAssets(folderId);
  renderFolderTree();
  renderAssetGrid();
  renderBreadcrumb();
}

async function refreshAll() {
  await Promise.all([loadFolders(), loadAssets(currentFolderId)]);
  renderFolderTree();
  renderAssetGrid();
  renderBreadcrumb();
}

// ── Drag & Drop ──

function setupDragDrop() {
  uploadZoneEl.addEventListener('click', (e) => {
    // Don't trigger file picker if clicking the progress bar
    if (e.target.closest('.lib-upload-progress')) return;
    uploadInputEl.click();
  });

  uploadInputEl.addEventListener('change', () => {
    if (uploadInputEl.files.length > 0) {
      handleUpload(uploadInputEl.files, currentFolderId);
      uploadInputEl.value = '';
    }
  });

  uploadZoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZoneEl.classList.add('drag-over');
  });

  uploadZoneEl.addEventListener('dragleave', (e) => {
    e.preventDefault();
    uploadZoneEl.classList.remove('drag-over');
  });

  uploadZoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZoneEl.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files, currentFolderId);
    }
  });

  // Also allow dropping on the whole main area
  const mainEl = document.querySelector('.lib-main');
  mainEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZoneEl.classList.add('drag-over');
  });

  mainEl.addEventListener('dragleave', (e) => {
    // Only remove if leaving the main area entirely
    if (!mainEl.contains(e.relatedTarget)) {
      uploadZoneEl.classList.remove('drag-over');
    }
  });

  mainEl.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZoneEl.classList.remove('drag-over');
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files, currentFolderId);
    }
  });
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

// ── Bootstrap ──

async function init() {
  // Auth gate
  if (!initAuth() || !isAuthenticated()) {
    window.location.href = '/';
    return;
  }

  // Cache DOM refs
  folderTreeEl = document.getElementById('folderTree');
  assetGridEl = document.getElementById('assetGrid');
  assetEmptyEl = document.getElementById('assetEmpty');
  breadcrumbEl = document.getElementById('breadcrumb');
  searchInputEl = document.getElementById('searchInput');
  uploadZoneEl = document.getElementById('uploadZone');
  uploadInputEl = document.getElementById('uploadInput');
  uploadProgressEl = document.getElementById('uploadProgress');
  uploadBarFillEl = document.getElementById('uploadBarFill');
  uploadStatusEl = document.getElementById('uploadStatus');
  contextMenuEl = document.getElementById('contextMenu');
  detailOverlayEl = document.getElementById('detailOverlay');
  detailPanelEl = document.getElementById('detailPanel');

  // Populate user info in top bar
  populateUserInfo();

  // Logout
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => logout());
  }

  // New folder button
  const btnNewFolder = document.getElementById('btnNewFolder');
  if (btnNewFolder) {
    btnNewFolder.addEventListener('click', async () => {
      const name = await showPrompt('New Folder', 'Folder name', '');
      if (name) {
        await createFolder(name, currentFolderId);
      }
    });
  }

  // Search
  searchInputEl.addEventListener('input', () => {
    searchQuery = searchInputEl.value.trim();
    renderAssetGrid();
  });

  // Close context menu on outside click
  document.addEventListener('click', (e) => {
    if (!contextMenuEl.contains(e.target)) {
      hideContextMenu();
    }
  });

  // Close detail overlay on outside click
  detailOverlayEl.addEventListener('click', (e) => {
    if (e.target === detailOverlayEl) {
      detailOverlayEl.classList.remove('show');
      selectedAssetId = null;
    }
  });

  // Escape key closes overlays
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
      if (detailOverlayEl.classList.contains('show')) {
        detailOverlayEl.classList.remove('show');
        selectedAssetId = null;
      }
    }
  });

  // Setup drag and drop
  setupDragDrop();

  // Load initial data
  await refreshAll();
}

// ── Start ──
init().catch((err) => {
  console.error('Library initialization failed:', err);
  showToast('Failed to initialize Graphics Library', 'error');
});
