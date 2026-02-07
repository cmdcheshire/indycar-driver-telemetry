const AUTH_KEYS = {
  TOKEN: 'ito_auth_token',
  REFRESH: 'ito_refresh_token',
  EXPIRES: 'ito_token_expires',
  USER: 'ito_user_info',
};

let refreshTimer = null;

export function getToken() {
  return localStorage.getItem(AUTH_KEYS.TOKEN);
}

export function getRefreshToken() {
  return localStorage.getItem(AUTH_KEYS.REFRESH);
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEYS.USER));
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  const token = getToken();
  const expires = localStorage.getItem(AUTH_KEYS.EXPIRES);
  if (!token || !expires) return false;
  return Date.now() < parseInt(expires, 10);
}

export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Login failed');
  }

  const data = await res.json();
  storeAuth(data);
  scheduleRefresh(data.expiresIn);
  return data.user;
}

export async function logout() {
  try {
    await authenticatedFetch('/api/auth/logout', { method: 'POST' });
  } catch { /* ignore */ }
  clearAuth();
  window.location.href = '/';
}

export async function authenticatedFetch(url, options = {}) {
  let token = getToken();

  // Auto-refresh if token expires in less than 5 minutes
  const expires = parseInt(localStorage.getItem(AUTH_KEYS.EXPIRES), 10);
  if (expires && (expires - Date.now()) < 300000) {
    await refreshTokens();
    token = getToken();
  }

  if (!token) {
    window.location.href = '/';
    throw new Error('Not authenticated');
  }

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    clearAuth();
    window.location.href = '/';
    throw new Error('Session expired');
  }

  return res;
}

async function refreshTokens() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) {
    clearAuth();
    return;
  }

  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      clearAuth();
      window.location.href = '/';
      return;
    }

    const data = await res.json();
    storeAuth(data);
    scheduleRefresh(data.expiresIn);
  } catch {
    clearAuth();
  }
}

function storeAuth(data) {
  localStorage.setItem(AUTH_KEYS.TOKEN, data.token);
  localStorage.setItem(AUTH_KEYS.REFRESH, data.refreshToken);
  localStorage.setItem(AUTH_KEYS.EXPIRES, String(Date.now() + data.expiresIn * 1000));
  localStorage.setItem(AUTH_KEYS.USER, JSON.stringify(data.user));
}

function clearAuth() {
  if (refreshTimer) clearTimeout(refreshTimer);
  Object.values(AUTH_KEYS).forEach(k => localStorage.removeItem(k));
}

function scheduleRefresh(expiresIn) {
  if (refreshTimer) clearTimeout(refreshTimer);
  // Refresh 5 minutes before expiry
  const delay = Math.max(0, (expiresIn - 300) * 1000);
  refreshTimer = setTimeout(() => refreshTokens(), delay);
}

// Initialize refresh timer on page load
export function initAuth() {
  if (!isAuthenticated()) return false;
  const expires = parseInt(localStorage.getItem(AUTH_KEYS.EXPIRES), 10);
  const remaining = Math.max(0, Math.floor((expires - Date.now()) / 1000));
  if (remaining > 0) scheduleRefresh(remaining);
  return true;
}
