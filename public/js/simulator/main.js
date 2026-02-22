/**
 * Simulator page entry point.
 * Handles XML file management, playback transport controls,
 * timeline visualization, and status polling for the telemetry replay simulator.
 */
import { initAuth, isAuthenticated, getToken, getUser, logout } from '/js/modules/auth.js';
import { showToast } from '/js/modules/ui.js';

// ── State ──
let currentState = 'stopped'; // stopped | playing | paused
let currentPosition = 0;
let totalChunks = 0;
let currentRate = 1;
let loadedFile = null;
let timeline = [];
let raceInfo = null;
let isDragging = false;
let pollInterval = null;

// ── Flag Colors ──
const FLAG_COLORS = {
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
  finish: '#6366f1',
  caution: '#eab308',
  white: '#f3f4f6',
};
const FLAG_DEFAULT_COLOR = '#374151';

// ── API Helper ──

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${getToken()}` },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api/simulator${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

// ── Formatting Helpers ──

function formatElapsed(value) {
  if (!value && value !== 0) return '--:--:--';
  // If it's already a string like "00:45:12.345", truncate fractional seconds
  if (typeof value === 'string') {
    const dotIdx = value.indexOf('.');
    return dotIdx >= 0 ? value.substring(0, dotIdx) : value;
  }
  // If it's a number (ms), format it
  const s = Math.floor(value / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── DOM References ──

const el = {};

function cacheElements() {
  el.raceTitle = document.getElementById('raceTitle');
  el.raceDetails = document.getElementById('raceDetails');
  el.raceLocation = document.getElementById('raceLocation');
  el.raceLaps = document.getElementById('raceLaps');
  el.raceTrackLength = document.getElementById('raceTrackLength');
  el.raceElapsed = document.getElementById('raceElapsed');
  el.racePosition = document.getElementById('racePosition');
  el.stateDisplay = document.getElementById('stateDisplay');
  el.timelineContainer = document.getElementById('timelineContainer');
  el.timelineTrack = document.getElementById('timelineTrack');
  el.timelineThumb = document.getElementById('timelineThumb');
  el.elapsedTimeStart = document.getElementById('elapsedTimeStart');
  el.elapsedTimeEnd = document.getElementById('elapsedTimeEnd');
  el.positionDisplay = document.getElementById('positionDisplay');
  el.elapsedDisplay = document.getElementById('elapsedDisplay');
  el.btnSeekStart = document.getElementById('btnSeekStart');
  el.btnPlay = document.getElementById('btnPlay');
  el.btnPause = document.getElementById('btnPause');
  el.btnStop = document.getElementById('btnStop');
  el.rateSelect = document.getElementById('rateSelect');
  el.fileList = document.getElementById('fileList');
  el.uploadBtn = document.getElementById('uploadBtn');
  el.uploadFileInput = document.getElementById('uploadFileInput');
  el.uploadProgress = document.getElementById('uploadProgress');
  el.uploadProgressBar = document.getElementById('uploadProgressBar');
  el.uploadStatus = document.getElementById('uploadStatus');
  el.statusState = document.getElementById('statusState');
  el.statusFile = document.getElementById('statusFile');
  el.statusRate = document.getElementById('statusRate');
}

// ── File Management ──

async function loadFiles() {
  try {
    const data = await api('GET', '/files');
    // API returns array directly
    renderFileList(Array.isArray(data) ? data : (data.files || []));
  } catch (err) {
    console.error('Failed to load files:', err);
    showToast('Failed to load file list', 'error');
  }
}

function renderFileList(files) {
  if (!el.fileList) return;

  if (!files || files.length === 0) {
    el.fileList.innerHTML = '<div class="empty-state">No files uploaded</div>';
    return;
  }

  el.fileList.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const file of files) {
    const item = document.createElement('div');
    item.className = `file-item${file.name === loadedFile ? ' loaded' : ''}`;

    const info = document.createElement('div');
    info.className = 'file-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';
    nameEl.textContent = file.name;
    nameEl.title = file.name;

    const sizeEl = document.createElement('div');
    sizeEl.className = 'file-size text-muted';
    sizeEl.textContent = formatSize(file.size);

    info.appendChild(nameEl);
    info.appendChild(sizeEl);

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn btn-sm';
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => loadFile(file.name));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-sm btn-danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => deleteFile(file.name));

    actions.appendChild(loadBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(info);
    item.appendChild(actions);
    fragment.appendChild(item);
  }

  el.fileList.appendChild(fragment);
}

async function loadFile(filename) {
  try {
    const data = await api('POST', '/load', { filename });
    loadedFile = filename;
    raceInfo = data.raceInfo || null;
    timeline = data.timeline || [];
    totalChunks = data.totalChunks || 0;
    currentPosition = 0;
    currentState = 'stopped';

    updateRaceInfo();
    renderTimeline(timeline, totalChunks);
    updateThumbPosition(0);
    updateTransportButtons();
    updateStateDisplay();
    updateStatusPanel();
    updatePositionDisplay(0);
    await loadFiles(); // refresh list to highlight loaded file

    showToast(`Loaded: ${filename}`, 'success', 2000);
  } catch (err) {
    console.error('Failed to load file:', err);
    showToast(err.message || 'Failed to load file', 'error');
  }
}

async function deleteFile(filename) {
  if (!confirm(`Delete "${filename}"?`)) return;

  try {
    await api('DELETE', `/files/${encodeURIComponent(filename)}`);
    if (loadedFile === filename) {
      loadedFile = null;
      resetUI();
    }
    showToast('File deleted', 'success', 2000);
    await loadFiles();
  } catch (err) {
    console.error('Failed to delete file:', err);
    showToast(err.message || 'Failed to delete file', 'error');
  }
}

async function uploadFile() {
  el.uploadFileInput.click();
}

async function handleFileSelected() {
  const file = el.uploadFileInput.files[0];
  if (!file) return;

  // Show progress
  el.uploadProgress.classList.add('visible');
  el.uploadStatus.classList.add('visible');
  el.uploadStatus.textContent = `Uploading ${file.name}...`;
  el.uploadProgressBar.style.width = '0%';

  const formData = new FormData();
  formData.append('xml', file);

  try {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        el.uploadProgressBar.style.width = pct + '%';
        el.uploadStatus.textContent = `Uploading ${file.name}... ${pct}%`;
      }
    });

    await new Promise((resolve, reject) => {
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          let errMsg = 'Upload failed';
          try {
            const resp = JSON.parse(xhr.responseText);
            errMsg = resp.error || errMsg;
          } catch { /* ignore */ }
          reject(new Error(errMsg));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.open('POST', '/api/simulator/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${getToken()}`);
      xhr.send(formData);
    });

    el.uploadProgressBar.style.width = '100%';
    el.uploadStatus.textContent = 'Upload complete';
    showToast(`Uploaded: ${file.name}`, 'success', 2000);
    await loadFiles();
  } catch (err) {
    console.error('Upload error:', err);
    showToast(err.message || 'Upload failed', 'error');
  } finally {
    // Hide progress after a delay
    setTimeout(() => {
      el.uploadProgress.classList.remove('visible');
      el.uploadStatus.classList.remove('visible');
      el.uploadProgressBar.style.width = '0%';
    }, 2000);
    // Reset file input so the same file can be re-uploaded
    el.uploadFileInput.value = '';
  }
}

// ── Transport Controls ──

async function play() {
  try {
    const data = await api('POST', '/play');
    currentState = 'playing';
    updateUI(data);
    startPolling();
    showToast('Playing', 'success', 1500);
  } catch (err) {
    console.error('Play error:', err);
    showToast(err.message || 'Failed to play', 'error');
  }
}

async function pause() {
  try {
    const data = await api('POST', '/pause');
    currentState = 'paused';
    updateUI(data);
    stopPolling();
    showToast('Paused', 'info', 1500);
  } catch (err) {
    console.error('Pause error:', err);
    showToast(err.message || 'Failed to pause', 'error');
  }
}

async function stop() {
  try {
    const data = await api('POST', '/stop');
    currentState = 'stopped';
    currentPosition = 0;
    updateUI(data);
    stopPolling();
    showToast('Stopped', 'info', 1500);
  } catch (err) {
    console.error('Stop error:', err);
    showToast(err.message || 'Failed to stop', 'error');
  }
}

async function seek(position) {
  try {
    const data = await api('POST', '/seek', { position: Math.round(position) });
    currentPosition = data.position ?? position;
    updateUI(data);
  } catch (err) {
    console.error('Seek error:', err);
    showToast(err.message || 'Failed to seek', 'error');
  }
}

async function setRate(rate) {
  try {
    await api('PUT', '/rate', { rate });
    currentRate = rate;
    updateStatusPanel();
  } catch (err) {
    console.error('Set rate error:', err);
    showToast(err.message || 'Failed to set rate', 'error');
  }
}

function seekToStart() {
  seek(0);
}

// ── Status Polling ──

function startPolling() {
  stopPolling();
  pollInterval = setInterval(async () => {
    try {
      const status = await api('GET', '/status');
      updateUI(status);
    } catch (e) {
      /* ignore polling errors */
    }
  }, 500);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ── Timeline Rendering ──

function renderTimeline(timelineData, chunks) {
  if (!el.timelineTrack) return;
  el.timelineTrack.innerHTML = '';

  if (!timelineData || timelineData.length === 0 || !chunks) return;

  for (const segment of timelineData) {
    const segEl = document.createElement('div');
    segEl.className = 'timeline-segment';

    const startPct = (segment.startIndex / chunks) * 100;
    const widthPct = ((segment.endIndex - segment.startIndex) / chunks) * 100;

    segEl.style.left = startPct + '%';
    segEl.style.width = widthPct + '%';

    const status = (segment.status || segment.flag || '').toLowerCase();
    segEl.style.backgroundColor = FLAG_COLORS[status] || FLAG_DEFAULT_COLOR;

    if (segment.status || segment.flag) {
      segEl.title = (segment.status || segment.flag).toUpperCase();
    }

    el.timelineTrack.appendChild(segEl);
  }
}

function updateThumbPosition(position) {
  if (!el.timelineThumb || !totalChunks) return;
  const pct = Math.min(100, Math.max(0, (position / totalChunks) * 100));
  el.timelineThumb.style.left = pct + '%';
}

// ── Timeline Dragging ──

function setupTimelineDrag() {
  if (!el.timelineThumb || !el.timelineContainer) return;

  el.timelineThumb.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isDragging = true;
    el.timelineThumb.style.cursor = 'grabbing';
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = el.timelineContainer.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = x / rect.width;
    const pos = Math.round(pct * totalChunks);
    currentPosition = pos;
    updateThumbPosition(pos);
    updatePositionDisplay(pos);
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;
    el.timelineThumb.style.cursor = 'grab';
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    seek(currentPosition);
  });

  // Click on timeline to seek
  el.timelineContainer.addEventListener('click', (e) => {
    if (isDragging) return;
    // Ignore clicks on the thumb itself
    if (e.target === el.timelineThumb || el.timelineThumb.contains(e.target)) return;

    const rect = el.timelineContainer.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const pct = x / rect.width;
    const pos = Math.round(pct * totalChunks);
    currentPosition = pos;
    updateThumbPosition(pos);
    seek(pos);
  });
}

// ── Race Info Update ──

function updateRaceInfo() {
  if (!raceInfo) return;

  if (el.raceTitle) {
    el.raceTitle.textContent = raceInfo.title || raceInfo.raceName || raceInfo.name || 'Unknown Race';
  }
  if (el.raceLocation) {
    el.raceLocation.textContent = raceInfo.location || raceInfo.trackName || '--';
  }
  if (el.raceLaps) {
    el.raceLaps.textContent = raceInfo.totalLaps || raceInfo.laps || '--';
  }
  if (el.raceTrackLength) {
    el.raceTrackLength.textContent = raceInfo.trackLength ? raceInfo.trackLength + ' mi' : '--';
  }
}

// ── UI Update ──

function updateUI(status) {
  if (!status) return;

  // Update state
  if (status.state) {
    currentState = status.state;
  }

  // Update position (backend returns 'position', not 'currentPosition')
  if (status.position !== undefined) {
    currentPosition = status.position;
  }
  if (status.totalChunks !== undefined) {
    totalChunks = status.totalChunks;
  }
  if (status.rate !== undefined) {
    currentRate = status.rate;
  }

  // Update race info if present
  if (status.raceInfo) {
    raceInfo = status.raceInfo;
    updateRaceInfo();
  }

  // Update loaded file
  if (status.loadedFile !== undefined) {
    loadedFile = status.loadedFile;
  }

  // Position display
  updatePositionDisplay(currentPosition);

  // Elapsed time
  const elapsed = status.elapsedTime ?? status.elapsed ?? null;
  const totalTime = status.totalTime ?? null;

  if (el.elapsedTimeStart) {
    el.elapsedTimeStart.textContent = formatElapsed(elapsed);
  }
  if (el.elapsedTimeEnd) {
    el.elapsedTimeEnd.textContent = formatElapsed(totalTime);
  }
  if (el.elapsedDisplay) {
    el.elapsedDisplay.textContent = formatElapsed(elapsed);
  }
  if (el.raceElapsed) {
    el.raceElapsed.textContent = formatElapsed(elapsed);
  }

  // Race position
  if (el.racePosition) {
    el.racePosition.textContent = `${currentPosition} / ${totalChunks}`;
  }

  // Timeline thumb
  if (!isDragging) {
    updateThumbPosition(currentPosition);
  }

  // Transport button states
  updateTransportButtons();

  // State display
  updateStateDisplay();

  // Status panel
  updateStatusPanel();

  // Handle auto-stop when playback finishes
  if (currentState === 'stopped' && pollInterval) {
    stopPolling();
  }
}

function updatePositionDisplay(pos) {
  if (el.positionDisplay) {
    el.positionDisplay.textContent = `${pos} / ${totalChunks} chunks`;
  }
}

function updateTransportButtons() {
  // Remove active class from all
  el.btnPlay?.classList.remove('active');
  el.btnPause?.classList.remove('active');
  el.btnStop?.classList.remove('active');

  if (currentState === 'playing') {
    el.btnPlay?.classList.add('active');
  } else if (currentState === 'paused') {
    el.btnPause?.classList.add('active');
  } else {
    el.btnStop?.classList.add('active');
  }
}

function updateStateDisplay() {
  if (!el.stateDisplay) return;

  // Remove all state classes
  el.stateDisplay.classList.remove('stopped', 'playing', 'paused');

  switch (currentState) {
    case 'playing':
      el.stateDisplay.textContent = 'Playing';
      el.stateDisplay.classList.add('playing');
      break;
    case 'paused':
      el.stateDisplay.textContent = 'Paused';
      el.stateDisplay.classList.add('paused');
      break;
    default:
      el.stateDisplay.textContent = 'Stopped';
      el.stateDisplay.classList.add('stopped');
      break;
  }
}

function updateStatusPanel() {
  if (el.statusState) {
    el.statusState.textContent = currentState.charAt(0).toUpperCase() + currentState.slice(1);
  }
  if (el.statusFile) {
    el.statusFile.textContent = loadedFile || 'None';
    el.statusFile.title = loadedFile || '';
  }
  if (el.statusRate) {
    el.statusRate.textContent = currentRate + 'x';
  }
}

function resetUI() {
  currentState = 'stopped';
  currentPosition = 0;
  totalChunks = 0;
  raceInfo = null;
  timeline = [];
  loadedFile = null;

  if (el.raceTitle) el.raceTitle.textContent = 'No Race Loaded';
  if (el.raceLocation) el.raceLocation.textContent = '--';
  if (el.raceLaps) el.raceLaps.textContent = '--';
  if (el.raceTrackLength) el.raceTrackLength.textContent = '--';
  if (el.raceElapsed) el.raceElapsed.textContent = '--:--:--';
  if (el.racePosition) el.racePosition.textContent = '-- / --';
  if (el.elapsedTimeStart) el.elapsedTimeStart.textContent = '00:00:00';
  if (el.elapsedTimeEnd) el.elapsedTimeEnd.textContent = '--:--:--';
  if (el.positionDisplay) el.positionDisplay.textContent = '0 / 0 chunks';
  if (el.elapsedDisplay) el.elapsedDisplay.textContent = '00:00:00';
  if (el.timelineTrack) el.timelineTrack.innerHTML = '';

  updateThumbPosition(0);
  updateTransportButtons();
  updateStateDisplay();
  updateStatusPanel();
}

// ── User Info ──

function populateUserInfo() {
  const user = getUser();
  if (!user) return;

  const avatarEl = document.getElementById('userAvatar');
  const nameEl = document.getElementById('userName');
  const roleEl = document.getElementById('userRole');

  if (avatarEl && user.username) {
    avatarEl.textContent = user.username.substring(0, 2).toUpperCase();
  }
  if (nameEl) {
    nameEl.textContent = user.username || '---';
  }
  if (roleEl) {
    roleEl.textContent = user.role || '---';
  }
}

// ── Initialization ──

async function init() {
  // Auth gate
  if (!initAuth() || !isAuthenticated()) {
    window.location.href = '/';
    return;
  }

  // Cache DOM references
  cacheElements();

  // Populate user info
  populateUserInfo();

  // Wire up logout
  document.getElementById('logoutBtn')?.addEventListener('click', () => logout());

  // Transport controls
  el.btnSeekStart?.addEventListener('click', seekToStart);
  el.btnPlay?.addEventListener('click', play);
  el.btnPause?.addEventListener('click', pause);
  el.btnStop?.addEventListener('click', stop);

  // Rate selector
  el.rateSelect?.addEventListener('change', (e) => {
    const rate = parseFloat(e.target.value);
    if (!isNaN(rate)) setRate(rate);
  });

  // Upload
  el.uploadBtn?.addEventListener('click', uploadFile);
  el.uploadFileInput?.addEventListener('change', handleFileSelected);

  // Timeline drag
  setupTimelineDrag();

  // Load file list
  await loadFiles();

  // Check current simulator status (may already be running)
  try {
    const status = await api('GET', '/status');
    if (status) {
      if (status.loadedFile) {
        loadedFile = status.loadedFile;
      }
      if (status.raceInfo) {
        raceInfo = status.raceInfo;
        updateRaceInfo();
      }
      if (status.totalChunks) {
        totalChunks = status.totalChunks;
        // Fetch timeline separately
        try {
          const tl = await api('GET', '/timeline');
          if (Array.isArray(tl) && tl.length > 0) {
            timeline = tl;
            renderTimeline(timeline, totalChunks);
          }
        } catch { /* ignore */ }
      }
      updateUI(status);

      // If already playing, start polling
      if (status.state === 'playing') {
        startPolling();
      }

      // Sync rate selector
      if (status.rate && el.rateSelect) {
        el.rateSelect.value = String(status.rate);
      }

      // Refresh file list to show loaded state
      await loadFiles();
    }
  } catch (e) {
    // Simulator may not have status yet, ignore
    console.log('No existing simulator status');
  }
}

// ── Start ──
init().catch((err) => {
  console.error('Simulator initialization failed:', err);
  showToast('Failed to initialize simulator', 'error');
});
