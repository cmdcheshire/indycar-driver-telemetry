/**
 * Preview Panel -- bottom-right area.
 * Renders a scaled-down iframe showing the live overlay for the selected output instance.
 * Maintains 16:9 aspect ratio and scales 1920x1080 content to fit the panel.
 */

let iframeEl = null;
let resizeObserver = null;

// ── Public API ──

export function initPreviewPanel() {
  // Set up resize observer to rescale iframe on container resize
  const container = document.getElementById('previewContainer');
  if (container) {
    resizeObserver = new ResizeObserver(() => {
      rescaleIframe(container);
    });
    resizeObserver.observe(container);
  }
}

export function updatePreview(accessToken) {
  const container = document.getElementById('previewContainer');
  const emptyEl = document.getElementById('previewEmpty');
  if (!container) return;

  // Hide the empty state
  if (emptyEl) emptyEl.style.display = 'none';

  // Create or update the wrapper and iframe
  let wrapper = container.querySelector('.gc-preview-wrapper');
  if (!wrapper) {
    wrapper = document.createElement('div');
    wrapper.className = 'gc-preview-wrapper';
    container.appendChild(wrapper);
  }

  // Create iframe if it doesn't exist
  iframeEl = wrapper.querySelector('iframe');
  if (!iframeEl) {
    iframeEl = document.createElement('iframe');
    iframeEl.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    iframeEl.setAttribute('loading', 'lazy');
    wrapper.appendChild(iframeEl);
  }

  // Set the src to the overlay URL
  const overlayUrl = `/overlay/${accessToken}`;
  if (iframeEl.src !== window.location.origin + overlayUrl) {
    iframeEl.src = overlayUrl;
  }

  // Scale to fit
  rescaleIframe(container);
}

export function clearPreview() {
  const container = document.getElementById('previewContainer');
  const emptyEl = document.getElementById('previewEmpty');
  if (!container) return;

  // Remove the wrapper and iframe
  const wrapper = container.querySelector('.gc-preview-wrapper');
  if (wrapper) {
    wrapper.remove();
  }

  iframeEl = null;

  // Show the empty state
  if (emptyEl) emptyEl.style.display = '';
}

// ── Internals ──

function rescaleIframe(container) {
  if (!container || !iframeEl) return;

  const wrapper = container.querySelector('.gc-preview-wrapper');
  if (!wrapper) return;

  // The iframe renders at 1920x1080 (native overlay resolution).
  // We need to scale it to fit within the wrapper's actual rendered size.
  const wrapperRect = wrapper.getBoundingClientRect();
  const wrapperWidth = wrapperRect.width;
  const wrapperHeight = wrapperRect.height;

  if (wrapperWidth === 0 || wrapperHeight === 0) return;

  const scaleX = wrapperWidth / 1920;
  const scaleY = wrapperHeight / 1080;
  const scale = Math.min(scaleX, scaleY);

  iframeEl.style.transform = `scale(${scale})`;
}
