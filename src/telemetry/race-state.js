const { EventEmitter } = require('events');

/**
 * Centralized race state. Replaces all global variables from the original monolith.
 *
 * Emits events on state changes so that output consumers (Google Sheets, future WebSocket
 * server, etc.) can subscribe without coupling to the data pipeline.
 *
 * Events emitted:
 *   'telemetry'   — full telemetry data updated for all cars
 *   'leaderboard' — race standings updated
 *   'lap'         — a car completed a lap
 *   'pit'         — a car's pit status changed
 *   'carStatus'   — a car's running/DNF status changed
 *   'flag'        — flag/race control state changed
 */
class RaceState extends EventEmitter {
  constructor() {
    super();

    // Connection / control
    this.isOnline = false;
    this.tcpHost = 'localhost';
    this.tcpPort = 5000;
    this.targetCarNumbers = [null, null, null];

    // Reference data (loaded once at startup from Google Sheets)
    this.referenceData = {
      drivers: {},
      tireImages: {},
      indicatorImages: {},
      leaderboardImages: {},
    };

    // Live race data
    this.telemetry = [];          // All cars' latest telemetry
    this.targetTelemetry = {};    // Primary target car only
    this.leaderboard = [];        // Current standings
    this.lapData = [];            // Per-car latest lap info
    this.allLapTimes = [];        // Historical lap times per car
    this.carStatus = [];          // Running / DNF per car
    this.pitStatus = [];          // Pit lane state per car
    this.averageSpeed = [];       // Average speed per car per lap
    this.manualDNFOverride = [];  // Manual DNF entries from control sheet

    // Per-car visualization state (delta colors, split colors)
    this.carStates = {};

    // Race-level state
    this.lapsCompleted = 0;
    this.currentLap = 0;
    this.flagColor = undefined;
    this.timeElapsed = undefined;
  }

  /**
   * Initialize per-driver data structures from reference data.
   * Called once after reference data is loaded.
   */
  initializeDriverData() {
    const carNumbers = Object.keys(this.referenceData.drivers);

    this.lapData = [];
    this.allLapTimes = [];
    this.carStatus = [];
    this.pitStatus = [];
    this.averageSpeed = [];
    this.manualDNFOverride = [];

    for (const carNumber of carNumbers) {
      this.lapData.push({
        carNumber,
        fastestLap: '-',
        lastLapNumber: '0',
        lastLapTime: '-',
        totalTime: '-',
        lapsBehindLeader: '-',
        timeBehindLeader: '-',
        lastLapDelta: ' ',
      });

      this.allLapTimes.push({
        carNumber,
        fastestLapNumber: '0',
        fastestLapTime: '0:00.000',
        lapTimes: [{ lapNumber: 0, lapTime: '-' }],
      });

      this.carStatus.push({
        carNumber,
        carStatus: '-',
      });

      this.pitStatus.push({
        carNumber,
        pitStatus: false,
        pitStops: 0,
      });

      this.averageSpeed.push({
        carNumber,
        averageSpeedLapNumber: '-',
        lastLapAverage: '-',
        currentLapSpeeds: [],
      });

      this.manualDNFOverride.push({
        carNumber,
        DNF: false,
      });
    }
  }

  /**
   * Initialize or retrieve per-car visualization state.
   */
  getCarState(carNumber) {
    if (!this.carStates[carNumber]) {
      this.carStates[carNumber] = {
        prevLapDeltaColorState: 'white',
        prevLapDeltaValue: null,
        prevDriverAheadSplitColorState: 'white',
        prevDriverAheadSplitValue: null,
        prevDriverBehindSplitColorState: 'white',
        prevDriverBehindSplitValue: null,
        lapsCompleted: 0,
      };
    }
    return this.carStates[carNumber];
  }

  // --- State update methods that emit events ---

  updateTelemetry(fullData, targetData) {
    this.telemetry = fullData;
    if (targetData) this.targetTelemetry = targetData;
    this.emit('telemetry', { full: fullData, target: targetData });
  }

  updateLeaderboard(data) {
    this.leaderboard = data;
    this.emit('leaderboard', data);
  }

  updateLapData(carNumber, lapDataObj) {
    const index = this.lapData.findIndex(item => item.carNumber === carNumber);
    if (index !== -1) {
      this.lapData[index] = lapDataObj;
    } else {
      this.lapData.push(lapDataObj);
    }
    this.emit('lap', lapDataObj);
  }

  updatePitStatus(carNumber, pitStatusObj) {
    const index = this.pitStatus.findIndex(item => item.carNumber === carNumber);
    if (index !== -1) {
      this.pitStatus[index] = pitStatusObj;
    }
    this.emit('pit', pitStatusObj);
  }

  updateCarStatus(carNumber, statusObj) {
    const index = this.carStatus.findIndex(item => item.carNumber === carNumber);
    if (index !== -1) {
      this.carStatus[index] = statusObj;
    } else {
      this.carStatus.push(statusObj);
    }
    this.emit('carStatus', statusObj);
  }

  updateFlag(flagColor, lapsCompleted, timeElapsed) {
    this.flagColor = flagColor;
    this.lapsCompleted = lapsCompleted;
    this.timeElapsed = timeElapsed;
    this.currentLap = flagColor === 'finish'
      ? parseInt(lapsCompleted)
      : parseInt(lapsCompleted) + 1;
    this.emit('flag', { flagColor, lapsCompleted, currentLap: this.currentLap, timeElapsed });
  }

  /**
   * Reset live data when going offline.
   */
  resetLiveData() {
    this.targetTelemetry = {};
    this.telemetry = [];
    this.leaderboard = [];
  }
}

module.exports = new RaceState();
