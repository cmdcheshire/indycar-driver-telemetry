const { Router } = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth.middleware');
const { getSetting, setSetting } = require('../config/database');

const router = Router();
router.use(authenticateToken);

// Get all system settings
router.get('/', requireRole('admin'), (req, res) => {
  const { getDb } = require('../config/database');
  const rows = getDb().prepare('SELECT * FROM system_settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.settings_key] = row.settings_value;
  }
  res.json({ settings });
});

// Get a single setting
router.get('/:key', (req, res) => {
  const value = getSetting(req.params.key);
  if (value === null) {
    return res.status(404).json({ error: 'Setting not found' });
  }
  res.json({ key: req.params.key, value });
});

// Update a setting
router.put('/:key', requireRole('admin'), (req, res) => {
  const { value } = req.body;
  if (value === undefined) {
    return res.status(400).json({ error: 'value required' });
  }
  setSetting(req.params.key, typeof value === 'string' ? value : JSON.stringify(value));
  res.json({ key: req.params.key, value });
});

module.exports = router;
