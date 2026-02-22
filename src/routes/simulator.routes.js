const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken, requireRole } = require('../middleware/auth.middleware');
const constants = require('../config/constants');
const simulatorService = require('../services/simulator.service');

const router = Router();

// All routes require authentication
router.use(authenticateToken);

// ---------------------------------------------------------------------------
// Multer configuration for XML upload
// ---------------------------------------------------------------------------

function ensureSimulatorDir() {
  const dir = path.join(constants.DATA_DIR, 'simulator');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = ensureSimulatorDir();
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Sanitize: replace non-alphanumeric chars (except . _ -) with underscore
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, sanitized);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xml') {
      cb(null, true);
    } else {
      cb(new Error('Only .xml files are allowed'));
    }
  },
});

// ---------------------------------------------------------------------------
// GET routes (auth only)
// ---------------------------------------------------------------------------

/**
 * GET /status — Current simulator status
 */
router.get('/status', (req, res) => {
  res.json(simulatorService.getStatus());
});

/**
 * GET /files — List available XML files
 */
router.get('/files', (req, res) => {
  try {
    const files = simulatorService.getFiles();
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /timeline — Flag state timeline for loaded file
 */
router.get('/timeline', (req, res) => {
  res.json(simulatorService.getTimeline());
});

// ---------------------------------------------------------------------------
// Mutation routes (require operator or admin role)
// ---------------------------------------------------------------------------

/**
 * POST /load — Load an XML file for playback
 */
router.post('/load', requireRole('operator', 'admin'), (req, res) => {
  const { filename } = req.body;
  if (!filename) {
    return res.status(400).json({ error: 'filename is required' });
  }

  try {
    const result = simulatorService.load(filename);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /play — Start or resume playback
 */
router.post('/play', requireRole('operator', 'admin'), (req, res) => {
  try {
    simulatorService.play();
    res.json(simulatorService.getStatus());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /pause — Pause playback
 */
router.post('/pause', requireRole('operator', 'admin'), (req, res) => {
  simulatorService.pause();
  res.json(simulatorService.getStatus());
});

/**
 * POST /stop — Stop playback and reset position
 */
router.post('/stop', requireRole('operator', 'admin'), (req, res) => {
  simulatorService.stop();
  res.json(simulatorService.getStatus());
});

/**
 * POST /seek — Jump to a specific chunk position
 */
router.post('/seek', requireRole('operator', 'admin'), (req, res) => {
  const { position } = req.body;
  if (position === undefined || position === null) {
    return res.status(400).json({ error: 'position is required' });
  }

  try {
    simulatorService.seek(position);
    res.json(simulatorService.getStatus());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /rate — Set playback rate multiplier
 */
router.put('/rate', requireRole('operator', 'admin'), (req, res) => {
  const { rate } = req.body;
  if (rate === undefined || rate === null) {
    return res.status(400).json({ error: 'rate is required' });
  }

  try {
    simulatorService.setRate(rate);
    res.json(simulatorService.getStatus());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /upload — Upload an XML file
 */
router.post('/upload', requireRole('operator', 'admin'), upload.single('xml'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  res.json({
    filename: req.file.filename,
    size: req.file.size,
  });
});

/**
 * DELETE /files/:filename — Delete an XML file
 */
router.delete('/files/:filename', requireRole('operator', 'admin'), (req, res) => {
  const { filename } = req.params;
  if (!filename) {
    return res.status(400).json({ error: 'filename is required' });
  }

  try {
    simulatorService.deleteFile(filename);
    res.json({ success: true, filename: path.basename(filename) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Multer error handling
// ---------------------------------------------------------------------------

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 200MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
