/**
 * Per-client delay ring buffer for overlay WebSocket connections.
 * Buffers messages server-side and delivers them at a configured time offset.
 */
class DelayBuffer {
  constructor(delayMs, maxBufferMs = 65000) {
    this.delayMs = delayMs;
    this.maxBufferMs = maxBufferMs;
    this.buffer = [];
    this.drainTimer = null;
    this.onDrain = null;
  }

  setDelay(newDelayMs) {
    this.delayMs = newDelayMs;
  }

  push(message) {
    const now = Date.now();
    this.buffer.push({
      timestamp: now,
      deliverAt: now + this.delayMs,
      message,
    });

    // Prune old entries
    while (this.buffer.length > 0 && (now - this.buffer[0].timestamp) > this.maxBufferMs) {
      this.buffer.shift();
    }

    this.scheduleDrain();
  }

  scheduleDrain() {
    if (this.drainTimer) return;

    const now = Date.now();
    const next = this.buffer.find(entry => entry.deliverAt > now);

    if (!next) {
      this.drain();
      return;
    }

    const waitMs = Math.max(0, next.deliverAt - now);
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.drain();
    }, waitMs);
  }

  drain() {
    const now = Date.now();
    while (this.buffer.length > 0 && this.buffer[0].deliverAt <= now) {
      const entry = this.buffer.shift();
      if (this.onDrain) {
        this.onDrain(entry.message);
      }
    }

    if (this.buffer.length > 0) {
      this.scheduleDrain();
    }
  }

  flush() {
    while (this.buffer.length > 0) {
      const entry = this.buffer.shift();
      if (this.onDrain) this.onDrain(entry.message);
    }
  }

  clear() {
    this.buffer = [];
    if (this.drainTimer) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
  }

  getStats() {
    return {
      bufferedMessages: this.buffer.length,
      delayMs: this.delayMs,
      oldestMessageAge: this.buffer.length > 0 ? Date.now() - this.buffer[0].timestamp : 0,
    };
  }
}

module.exports = DelayBuffer;
