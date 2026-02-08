/**
 * Template Library -- bottom-left panel.
 * Displays available overlay templates as a filterable card grid.
 * Clicking a template card adds it to the currently selected output's rundown.
 */

let callbacks = { onAddToRundown: null };
let allTemplates = [];
let activeFilter = 'all';

// ── Public API ──

export function initTemplateLibrary({ onAddToRundown }) {
  callbacks.onAddToRundown = onAddToRundown;

  // Wire up filter tab clicks (the "All" tab is already in the DOM)
  const filtersEl = document.getElementById('templateFilters');
  if (filtersEl) {
    filtersEl.addEventListener('click', (e) => {
      const tab = e.target.closest('.gc-filter-tab');
      if (!tab) return;

      activeFilter = tab.dataset.filter || 'all';

      // Update active state
      filtersEl.querySelectorAll('.gc-filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Re-render with filter
      renderFilteredTemplates();
    });
  }
}

export function renderTemplateLibrary(templates) {
  allTemplates = templates || [];

  // Build filter tabs from unique overlay_type values
  buildFilterTabs();

  // Render the grid
  renderFilteredTemplates();
}

// ── Internals ──

function buildFilterTabs() {
  const filtersEl = document.getElementById('templateFilters');
  if (!filtersEl) return;

  // Collect unique types
  const types = new Set();
  for (const t of allTemplates) {
    if (t.overlay_type) types.add(t.overlay_type);
  }

  let html = '<button class="gc-filter-tab active" data-filter="all">All</button>';

  for (const type of [...types].sort()) {
    html += `<button class="gc-filter-tab" data-filter="${escapeHtml(type)}">${escapeHtml(formatTypeName(type))}</button>`;
  }

  filtersEl.innerHTML = html;

  // Reset active filter
  activeFilter = 'all';
}

function renderFilteredTemplates() {
  const gridEl = document.getElementById('templateGrid');
  if (!gridEl) return;

  // Filter
  const filtered = activeFilter === 'all'
    ? allTemplates
    : allTemplates.filter(t => t.overlay_type === activeFilter);

  if (filtered.length === 0) {
    gridEl.innerHTML = `
      <div class="gc-empty-state" style="grid-column: 1 / -1;">
        <span>${allTemplates.length === 0 ? 'No templates available' : 'No templates match this filter'}</span>
      </div>
    `;
    return;
  }

  let html = '';
  for (const template of filtered) {
    const typeBadge = template.overlay_type
      ? `<span class="gc-type-badge">${escapeHtml(formatTypeName(template.overlay_type))}</span>`
      : '';

    html += `
      <div class="gc-template-card" data-template-id="${template.id}" title="Click to add to rundown">
        <div class="gc-template-card-name">${escapeHtml(template.name)}</div>
        <div class="gc-template-card-meta">
          ${typeBadge}
        </div>
      </div>
    `;
  }

  gridEl.innerHTML = html;

  // Wire up clicks
  gridEl.querySelectorAll('.gc-template-card').forEach(card => {
    card.addEventListener('click', () => {
      const templateId = parseInt(card.dataset.templateId, 10);
      if (callbacks.onAddToRundown) {
        callbacks.onAddToRundown(templateId);
      }
    });
  });
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
