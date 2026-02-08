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

// ── Template Folders ──

router.get('/template-folders', (req, res) => {
  try {
    const folders = overlayService.getTemplateFolders();
    res.json({ folders });
  } catch (err) {
    console.error('Error listing template folders:', err.message);
    res.status(500).json({ error: 'Failed to list template folders' });
  }
});

router.post('/template-folders', requireRole('operator', 'admin'), (req, res) => {
  try {
    const { name, parent_id } = req.body;
    const folder = overlayService.createTemplateFolder(name, parent_id);
    res.status(201).json({ folder });
  } catch (err) {
    console.error('Error creating template folder:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.put('/template-folders/:id', requireRole('operator', 'admin'), (req, res) => {
  try {
    const folder = overlayService.updateTemplateFolder(parseInt(req.params.id, 10), req.body);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json({ folder });
  } catch (err) {
    console.error('Error updating template folder:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/template-folders/:id', requireRole('admin'), (req, res) => {
  try {
    overlayService.deleteTemplateFolder(parseInt(req.params.id, 10));
    res.json({ message: 'Template folder deleted' });
  } catch (err) {
    console.error('Error deleting template folder:', err.message);
    res.status(500).json({ error: 'Failed to delete template folder' });
  }
});

router.put('/templates/:id/move', requireRole('operator', 'admin'), (req, res) => {
  try {
    const { folder_id } = req.body;
    const template = overlayService.updateTemplate(parseInt(req.params.id, 10), { folder_id: folder_id ?? null });
    if (!template) return res.status(404).json({ error: 'Template not found' });
    res.json({ template });
  } catch (err) {
    console.error('Error moving template:', err.message);
    res.status(400).json({ error: err.message });
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

// ── Folders ──

router.get('/folders', (req, res) => {
  try {
    const folders = overlayService.getFolders();
    // Attach instances to each folder
    const instances = overlayService.getAllInstances();
    const foldersWithInstances = folders.map(f => ({
      ...f,
      instances: instances.filter(i => i.folder_id === f.id),
    }));
    res.json({ folders: foldersWithInstances });
  } catch (err) {
    console.error('Error listing folders:', err.message);
    res.status(500).json({ error: 'Failed to list folders' });
  }
});

router.post('/folders', requireRole('operator', 'admin'), (req, res) => {
  try {
    const { name, parent_id } = req.body;
    const folder = overlayService.createFolder(name, parent_id);
    res.status(201).json({ folder });
  } catch (err) {
    console.error('Error creating folder:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.put('/folders/:id', requireRole('operator', 'admin'), (req, res) => {
  try {
    const folder = overlayService.updateFolder(parseInt(req.params.id, 10), req.body);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json({ folder });
  } catch (err) {
    console.error('Error updating folder:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/folders/:id', requireRole('admin'), (req, res) => {
  try {
    overlayService.deleteFolder(parseInt(req.params.id, 10));
    res.json({ message: 'Folder deleted' });
  } catch (err) {
    console.error('Error deleting folder:', err.message);
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// ── Rundown ──

router.get('/instances/:id/rundown', (req, res) => {
  try {
    const items = overlayService.getRundownItems(parseInt(req.params.id, 10));
    res.json({ items });
  } catch (err) {
    console.error('Error getting rundown:', err.message);
    res.status(500).json({ error: 'Failed to get rundown' });
  }
});

router.post('/instances/:id/rundown', requireRole('operator', 'admin'), (req, res) => {
  try {
    const { template_id, sort_order } = req.body;
    const item = overlayService.addRundownItem(parseInt(req.params.id, 10), template_id, sort_order);
    res.status(201).json({ item });
  } catch (err) {
    console.error('Error adding rundown item:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.put('/rundown/:itemId', requireRole('operator', 'admin'), (req, res) => {
  try {
    const item = overlayService.updateRundownItem(parseInt(req.params.itemId, 10), req.body);
    if (!item) return res.status(404).json({ error: 'Rundown item not found' });

    // If this item is on-air, push config changes to the overlay in real-time
    if (item.is_on_air && item.config_overrides && Object.keys(item.config_overrides).length > 0) {
      const wsService = require('../services/websocket.service');
      wsService.sendOverlayConfigUpdate(item.instance_id, item.config_overrides);
    }

    res.json({ item });
  } catch (err) {
    console.error('Error updating rundown item:', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.delete('/rundown/:itemId', requireRole('admin'), (req, res) => {
  try {
    overlayService.deleteRundownItem(parseInt(req.params.itemId, 10));
    res.json({ message: 'Rundown item deleted' });
  } catch (err) {
    console.error('Error deleting rundown item:', err.message);
    res.status(500).json({ error: 'Failed to delete rundown item' });
  }
});

router.post('/rundown/:itemId/take', requireRole('operator', 'admin'), (req, res) => {
  try {
    const { action } = req.body;
    if (action !== 'on' && action !== 'off' && action !== 'cue' && action !== 'resume') {
      return res.status(400).json({ error: "action must be 'on', 'off', 'cue', or 'resume'" });
    }

    const itemId = parseInt(req.params.itemId, 10);
    const wsService = require('../services/websocket.service');

    // Get the rundown item directly by its ID
    const db = require('../config/database').getDb();
    const rundownItem = db.prepare('SELECT * FROM rundown_items WHERE id = ?').get(itemId);
    if (!rundownItem) return res.status(404).json({ error: 'Rundown item not found' });

    const instanceId = rundownItem.instance_id;
    const configOverrides = JSON.parse(rundownItem.config_overrides || '{}');

    // Load template to extract animation config
    const templateData = overlayService.getTemplate(rundownItem.template_id);

    // Parse animation config from template_data
    let enterAnimation;
    let exitAnimation;
    let enterElementAnims = [];
    let exitElementAnims = [];
    let timelineConfig = null;
    if (templateData) {
      try {
        const tData = typeof templateData.template_data === 'string'
          ? JSON.parse(templateData.template_data)
          : templateData.template_data;
        if (tData && tData.animation) {
          enterAnimation = tData.animation.enter && tData.animation.enter.type;
          exitAnimation = tData.animation.exit && tData.animation.exit.type;
        }
        // Extract timeline config (hold duration, pause points)
        if (tData && tData.timeline) {
          timelineConfig = tData.timeline;
        }
        // Extract per-element animation configs
        if (tData && Array.isArray(tData.elements)) {
          for (const el of tData.elements) {
            if (!el.animation) continue;
            const anim = el.animation;
            if (anim.enter && anim.enter.type && anim.enter.type !== 'none') {
              enterElementAnims.push({
                elementId: el.id,
                type: anim.enter.type,
                duration: anim.enter.duration || 300,
                delay: anim.enter.delay || 0,
                easing: anim.enter.easing || 'power2.out',
              });
            }
            if (anim.exit && anim.exit.type && anim.exit.type !== 'none') {
              exitElementAnims.push({
                elementId: el.id,
                type: anim.exit.type,
                duration: anim.exit.duration || 300,
                delay: anim.exit.delay || 0,
                easing: anim.exit.easing || 'power2.in',
              });
            }
          }
        }
      } catch (_) { /* ignore parse errors, defaults will be used */ }
    }

    if (action === 'cue') {
      // CUE: load the template but don't make it visible (no flash)
      if (!templateData) return res.status(404).json({ error: 'Template not found' });

      wsService.sendOverlayTemplateUpdate(instanceId, templateData);

      // Apply config overrides (e.g. target car numbers) if any
      if (Object.keys(configOverrides).length > 0) {
        wsService.sendOverlayConfigUpdate(instanceId, configOverrides);
      }

    } else if (action === 'on') {
      if (!templateData) return res.status(404).json({ error: 'Template not found' });

      // Take off any other currently on-air items for this instance
      const onAirItems = db.prepare(
        'SELECT id FROM rundown_items WHERE instance_id = ? AND is_on_air = 1 AND id != ?'
      ).all(instanceId, itemId);

      for (const onAirItem of onAirItems) {
        wsService.sendOverlayVisibility(instanceId, false, exitAnimation, exitElementAnims);
        overlayService.setRundownItemOnAir(onAirItem.id, false);
      }

      // Send template update, config overrides, then visibility
      wsService.sendOverlayTemplateUpdate(instanceId, templateData);

      if (Object.keys(configOverrides).length > 0) {
        wsService.sendOverlayConfigUpdate(instanceId, configOverrides);
      }

      wsService.sendOverlayVisibility(instanceId, true, enterAnimation, enterElementAnims, timelineConfig);
      overlayService.setRundownItemOnAir(itemId, true);
    } else if (action === 'resume') {
      wsService.sendOverlayResume(instanceId);
    } else {
      wsService.sendOverlayVisibility(instanceId, false, exitAnimation, exitElementAnims);
      overlayService.setRundownItemOnAir(itemId, false);
    }

    res.json({ itemId, action, success: true });
  } catch (err) {
    console.error('Error taking rundown item:', err.message);
    res.status(500).json({ error: 'Failed to take rundown item' });
  }
});

module.exports = router;
