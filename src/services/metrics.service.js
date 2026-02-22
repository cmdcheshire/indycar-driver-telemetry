/**
 * Tracks message throughput and system metrics.
 */
class MetricsService {
  constructor() {
    this.counters = {
      telemetry: 0,
      leaderboard: 0,
      pit: 0,
      completedLap: 0,
      carStatus: 0,
      flag: 0,
    };

    this.rates = {
      telemetry: 0,
      leaderboard: 0,
      pit: 0,
      completedLap: 0,
      carStatus: 0,
      flag: 0,
    };

    this.totalMessages = 0;
    this.startTime = Date.now();
    this._prevCounters = { ...this.counters };
    this._rateInterval = null;
  }

  start() {
    // Calculate rates every second
    this._rateInterval = setInterval(() => {
      for (const type of Object.keys(this.counters)) {
        this.rates[type] = this.counters[type] - this._prevCounters[type];
        this._prevCounters[type] = this.counters[type];
      }
    }, 1000);
  }

  stop() {
    if (this._rateInterval) {
      clearInterval(this._rateInterval);
      this._rateInterval = null;
    }
  }

  recordMessage(type) {
    if (this.counters[type] !== undefined) {
      this.counters[type]++;
    }
    this.totalMessages++;
  }

  getMetrics() {
    return {
      messagesPerSecond: { ...this.rates },
      totalMessages: this.totalMessages,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}

module.exports = new MetricsService();
