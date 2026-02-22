const { Router } = require('express');
const { authenticateToken } = require('../middleware/auth.middleware');
const state = require('../telemetry/race-state');

const router = Router();
router.use(authenticateToken);

// Full current race state snapshot
router.get('/snapshot', (req, res) => {
  res.json({
    isOnline: state.isOnline,
    flagColor: state.flagColor,
    currentLap: state.currentLap,
    lapsCompleted: state.lapsCompleted,
    timeElapsed: state.timeElapsed,
    targetCars: state.targetCarNumbers,
    telemetry: state.telemetry,
    leaderboard: state.leaderboard,
    lapData: state.lapData,
    carStatus: state.carStatus,
    pitStatus: state.pitStatus,
    averageSpeed: state.averageSpeed,
    manualDNF: state.manualDNFOverride,
    referenceData: state.referenceData,
    carStates: state.carStates,
  });
});

// Current leaderboard
router.get('/leaderboard', (req, res) => {
  res.json({ leaderboard: state.leaderboard });
});

// All driver data
router.get('/drivers', (req, res) => {
  res.json({
    lapData: state.lapData,
    carStatus: state.carStatus,
    pitStatus: state.pitStatus,
    averageSpeed: state.averageSpeed,
  });
});

module.exports = router;
