const { Router } = require('express');
const { authenticateToken, requireRole } = require('../middleware/auth.middleware');
const overlayService = require('../services/overlay.service');

const router = Router();
router.use(authenticateToken);

// ── Templates ──

router.get('/templates', (req, res) => {
  try {
    const templates = overlayService.getAllTemplates();
    res.json({ templates });
  } catch (err) {
    console.error('Error listing templates:', err.message);
    res.status(500).json({ error: 'Failed to list templates' });
  }
});

router.post('/templates', requireRole('operator', 'admin'), (req, res) => {
  try {
    const template = overlayService.createTemplate(req.body, req.user.userId);
    res.status(201).json({ template });
  } catch (err) {
    console.error('Error creating template:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/templates/:id', (req, res) => {
  try {
    const template = overlayService.getTemplate(parseInt(req.params.id, 10));
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ template });
  } catch (err) {
    console.error('Error getting template:', err.message);
    res.status(500).json({ error: 'Failed to get template' });
  }
});

router.put('/templates/:id', requireRole('operator', 'admin'), (req, res) => {
  try {
    const template = overlayService.updateTemplate(parseInt(req.params.id, 10), req.body);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ template });
  } catch (err) {
    console.error('Error updating template:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/templates/:id', requireRole('admin'), (req, res) => {
  try {
    overlayService.deleteTemplate(parseInt(req.params.id, 10));
    res.json({ message: 'Template deleted' });
  } catch (err) {
    console.error('Error deleting template:', err.message);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

router.post('/templates/:id/duplicate', requireRole('operator', 'admin'), (req, res) => {
  try {
    const template = overlayService.duplicateTemplate(parseInt(req.params.id, 10), req.user.userId);
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.status(201).json({ template });
  } catch (err) {
    console.error('Error duplicating template:', err.message);
    res.status(500).json({ error: 'Failed to duplicate template' });
  }
});

// ── Instances ──

router.get('/instances', (req, res) => {
  try {
    const instances = overlayService.getAllInstances();
    res.json({ instances });
  } catch (err) {
    console.error('Error listing instances:', err.message);
    res.status(500).json({ error: 'Failed to list instances' });
  }
});

router.post('/instances', requireRole('operator', 'admin'), (req, res) => {
  try {
    const instance = overlayService.createInstance(req.body);
    res.status(201).json({ instance });
  } catch (err) {
    console.error('Error creating instance:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/instances/:id', (req, res) => {
  try {
    const instance = overlayService.getInstance(parseInt(req.params.id, 10));
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    res.json({ instance });
  } catch (err) {
    console.error('Error getting instance:', err.message);
    res.status(500).json({ error: 'Failed to get instance' });
  }
});

router.put('/instances/:id', requireRole('operator', 'admin'), (req, res) => {
  try {
    const instance = overlayService.updateInstance(parseInt(req.params.id, 10), req.body);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });
    res.json({ instance });
  } catch (err) {
    console.error('Error updating instance:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/instances/:id', requireRole('admin'), (req, res) => {
  try {
    overlayService.deleteInstance(parseInt(req.params.id, 10));
    res.json({ message: 'Instance deleted' });
  } catch (err) {
    console.error('Error deleting instance:', err.message);
    res.status(500).json({ error: 'Failed to delete instance' });
  }
});

router.put('/instances/:id/delay', requireRole('operator', 'admin'), (req, res) => {
  try {
    const { delaySeconds } = req.body;
    if (typeof delaySeconds !== 'number' || delaySeconds < 0 || delaySeconds > 60) {
      return res.status(400).json({ error: 'delaySeconds must be 0-60' });
    }
    const instance = overlayService.updateInstanceDelay(parseInt(req.params.id, 10), delaySeconds);
    if (!instance) return res.status(404).json({ error: 'Instance not found' });

    // Update delay buffer for connected overlay client
    const wsService = require('../services/websocket.service');
    wsService.updateOverlayDelay(instance.id, delaySeconds);

    res.json({ instance });
  } catch (err) {
    console.error('Error updating delay:', err.message);
    res.status(500).json({ error: 'Failed to update delay' });
  }
});

router.put('/instances/:id/visibility', requireRole('operator', 'admin'), (req, res) => {
  try {
    const { visible } = req.body;
    if (typeof visible !== 'boolean') {
      return res.status(400).json({ error: 'visible must be boolean' });
    }

    // Send visibility command to overlay client
    const wsService = require('../services/websocket.service');
    wsService.sendOverlayVisibility(parseInt(req.params.id, 10), visible);

    res.json({ visible });
  } catch (err) {
    console.error('Error updating visibility:', err.message);
    res.status(500).json({ error: 'Failed to update visibility' });
  }
});

module.exports = router;
