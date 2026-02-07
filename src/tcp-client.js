const net = require('net');
const { EventEmitter } = require('events');

/**
 * TCP client that connects to the IndyCar telemetry stream, buffers incoming data,
 * and extracts complete XML messages.
 *
 * Emits:
 *   'message' — { type: string, raw: string } for each complete message extracted
 *   'connected' — TCP connection established
 *   'disconnected' — TCP connection closed
 *   'error' — socket error
 */
class TcpClient extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.buffer = '';

    // Message delimiters for each XML message type
    this.messageTypes = [
      { type: 'telemetry',   start: '<Telemetry_Leaderboard',   end: '</Telemetry_Leaderboard>' },
      { type: 'pit',         start: '<Pit_Summary',             end: '/>' },
      { type: 'leaderboard', start: '<Unofficial_Leaderboard',  end: '</Unofficial_Leaderboard>' },
      { type: 'completedLap',start: '<Completed_Lap',           end: '/>' },
      { type: 'carStatus',   start: '<Car_Status',              end: '/>' },
      { type: 'flag',        start: '<Flag Elapsed_Time="',     end: '/>' },
    ];
  }

  connect(host, port) {
    this.client = net.connect({ host, port });

    this.client.on('connect', () => {
      console.log(`Connected to TCP server at ${host}:${port}`);
      this.emit('connected');
    });

    this.client.on('data', (data) => {
      this.buffer += data.toString();
      this.extractMessages();
    });

    this.client.on('end', () => {
      console.log('TCP connection ended.');
      this.emit('disconnected');
    });

    this.client.on('error', (err) => {
      console.error('TCP socket error:', err.message);
      this.emit('error', err);
    });

    this.client.on('close', () => {
      console.log('TCP socket closed.');
    });
  }

  destroy() {
    if (this.client) {
      this.client.destroy();
      this.client = null;
    }
    this.buffer = '';
  }

  /**
   * Scan the buffer for complete XML messages and emit them.
   * Handles the fact that TCP may deliver partial or multiple messages in a single chunk.
   */
  extractMessages() {
    let foundMessage = true;

    while (foundMessage && this.buffer.length > 0) {
      foundMessage = false;

      // Find the first occurring message start tag
      let earliest = { index: -1, type: null };

      for (const mt of this.messageTypes) {
        const idx = this.buffer.indexOf(mt.start);
        if (idx !== -1 && (earliest.index === -1 || idx < earliest.index)) {
          earliest = { index: idx, type: mt };
        }
      }

      if (earliest.index === -1) break; // No start tag found

      const mt = earliest.type;
      const startIdx = earliest.index;

      // For self-closing tags (/>), search from after the start tag to avoid
      // matching the start tag itself if it contains '/>'
      const searchFrom = mt.end === '/>'
        ? startIdx + mt.start.length
        : startIdx;

      const endIdx = this.buffer.indexOf(mt.end, searchFrom);

      if (endIdx === -1) {
        // Discard any garbage before the start tag
        if (startIdx > 0) {
          this.buffer = this.buffer.substring(startIdx);
        }
        break; // Incomplete message, wait for more data
      }

      const raw = this.buffer.substring(startIdx, endIdx + mt.end.length);
      this.buffer = this.buffer.substring(endIdx + mt.end.length);
      foundMessage = true;

      this.emit('message', { type: mt.type, raw });
    }
  }
}

module.exports = TcpClient;
