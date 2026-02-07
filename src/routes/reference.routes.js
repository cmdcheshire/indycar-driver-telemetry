const { Router } = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth.middleware');
const referenceService = require('../services/reference-data.service');

const router = Router();
router.use(authenticateToken);

// List all drivers
router.get('/drivers', (req, res) => {
  try {
    const drivers = referenceService.getAllDrivers();
    res.json({ drivers });
  } catch (err) {
    console.error('Error listing drivers:', err.message);
    res.status(500).json({ error: 'Failed to list drivers' });
  }
});

// Add or update a driver
router.post('/drivers', requireRole('operator', 'admin'), (req, res) => {
  try {
    const driver = referenceService.upsertDriver(req.body);
    res.json({ driver });
  } catch (err) {
    console.error('Error saving driver:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Update a single driver
router.put('/drivers/:carNumber', requireRole('operator', 'admin'), (req, res) => {
  try {
    const driver = referenceService.upsertDriver({ ...req.body, car_number: req.params.carNumber });
    res.json({ driver });
  } catch (err) {
    console.error('Error updating driver:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// Delete a driver
router.delete('/drivers/:carNumber', requireRole('admin'), (req, res) => {
  try {
    referenceService.deleteDriver(req.params.carNumber);
    res.json({ message: 'Driver deleted' });
  } catch (err) {
    console.error('Error deleting driver:', err.message);
    res.status(500).json({ error: 'Failed to delete driver' });
  }
});

// Bulk import drivers
router.post('/drivers/import', requireRole('admin'), (req, res) => {
  try {
    const { drivers } = req.body;
    if (!Array.isArray(drivers)) {
      return res.status(400).json({ error: 'drivers must be an array' });
    }
    const count = referenceService.bulkImportDrivers(drivers);
    res.json({ imported: count });
  } catch (err) {
    console.error('Error importing drivers:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// List images by category
router.get('/images/:category', (req, res) => {
  try {
    const images = referenceService.getImagesByCategory(req.params.category);
    res.json({ images });
  } catch (err) {
    console.error('Error listing images:', err.message);
    res.status(500).json({ error: 'Failed to list images' });
  }
});

module.exports = router;
