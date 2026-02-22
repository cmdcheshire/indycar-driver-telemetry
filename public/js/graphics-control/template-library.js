/**
 * Template Library -- bottom-left panel.
 * Displays available overlay templates in a folder tree + card list layout.
 * Supports drag-and-drop for organising templates into folders.
 */

import { authenticatedFetch } from '/js/modules/auth.js';
import { showToast } from '/js/modules/ui.js';

let callbacks = { onAddToRundown: null };
let allTemplates = [];
let templateFolders = [];
let selectedFolderId = null; // null = all templates
let expandedFolders = new Set();

// Cached DOM refs
let treeEl = null;
let listEl = null;
let newFolderBtn = null;

// ── Public API ──

export function initTemplateLibrary({ onAddToRundown }) {
  callbacks.onAddToRundown = onAddToRundown;

  treeEl = document.getElementById('templateTree');
  listEl = document.getElementById('templateList');
  newFolderBtn = document.getElementById('templateNewFolder');

  if (newFolderBtn) {
    newFolderBtn.addEventListener('click', handleNewFolder);
  }

  // Fetch folders on init
  fetchFolders();
}

export function renderTemplateLibrary(templates) {
  allTemplates = templates || [];
  renderTree();
  renderTemplateCards();
}

// ── Folder fetching ──

async function fetchFolders() {
  try {
    const res = await authenticatedFetch('/api/overlays/template-folders');
    if (res.ok) {
      const data = await res.json();
      templateFolders = data.folders || [];
      renderTree();
      renderTemplateCards();
    }
  } catch (err) {
    console.error('Failed to fetch template folders:', err);
  }
}

// ── Folder tree ──

function buildFolderTree(folderList) {
  const map = {};
  const roots = [];
  for (const f of folderList) map[f.id] = { ...f, children: [] };
  for (const f of folderList) {
    if (f.parent_id && map[f.parent_id]) map[f.parent_id].children.push(map[f.id]);
    else roots.push(map[f.id]);
  }
  return roots;
}

function renderTree() {
  if (!treeEl) return;

  const roots = buildFolderTree(templateFolders);

  let html = '';

  // Root "All Templates" row
  const allSelected = selectedFolderId === null ? ' selected' : '';
  html += `<div class="gc-tmpl-folder-item">
    <div class="gc-tmpl-folder-row${allSelected}" data-folder-id="__all__"
         draggable="false">
      <span class="gc-tmpl-folder-chevron empty"></span>
      <span class="gc-tmpl-folder-name">All Templates</span>
    </div>
  </div>`;

  html += renderFolderNodes(roots, 0);

  treeEl.innerHTML = html;

  // Wire events
  wireTreeEvents();
}

function renderFolderNodes(nodes, depth) {
  let html = '';
  for (const node of nodes) {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedFolders.has(node.id);
    const isSelected = selectedFolderId === node.id;

    const chevronClass = hasChildren
      ? `gc-tmpl-folder-chevron${isExpanded ? ' open' : ''}`
      : 'gc-tmpl-folder-chevron empty';

    const rowClass = `gc-tmpl-folder-row${isSelected ? ' selected' : ''}`;
    const childrenClass = `gc-tmpl-folder-children${isExpanded ? ' open' : ''}`;

    const chevronSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>`;

    html += `<div class="gc-tmpl-folder-item" style="padding-left: ${depth * 14}px">
      <div class="${rowClass}" data-folder-id="${node.id}">
        <span class="${chevronClass}" data-chevron-folder="${node.id}">${hasChildren ? chevronSvg : ''}</span>
        <span class="gc-tmpl-folder-name">${escapeHtml(node.name)}</span>
      </div>`;

    if (hasChildren) {
      html += `<div class="${childrenClass}" data-children-folder="${node.id}">`;
      html += renderFolderNodes(node.children, depth + 1);
      html += `</div>`;
    }

    html += `</div>`;
  }
  return html;
}

function wireTreeEvents() {
  if (!treeEl) return;

  // Click on folder rows -- select or toggle chevron
  treeEl.addEventListener('click', (e) => {
    // Check if chevron was clicked
    const chevron = e.target.closest('.gc-tmpl-folder-chevron');
    if (chevron && !chevron.classList.contains('empty')) {
      const folderId = parseInt(chevron.dataset.chevronFolder, 10);
      if (expandedFolders.has(folderId)) {
        expandedFolders.delete(folderId);
      } else {
        expandedFolders.add(folderId);
      }
      renderTree();
      return;
    }

    // Otherwise, select the folder row
    const row = e.target.closest('.gc-tmpl-folder-row');
    if (!row) return;

    const fId = row.dataset.folderId;
    if (fId === '__all__') {
      selectedFolderId = null;
    } else {
      selectedFolderId = parseInt(fId, 10);
    }

    renderTree();
    renderTemplateCards();
  });

  // Drag-and-drop on folder rows
  const folderRows = treeEl.querySelectorAll('.gc-tmpl-folder-row');
  folderRows.forEach(row => {
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

      const fId = row.dataset.folderId;
      const targetFolderId = fId === '__all__' ? null : parseInt(fId, 10);

      try {
        const res = await authenticatedFetch(`/api/overlays/templates/${templateId}/move`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folder_id: targetFolderId }),
        });

        if (res.ok) {
          // Update local state
          const tmpl = allTemplates.find(t => t.id === parseInt(templateId, 10));
          if (tmpl) tmpl.folder_id = targetFolderId;
          renderTemplateCards();
          showToast('Template moved', 'success');
        } else {
          showToast('Failed to move template', 'error');
        }
      } catch (err) {
        console.error('Failed to move template:', err);
        showToast('Failed to move template', 'error');
      }
    });
  });
}

// ── Template cards ──

function renderTemplateCards() {
  if (!listEl) return;

  const filtered = selectedFolderId === null
    ? allTemplates
    : allTemplates.filter(t => t.folder_id === selectedFolderId);

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="gc-empty-state" style="grid-column: 1 / -1;">
        <span>${allTemplates.length === 0 ? 'No templates available' : 'No templates in this folder'}</span>
      </div>
    `;
    return;
  }

  let html = '';
  for (const t of filtered) {
    html += `<div class="gc-template-card" data-template-id="${t.id}" draggable="true">
      <div class="gc-template-card-name">${escapeHtml(t.name)}</div>
      <div class="gc-template-card-meta">
        <span class="gc-type-badge">${escapeHtml(formatTypeName(t.overlay_type))}</span>
      </div>
    </div>`;
  }

  listEl.innerHTML = html;

  // Wire click + drag handlers
  listEl.querySelectorAll('.gc-template-card').forEach(card => {
    card.addEventListener('click', () => {
      const templateId = parseInt(card.dataset.templateId, 10);
      if (callbacks.onAddToRundown) {
        callbacks.onAddToRundown(templateId);
      }
    });

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/template-id', card.dataset.templateId);
    });
  });
}

// ── New folder ──

async function handleNewFolder() {
  const name = window.prompt('New folder name:');
  if (!name || !name.trim()) return;

  const parentId = selectedFolderId;

  try {
    const res = await authenticatedFetch('/api/overlays/template-folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), parent_id: parentId }),
    });

    if (res.ok) {
      showToast('Folder created', 'success');
      await fetchFolders();
    } else {
      showToast('Failed to create folder', 'error');
    }
  } catch (err) {
    console.error('Failed to create folder:', err);
    showToast('Failed to create folder', 'error');
  }
}

// ── Utilities ──

function formatTypeName(type) {
  if (!type) return '';
  // Convert snake_case or kebab-case to Title Case
  return type
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
