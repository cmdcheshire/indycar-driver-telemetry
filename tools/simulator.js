#!/usr/bin/env node

/**
 * TCP Telemetry Simulator
 *
 * Replays IndyCar telemetry XML data over TCP for testing purposes.
 * Reads an XML file containing mixed message types, splits it into individual
 * top-level XML chunks, and streams them to connected clients with a
 * configurable delay.
 *
 * Usage:
 *   node tools/simulator.js [--port 5000] [--delay 200]
 *
 * Options:
 *   --port   TCP port to listen on (default: 5000)
 *   --delay  Milliseconds between each message chunk (default: 200)
 */

const net  = require('net');
const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const config = { port: 5000, delay: 200 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      config.port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--delay' && args[i + 1]) {
      config.delay = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: node tools/simulator.js [--port 5000] [--delay 200]');
      console.log('');
      console.log('Options:');
      console.log('  --port   TCP port to listen on (default: 5000)');
      console.log('  --delay  Milliseconds between messages (default: 200)');
      process.exit(0);
    }
  }

  return config;
}

// ---------------------------------------------------------------------------
// XML file loading
// ---------------------------------------------------------------------------

/**
 * Resolve the XML file path. Prefer "full telemetry.xml"; fall back to
 * "telemetry.xml" in the same directory.
 */
function resolveXmlPath() {
  const baseDir  = path.resolve('/Users/chris.cheshire/Documents/Indycar/indycar-stream-tester');
  const primary  = path.join(baseDir, 'full telemetry.xml');
  const fallback = path.join(baseDir, 'telemetry.xml');

  if (fs.existsSync(primary)) {
    return primary;
  }

  if (fs.existsSync(fallback)) {
    console.log(`[simulator] "full telemetry.xml" not found, using fallback: ${fallback}`);
    return fallback;
  }

  console.error('[simulator] No XML file found at either:');
  console.error(`  ${primary}`);
  console.error(`  ${fallback}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// XML chunking
// ---------------------------------------------------------------------------

/**
 * Known top-level XML element names in the telemetry feed.
 */
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
 * Split raw XML text into individual message chunks. Each chunk is one
 * complete top-level XML element (from opening tag to closing tag, or a
 * self-closing tag).
 *
 * This parser works line-by-line for memory efficiency on large files.
 *
 * @param {string} xmlText - The full XML file contents.
 * @returns {Array<{type: string, xml: string}>}
 */
function splitIntoChunks(xmlText) {
  const chunks = [];
  const lines  = xmlText.split('\n');

  let currentType  = null;
  let currentLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) continue;

    if (currentType === null) {
      // Look for the start of a top-level element
      const openMatch = matchOpenTag(trimmed);
      if (openMatch) {
        currentType = openMatch.type;

        // Check if it is a self-closing tag (e.g. <Flag ... />)
        if (openMatch.selfClosing) {
          chunks.push({ type: currentType, xml: trimmed });
          currentType = null;
          currentLines = [];
        } else {
          currentLines = [line];

          // Check if the closing tag is on the same line
          if (hasClosingTag(trimmed, currentType)) {
            chunks.push({ type: currentType, xml: currentLines.join('\n') });
            currentType = null;
            currentLines = [];
          }
        }
      }
      // Else: skip non-element lines (whitespace, comments, etc.)
    } else {
      // We are inside a multi-line element - accumulate lines
      currentLines.push(line);

      // Check for the closing tag
      if (hasClosingTag(trimmed, currentType)) {
        chunks.push({ type: currentType, xml: currentLines.join('\n') });
        currentType = null;
        currentLines = [];
      }
    }
  }

  // Handle an element that was never closed (shouldn't happen in valid data)
  if (currentType && currentLines.length > 0) {
    console.warn(`[simulator] Warning: unclosed element <${currentType}> at end of file`);
    chunks.push({ type: currentType, xml: currentLines.join('\n') });
  }

  return chunks;
}

/**
 * Try to match a top-level opening tag at the start of a trimmed line.
 * Returns { type, selfClosing } or null.
 */
function matchOpenTag(trimmed) {
  for (const tag of TOP_LEVEL_ELEMENTS) {
    // Match <Tag, <Tag>, <Tag , or <Tag/
    if (trimmed.startsWith(`<${tag}`) && !trimmed.startsWith(`</${tag}`)) {
      const selfClosing = trimmed.endsWith('/>');
      return { type: tag, selfClosing };
    }
  }
  return null;
}

/**
 * Check if a line contains the closing tag for a given element type.
 */
function hasClosingTag(trimmed, type) {
  return trimmed.includes(`</${type}>`);
}

// ---------------------------------------------------------------------------
// Client streaming
// ---------------------------------------------------------------------------

/**
 * Stream chunks to a connected socket. Loops indefinitely until the socket
 * is destroyed.
 */
async function streamToClient(socket, chunks, delay) {
  const addr = `${socket.remoteAddress}:${socket.remotePort}`;
  let loopCount = 0;

  while (!socket.destroyed) {
    loopCount++;
    console.log(`[simulator] Starting loop #${loopCount} for client ${addr} (${chunks.length} chunks)`);

    for (let i = 0; i < chunks.length; i++) {
      if (socket.destroyed) return;

      const chunk = chunks[i];

      try {
        // Write the XML chunk followed by a newline delimiter
        const ok = socket.write(chunk.xml + '\n');

        // Minimal logging: type and index
        if (i % 100 === 0 || chunk.type !== 'Telemetry_Leaderboard') {
          console.log(`[simulator] -> ${addr}  [${i + 1}/${chunks.length}] ${chunk.type}`);
        }

        // If back-pressure, wait for drain before continuing
        if (!ok) {
          await new Promise(resolve => socket.once('drain', resolve));
        }
      } catch (err) {
        if (!socket.destroyed) {
          console.error(`[simulator] Write error for ${addr}:`, err.message);
        }
        return;
      }

      // Delay between chunks
      await sleep(delay);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const config = parseArgs();

  // Load and parse XML
  const xmlPath = resolveXmlPath();
  console.log(`[simulator] Loading XML from: ${xmlPath}`);

  const xmlText = fs.readFileSync(xmlPath, 'utf-8');
  console.log(`[simulator] File size: ${(xmlText.length / 1024 / 1024).toFixed(2)} MB`);

  const chunks = splitIntoChunks(xmlText);
  console.log(`[simulator] Parsed ${chunks.length} message chunks`);

  // Log type breakdown
  const typeCounts = {};
  for (const chunk of chunks) {
    typeCounts[chunk.type] = (typeCounts[chunk.type] || 0) + 1;
  }
  console.log('[simulator] Message breakdown:');
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  if (chunks.length === 0) {
    console.error('[simulator] No message chunks found in XML file. Exiting.');
    process.exit(1);
  }

  // Start TCP server
  const server = net.createServer(socket => {
    const addr = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[simulator] Client connected: ${addr}`);

    socket.on('error', err => {
      console.log(`[simulator] Client ${addr} error: ${err.message}`);
    });

    socket.on('close', () => {
      console.log(`[simulator] Client disconnected: ${addr}`);
    });

    // Start streaming to this client
    streamToClient(socket, chunks, config.delay).catch(err => {
      console.error(`[simulator] Stream error for ${addr}:`, err.message);
    });
  });

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[simulator] Port ${config.port} is already in use`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(config.port, () => {
    console.log('');
    console.log('='.repeat(60));
    console.log(`  IndyCar Telemetry Simulator`);
    console.log(`  TCP server listening on port ${config.port}`);
    console.log(`  Delay between messages: ${config.delay}ms`);
    console.log(`  Total chunks to replay: ${chunks.length}`);
    console.log('='.repeat(60));
    console.log('');
    console.log('Waiting for client connections...');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[simulator] Shutting down...');
    server.close(() => {
      console.log('[simulator] Server closed');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
  });
}

main();
