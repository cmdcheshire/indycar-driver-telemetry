const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken, requireRole } = require('../middleware/auth.middleware');
const constants = require('../config/constants');

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = req.params.type || 'overlays';
    const allowed = ['drivers', 'teams', 'overlays'];
    const uploadType = allowed.includes(type) ? type : 'overlays';
    const dir = path.join(constants.UPLOADS_DIR, uploadType);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueName = `${name}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('File type not allowed'));
    }
  },
});

// Upload image
router.post('/upload/:type', authenticateToken, requireRole('operator', 'admin'), upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const relativePath = `/api/assets/${req.params.type}/${req.file.filename}`;
  res.json({ path: relativePath, filename: req.file.filename });
});

// Serve uploaded assets (public — no auth needed for overlay rendering)
router.get('/:type/:filename', (req, res) => {
  const { type, filename } = req.params;
  const allowed = ['drivers', 'teams', 'overlays'];

  if (!allowed.includes(type)) {
    return res.status(400).json({ error: 'Invalid asset type' });
  }

  // Sanitize filename to prevent path traversal
  const safeName = path.basename(filename);
  const filePath = path.join(constants.UPLOADS_DIR, type, safeName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.sendFile(filePath);
});

module.exports = router;
