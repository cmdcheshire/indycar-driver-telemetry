const xml2js = require('xml2js');
const state = require('./race-state');
const { BadDataError } = require('./errors');
const { toFixedDecimal } = require('./utils');

const xmlParser = new xml2js.Parser({ explicitRoot: false, ignoreAttributes: false, trim: true });

/**
 * Process a raw XML message extracted from the TCP stream.
 * Parses the XML, then routes to the appropriate handler based on message type.
 */
async function processMessage({ type, raw }) {
  let result;
  try {
    result = await xmlParser.parseStringPromise(raw);
  } catch (err) {
    console.error(`XML parse error (${type}):`, err.message);
    return;
  }

  if (!result) {
    console.error(`XML parse returned null (${type})`);
    return;
  }

  try {
    switch (type) {
      case 'telemetry':   processTelemetry(result); break;
      case 'pit':         processPitSummary(result); break;
      case 'leaderboard': processLeaderboard(result); break;
      case 'completedLap':processCompletedLap(result); break;
      case 'carStatus':   processCarStatus(result); break;
      case 'flag':        processFlag(result); break;
    }
  } catch (error) {
    if (error instanceof BadDataError) {
      console.warn('Bad data:', error.message);
    } else {
      console.error(`Error processing ${type}:`, error.message);
    }
  }
}

// ──────────────────────────────────────────────
// Message handlers
// ──────────────────────────────────────────────

function processTelemetry(result) {
  const positions = Array.isArray(result.Position) ? result.Position : [result.Position];

  // Build full telemetry array
  const fullData = positions.map(pos => ({
    carNumber: pos.$.Car,
    rank: parseInt(pos.$.Rank, 10),
    speed: parseFloat(pos.$.speed),
    rpm: parseInt(pos.$.rpm, 10),
    throttle: parseInt(pos.$.throttle, 10),
    brake: parseInt(pos.$.brake, 10),
    battery: parseInt(pos.$.Battery_Pct_Remaining, 10),
    pitStop: 0,
  }));

  // Extract target car data
  const targetCar = state.targetCarNumbers[0];
  const targetData = targetCar
    ? fullData.find(item => item.carNumber === targetCar) || null
    : null;

  // Accumulate speeds for average speed calculation
  for (const car of fullData) {
    const avgIdx = state.averageSpeed.findIndex(item => item.carNumber === car.carNumber);
    if (avgIdx !== -1) {
      state.averageSpeed[avgIdx].currentLapSpeeds.push(car.speed);
    }
  }

  state.updateTelemetry(fullData, targetData);
}

function processPitSummary(result) {
  const carNumber = result.$.Car;
  const entryTime = result.$.Pit_Lane_Entry_Time;
  const exitTime = result.$.Pit_Lane_Exit_Time;

  // In pit if entry time exists but exit time is empty
  const inPit = entryTime !== '' && exitTime === '';

  const pitStatusObj = {
    carNumber,
    pitStatus: inPit,
    pitStops: result.$.Pit_Number,
  };

  console.log(`Pit status: Car ${carNumber} — ${inPit ? 'IN PIT' : 'OUT'} (stop #${result.$.Pit_Number})`);
  state.updatePitStatus(carNumber, pitStatusObj);
}

function processLeaderboard(result) {
  const positions = Array.isArray(result.Position) ? result.Position : [result.Position];

  const updated = positions.map(pos => ({
    Car: pos.$.Car,
    Rank: pos.$.Rank,
    Laps_Behind: pos.$.Laps_Behind,
    Time_Behind: pos.$.Time_Behind,
  }));

  // Validate time-behind ordering (must be monotonically increasing for non-lapped cars)
  for (let i = 1; i < updated.length; i++) {
    if (parseInt(updated[i].Laps_Behind) > 0) continue;

    if (parseFloat(updated[i].Time_Behind) <= parseFloat(updated[i - 1].Time_Behind)) {
      // Bad data — try to use previous known-good data for this car
      const oldIdx = state.leaderboard.findIndex(item => item.Car === updated[i].Car);
      if (oldIdx !== -1) {
        updated[i] = state.leaderboard[oldIdx];
      } else {
        const dnfIdx = state.manualDNFOverride.findIndex(item => item.carNumber === updated[i].Car);
        if (dnfIdx !== -1 && state.manualDNFOverride[dnfIdx].DNF) {
          // DNF car — keep the data as-is, it'll be overridden in display
        } else {
          throw new BadDataError('Time behind data is misordered, skipping leaderboard message.');
        }
      }
    }
  }

  state.updateLeaderboard(updated);
}

function processCompletedLap(result) {
  const carNumber = result.$.Car;
  const lapIndex = state.lapData.findIndex(item => item.carNumber === carNumber);

  // Calculate average speed for completed lap
  const avgIdx = state.averageSpeed.findIndex(item => item.carNumber === carNumber);
  let newAverageSpeed;
  if (avgIdx !== -1) {
    const speeds = state.averageSpeed[avgIdx].currentLapSpeeds;
    if (speeds.length > 0) {
      newAverageSpeed = speeds.reduce((sum, s) => sum + s, 0) / speeds.length;
    }
    state.averageSpeed[avgIdx] = {
      carNumber,
      averageSpeedLapNumber: result.$.Lap_Number,
      lastLapAverage: newAverageSpeed || '-',
      currentLapSpeeds: [],
    };
  }

  // Calculate lap delta
  let lapDelta = ' ';
  if (lapIndex !== -1) {
    const prevTime = parseFloat(state.lapData[lapIndex].lastLapTime);
    const thisTime = parseFloat(result.$.Lap_Time);
    if (!isNaN(prevTime) && !isNaN(thisTime) && prevTime > 0) {
      const diff = thisTime - prevTime;
      lapDelta = toFixedDecimal(diff > 0 ? '+' + diff : diff.toString());
    }
  }

  const lapDataObj = {
    carNumber,
    fastestLap: result.$.Fastest_Lap,
    lastLapNumber: result.$.Lap_Number,
    lastLapTime: result.$.Lap_Time,
    totalTime: result.$.Time,
    lapsBehindLeader: result.$.Laps_Behind_Leader,
    timeBehindLeader: result.$.Time_Behind_Leader,
    lastLapDelta: lapDelta,
    averageSpeed: newAverageSpeed,
  };

  state.updateLapData(carNumber, lapDataObj);

  // Update all-lap-times history
  const ltIdx = state.allLapTimes.findIndex(item => item.carNumber === carNumber);
  if (ltIdx !== -1) {
    state.allLapTimes[ltIdx].lapTimes.push({
      lapNumber: result.$.Lap_Number,
      lapTime: result.$.Lap_Time,
    });
    state.allLapTimes[ltIdx].fastestLapNumber = result.$.Fastest_Lap;

    // Update fastest lap time
    if (result.$.Fastest_Lap === result.$.Lap_Number) {
      state.allLapTimes[ltIdx].fastestLapTime = result.$.Lap_Time;
    } else {
      const fastestEntry = state.allLapTimes[ltIdx].lapTimes.find(
        item => item.lapNumber === result.$.Fastest_Lap
      );
      if (fastestEntry && fastestEntry.lapTime) {
        // BUG FIX: Original used result.$.LapTime (wrong casing) — corrected to result.$.Lap_Time
        if (parseFloat(fastestEntry.lapTime) > parseFloat(result.$.Lap_Time)) {
          state.allLapTimes[ltIdx].fastestLapTime = result.$.Lap_Time;
        } else {
          state.allLapTimes[ltIdx].fastestLapTime = fastestEntry.lapTime;
        }
      }
    }
  }

  console.log(`Lap completed: Car ${carNumber}, Lap ${result.$.Lap_Number}, Time ${result.$.Lap_Time}`);
}

function processCarStatus(result) {
  const carNumber = result.$.Car;
  const statusObj = {
    carNumber,
    carStatus: result.$.Status,
  };

  // BUG FIX: Original code referenced `newLapDataObject` and pushed to `latestLapData`
  // instead of using `newCarStatusObject` and pushing to `carStatusData`
  state.updateCarStatus(carNumber, statusObj);
  console.log(`Car status: ${carNumber} → ${result.$.Status}`);
}

function processFlag(result) {
  const lapsCompleted = result.$.Laps_Completed;
  const flagColor = result.$.Status;
  const timeElapsed = result.$.Elapsed_Time;

  state.updateFlag(flagColor, lapsCompleted, timeElapsed);
  console.log(`Flag: ${flagColor}, Lap ${state.currentLap}, Elapsed ${timeElapsed}`);
}

module.exports = { processMessage };
