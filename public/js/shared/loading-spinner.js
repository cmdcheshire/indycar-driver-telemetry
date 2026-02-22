/**
 * Shared loading spinner utilities.
 * Provides consistent loading indicators across the application.
 */

/**
 * Create an inline SVG spinner icon.
 * @param {object} options - Spinner options
 * @param {number} options.size - Size in pixels (default: 16)
 * @param {string} options.color - Stroke color (default: currentColor)
 * @param {number} options.strokeWidth - Stroke width (default: 2)
 * @returns {string} SVG markup
 */
export function createSpinnerSvg(options = {}) {
  const { size = 16, color = 'currentColor', strokeWidth = 2 } = options;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${strokeWidth}" class="loading-spinner">
      <circle cx="12" cy="12" r="10" opacity="0.25"/>
      <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 12 12"
          to="360 12 12"
          dur="1s"
          repeatCount="indefinite"/>
      </path>
    </svg>
  `;
}

/**
 * Create a loading spinner DOM element.
 * @param {object} options - Spinner options
 * @param {number} options.size - Size in pixels (default: 16)
 * @param {string} options.color - Stroke color (default: currentColor)
 * @param {number} options.strokeWidth - Stroke width (default: 2)
 * @returns {HTMLElement} Spinner element
 */
export function createSpinner(options = {}) {
  const wrapper = document.createElement('div');
  wrapper.className = 'loading-spinner-wrapper';
  wrapper.innerHTML = createSpinnerSvg(options);
  return wrapper;
}

/**
 * Show a loading state on a button (replace text with spinner).
 * @param {HTMLElement} button - Button element
 * @param {string} loadingText - Optional text to show while loading (default: spinner only)
 * @returns {Function} Cleanup function to restore button state
 */
export function setButtonLoading(button, loadingText = '') {
  const originalHtml = button.innerHTML;
  const originalDisabled = button.disabled;

  button.disabled = true;
  button.style.position = 'relative';

  if (loadingText) {
    button.innerHTML = `
      <span style="display: inline-flex; align-items: center; gap: 6px;">
        ${createSpinnerSvg({ size: 14 })}
        <span>${loadingText}</span>
      </span>
    `;
  } else {
    button.innerHTML = createSpinnerSvg({ size: 14 });
  }

  // Return cleanup function
  return () => {
    button.innerHTML = originalHtml;
    button.disabled = originalDisabled;
  };
}

/**
 * Show a loading overlay on a container element.
 * @param {HTMLElement} container - Container element
 * @param {string} message - Optional loading message
 * @returns {Function} Cleanup function to remove overlay
 */
export function showLoadingOverlay(container, message = 'Loading...') {
  const overlay = document.createElement('div');
  overlay.className = 'loading-overlay';
  overlay.style.cssText = `
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: rgba(10, 12, 16, 0.85);
    backdrop-filter: blur(4px);
    z-index: 1000;
    color: #8892b0;
    font-size: 13px;
    font-weight: 500;
  `;

  const spinner = createSpinner({ size: 32, strokeWidth: 2.5 });
  overlay.appendChild(spinner);

  if (message) {
    const messageEl = document.createElement('div');
    messageEl.textContent = message;
    overlay.appendChild(messageEl);
  }

  // Ensure container has position context
  const originalPosition = container.style.position;
  if (!originalPosition || originalPosition === 'static') {
    container.style.position = 'relative';
  }

  container.appendChild(overlay);

  // Return cleanup function
  return () => {
    overlay.remove();
    if (originalPosition === '' || originalPosition === 'static') {
      container.style.position = originalPosition;
    }
  };
}

/**
 * Create a skeleton loading placeholder.
 * @param {object} options - Skeleton options
 * @param {number} options.width - Width (default: 100%)
 * @param {number} options.height - Height in pixels (default: 20)
 * @param {number} options.borderRadius - Border radius in pixels (default: 4)
 * @returns {HTMLElement} Skeleton element
 */
export function createSkeleton(options = {}) {
  const { width = '100%', height = 20, borderRadius = 4 } = options;

  const skeleton = document.createElement('div');
  skeleton.className = 'loading-skeleton';
  skeleton.style.cssText = `
    width: ${typeof width === 'number' ? `${width}px` : width};
    height: ${height}px;
    border-radius: ${borderRadius}px;
    background: linear-gradient(90deg, #1a1d2e 0%, #2a2d3e 50%, #1a1d2e 100%);
    background-size: 200% 100%;
    animation: skeleton-shimmer 1.5s ease-in-out infinite;
  `;

  return skeleton;
}

// Add global animation keyframes if not already present
if (typeof document !== 'undefined' && !document.getElementById('loading-spinner-styles')) {
  const style = document.createElement('style');
  style.id = 'loading-spinner-styles';
  style.textContent = `
    @keyframes skeleton-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .loading-spinner {
      display: inline-block;
      vertical-align: middle;
    }

    .loading-spinner-wrapper {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
  `;
  document.head.appendChild(style);
}
