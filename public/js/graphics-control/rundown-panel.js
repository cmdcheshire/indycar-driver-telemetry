/**
 * Rundown Panel -- main area.
 * Displays and manages the ordered list of graphics for the selected output instance.
 * Supports take on/off, reorder via drag-and-drop, and item removal.
 */
import { authenticatedFetch } from '/js/modules/auth.js';
import { showToast, showConfirm } from '/js/modules/ui.js';

let callbacks = { onRefresh: null };
let currentInstanceId = null;
let dragSourceIndex = null;

// ── SVG Icons ──

const ICONS = {
  dragHandle: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
};

// ── Public API ──

export function initRundownPanel({ onRefresh }) {
  callbacks.onRefresh = onRefresh;

  // Wire up Add Graphic button
  const addBtn = document.getElementById('btnAddGraphic');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      // Scroll the template library into view and flash it
      const templateLib = document.querySelector('.gc-template-library');
      if (templateLib) {
        templateLib.style.outline = '2px solid var(--accent)';
        setTimeout(() => { templateLib.style.outline = ''; }, 1500);
      }
    });
  }
}

export function renderRundown(instanceId, items) {
  currentInstanceId = instanceId;

  const titleEl = document.getElementById('rundownTitle');
  const listEl = document.getElementById('rundownList');
  const addBtn = document.getElementById('btnAddGraphic');

  if (!listEl) return;

  // Update title -- we may not have the instance name here, so just show "Rundown"
  if (titleEl) {
    titleEl.textContent = 'Rundown';
  }

  if (addBtn) {
    addBtn.classList.remove('hidden');
  }

  if (!items || items.length === 0) {
    listEl.innerHTML = `
      <div class="gc-rundown-empty">
        <div class="gc-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          <span>No graphics in rundown. Click "+ Add Graphic" or select a template below.</span>
        </div>
      </div>
    `;
    return;
  }

  // Sort items by sort_order
  const sorted = [...items].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  let html = '';
  sorted.forEach((item, index) => {
    const isOnAir = item.is_on_air === true || item.is_on_air === 1;
    const typeBadge = item.overlay_type
      ? `<span class="gc-type-badge">${escapeHtml(item.overlay_type)}</span>`
      : '';

    html += `
      <div class="gc-rundown-item ${isOnAir ? 'on-air' : ''}"
           data-item-id="${item.id}"
           data-index="${index}"
           draggable="true">
        <div class="gc-drag-handle" title="Drag to reorder">${ICONS.dragHandle}</div>
        <div class="gc-rundown-info">
          <span class="gc-rundown-template-name">${escapeHtml(item.template_name || 'Unknown Template')}</span>
          ${typeBadge}
        </div>
        <div class="gc-rundown-controls">
          <button class="gc-btn-cue" data-action="cue" data-item-id="${item.id}" title="Cue (load)">CUE</button>
          <button class="gc-btn-take-on" data-action="take-on" data-item-id="${item.id}" title="Take On Air">TAKE ON</button>
          <button class="gc-btn-take-off" data-action="take-off" data-item-id="${item.id}" title="Take Off Air">TAKE OFF</button>
          <div class="gc-rundown-on-air ${isOnAir ? 'active' : ''}" title="${isOnAir ? 'ON AIR' : 'Off'}"></div>
          <button class="gc-btn-remove" data-action="remove" data-item-id="${item.id}" title="Remove from rundown">${ICONS.remove}</button>
        </div>
      </div>
    `;
  });

  listEl.innerHTML = html;

  // Wire up button clicks
  listEl.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const itemId = parseInt(btn.dataset.itemId, 10);

      if (action === 'cue') handleCue(itemId);
      else if (action === 'take-on') handleTakeOn(itemId);
      else if (action === 'take-off') handleTakeOff(itemId);
      else if (action === 'remove') handleRemove(itemId);
    });
  });

  // Wire up drag and drop
  setupDragAndDrop(listEl, sorted);
}

export function clearRundown() {
  currentInstanceId = null;

  const titleEl = document.getElementById('rundownTitle');
  const listEl = document.getElementById('rundownList');
  const addBtn = document.getElementById('btnAddGraphic');

  if (titleEl) titleEl.textContent = 'Select an Output';
  if (addBtn) addBtn.classList.add('hidden');

  if (listEl) {
    listEl.innerHTML = `
      <div class="gc-rundown-empty">
        <div class="gc-empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
          <span>Select an output from the left panel to view its rundown</span>
        </div>
      </div>
    `;
  }
}

// ── Take Actions ──

async function handleCue(itemId) {
  try {
    const res = await authenticatedFetch(`/api/overlays/rundown/${itemId}/take`, {
      method: 'POST',
      body: JSON.stringify({ action: 'on' }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to cue graphic');
    }

    showToast('Graphic cued', 'success');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to cue graphic:', err);
    showToast(err.message || 'Failed to cue graphic', 'error');
  }
}

async function handleTakeOn(itemId) {
  try {
    const res = await authenticatedFetch(`/api/overlays/rundown/${itemId}/take`, {
      method: 'POST',
      body: JSON.stringify({ action: 'on' }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to take on');
    }

    showToast('Graphic taken ON AIR', 'success');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to take on:', err);
    showToast(err.message || 'Failed to take on', 'error');
  }
}

async function handleTakeOff(itemId) {
  try {
    const res = await authenticatedFetch(`/api/overlays/rundown/${itemId}/take`, {
      method: 'POST',
      body: JSON.stringify({ action: 'off' }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to take off');
    }

    showToast('Graphic taken OFF AIR', 'info');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to take off:', err);
    showToast(err.message || 'Failed to take off', 'error');
  }
}

async function handleRemove(itemId) {
  const confirmed = await showConfirm('Remove Graphic', 'Remove this graphic from the rundown?');
  if (!confirmed) return;

  try {
    const res = await authenticatedFetch(`/api/overlays/rundown/${itemId}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to remove graphic');
    }

    showToast('Graphic removed', 'success');
    if (callbacks.onRefresh) await callbacks.onRefresh();
  } catch (err) {
    console.error('Failed to remove graphic:', err);
    showToast(err.message || 'Failed to remove graphic', 'error');
  }
}

// ── Drag and Drop Reorder ──

function setupDragAndDrop(listEl, items) {
  const rows = listEl.querySelectorAll('.gc-rundown-item');

  rows.forEach((row, index) => {
    row.addEventListener('dragstart', (e) => {
      dragSourceIndex = index;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      rows.forEach(r => r.classList.remove('drag-over'));
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Clear all drag-over classes
      rows.forEach(r => r.classList.remove('drag-over'));
      if (index !== dragSourceIndex) {
        row.classList.add('drag-over');
      }
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      rows.forEach(r => r.classList.remove('drag-over'));

      const fromIndex = dragSourceIndex;
      const toIndex = index;

      if (fromIndex === null || fromIndex === toIndex) return;

      // Swap sort orders
      const fromItem = items[fromIndex];
      const toItem = items[toIndex];

      if (!fromItem || !toItem) return;

      try {
        // Update the moved item's sort_order to the target position
        await authenticatedFetch(`/api/overlays/rundown/${fromItem.id}`, {
          method: 'PUT',
          body: JSON.stringify({ sort_order: toItem.sort_order }),
        });

        // Update the displaced item's sort_order
        await authenticatedFetch(`/api/overlays/rundown/${toItem.id}`, {
          method: 'PUT',
          body: JSON.stringify({ sort_order: fromItem.sort_order }),
        });

        if (callbacks.onRefresh) await callbacks.onRefresh();
      } catch (err) {
        console.error('Failed to reorder:', err);
        showToast('Failed to reorder items', 'error');
      }

      dragSourceIndex = null;
    });
  });
}

// ── Utilities ──

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
