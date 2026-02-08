const path = require('path');
const fs = require('fs');
const constants = require('../config/constants');
const { processMessage } = require('../telemetry/message-processor');
const metricsService = require('./metrics.service');

// ---------------------------------------------------------------------------
// XML chunking (reused from tools/simulator.js)
// ---------------------------------------------------------------------------

const TOP_LEVEL_ELEMENTS = [
  'Telemetry_Leaderboard',
  'Pit_Summary',
  'Unofficial_Leaderboard',
  'Completed_Lap',
  'Car_Status',
  'Flag',
  'Race_Information',
  'Race_Summary',
];

/**
 * Map XML element types to message-processor types.
 * Race_Information and Race_Summary are metadata-only (null = not sent to processor).
 */
const TYPE_MAP = {
  Telemetry_Leaderboard: 'telemetry',
  Pit_Summary: 'pit',
  Unofficial_Leaderboard: 'leaderboard',
  Completed_Lap: 'completedLap',
  Car_Status: 'carStatus',
  Flag: 'flag',
  Race_Information: null,
  Race_Summary: null,
};

/**
 * Split raw XML text into individual message chunks.
 * Each chunk is one complete top-level XML element.
 */
function splitIntoChunks(xmlText) {
  const chunks = [];
  const lines = xmlText.split('\n');

  let currentType = null;
  let currentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (currentType === null) {
      const openMatch = matchOpenTag(trimmed);
      if (openMatch) {
        currentType = openMatch.type;

        if (openMatch.selfClosing) {
          chunks.push({ type: currentType, xml: trimmed, msgType: TYPE_MAP[currentType] });
          currentType = null;
          currentLines = [];
        } else {
          currentLines = [line];

          if (hasClosingTag(trimmed, currentType)) {
            chunks.push({ type: currentType, xml: currentLines.join('\n'), msgType: TYPE_MAP[currentType] });
            currentType = null;
            currentLines = [];
          }
        }
      }
    } else {
      currentLines.push(line);

      if (hasClosingTag(trimmed, currentType)) {
        chunks.push({ type: currentType, xml: currentLines.join('\n'), msgType: TYPE_MAP[currentType] });
        currentType = null;
        currentLines = [];
      }
    }
  }

  if (currentType && currentLines.length > 0) {
    console.warn(`[simulator] Warning: unclosed element <${currentType}> at end of file`);
    chunks.push({ type: currentType, xml: currentLines.join('\n'), msgType: TYPE_MAP[currentType] });
  }

  return chunks;
}

function matchOpenTag(trimmed) {
  for (const tag of TOP_LEVEL_ELEMENTS) {
    if (trimmed.startsWith(`<${tag}`) && !trimmed.startsWith(`</${tag}`)) {
      const selfClosing = trimmed.endsWith('/>');
      return { type: tag, selfClosing };
    }
  }
  return null;
}

function hasClosingTag(trimmed, type) {
  return trimmed.includes(`</${type}>`);
}

// ---------------------------------------------------------------------------
// Elapsed time parsing
// ---------------------------------------------------------------------------

/**
 * Parse elapsed time string "HH:MM:SS.fff" or "H:MM:SS.fff" to milliseconds.
 */
function parseElapsedTime(timeStr) {
  if (!timeStr) return null;

  const match = timeStr.match(/^(\d{1,2}):(\d{2}):(\d{2})\.(\d+)$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseInt(match[3], 10);
  const fraction = parseInt(match[4].padEnd(3, '0').slice(0, 3), 10);

  return (hours * 3600 + minutes * 60 + seconds) * 1000 + fraction;
}

// ---------------------------------------------------------------------------
// Race info extraction
// ---------------------------------------------------------------------------

/**
 * Extract race information from a Race_Information XML chunk.
 * Looks for <Title>, <Laps>, <Location>, <Time>, <Track_Length> child elements.
 */
function extractRaceInfo(xml) {
  const extract = (tag) => {
    const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return match ? match[1].trim() : null;
  };

  return {
    title: extract('Title'),
    laps: extract('Laps') ? parseInt(extract('Laps'), 10) : null,
    location: extract('Location'),
    startTime: extract('Time'),
    trackLength: extract('Track_Length') ? parseFloat(extract('Track_Length')) : null,
  };
}

// ---------------------------------------------------------------------------
// Flag timeline builder
// ---------------------------------------------------------------------------

/**
 * Extract elapsed time and status from a Flag chunk.
 */
function extractFlagData(xml) {
  const statusMatch = xml.match(/Status="([^"]*)"/);
  const timeMatch = xml.match(/Elapsed_Time="([^"]*)"/);
  const lapsMatch = xml.match(/Laps_Completed="([^"]*)"/);

  return {
    status: statusMatch ? statusMatch[1] : null,
    elapsedTime: timeMatch ? timeMatch[1] : null,
    lapsCompleted: lapsMatch ? lapsMatch[1] : null,
  };
}

/**
 * Build a flag timeline from chunks. Each segment captures the start/end
 * chunk indices and elapsed times for a contiguous flag state.
 */
function buildFlagTimeline(chunks) {
  const timeline = [];
  let currentSegment = null;

  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].type !== 'Flag') continue;

    const flagData = extractFlagData(chunks[i].xml);
    if (!flagData.status) continue;

    if (currentSegment && currentSegment.status === flagData.status) {
      // Extend current segment
      currentSegment.endIndex = i;
      currentSegment.elapsedTimeEnd = flagData.elapsedTime;
    } else {
      // Close previous segment
      if (currentSegment) {
        currentSegment.endIndex = i - 1;
        timeline.push(currentSegment);
      }

      // Start new segment
      currentSegment = {
        startIndex: i,
        endIndex: i,
        status: flagData.status,
        elapsedTimeStart: flagData.elapsedTime,
        elapsedTimeEnd: flagData.elapsedTime,
      };
    }
  }

  // Push final segment
  if (currentSegment) {
    timeline.push(currentSegment);
  }

  return timeline;
}

// ---------------------------------------------------------------------------
// Delay computation
// ---------------------------------------------------------------------------

/**
 * Build per-chunk delays for real-time playback using Flag elapsed times as
 * anchor points. Between anchors, delays are distributed evenly. Chunks
 * without timing info default to 100ms.
 */
function buildDelays(chunks) {
  const DEFAULT_DELAY = 100;
  const delays = new Array(chunks.length).fill(DEFAULT_DELAY);

  // Collect anchor points: indices with known elapsed times (from Flag chunks)
  const anchors = [];
  for (let i = 0; i < chunks.length; i++) {
    if (chunks[i].type === 'Flag') {
      const flagData = extractFlagData(chunks[i].xml);
      const ms = parseElapsedTime(flagData.elapsedTime);
      if (ms !== null) {
        anchors.push({ index: i, timeMs: ms });
      }
    }
  }

  if (anchors.length < 2) {
    // Not enough anchors — use default delay for all chunks
    return delays;
  }

  // For each pair of consecutive anchors, compute the total real time elapsed
  // and distribute it evenly across the chunks between them
  for (let a = 0; a < anchors.length - 1; a++) {
    const startIdx = anchors[a].index;
    const endIdx = anchors[a + 1].index;
    const timeDelta = anchors[a + 1].timeMs - anchors[a].timeMs;
    const chunkCount = endIdx - startIdx;

    if (chunkCount > 0 && timeDelta > 0) {
      const perChunkDelay = timeDelta / chunkCount;
      for (let i = startIdx; i < endIdx; i++) {
        delays[i] = perChunkDelay;
      }
    }
  }

  // First chunk has no delay (starts immediately)
  delays[0] = 0;

  return delays;
}

// ---------------------------------------------------------------------------
// Simulator directory helpers
// ---------------------------------------------------------------------------

function getSimulatorDir() {
  const dir = path.join(constants.DATA_DIR, 'simulator');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Sanitize a filename to prevent path traversal.
 */
function sanitizeFilename(filename) {
  return path.basename(filename);
}

// ---------------------------------------------------------------------------
// SimulatorService
// ---------------------------------------------------------------------------

class SimulatorService {
  constructor() {
    this.chunks = [];
    this.timeline = [];
    this.raceInfo = null;
    this.delays = [];

    this.state = 'stopped';
    this.position = 0;
    this.rate = 1;
    this.loadedFile = null;
    this.playTimer = null;

    // TCP control callbacks (set by server.js)
    this._tcpDisconnect = null;
    this._tcpReconnect = null;

    // Status broadcast callback (set by server.js)
    this._onStatusChange = null;
  }

  /**
   * Set TCP control callbacks so the simulator can disconnect TCP
   * during playback and reconnect when stopped.
   */
  setTcpControl({ disconnect, reconnect }) {
    this._tcpDisconnect = disconnect;
    this._tcpReconnect = reconnect;
  }

  /**
   * Set a callback to be invoked whenever simulator state changes.
   * @param {Function} fn - Called with getStatus() result
   */
  onStatusChange(fn) {
    this._onStatusChange = fn;
  }

  /** Broadcast current status to listeners. */
  _broadcastStatus() {
    if (this._onStatusChange) this._onStatusChange(this.getStatus());
  }

  // ── File Management ──

  /**
   * Returns array of { name, size, modified } for XML files in data/simulator/.
   */
  getFiles() {
    const dir = getSimulatorDir();
    const files = fs.readdirSync(dir);

    return files
      .filter(f => path.extname(f).toLowerCase() === '.xml')
      .map(f => {
        const filePath = path.join(dir, f);
        const stats = fs.statSync(filePath);
        return {
          name: f,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }

  /**
   * Delete a file from data/simulator/.
   */
  deleteFile(filename) {
    const safeName = sanitizeFilename(filename);
    const filePath = path.join(getSimulatorDir(), safeName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${safeName}`);
    }

    // If this file is currently loaded, stop playback first
    if (this.loadedFile === safeName) {
      this.stop();
      this.loadedFile = null;
      this.chunks = [];
      this.timeline = [];
      this.raceInfo = null;
      this.delays = [];
    }

    fs.unlinkSync(filePath);
  }

  // ── Loading & Parsing ──

  /**
   * Load and parse an XML file. Builds chunks, timeline, delays, and extracts race info.
   * Returns { raceInfo, timeline, totalChunks }.
   */
  load(filename) {
    const safeName = sanitizeFilename(filename);
    const filePath = path.join(getSimulatorDir(), safeName);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${safeName}`);
    }

    // Stop any current playback
    this.stop();

    console.log(`[simulator] Loading XML from: ${filePath}`);
    const xmlText = fs.readFileSync(filePath, 'utf-8');
    console.log(`[simulator] File size: ${(xmlText.length / 1024 / 1024).toFixed(2)} MB`);

    // Parse into chunks
    this.chunks = splitIntoChunks(xmlText);
    console.log(`[simulator] Parsed ${this.chunks.length} message chunks`);

    // Log type breakdown
    const typeCounts = {};
    for (const chunk of this.chunks) {
      typeCounts[chunk.type] = (typeCounts[chunk.type] || 0) + 1;
    }
    console.log('[simulator] Message breakdown:');
    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`);
    }

    // Extract race info from the first Race_Information chunk
    this.raceInfo = null;
    for (const chunk of this.chunks) {
      if (chunk.type === 'Race_Information') {
        this.raceInfo = extractRaceInfo(chunk.xml);
        break;
      }
    }

    // Build flag timeline
    this.timeline = buildFlagTimeline(this.chunks);

    // Build per-chunk delays
    this.delays = buildDelays(this.chunks);

    this.loadedFile = safeName;
    this.position = 0;
    this.state = 'stopped';

    console.log(`[simulator] Loaded "${safeName}": ${this.chunks.length} chunks, ${this.timeline.length} flag segments`);
    if (this.raceInfo) {
      console.log(`[simulator] Race: ${this.raceInfo.title} at ${this.raceInfo.location}`);
    }

    return {
      raceInfo: this.raceInfo,
      timeline: this.timeline,
      totalChunks: this.chunks.length,
    };
  }

  // ── Playback Controls ──

  /**
   * Start or resume playback.
   */
  play() {
    if (this.chunks.length === 0) {
      throw new Error('No file loaded');
    }

    if (this.state === 'playing') {
      return; // Already playing
    }

    if (this.position >= this.chunks.length) {
      // Reached the end — reset to beginning
      this.position = 0;
    }

    // Disconnect TCP so live data doesn't interfere with simulation
    if (this._tcpDisconnect) this._tcpDisconnect();

    this.state = 'playing';
    console.log(`[simulator] Playing from position ${this.position}/${this.chunks.length} at ${this.rate}x`);
    this._broadcastStatus();
    this._playNext();
  }

  /**
   * Pause playback.
   */
  pause() {
    if (this.state !== 'playing') return;

    this.state = 'paused';
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
    console.log(`[simulator] Paused at position ${this.position}/${this.chunks.length}`);
    this._broadcastStatus();
  }

  /**
   * Stop playback and reset position to 0.
   */
  stop() {
    const wasPlaying = this.state === 'playing' || this.state === 'paused';
    this.state = 'stopped';
    this.position = 0;
    if (this.playTimer) {
      clearTimeout(this.playTimer);
      this.playTimer = null;
    }
    console.log('[simulator] Stopped');
    this._broadcastStatus();

    // Reconnect TCP when stopping simulator
    if (wasPlaying && this._tcpReconnect) this._tcpReconnect();
  }

  /**
   * Jump to a specific chunk index (0-based).
   */
  seek(position) {
    if (this.chunks.length === 0) {
      throw new Error('No file loaded');
    }

    const pos = parseInt(position, 10);
    if (isNaN(pos) || pos < 0 || pos >= this.chunks.length) {
      throw new Error(`Invalid position: ${position}. Must be 0-${this.chunks.length - 1}`);
    }

    this.position = pos;
    console.log(`[simulator] Seeked to position ${this.position}/${this.chunks.length}`);

    // If currently playing, restart the playback loop from the new position
    if (this.state === 'playing') {
      if (this.playTimer) {
        clearTimeout(this.playTimer);
        this.playTimer = null;
      }
      this._playNext();
    }
  }

  /**
   * Set playback rate multiplier (0.25 to 20).
   */
  setRate(rate) {
    const r = parseFloat(rate);
    if (isNaN(r) || r < 0.25 || r > 20) {
      throw new Error(`Invalid rate: ${rate}. Must be 0.25-20`);
    }

    this.rate = r;
    console.log(`[simulator] Rate set to ${this.rate}x`);
  }

  /**
   * Get current playback status.
   */
  getStatus() {
    // Compute current elapsed time from the nearest flag anchor at or before position
    let elapsedTime = null;
    if (this.chunks.length > 0) {
      for (let i = this.position; i >= 0; i--) {
        if (this.chunks[i] && this.chunks[i].type === 'Flag') {
          const flagData = extractFlagData(this.chunks[i].xml);
          if (flagData.elapsedTime) {
            elapsedTime = flagData.elapsedTime;
            break;
          }
        }
      }
    }

    return {
      state: this.state,
      position: this.position,
      totalChunks: this.chunks.length,
      rate: this.rate,
      loadedFile: this.loadedFile,
      raceInfo: this.raceInfo,
      elapsedTime,
    };
  }

  /**
   * Returns the flag timeline array.
   */
  getTimeline() {
    return this.timeline;
  }

  // ── Internal Playback Loop ──

  /**
   * Process the current chunk and schedule the next one.
   */
  _playNext() {
    if (this.state !== 'playing') return;

    if (this.position >= this.chunks.length) {
      // Reached the end
      this.state = 'stopped';
      console.log('[simulator] Playback complete — end of file reached');
      this._broadcastStatus();
      if (this._tcpReconnect) this._tcpReconnect();
      return;
    }

    const chunk = this.chunks[this.position];

    // Send to message processor if it has a mapped type (not metadata)
    if (chunk.msgType) {
      metricsService.recordMessage(chunk.msgType);
      processMessage({ type: chunk.msgType, raw: chunk.xml });
    }

    this.position++;

    // Check if we've reached the end after incrementing
    if (this.position >= this.chunks.length) {
      this.state = 'stopped';
      console.log('[simulator] Playback complete — end of file reached');
      this._broadcastStatus();
      if (this._tcpReconnect) this._tcpReconnect();
      return;
    }

    // Compute delay for the next chunk
    const rawDelay = this.delays[this.position] || 100;
    const actualDelay = Math.max(1, rawDelay / this.rate);

    this.playTimer = setTimeout(() => this._playNext(), actualDelay);
  }
}

module.exports = new SimulatorService();
