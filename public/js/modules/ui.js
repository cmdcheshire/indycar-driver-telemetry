// Toast notifications
let toastContainer = null;

function ensureToastContainer() {
  if (toastContainer) return toastContainer;
  toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);
  return toastContainer;
}

export function showToast(message, type = 'info', duration = 4000) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    toast.style.transition = 'all 300ms ease';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// Modal dialogs
export function showModal(title, bodyHtml, options = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const confirmText = options.confirmText || 'OK';
    const cancelText = options.cancelText || 'Cancel';
    const showCancel = options.showCancel !== false;

    overlay.innerHTML = `
      <div class="modal">
        <h2>${title}</h2>
        <div class="modal-body">${bodyHtml}</div>
        <div class="modal-actions">
          ${showCancel ? `<button class="btn" id="modal-cancel">${cancelText}</button>` : ''}
          <button class="btn btn-primary" id="modal-confirm">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const cleanup = (result) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };

    overlay.querySelector('#modal-confirm').addEventListener('click', () => cleanup(true));
    if (showCancel) {
      overlay.querySelector('#modal-cancel').addEventListener('click', () => cleanup(false));
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });

    document.addEventListener('keydown', function handler(e) {
      if (e.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', handler); }
      if (e.key === 'Enter') { cleanup(true); document.removeEventListener('keydown', handler); }
    });
  });
}

export function showConfirm(title, message) {
  return showModal(title, `<p>${message}</p>`, { showCancel: true });
}

export function showPrompt(title, label, defaultValue = '') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    overlay.innerHTML = `
      <div class="modal">
        <h2>${title}</h2>
        <div class="input-group" style="margin-top:12px">
          <label>${label}</label>
          <input class="input w-full" id="modal-input" value="${defaultValue}" />
        </div>
        <div class="modal-actions">
          <button class="btn" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-confirm">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('show');
      overlay.querySelector('#modal-input').focus();
      overlay.querySelector('#modal-input').select();
    });

    const cleanup = (value) => {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
      resolve(value);
    };

    overlay.querySelector('#modal-confirm').addEventListener('click', () => {
      cleanup(overlay.querySelector('#modal-input').value.trim());
    });
    overlay.querySelector('#modal-cancel').addEventListener('click', () => cleanup(null));
    overlay.querySelector('#modal-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') cleanup(overlay.querySelector('#modal-input').value.trim());
      if (e.key === 'Escape') cleanup(null);
    });
  });
}
