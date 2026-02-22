/**
 * Templates page entry point.
 * Template management with folder tree, card grid, context menus.
 */
import { initAuth, isAuthenticated, getUser, getToken, logout, authenticatedFetch } from '/js/modules/auth.js';
import { showToast, showConfirm, showPrompt } from '/js/modules/ui.js';
import { createSkeleton } from '/js/shared/loading-spinner.js';

// ── State ──

let folders = [];
let templates = [];
let currentFolderId = null; // null = root / "All Templates"
let searchQuery = '';
let expandedFolders = new Set();

// ── DOM References ──

let folderTreeEl, templateGridEl, breadcrumbEl, searchInputEl;
let contextMenuEl;

// ── Type Icons (SVG) ──

const TYPE_ICONS = {
  leaderboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
  driver_card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  ticker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><polyline points="10 3 8 6 12 6"/><polyline points="14 21 16 18 12 18"/></svg>',
  lbar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 3v18h17"/><line x1="4" y1="14" x2="14" y2="14"/><line x1="4" y1="9" x2="11" y2="9"/></svg>',
  bug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="14" y="2" width="8" height="8" rx="1"/><rect x="2" y="2" width="20" height="20" rx="2" stroke-dasharray="4 2"/></svg>',
  fullscreen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
  custom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
};

// ── Utility ──

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function relativeTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

function getTypeIcon(overlayType) {
  return TYPE_ICONS[overlayType] || TYPE_ICONS.custom;
}

// ── Data Fetching ──

async function loadFolders() {
  try {
    const res = await authenticatedFetch('/api/overlays/template-folders');
    if (!res.ok) throw new Error('Failed to load folders');
    const data = await res.json();
    folders = data.folders || [];
  } catch (err) {
    console.error('Failed to load folders:', err);
    folders = [];
  }
}

async function loadTemplates() {
  try {
    const res = await authenticatedFetch('/api/overlays/templates');
    if (!res.ok) throw new Error('Failed to load templates');
    const data = await res.json();
    templates = data.templates || [];
  } catch (err) {
    console.error('Failed to load templates:', err);
    templates = [];
  }
}

async function createFolder(name, parentId) {
  try {
    const body = { name };
    if (parentId) body.parent_id = parentId;
    const res = await authenticatedFetch('/api/overlays/template-folders', {
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
    const res = await authenticatedFetch(`/api/overlays/template-folders/${id}`, {
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
    const res = await authenticatedFetch(`/api/overlays/template-folders/${id}`, {
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

async function createTemplate(templateData) {
  try {
    const res = await authenticatedFetch('/api/overlays/templates', {
      method: 'POST',
      body: JSON.stringify(templateData),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to create template');
    }
    const data = await res.json();
    return data.template;
  } catch (err) {
    console.error('Failed to create template:', err);
    showToast(err.message || 'Failed to create template', 'error');
    return null;
  }
}

async function renameTemplate(id, name) {
  try {
    const res = await authenticatedFetch(`/api/overlays/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to rename template');
    }
    showToast('Template renamed', 'success');
    await loadTemplates();
    renderTemplateGrid();
  } catch (err) {
    console.error('Failed to rename template:', err);
    showToast(err.message || 'Failed to rename template', 'error');
  }
}

async function deleteTemplate(id) {
  try {
    const res = await authenticatedFetch(`/api/overlays/templates/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete template');
    }
    showToast('Template deleted', 'success');
    await loadTemplates();
    renderTemplateGrid();
  } catch (err) {
    console.error('Failed to delete template:', err);
    showToast(err.message || 'Failed to delete template', 'error');
  }
}

async function duplicateTemplate(id) {
  try {
    const res = await authenticatedFetch(`/api/overlays/templates/${id}/duplicate`, {
      method: 'POST',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to duplicate template');
    }
    showToast('Template duplicated', 'success');
    await loadTemplates();
    renderTemplateGrid();
  } catch (err) {
    console.error('Failed to duplicate template:', err);
    showToast(err.message || 'Failed to duplicate template', 'error');
  }
}

async function moveTemplate(id, folderId) {
  try {
    const res = await authenticatedFetch(`/api/overlays/templates/${id}/move`, {
      method: 'PUT',
      body: JSON.stringify({ folder_id: folderId }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to move template');
    }
    showToast('Template moved', 'success');
    await loadTemplates();
    renderTemplateGrid();
  } catch (err) {
    console.error('Failed to move template:', err);
    showToast(err.message || 'Failed to move template', 'error');
  }
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

  // Root item: "All Templates"
  const rootSelected = currentFolderId === null ? ' selected' : '';
  html += `
    <div class="tmpl-folder-item">
      <div class="tmpl-folder-row${rootSelected}" data-folder-id="root">
        <span class="tmpl-folder-chevron empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
        </span>
        <svg class="tmpl-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/></svg>
        <span class="tmpl-folder-name">All Templates</span>
      </div>
    </div>
  `;

  html += renderFolderNodes(tree, 0);
  folderTreeEl.innerHTML = html;

  // Bind chevron clicks — toggle expand only (don't change selection)
  folderTreeEl.querySelectorAll('.tmpl-folder-chevron').forEach(chevron => {
    if (chevron.classList.contains('empty')) return;
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      const row = chevron.closest('.tmpl-folder-row');
      if (!row) return;
      const folderId = row.dataset.folderId;
      if (folderId === 'root') return;
      const id = parseInt(folderId, 10);
      if (expandedFolders.has(id)) {
        expandedFolders.delete(id);
      } else {
        expandedFolders.add(id);
      }
      renderFolderTree();
    });
  });

  // Bind row clicks — select folder (auto-expand if collapsed, never collapse)
  folderTreeEl.querySelectorAll('.tmpl-folder-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.tmpl-folder-actions') || e.target.closest('.tmpl-folder-action-btn')) return;
      if (e.target.closest('.tmpl-folder-chevron')) return; // handled above

      const folderId = row.dataset.folderId;
      if (folderId === 'root') {
        selectFolder(null);
      } else {
        const id = parseInt(folderId, 10);
        // Auto-expand when selecting, but never collapse
        if (!expandedFolders.has(id)) {
          expandedFolders.add(id);
        }
        selectFolder(id);
      }
    });
  });

  // Bind rename/delete buttons
  folderTreeEl.querySelectorAll('.tmpl-folder-action-btn[data-action="rename"]').forEach(btn => {
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

  folderTreeEl.querySelectorAll('.tmpl-folder-action-btn[data-action="delete"]').forEach(btn => {
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

  // Drag-and-drop: folders as drop targets for templates
  folderTreeEl.querySelectorAll('.tmpl-folder-row').forEach(row => {
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
      const templateId = e.dataTransfer.getData('text/template-id');
      if (!templateId) return;
      const folderId = row.dataset.folderId;
      const targetFolderId = folderId === 'root' ? null : parseInt(folderId, 10);
      await moveTemplate(parseInt(templateId, 10), targetFolderId);
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
      <div class="tmpl-folder-item">
        <div class="tmpl-folder-row${isSelected ? ' selected' : ''}" data-folder-id="${node.id}" style="padding-left: ${10 + depth * 16}px">
          <span class="tmpl-folder-chevron${isExpanded ? ' open' : ''}${!hasChildren ? ' empty' : ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
          <svg class="tmpl-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/></svg>
          <span class="tmpl-folder-name">${escapeHtml(node.name)}</span>
          <span class="tmpl-folder-actions">
            <button class="tmpl-folder-action-btn" data-action="rename" data-folder-id="${node.id}" title="Rename">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="tmpl-folder-action-btn danger" data-action="delete" data-folder-id="${node.id}" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </span>
        </div>
        ${hasChildren ? `<div class="tmpl-folder-children${isExpanded ? ' open' : ''}">${renderFolderNodes(node.children, depth + 1)}</div>` : ''}
      </div>
    `;
  }
  return html;
}

// ── Rendering: Template Grid ──

function showSkeletonGrid() {
  let html = '';
  for (let i = 0; i < 8; i++) {
    html += `
      <div class="tmpl-card" style="pointer-events: none;">
        <div class="tmpl-card-thumb" style="background: #1a1d2e;">
          ${createSkeleton({ width: '100%', height: 180 }).outerHTML}
        </div>
        <div class="tmpl-card-info" style="padding: 12px;">
          ${createSkeleton({ width: '80%', height: 16, borderRadius: 4 }).outerHTML}
          <div style="margin-top: 8px; display: flex; gap: 6px;">
            ${createSkeleton({ width: 60, height: 12, borderRadius: 3 }).outerHTML}
            ${createSkeleton({ width: 50, height: 12, borderRadius: 3 }).outerHTML}
          </div>
        </div>
      </div>
    `;
  }
  templateGridEl.innerHTML = html;
}

function renderTemplateGrid() {
  // Filter by current folder
  let filtered = templates.filter(t => {
    if (currentFolderId === null) return true;
    return t.folder_id === currentFolderId;
  });

  // Apply search filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(t =>
      (t.name || '').toLowerCase().includes(q) ||
      (t.overlay_type || '').toLowerCase().includes(q)
    );
  }

  if (filtered.length === 0) {
    templateGridEl.innerHTML = `
      <div class="tmpl-empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
        <span>${searchQuery ? 'No templates match your search' : 'No templates in this folder'}</span>
        <span style="font-size:0.75rem; color:var(--text-dim)">${searchQuery ? 'Try a different search term' : 'Click "+ New Template" to get started'}</span>
      </div>
    `;
    return;
  }

  let html = '';
  for (const tmpl of filtered) {
    const iconSvg = getTypeIcon(tmpl.overlay_type);
    const dims = (tmpl.canvas_width && tmpl.canvas_height)
      ? `${tmpl.canvas_width}x${tmpl.canvas_height}`
      : '';
    const timeStr = relativeTime(tmpl.updated_at || tmpl.created_at);

    const thumbContent = tmpl.thumbnail
      ? `<img src="${tmpl.thumbnail}" alt="" loading="lazy">`
      : iconSvg;

    html += `
      <div class="tmpl-card" data-template-id="${tmpl.id}" draggable="true">
        <button class="tmpl-card-dots" data-template-id="${tmpl.id}" title="More actions">&#8943;</button>
        <div class="tmpl-card-thumb">
          ${thumbContent}
        </div>
        <div class="tmpl-card-info">
          <div class="tmpl-card-name" title="${escapeHtml(tmpl.name)}">${escapeHtml(tmpl.name)}</div>
          <div class="tmpl-card-meta">
            <span class="tmpl-type-badge">${escapeHtml(tmpl.overlay_type || 'custom')}</span>
            ${dims ? `<span>${dims}</span>` : ''}
            <span>${timeStr}</span>
          </div>
        </div>
      </div>
    `;
  }

  templateGridEl.innerHTML = html;

  // Bind card click -> open in builder
  templateGridEl.querySelectorAll('.tmpl-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.tmpl-card-dots')) return;
      const templateId = card.dataset.templateId;
      window.location.href = `/builder/${templateId}`;
    });

    // Drag-and-drop: template cards as drag sources
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/template-id', card.dataset.templateId);
      e.dataTransfer.effectAllowed = 'move';
    });
  });

  // Bind three-dot menu
  templateGridEl.querySelectorAll('.tmpl-card-dots').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const templateId = parseInt(btn.dataset.templateId, 10);
      const tmpl = templates.find(t => t.id === templateId);
      if (tmpl) showContextMenu(e, tmpl);
    });
  });

  // Bind right-click
  templateGridEl.querySelectorAll('.tmpl-card').forEach(card => {
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const templateId = parseInt(card.dataset.templateId, 10);
      const tmpl = templates.find(t => t.id === templateId);
      if (tmpl) showContextMenu(e, tmpl);
    });
  });
}

// ── Rendering: Breadcrumb ──

function renderBreadcrumb() {
  if (!currentFolderId) {
    breadcrumbEl.innerHTML = '<span class="tmpl-breadcrumb-item current">All Templates</span>';
    return;
  }

  const path = getFolderPath(currentFolderId);
  let html = '<span class="tmpl-breadcrumb-item" data-folder-id="root">All Templates</span>';

  for (let i = 0; i < path.length; i++) {
    html += '<span class="tmpl-breadcrumb-sep">/</span>';
    const isLast = i === path.length - 1;
    html += `<span class="tmpl-breadcrumb-item${isLast ? ' current' : ''}" data-folder-id="${path[i].id}">${escapeHtml(path[i].name)}</span>`;
  }

  breadcrumbEl.innerHTML = html;

  // Bind breadcrumb clicks
  breadcrumbEl.querySelectorAll('.tmpl-breadcrumb-item:not(.current)').forEach(item => {
    item.addEventListener('click', () => {
      const folderId = item.dataset.folderId;
      selectFolder(folderId === 'root' ? null : parseInt(folderId, 10));
    });
  });
}

// ── Context Menu ──

function showContextMenu(e, template) {
  contextMenuEl.innerHTML = `
    <div class="tmpl-context-item" data-action="open">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Open in Builder
    </div>
    <div class="tmpl-context-item" data-action="rename">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      Rename
    </div>
    <div class="tmpl-context-item" data-action="duplicate">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
      Duplicate
    </div>
    <div class="tmpl-context-item" data-action="move">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-2H5a2 2 0 0 0-2 2z"/></svg>
      Move to Folder
    </div>
    <div class="tmpl-context-separator"></div>
    <div class="tmpl-context-item danger" data-action="delete">
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
  contextMenuEl.querySelector('[data-action="open"]').addEventListener('click', () => {
    hideContextMenu();
    window.location.href = `/builder/${template.id}`;
  });

  contextMenuEl.querySelector('[data-action="rename"]').addEventListener('click', async () => {
    hideContextMenu();
    const newName = await showPrompt('Rename Template', 'Template name', template.name);
    if (newName && newName !== template.name) {
      await renameTemplate(template.id, newName);
    }
  });

  contextMenuEl.querySelector('[data-action="duplicate"]').addEventListener('click', async () => {
    hideContextMenu();
    await duplicateTemplate(template.id);
  });

  contextMenuEl.querySelector('[data-action="move"]').addEventListener('click', () => {
    hideContextMenu();
    showMoveModal(template);
  });

  contextMenuEl.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    hideContextMenu();
    const confirmed = await showConfirm('Delete Template', `Delete "${template.name}"? This cannot be undone.`);
    if (confirmed) {
      await deleteTemplate(template.id);
    }
  });
}

function hideContextMenu() {
  contextMenuEl.classList.remove('show');
}

// ── Move-to-Folder Modal ──

function showMoveModal(template) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  let folderOptions = `<div class="tmpl-move-folder-option${!template.folder_id ? ' selected' : ''}" data-folder-id="root">Root (no folder)</div>`;
  for (const f of folders) {
    const isSelected = template.folder_id === f.id;
    folderOptions += `<div class="tmpl-move-folder-option${isSelected ? ' selected' : ''}" data-folder-id="${f.id}">${escapeHtml(f.name)}</div>`;
  }

  overlay.innerHTML = `
    <div class="modal">
      <h2>Move "${escapeHtml(template.name)}"</h2>
      <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:8px">Select destination folder:</p>
      <div class="tmpl-move-folder-list">${folderOptions}</div>
      <div class="modal-actions">
        <button class="btn" id="move-cancel">Cancel</button>
        <button class="btn btn-primary" id="move-confirm">Move</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('show'));

  let selectedMoveTarget = template.folder_id || null;

  // Bind folder option clicks
  overlay.querySelectorAll('.tmpl-move-folder-option').forEach(opt => {
    opt.addEventListener('click', () => {
      overlay.querySelectorAll('.tmpl-move-folder-option').forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      const fid = opt.dataset.folderId;
      selectedMoveTarget = fid === 'root' ? null : parseInt(fid, 10);
    });
  });

  const cleanup = () => {
    overlay.classList.remove('show');
    setTimeout(() => overlay.remove(), 200);
  };

  overlay.querySelector('#move-cancel').addEventListener('click', cleanup);
  overlay.querySelector('#move-confirm').addEventListener('click', async () => {
    cleanup();
    await moveTemplate(template.id, selectedMoveTarget);
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
  renderFolderTree();
  renderTemplateGrid();
  renderBreadcrumb();
}

async function refreshAll() {
  showSkeletonGrid();
  await Promise.all([loadFolders(), loadTemplates()]);
  renderFolderTree();
  renderTemplateGrid();
  renderBreadcrumb();
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
  templateGridEl = document.getElementById('templateGrid');
  breadcrumbEl = document.getElementById('breadcrumb');
  searchInputEl = document.getElementById('searchInput');
  contextMenuEl = document.getElementById('contextMenu');

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

  // New template button
  const btnNewTemplate = document.getElementById('btnNewTemplate');
  if (btnNewTemplate) {
    btnNewTemplate.addEventListener('click', async () => {
      const newTemplate = await createTemplate({
        name: 'Untitled Template',
        overlay_type: 'custom',
        template_data: {
          elements: [],
          groups: [],
          canvas: { width: 1920, height: 1080 },
          version: 1,
        },
        canvas_width: 1920,
        canvas_height: 1080,
        folder_id: currentFolderId,
      });
      if (newTemplate && newTemplate.id) {
        window.location.href = `/builder/${newTemplate.id}`;
      }
    });
  }

  // Search
  searchInputEl.addEventListener('input', () => {
    searchQuery = searchInputEl.value.trim();
    renderTemplateGrid();
  });

  // Close context menu on outside click
  document.addEventListener('click', (e) => {
    if (!contextMenuEl.contains(e.target)) {
      hideContextMenu();
    }
  });

  // Escape key closes context menu
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
    }
  });

  // Load initial data
  await refreshAll();
}

// ── Start ──
init().catch((err) => {
  console.error('Templates initialization failed:', err);
  showToast('Failed to initialize Templates page', 'error');
});
