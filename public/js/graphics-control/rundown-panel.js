/**
 * Rundown Panel -- main area.
 * Displays and manages the ordered list of graphics for the selected output instance.
 * Supports take on/off, cue, reorder via drag-and-drop, item removal,
 * per-item config overrides, inline rename, and output URL display.
 */
import { authenticatedFetch } from '/js/modules/auth.js';
import { showToast, showConfirm } from '/js/modules/ui.js';
import { getSettingDef, EXPOSABLE_SETTINGS } from '/js/shared/exposed-settings.js';

let callbacks = { onRefresh: null };
let currentInstanceId = null;
let dragSourceIndex = null;

// ── SVG Icons ──

const ICONS = {
  dragHandle: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
  remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
};

// ── Public API ──

export function initRundownPanel({ onRefresh }) {
  callbacks.onRefresh = onRefresh;

  // Wire up Add Graphic button
  const addBtn = document.getElementById('btnAddGraphic');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      const templateLib = document.querySelector('.gc-template-library');
      if (templateLib) {
        templateLib.style.outline = '2px solid var(--accent)';
        setTimeout(() => { templateLib.style.outline = ''; }, 1500);
      }
    });
  }

  // Wire up URL copy button
  const copyBtn = document.getElementById('urlCopyBtn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const urlInput = document.getElementById('urlInput');
      if (urlInput && urlInput.value) {
        navigator.clipboard.writeText(urlInput.value).then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        }).catch(() => {
          // Fallback: select + copy
          urlInput.select();
          document.execCommand('copy');
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        });
      }
    });
  }
}

export function renderRundown(instanceId, items, overlayUrl) {
  currentInstanceId = instanceId;

  const titleEl = document.getElementById('rundownTitle');
  const listEl = document.getElementById('rundownList');
  const addBtn = document.getElementById('btnAddGraphic');
  const urlBar = document.getElementById('urlBar');
  const urlInput = document.getElementById('urlInput');

  if (!listEl) return;

  if (titleEl) {
    titleEl.textContent = 'Rundown';
  }

  if (addBtn) {
    addBtn.classList.remove('hidden');
  }

  // Show URL bar with overlay URL
  if (urlBar && urlInput && overlayUrl) {
    urlBar.classList.remove('hidden');
    urlInput.value = overlayUrl;
  } else if (urlBar) {
    urlBar.classList.add('hidden');
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
    const typeBadge = item.template_name
      ? `<span class="gc-type-badge">${escapeHtml(item.template_name)}</span>`
      : '';

    // Use displayName from config_overrides if set, otherwise template_name
    const config = item.config_overrides || {};
    const displayName = config.displayName || item.template_name || 'Unknown Template';

    // Exposed element overrides
    const elementOverrides = config.elementOverrides || {};
    const exposedElements = item.exposed_elements || [];

    // Build exposed element rows with proper controls per setting
    let exposedHtml = '';
    if (exposedElements.length > 0) {
      exposedHtml = '<div class="gc-config-divider">Exposed Elements</div>';
      for (const el of exposedElements) {
        const override = elementOverrides[el.id] || {};
        const settings = el.exposedSettings || [];
        const defaults = el.defaults || {};

        // If no explicit exposed settings, fall back to all available settings for the type
        const effectiveSettings = settings.length > 0
          ? settings
          : (EXPOSABLE_SETTINGS[el.type] || []).map(s => s.key);

        exposedHtml += `<div class="gc-exposed-group"><span class="gc-exposed-group-label">${escapeHtml(el.name)}</span>`;
        for (const settingKey of effectiveSettings) {
          const def = getSettingDef(el.type, settingKey);
          if (!def) continue;

          const currentVal = override[settingKey] !== undefined ? override[settingKey] : (defaults[settingKey] || el.props?.[settingKey] || '');

          if (def.inputType === 'carSelector') {
            // Two-part car selector: mode dropdown + conditional secondary input
            const rawVal = String(currentVal);
            let carBase = rawVal;
            let carSec = '';
            const ci = rawVal.indexOf(':');
            if (ci !== -1) { carBase = rawVal.substring(0, ci); carSec = rawVal.substring(ci + 1); }

            const carBaseOptions = [
              { value: '', label: '-- None --' },
              { value: 'target1', label: 'Target 1 (Primary)' },
              { value: 'target2', label: 'Target 2 (Secondary)' },
              { value: 'target3', label: 'Target 3 (Tertiary)' },
              { value: 'byRank', label: 'By Position' },
              { value: 'byCar', label: 'By Car Number' },
            ];
            const carOpts = carBaseOptions.map(o =>
              `<option value="${escapeHtml(o.value)}"${carBase === o.value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
            ).join('');

            let secHtml = '';
            if (carBase === 'byRank') {
              secHtml = `<input type="number" class="gc-car-secondary" min="1" max="40" step="1" value="${parseInt(carSec, 10) || 1}" style="width:56px;flex:none;padding:4px 6px;background:var(--surface-2,#2a2d35);border:1px solid var(--border,#3a3d45);border-radius:4px;color:var(--text,#e8eaed);font-size:0.8rem;">`;
            } else if (carBase === 'byCar') {
              secHtml = `<input type="text" class="gc-car-secondary" placeholder="Car #" value="${escapeHtml(carSec)}" style="width:56px;flex:none;padding:4px 6px;background:var(--surface-2,#2a2d35);border:1px solid var(--border,#3a3d45);border-radius:4px;color:var(--text,#e8eaed);font-size:0.8rem;">`;
            }

            exposedHtml += `
              <div class="gc-config-row gc-car-selector-row" data-element-id="${el.id}" data-item-id="${item.id}">
                <span class="gc-config-label">${escapeHtml(def.label)}</span>
                <div style="display:flex;gap:4px;flex:1;min-width:0;align-items:center;">
                  <select class="gc-car-base" style="flex:1;min-width:0;padding:4px 6px;background:var(--surface-2,#2a2d35);border:1px solid var(--border,#3a3d45);border-radius:4px;color:var(--text,#e8eaed);font-size:0.8rem;">${carOpts}</select>
                  <span class="gc-car-secondary-wrap">${secHtml}</span>
                  <input type="hidden" class="gc-exposed-input gc-car-combined"
                         data-element-id="${el.id}" data-prop-key="${settingKey}" data-item-id="${item.id}"
                         value="${escapeHtml(rawVal)}">
                </div>
              </div>`;
          } else if (def.inputType === 'color') {
            exposedHtml += `
              <div class="gc-config-row">
                <span class="gc-config-label">${escapeHtml(def.label)}</span>
                <input type="color" class="gc-config-input gc-exposed-input"
                       data-element-id="${el.id}" data-prop-key="${settingKey}" data-item-id="${item.id}"
                       value="${escapeHtml(String(currentVal || '#ffffff'))}">
              </div>`;
          } else if (def.inputType === 'number') {
            exposedHtml += `
              <div class="gc-config-row">
                <span class="gc-config-label">${escapeHtml(def.label)}</span>
                <input type="number" class="gc-config-input gc-exposed-input"
                       data-element-id="${el.id}" data-prop-key="${settingKey}" data-item-id="${item.id}"
                       min="${def.min || 0}" max="${def.max || 999}" step="${def.step || 1}"
                       value="${currentVal}">
              </div>`;
          } else if (def.inputType === 'select' && def.options) {
            const opts = def.options.map(o =>
              `<option value="${escapeHtml(o.value)}"${String(currentVal) === String(o.value) ? ' selected' : ''}>${escapeHtml(o.label)}</option>`
            ).join('');
            exposedHtml += `
              <div class="gc-config-row">
                <span class="gc-config-label">${escapeHtml(def.label)}</span>
                <select class="gc-config-input gc-exposed-input"
                        data-element-id="${el.id}" data-prop-key="${settingKey}" data-item-id="${item.id}"
                       >${opts}</select>
              </div>`;
          } else if (def.inputType === 'textarea') {
            exposedHtml += `
              <div class="gc-config-row" style="align-items:flex-start">
                <span class="gc-config-label">${escapeHtml(def.label)}</span>
                <textarea class="gc-config-input gc-exposed-input"
                          data-element-id="${el.id}" data-prop-key="${settingKey}" data-item-id="${item.id}"
                          rows="2" style="resize:vertical;">${escapeHtml(String(currentVal))}</textarea>
              </div>`;
          } else {
            exposedHtml += `
              <div class="gc-config-row">
                <span class="gc-config-label">${escapeHtml(def.label)}</span>
                <input type="text" class="gc-config-input gc-exposed-input"
                       data-element-id="${el.id}" data-prop-key="${settingKey}" data-item-id="${item.id}"
                       placeholder="${escapeHtml(String(defaults[settingKey] || ''))}"
                       value="${escapeHtml(String(currentVal))}">
              </div>`;
          }
        }
        exposedHtml += '</div>';
      }
    }

    html += `
      <div class="gc-rundown-item-wrapper" data-item-id="${item.id}">
        <div class="gc-rundown-item ${isOnAir ? 'on-air' : ''}"
             data-item-id="${item.id}"
             data-index="${index}"
             draggable="true">
          <div class="gc-drag-handle" title="Drag to reorder">${ICONS.dragHandle}</div>
          <div class="gc-rundown-info">
            <span class="gc-rundown-template-name"
                  data-item-id="${item.id}"
                  data-original-name="${escapeHtml(item.template_name || 'Unknown Template')}"
                  title="Double-click to rename">${escapeHtml(displayName)}</span>
            ${typeBadge}
          </div>
          <div class="gc-rundown-controls">
            <button class="gc-btn-config" data-action="config" data-item-id="${item.id}" title="Configure">${ICONS.gear}</button>
            <button class="gc-btn-cue" data-action="cue" data-item-id="${item.id}" title="Cue (load without showing)">CUE</button>
            <button class="gc-btn-take-on" data-action="take-on" data-item-id="${item.id}" title="Take On Air">TAKE ON</button>
            <button class="gc-btn-take-off" data-action="take-off" data-item-id="${item.id}" title="Take Off Air">TAKE OFF</button>
            <button class="gc-btn-resume ${isOnAir ? '' : 'hidden'}" data-action="resume" data-item-id="${item.id}" title="Resume (advance past pause point)">RESUME</button>
            <div class="gc-rundown-on-air ${isOnAir ? 'active' : ''}" title="${isOnAir ? 'ON AIR' : 'Off'}"></div>
            <button class="gc-btn-remove" data-action="remove" data-item-id="${item.id}" title="Remove from rundown">${ICONS.remove}</button>
          </div>
        </div>
        <div class="gc-item-config" data-config-for="${item.id}">
          ${exposedHtml}
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
      else if (action === 'resume') handleResume(itemId);
      else if (action === 'remove') handleRemove(itemId);
      else if (action === 'config') handleToggleConfig(itemId, btn);
    });
  });

  // Wire up config input changes
  listEl.querySelectorAll('.gc-config-input').forEach(input => {
    input.addEventListener('change', () => {
      const itemId = parseInt(input.dataset.itemId, 10);
      saveConfigOverrides(itemId);
    });
  });

  // Wire up two-part car selector controls
  listEl.querySelectorAll('.gc-car-selector-row').forEach(row => {
    const baseSelect = row.querySelector('.gc-car-base');
    const secondaryWrap = row.querySelector('.gc-car-secondary-wrap');
    const hiddenInput = row.querySelector('.gc-car-combined');
    const itemId = parseInt(row.dataset.itemId, 10);

    function updateCombined() {
      const base = baseSelect.value;
      const secInput = secondaryWrap.querySelector('input');
      const sec = secInput ? secInput.value.trim() : '';
      hiddenInput.value = (base === 'byRank' || base === 'byCar') && sec ? `${base}:${sec}` : base;
      saveConfigOverrides(itemId);
    }

    function wireSecondary() {
      const secInput = secondaryWrap.querySelector('input');
      if (secInput) {
        secInput.addEventListener('change', updateCombined);
        secInput.addEventListener('input', updateCombined);
      }
    }

    baseSelect.addEventListener('change', () => {
      const base = baseSelect.value;
      if (base === 'byRank') {
        secondaryWrap.innerHTML = `<input type="number" class="gc-car-secondary" min="1" max="40" step="1" value="1" style="width:56px;flex:none;padding:4px 6px;background:var(--surface-2,#2a2d35);border:1px solid var(--border,#3a3d45);border-radius:4px;color:var(--text,#e8eaed);font-size:0.8rem;">`;
      } else if (base === 'byCar') {
        secondaryWrap.innerHTML = `<input type="text" class="gc-car-secondary" placeholder="Car #" style="width:56px;flex:none;padding:4px 6px;background:var(--surface-2,#2a2d35);border:1px solid var(--border,#3a3d45);border-radius:4px;color:var(--text,#e8eaed);font-size:0.8rem;">`;
      } else {
        secondaryWrap.innerHTML = '';
      }
      wireSecondary();
      updateCombined();
    });

    // Wire initial secondary input
    wireSecondary();
  });

  // Wire up inline rename (double-click)
  listEl.querySelectorAll('.gc-rundown-template-name').forEach(nameEl => {
    nameEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startInlineRename(nameEl);
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
  const urlBar = document.getElementById('urlBar');

  if (titleEl) titleEl.textContent = 'Select an Output';
  if (addBtn) addBtn.classList.add('hidden');
  if (urlBar) urlBar.classList.add('hidden');

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

// ── Config Panel ──

function handleToggleConfig(itemId, btn) {
  const configPanel = document.querySelector(`.gc-item-config[data-config-for="${itemId}"]`);
  if (!configPanel) return;

  const isOpen = configPanel.classList.contains('open');
  configPanel.classList.toggle('open');
  btn.classList.toggle('active', !isOpen);
}

async function saveConfigOverrides(itemId) {
  // Gather exposed element overrides (supports multiple settings per element)
  const elementOverrides = {};
  const exposedInputs = document.querySelectorAll(`.gc-exposed-input[data-item-id="${itemId}"]`);
  exposedInputs.forEach(input => {
    const elId = input.dataset.elementId;
    const propKey = input.dataset.propKey;
    const value = input.value.trim();
    if (elId && propKey && value) {
      if (!elementOverrides[elId]) elementOverrides[elId] = {};
      // Coerce numbers for numeric fields
      if (input.type === 'number') {
        elementOverrides[elId][propKey] = parseFloat(value);
      } else {
        elementOverrides[elId][propKey] = value;
      }
    }
  });

  // Also preserve any existing displayName
  const nameEl = document.querySelector(`.gc-rundown-template-name[data-item-id="${itemId}"]`);
  const currentName = nameEl ? nameEl.textContent.trim() : '';
  const originalName = nameEl ? nameEl.dataset.originalName : '';

  const configOverrides = {};
  if (Object.keys(elementOverrides).length > 0) {
    configOverrides.elementOverrides = elementOverrides;
  }
  if (currentName && currentName !== originalName) {
    configOverrides.displayName = currentName;
  }

  try {
    const res = await authenticatedFetch(`/api/overlays/rundown/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ config_overrides: configOverrides }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to save config');
    }

    showToast('Config saved', 'success');
  } catch (err) {
    console.error('Failed to save config:', err);
    showToast(err.message || 'Failed to save config', 'error');
  }
}

// ── Inline Rename ──

function startInlineRename(nameEl) {
  const originalText = nameEl.textContent;
  nameEl.contentEditable = 'true';
  nameEl.focus();

  // Select all text
  const range = document.createRange();
  range.selectNodeContents(nameEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finishRename() {
    nameEl.contentEditable = 'false';
    nameEl.removeEventListener('blur', onBlur);
    nameEl.removeEventListener('keydown', onKeydown);

    const newName = nameEl.textContent.trim();
    if (!newName) {
      nameEl.textContent = originalText;
      return;
    }

    if (newName !== originalText) {
      const itemId = parseInt(nameEl.dataset.itemId, 10);
      saveDisplayName(itemId, newName);
    }
  }

  function onBlur() {
    finishRename();
  }

  function onKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameEl.blur();
    } else if (e.key === 'Escape') {
      nameEl.textContent = originalText;
      nameEl.blur();
    }
  }

  nameEl.addEventListener('blur', onBlur);
  nameEl.addEventListener('keydown', onKeydown);
}

async function saveDisplayName(itemId, displayName) {
  try {
    // Preserve exposed element overrides
    const elementOverrides = {};
    const exposedInputs = document.querySelectorAll(`.gc-exposed-input[data-item-id="${itemId}"]`);
    exposedInputs.forEach(input => {
      const elId = input.dataset.elementId;
      const propKey = input.dataset.propKey;
      const value = input.value.trim();
      if (elId && propKey && value) {
        if (!elementOverrides[elId]) elementOverrides[elId] = {};
        if (input.type === 'number') {
          elementOverrides[elId][propKey] = parseFloat(value);
        } else {
          elementOverrides[elId][propKey] = value;
        }
      }
    });

    const configOverrides = { displayName };
    if (Object.keys(elementOverrides).length > 0) {
      configOverrides.elementOverrides = elementOverrides;
    }

    const res = await authenticatedFetch(`/api/overlays/rundown/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify({ config_overrides: configOverrides }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to rename');
    }

    showToast('Renamed', 'success');
  } catch (err) {
    console.error('Failed to rename:', err);
    showToast(err.message || 'Failed to rename', 'error');
  }
}

// ── Take Actions ──

async function handleCue(itemId) {
  try {
    const res = await authenticatedFetch(`/api/overlays/rundown/${itemId}/take`, {
      method: 'POST',
      body: JSON.stringify({ action: 'cue' }),
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

async function handleResume(itemId) {
  try {
    const res = await authenticatedFetch(`/api/overlays/rundown/${itemId}/take`, {
      method: 'POST',
      body: JSON.stringify({ action: 'resume' }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to resume');
    }
  } catch (err) {
    console.error('Failed to resume:', err);
    showToast(err.message || 'Failed to resume', 'error');
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

      const fromItem = items[fromIndex];
      const toItem = items[toIndex];

      if (!fromItem || !toItem) return;

      try {
        await authenticatedFetch(`/api/overlays/rundown/${fromItem.id}`, {
          method: 'PUT',
          body: JSON.stringify({ sort_order: toItem.sort_order }),
        });

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
