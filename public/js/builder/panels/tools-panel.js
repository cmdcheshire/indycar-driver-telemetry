/**
 * Tools panel - left sidebar tool buttons for the overlay builder.
 * Tools: Select, Text, Image, Shape, Data
 */

/** @type {string} */
let activeTool = 'select';

/** @type {Function|null} */
let onToolChange = null;

/** @type {HTMLElement|null} */
let gridEl = null;

const TOOLS = [
  {
    id: 'select',
    label: 'Select',
    shortcut: 'V',
    icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l5 14 2.1-5.9L16 9z"/></svg>`,
  },
  {
    id: 'text',
    label: 'Text',
    shortcut: 'T',
    icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h10M9 4v11"/></svg>`,
  },
  {
    id: 'image',
    label: 'Image',
    shortcut: 'I',
    icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="14" height="14" rx="2"/><circle cx="6.5" cy="6.5" r="1.5"/><path d="M16 12l-4-4L3 16"/></svg>`,
  },
  {
    id: 'shape',
    label: 'Shape',
    shortcut: 'R',
    icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="14" height="14" rx="1"/></svg>`,
  },
  {
    id: 'data',
    label: 'Data',
    shortcut: 'D',
    icon: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="9" cy="4" rx="6" ry="2.5"/><path d="M3 4v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V4"/><path d="M3 9c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5"/></svg>`,
  },
];

/**
 * Initialize the tools panel.
 * @param {object} opts
 * @param {Function} opts.onToolChange - Called with (toolId) when active tool changes
 */
export function initToolsPanel(opts) {
  onToolChange = opts.onToolChange;
  gridEl = document.getElementById('toolsGrid');

  if (!gridEl) return;

  gridEl.innerHTML = '';

  for (const tool of TOOLS) {
    const btn = document.createElement('button');
    btn.className = `tool-btn${tool.id === activeTool ? ' active' : ''}`;
    btn.dataset.toolId = tool.id;
    btn.title = `${tool.label} (${tool.shortcut})`;
    btn.innerHTML = tool.icon;
    btn.addEventListener('click', () => setActiveTool(tool.id));
    gridEl.appendChild(btn);
  }
}

/**
 * Set the active tool.
 * @param {string} toolId
 */
export function setActiveTool(toolId) {
  const tool = TOOLS.find(t => t.id === toolId);
  if (!tool) return;

  activeTool = toolId;

  // Update button states
  if (gridEl) {
    gridEl.querySelectorAll('.tool-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.toolId === toolId);
    });
  }

  // Update cursor on canvas
  const canvasArea = document.getElementById('canvasArea');
  if (canvasArea) {
    canvasArea.style.cursor = toolId === 'select' ? 'default' : 'crosshair';
  }

  if (onToolChange) onToolChange(toolId);
}

/**
 * Get the currently active tool ID.
 * @returns {string}
 */
export function getActiveTool() {
  return activeTool;
}

/**
 * Handle keyboard shortcut for tool switching.
 * @param {string} key - Lowercase key pressed
 * @returns {boolean} Whether a tool was activated
 */
export function handleToolShortcut(key) {
  const tool = TOOLS.find(t => t.shortcut.toLowerCase() === key);
  if (tool) {
    setActiveTool(tool.id);
    return true;
  }
  return false;
}
