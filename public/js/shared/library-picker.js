/**
 * Shared library asset picker with folder navigation.
 * Returns selected asset URL and metadata.
 */

import { getToken } from '/js/modules/auth.js';
import { showToast } from '/js/modules/ui.js';

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp']);
const MODEL_EXTS = new Set(['.glb', '.gltf']);
const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2']);

/**
 * Show library picker modal and return selected asset.
 * @param {object} options - Picker options
 * @param {string[]} options.filter - File type filter (e.g. ['image', 'model', 'font'])
 * @param {string} options.title - Modal title
 * @returns {Promise<{url: string, asset: object}|null>} Selected asset or null if cancelled
 */
export async function showLibraryPicker(options = {}) {
  const { filter = ['image'], title = 'Select from Library' } = options;

  // Fetch folders and assets
  let folders = [];
  let assets = [];
  let currentFolderId = null;
  let searchQuery = '';

  try {
    const [foldersRes, assetsRes] = await Promise.all([
      fetch('/api/library/folders'),
      fetch('/api/library/assets'),
    ]);

    if (!foldersRes.ok || !assetsRes.ok) throw new Error('Failed to fetch library data');

    const foldersData = await foldersRes.json();
    const assetsData = await assetsRes.json();

    folders = foldersData.folders || [];
    assets = assetsData.assets || [];
  } catch (err) {
    console.error('[library-picker] Failed to load library:', err);
    showToast('Failed to load library', 'error');
    return null;
  }

  // Filter assets by type
  const filteredAssets = assets.filter(asset => {
    const filename = asset.original_name || asset.filename;
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();

    if (filter.includes('image') && IMAGE_EXTS.has(ext)) return true;
    if (filter.includes('model') && MODEL_EXTS.has(ext)) return true;
    if (filter.includes('font') && FONT_EXTS.has(ext)) return true;

    return false;
  });

  return new Promise((resolve) => {
    // Build modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(4px);
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: #1a1d2e;
      border: 1px solid #2d3451;
      border-radius: 12px;
      width: 90%;
      max-width: 900px;
      height: 80%;
      max-height: 700px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 20px 24px;
      border-bottom: 1px solid #2d3451;
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    header.innerHTML = `
      <h3 style="margin: 0; font-size: 18px; font-weight: 600; color: #fff;">${title}</h3>
      <button class="close-btn" style="background: none; border: none; color: #8892b0; font-size: 24px; cursor: pointer; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;">&times;</button>
    `;

    // Sidebar for folders
    const sidebar = document.createElement('div');
    sidebar.style.cssText = `
      width: 220px;
      border-right: 1px solid #2d3451;
      overflow-y: auto;
      background: #161928;
    `;

    // Content area
    const content = document.createElement('div');
    content.style.cssText = `
      flex: 1;
      display: flex;
      flex-direction: column;
    `;

    // Breadcrumb
    const breadcrumb = document.createElement('div');
    breadcrumb.style.cssText = `
      padding: 12px 16px;
      border-bottom: 1px solid #2d3451;
      font-size: 13px;
      color: #8892b0;
      background: #161928;
    `;

    // Search box
    const searchBox = document.createElement('div');
    searchBox.style.cssText = `
      padding: 12px 16px;
      border-bottom: 1px solid #2d3451;
      background: #161928;
    `;
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search assets...';
    searchInput.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      background: #0f1118;
      border: 1px solid #2d3451;
      border-radius: 6px;
      color: #fff;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    `;
    searchInput.addEventListener('focus', () => {
      searchInput.style.borderColor = '#3b82f6';
    });
    searchInput.addEventListener('blur', () => {
      searchInput.style.borderColor = '#2d3451';
    });
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase().trim();
      renderAssets();
    });
    searchBox.appendChild(searchInput);

    // Asset grid
    const grid = document.createElement('div');
    grid.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 16px;
      align-content: start;
    `;

    const body = document.createElement('div');
    body.style.cssText = 'display: flex; flex: 1; overflow: hidden;';
    body.appendChild(sidebar);
    content.appendChild(breadcrumb);
    content.appendChild(searchBox);
    content.appendChild(grid);
    body.appendChild(content);

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Render folder tree
    function renderFolders() {
      sidebar.innerHTML = '';

      // All Assets (root)
      const rootItem = document.createElement('div');
      rootItem.style.cssText = `
        padding: 10px 16px;
        cursor: pointer;
        color: ${currentFolderId === null ? '#3b82f6' : '#8892b0'};
        font-size: 13px;
        font-weight: ${currentFolderId === null ? '600' : '400'};
        background: ${currentFolderId === null ? 'rgba(59, 130, 246, 0.1)' : 'transparent'};
        transition: all 0.2s;
      `;
      rootItem.textContent = '📁 All Assets';
      rootItem.addEventListener('click', () => {
        currentFolderId = null;
        searchQuery = '';
        searchInput.value = '';
        renderFolders();
        renderAssets();
      });
      rootItem.addEventListener('mouseenter', () => {
        if (currentFolderId !== null) rootItem.style.background = 'rgba(255, 255, 255, 0.05)';
      });
      rootItem.addEventListener('mouseleave', () => {
        if (currentFolderId !== null) rootItem.style.background = 'transparent';
      });
      sidebar.appendChild(rootItem);

      // Build folder tree (only root-level folders for now - nested coming later)
      const rootFolders = folders.filter(f => !f.parent_id);
      rootFolders.forEach(folder => {
        const folderItem = document.createElement('div');
        const isActive = currentFolderId === folder.id;
        folderItem.style.cssText = `
          padding: 10px 16px;
          cursor: pointer;
          color: ${isActive ? '#3b82f6' : '#8892b0'};
          font-size: 13px;
          font-weight: ${isActive ? '600' : '400'};
          background: ${isActive ? 'rgba(59, 130, 246, 0.1)' : 'transparent'};
          transition: all 0.2s;
        `;
        folderItem.textContent = `📁 ${folder.name}`;
        folderItem.addEventListener('click', () => {
          currentFolderId = folder.id;
          searchQuery = '';
          searchInput.value = '';
          renderFolders();
          renderAssets();
        });
        folderItem.addEventListener('mouseenter', () => {
          if (!isActive) folderItem.style.background = 'rgba(255, 255, 255, 0.05)';
        });
        folderItem.addEventListener('mouseleave', () => {
          if (!isActive) folderItem.style.background = 'transparent';
        });
        sidebar.appendChild(folderItem);
      });
    }

    // Render assets for current folder
    function renderAssets() {
      grid.innerHTML = '';

      // Update breadcrumb
      if (currentFolderId === null) {
        breadcrumb.textContent = 'All Assets';
      } else {
        const folder = folders.find(f => f.id === currentFolderId);
        breadcrumb.textContent = folder ? folder.name : 'Unknown Folder';
      }

      // Filter by current folder
      let folderAssets = filteredAssets.filter(asset => {
        if (currentFolderId === null) return true; // Show all when no folder selected
        return asset.folder_id === currentFolderId;
      });

      // Filter by search query
      if (searchQuery) {
        folderAssets = folderAssets.filter(asset => {
          const filename = (asset.original_name || asset.filename).toLowerCase();
          return filename.includes(searchQuery);
        });
      }

      if (folderAssets.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'grid-column: 1 / -1; text-align: center; padding: 40px; color: #8892b0; font-size: 14px;';
        empty.textContent = currentFolderId === null ? 'No assets in library' : 'No assets in this folder';
        grid.appendChild(empty);
        return;
      }

      folderAssets.forEach(asset => {
        const card = document.createElement('div');
        card.style.cssText = `
          background: #161928;
          border: 2px solid transparent;
          border-radius: 8px;
          cursor: pointer;
          overflow: hidden;
          transition: all 0.2s;
        `;

        const thumb = document.createElement('div');
        thumb.style.cssText = `
          width: 100%;
          height: 120px;
          background: #0f1118;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        `;

        const filename = asset.original_name || asset.filename;
        const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();

        if (IMAGE_EXTS.has(ext)) {
          const img = document.createElement('img');
          img.src = `/api/library/assets/${asset.id}/file`;
          Object.assign(img.style, { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' });
          img.draggable = false;
          thumb.appendChild(img);
        } else {
          const icon = document.createElement('span');
          icon.textContent = ext.toUpperCase().substring(1);
          icon.style.cssText = 'font-size: 18px; font-weight: 700; color: #4a5568;';
          thumb.appendChild(icon);
        }

        const label = document.createElement('div');
        label.style.cssText = `
          padding: 8px;
          font-size: 11px;
          color: #8892b0;
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `;
        label.textContent = filename;

        card.appendChild(thumb);
        card.appendChild(label);

        card.addEventListener('mouseenter', () => {
          card.style.borderColor = '#3b82f6';
          card.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.3)';
        });
        card.addEventListener('mouseleave', () => {
          card.style.borderColor = 'transparent';
          card.style.boxShadow = 'none';
        });

        card.addEventListener('click', () => {
          const fn = encodeURIComponent(filename);
          const url = `/api/library/assets/${asset.id}/file?fn=${fn}`;
          overlay.remove();
          resolve({ url, asset });
        });

        grid.appendChild(card);
      });
    }

    // Close handlers
    header.querySelector('.close-btn').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve(null);
      }
    });

    // Initial render
    renderFolders();
    renderAssets();
  });
}
