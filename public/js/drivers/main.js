/**
 * Drivers management page.
 * CRUD operations for driver reference data.
 */
import { initAuth, isAuthenticated, authenticatedFetch, getUser, logout } from '/js/modules/auth.js';
import { showToast } from '/js/modules/ui.js';

let drivers = [];
let editingCarNumber = null;

async function init() {
  if (!initAuth() || !isAuthenticated()) {
    window.location.href = '/';
    return;
  }

  populateUserInfo();

  document.getElementById('logoutBtn').addEventListener('click', () => logout());
  document.getElementById('addDriverBtn').addEventListener('click', () => toggleAddForm(true));

  await loadDrivers();
}

function populateUserInfo() {
  const user = getUser();
  if (!user) return;
  const avatarEl = document.getElementById('userAvatar');
  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');
  if (avatarEl && user.username) avatarEl.textContent = user.username.substring(0, 2).toUpperCase();
  if (nameEl) nameEl.textContent = user.username || '---';
  if (roleEl) roleEl.textContent = user.role || '---';
}

async function loadDrivers() {
  try {
    const res = await authenticatedFetch('/api/reference/drivers');
    if (!res.ok) throw new Error('Failed to load drivers');
    const data = await res.json();
    drivers = data.drivers || [];
    renderTable();
  } catch (err) {
    console.error('Load drivers error:', err);
    showToast('Failed to load drivers', 'error');
  }
}

function renderTable() {
  const tbody = document.getElementById('driversBody');
  if (!tbody) return;

  if (drivers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No drivers loaded. Click "Add Driver" to get started.</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const d of drivers) {
    const tr = document.createElement('tr');
    tr.dataset.carNumber = d.car_number;

    if (editingCarNumber === d.car_number) {
      // Editing mode - render inputs
      tr.innerHTML = `
        <td class="car-number-cell">#${d.car_number}</td>
        <td><input class="input edit-input" type="text" value="${_esc(d.first_name)}" data-field="first_name" /></td>
        <td><input class="input edit-input" type="text" value="${_esc(d.last_name)}" data-field="last_name" /></td>
        <td><input class="input edit-input" type="text" value="${_esc(d.display_name)}" data-field="display_name" placeholder="Auto-generated if blank" /></td>
        <td><input class="input edit-input" type="text" value="${_esc(d.team || '')}" data-field="team" /></td>
        <td class="actions-cell">
          <button class="btn btn-sm btn-primary save-edit-btn">Save</button>
          <button class="btn btn-sm cancel-edit-btn">Cancel</button>
        </td>
      `;

      tr.querySelector('.save-edit-btn').addEventListener('click', () => saveEdit(d.car_number, tr));
      tr.querySelector('.cancel-edit-btn').addEventListener('click', () => cancelEdit());
    } else {
      // Display mode
      tr.innerHTML = `
        <td class="car-number-cell">#${d.car_number}</td>
        <td>${_esc(d.first_name)}</td>
        <td>${_esc(d.last_name)}</td>
        <td>${_esc(d.display_name)}</td>
        <td class="team-cell">${_esc(d.team || '--')}</td>
        <td class="actions-cell">
          <button class="btn btn-sm edit-btn">Edit</button>
          <button class="btn btn-sm delete-btn" style="color:var(--danger)">Delete</button>
        </td>
      `;

      tr.querySelector('.edit-btn').addEventListener('click', () => startEdit(d.car_number));
      tr.querySelector('.delete-btn').addEventListener('click', () => deleteDriver(d.car_number));
    }

    fragment.appendChild(tr);
  }

  tbody.innerHTML = '';
  tbody.appendChild(fragment);
}

function startEdit(carNumber) {
  editingCarNumber = carNumber;
  renderTable();
}

function cancelEdit() {
  editingCarNumber = null;
  renderTable();
}

async function saveEdit(carNumber, tr) {
  const inputs = tr.querySelectorAll('.edit-input');
  const data = {};
  for (const input of inputs) {
    data[input.dataset.field] = input.value.trim();
  }

  try {
    const res = await authenticatedFetch(`/api/reference/drivers/${carNumber}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('Failed to update driver');
    editingCarNumber = null;
    showToast('Driver updated', 'success', 2000);
    await loadDrivers();
  } catch (err) {
    console.error('Save edit error:', err);
    showToast('Failed to update driver', 'error');
  }
}

async function deleteDriver(carNumber) {
  if (!confirm(`Delete driver #${carNumber}?`)) return;

  try {
    const res = await authenticatedFetch(`/api/reference/drivers/${carNumber}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete driver');
    showToast('Driver deleted', 'success', 2000);
    await loadDrivers();
  } catch (err) {
    console.error('Delete driver error:', err);
    showToast('Failed to delete driver', 'error');
  }
}

function toggleAddForm(show) {
  const form = document.getElementById('addDriverForm');
  if (form) {
    form.style.display = show ? 'block' : 'none';
    if (show) {
      form.querySelector('input')?.focus();
    }
  }
}

// Wire up the add form submit and cancel
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('saveNewDriverBtn');
  const cancelBtn = document.getElementById('cancelNewDriverBtn');

  if (saveBtn) saveBtn.addEventListener('click', addDriver);
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    toggleAddForm(false);
    clearAddForm();
  });
});

async function addDriver() {
  const car = document.getElementById('newCarNumber')?.value.trim();
  const first = document.getElementById('newFirstName')?.value.trim();
  const last = document.getElementById('newLastName')?.value.trim();
  const team = document.getElementById('newTeam')?.value.trim();

  if (!car || !first || !last) {
    showToast('Car number, first name, and last name are required', 'warning');
    return;
  }

  try {
    const res = await authenticatedFetch('/api/reference/drivers', {
      method: 'POST',
      body: JSON.stringify({
        car_number: car,
        first_name: first,
        last_name: last,
        team: team || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to add driver');
    }
    showToast(`Driver #${car} added`, 'success', 2000);
    toggleAddForm(false);
    clearAddForm();
    await loadDrivers();
  } catch (err) {
    console.error('Add driver error:', err);
    showToast(err.message || 'Failed to add driver', 'error');
  }
}

function clearAddForm() {
  ['newCarNumber', 'newFirstName', 'newLastName', 'newTeam'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

function _esc(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init().catch(err => {
  console.error('Drivers page init failed:', err);
  showToast('Failed to initialize', 'error');
});
