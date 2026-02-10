/**
 * Custom color picker with hex code input and alpha support.
 * Returns color in rgba() format.
 */

/**
 * Parse any CSS color value to RGBA components.
 * @param {string} color - CSS color string (hex, rgb, rgba, named)
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
function parseColor(color) {
  if (!color || color === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  // Hex format
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return { r, g, b, a: 1 };
    } else if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return { r, g, b, a: 1 };
    }
  }

  // rgb/rgba format
  const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]),
      g: parseInt(rgbMatch[2]),
      b: parseInt(rgbMatch[3]),
      a: rgbMatch[4] !== undefined ? parseFloat(rgbMatch[4]) : 1,
    };
  }

  // Fallback: create temporary element to resolve named colors
  const div = document.createElement('div');
  div.style.color = color;
  document.body.appendChild(div);
  const computed = getComputedStyle(div).color;
  document.body.removeChild(div);

  const compMatch = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (compMatch) {
    return {
      r: parseInt(compMatch[1]),
      g: parseInt(compMatch[2]),
      b: parseInt(compMatch[3]),
      a: compMatch[4] !== undefined ? parseFloat(compMatch[4]) : 1,
    };
  }

  return { r: 0, g: 0, b: 0, a: 1 };
}

/**
 * Convert RGBA to hex string (without alpha).
 * @param {{ r: number, g: number, b: number }} rgba
 * @returns {string}
 */
function rgbaToHex({ r, g, b }) {
  const toHex = (n) => {
    const hex = Math.round(n).toString(16).padStart(2, '0');
    return hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Show color picker modal and return selected color.
 * @param {object} options - Picker options
 * @param {string} options.initialColor - Initial color value (any CSS format)
 * @param {string} options.title - Modal title
 * @param {boolean} options.showAlpha - Show alpha slider (default: true)
 * @returns {Promise<string|null>} Selected color in rgba() format, or null if cancelled
 */
export async function showColorPicker(options = {}) {
  const {
    initialColor = '#3b82f6',
    title = 'Color Picker',
    showAlpha = true,
  } = options;

  const rgba = parseColor(initialColor);
  let currentColor = { ...rgba };

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
      width: 320px;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 16px 20px;
      border-bottom: 1px solid #2d3451;
      display: flex;
      align-items: center;
      justify-content: space-between;
    `;
    header.innerHTML = `
      <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #fff;">${title}</h3>
      <button class="close-btn" style="background: none; border: none; color: #8892b0; font-size: 24px; cursor: pointer; padding: 0; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center;">&times;</button>
    `;

    // Body
    const body = document.createElement('div');
    body.style.cssText = 'padding: 20px; display: flex; flex-direction: column; gap: 16px;';

    // Color preview
    const preview = document.createElement('div');
    preview.style.cssText = `
      width: 100%;
      height: 60px;
      border-radius: 8px;
      border: 1px solid #2d3451;
      background: ${initialColor};
      position: relative;
      overflow: hidden;
    `;

    // Checkerboard background for transparency
    const checkerboard = document.createElement('div');
    checkerboard.style.cssText = `
      position: absolute;
      inset: 0;
      background-image: linear-gradient(45deg, #0f1118 25%, transparent 25%, transparent 75%, #0f1118 75%, #0f1118),
        linear-gradient(45deg, #0f1118 25%, transparent 25%, transparent 75%, #0f1118 75%, #0f1118);
      background-size: 12px 12px;
      background-position: 0 0, 6px 6px;
      z-index: 0;
    `;
    preview.appendChild(checkerboard);

    const previewColor = document.createElement('div');
    previewColor.style.cssText = `
      position: absolute;
      inset: 0;
      z-index: 1;
      background: ${initialColor};
    `;
    preview.appendChild(previewColor);

    // Hex input
    const hexRow = document.createElement('div');
    hexRow.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
    hexRow.innerHTML = `
      <label style="font-size: 12px; font-weight: 500; color: #8892b0; text-transform: uppercase;">Hex</label>
    `;
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.value = rgbaToHex(rgba);
    hexInput.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      background: #0f1118;
      border: 1px solid #2d3451;
      border-radius: 6px;
      color: #fff;
      font-family: 'Roboto Mono', monospace;
      font-size: 13px;
      outline: none;
    `;
    hexInput.addEventListener('focus', () => {
      hexInput.style.borderColor = '#3b82f6';
    });
    hexInput.addEventListener('blur', () => {
      hexInput.style.borderColor = '#2d3451';
    });
    hexRow.appendChild(hexInput);

    // RGB inputs
    const rgbRow = document.createElement('div');
    rgbRow.style.cssText = 'display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;';

    const createRgbInput = (label, value, max = 255) => {
      const col = document.createElement('div');
      col.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
      col.innerHTML = `
        <label style="font-size: 11px; font-weight: 500; color: #8892b0; text-transform: uppercase;">${label}</label>
      `;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(max);
      input.value = String(value);
      input.style.cssText = `
        width: 100%;
        padding: 8px;
        background: #0f1118;
        border: 1px solid #2d3451;
        border-radius: 6px;
        color: #fff;
        font-size: 13px;
        outline: none;
      `;
      input.addEventListener('focus', () => {
        input.style.borderColor = '#3b82f6';
      });
      input.addEventListener('blur', () => {
        input.style.borderColor = '#2d3451';
      });
      col.appendChild(input);
      return { col, input };
    };

    const rInput = createRgbInput('R', rgba.r);
    const gInput = createRgbInput('G', rgba.g);
    const bInput = createRgbInput('B', rgba.b);

    rgbRow.appendChild(rInput.col);
    rgbRow.appendChild(gInput.col);
    rgbRow.appendChild(bInput.col);

    // Alpha slider (if enabled)
    let alphaInput = null;
    let alphaRow = null;
    if (showAlpha) {
      alphaRow = document.createElement('div');
      alphaRow.style.cssText = 'display: flex; flex-direction: column; gap: 6px;';
      alphaRow.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <label style="font-size: 12px; font-weight: 500; color: #8892b0; text-transform: uppercase;">Alpha</label>
          <span id="alphaValue" style="font-size: 12px; color: #8892b0; font-family: 'Roboto Mono', monospace;">${Math.round(rgba.a * 100)}%</span>
        </div>
      `;
      alphaInput = document.createElement('input');
      alphaInput.type = 'range';
      alphaInput.min = '0';
      alphaInput.max = '100';
      alphaInput.value = String(Math.round(rgba.a * 100));
      alphaInput.style.cssText = `
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: linear-gradient(to right, transparent, ${rgbaToHex(rgba)});
        outline: none;
        -webkit-appearance: none;
      `;
      // Custom thumb styling
      const style = document.createElement('style');
      style.textContent = `
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #fff;
        }
        input[type="range"]::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 2px solid #fff;
        }
      `;
      document.head.appendChild(style);

      alphaRow.appendChild(alphaInput);
    }

    // Update preview
    const updatePreview = () => {
      const colorStr = `rgba(${currentColor.r}, ${currentColor.g}, ${currentColor.b}, ${currentColor.a})`;
      previewColor.style.background = colorStr;
      if (showAlpha && alphaInput) {
        alphaInput.style.background = `linear-gradient(to right, transparent, ${rgbaToHex(currentColor)})`;
      }
    };

    // Hex input handler
    hexInput.addEventListener('input', () => {
      const hex = hexInput.value.trim();
      if (/^#?[0-9A-Fa-f]{6}$/.test(hex) || /^#?[0-9A-Fa-f]{3}$/.test(hex)) {
        const parsed = parseColor(hex.startsWith('#') ? hex : `#${hex}`);
        currentColor.r = parsed.r;
        currentColor.g = parsed.g;
        currentColor.b = parsed.b;
        rInput.input.value = String(parsed.r);
        gInput.input.value = String(parsed.g);
        bInput.input.value = String(parsed.b);
        updatePreview();
      }
    });

    // RGB input handlers
    const updateFromRgb = () => {
      currentColor.r = Math.max(0, Math.min(255, parseInt(rInput.input.value) || 0));
      currentColor.g = Math.max(0, Math.min(255, parseInt(gInput.input.value) || 0));
      currentColor.b = Math.max(0, Math.min(255, parseInt(bInput.input.value) || 0));
      hexInput.value = rgbaToHex(currentColor);
      updatePreview();
    };

    rInput.input.addEventListener('input', updateFromRgb);
    gInput.input.addEventListener('input', updateFromRgb);
    bInput.input.addEventListener('input', updateFromRgb);

    // Alpha slider handler
    if (showAlpha && alphaInput) {
      alphaInput.addEventListener('input', () => {
        currentColor.a = parseInt(alphaInput.value) / 100;
        const alphaValueLabel = alphaRow.querySelector('#alphaValue');
        if (alphaValueLabel) {
          alphaValueLabel.textContent = `${alphaInput.value}%`;
        }
        updatePreview();
      });
    }

    // Buttons
    const footer = document.createElement('div');
    footer.style.cssText = `
      padding: 16px 20px;
      border-top: 1px solid #2d3451;
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 8px 16px;
      background: transparent;
      border: 1px solid #2d3451;
      border-radius: 6px;
      color: #8892b0;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    `;
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.background = 'rgba(255, 255, 255, 0.05)';
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.background = 'transparent';
    });

    const okBtn = document.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = `
      padding: 8px 16px;
      background: #3b82f6;
      border: none;
      border-radius: 6px;
      color: #fff;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    `;
    okBtn.addEventListener('mouseenter', () => {
      okBtn.style.background = '#2563eb';
    });
    okBtn.addEventListener('mouseleave', () => {
      okBtn.style.background = '#3b82f6';
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(okBtn);

    // Assemble modal
    body.appendChild(preview);
    body.appendChild(hexRow);
    body.appendChild(rgbRow);
    if (showAlpha && alphaRow) {
      body.appendChild(alphaRow);
    }

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Close handlers
    const close = (color) => {
      overlay.remove();
      resolve(color);
    };

    header.querySelector('.close-btn').addEventListener('click', () => close(null));
    cancelBtn.addEventListener('click', () => close(null));
    okBtn.addEventListener('click', () => {
      const colorStr = `rgba(${currentColor.r}, ${currentColor.g}, ${currentColor.b}, ${currentColor.a})`;
      close(colorStr);
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });

    // Focus hex input
    setTimeout(() => hexInput.focus(), 100);
  });
}
