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

router.post('/rundown/:itemId/take', requireRole('operator', 'admin'), async (req, res) => {
  try {
    const { action, autoCue = false } = req.body;
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
            // Include elements with standard enter presets OR keyframe enter animations
            const hasEnterPreset = anim.enter && anim.enter.type && anim.enter.type !== 'none';
            const hasEnterKeyframes = anim.enterKeyframes && anim.enterKeyframes.enabled
              && Array.isArray(anim.enterKeyframes.tracks) && anim.enterKeyframes.tracks.length > 0;
            if (hasEnterPreset || hasEnterKeyframes) {
              enterElementAnims.push({
                elementId: el.id,
                type: (anim.enter && anim.enter.type) || 'none',
                duration: (anim.enter && anim.enter.duration) || 300,
                delay: (anim.enter && anim.enter.delay) || 0,
                easing: (anim.enter && anim.enter.easing) || 'power2.out',
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
      // CUE: Pre-build the template with all animations for instant TAKE ON
      if (!templateData) return res.status(404).json({ error: 'Template not found' });

      // Send comprehensive CUE message with template, config, and pre-computed animations
      wsService.sendOverlayCue(
        instanceId,
        templateData,
        configOverrides,
        enterElementAnims,
        timelineConfig
      );

      console.log('[cue] CUE sent with', enterElementAnims.length, 'enter animations');

    } else if (action === 'on') {
      if (!templateData) return res.status(404).json({ error: 'Template not found' });

      // Take off any other currently on-air items for this instance
      const onAirItems = db.prepare(
        'SELECT * FROM rundown_items WHERE instance_id = ? AND is_on_air = 1 AND id != ?'
      ).all(instanceId, itemId);

      // Check if same template as currently on-air (for smooth transitions)
      if (onAirItems.length > 0) {
        const currentOnAir = onAirItems[0];
        const sameTemplate = currentOnAir.template_id === rundownItem.template_id;

        if (sameTemplate) {
          // Same template, different data → send templateTransition instead of full cycle
          console.log('[Rundown] Same template detected, using transition instead of full cycle');

          // Extract UPDATE animations from element configs
          const updateElementAnims = [];
          if (templateData) {
            try {
              const tData = typeof templateData.template_data === 'string'
                ? JSON.parse(templateData.template_data)
                : templateData.template_data;

              if (tData && Array.isArray(tData.elements)) {
                for (const el of tData.elements) {
                  if (el.animation && el.animation.update && el.animation.update.type && el.animation.update.type !== 'none') {
                    updateElementAnims.push({
                      elementId: el.id,
                      type: el.animation.update.type,
                      duration: el.animation.update.duration || 300,
                      delay: 0,
                    });
                  }
                }
              }
            } catch (err) {
              console.warn('[Rundown] Error extracting update animations:', err);
            }
          }

          // Send transition message
          wsService.sendOverlayTransition(instanceId, configOverrides, updateElementAnims);

          // Update on-air status
          overlayService.setRundownItemOnAir(currentOnAir.id, false);
          overlayService.setRundownItemOnAir(itemId, true);

          return res.json({ success: true, message: 'Template transition complete' });
        }
      }

      let exitDurationMs = 0;
      if (onAirItems.length > 0) {
        // Extract exit animations from the CURRENTLY ON-AIR template (not the new one)
        const onAirItem = onAirItems[0]; // Take first on-air item
        const onAirTemplateData = overlayService.getTemplate(onAirItem.template_id);
        let onAirExitAnims = [];
        let onAirExitAnimation = 'fadeOut';

        if (onAirTemplateData) {
          try {
            const tData = typeof onAirTemplateData.template_data === 'string'
              ? JSON.parse(onAirTemplateData.template_data)
              : onAirTemplateData.template_data;

            if (tData && tData.animation && tData.animation.exit) {
              onAirExitAnimation = tData.animation.exit.type || 'fadeOut';
            }

            // Extract per-element exit animations from on-air template
            if (tData && Array.isArray(tData.elements)) {
              for (const el of tData.elements) {
                if (el.animation && el.animation.exit && el.animation.exit.type && el.animation.exit.type !== 'none') {
                  onAirExitAnims.push({
                    elementId: el.id,
                    type: el.animation.exit.type,
                    duration: el.animation.exit.duration || 300,
                    delay: el.animation.exit.delay || 0,
                    easing: el.animation.exit.easing || 'power2.in',
                  });
                }
              }
            }
          } catch (_) { /* ignore parse errors */ }
        }

        // Send TAKE OFF to currently on-air items with THEIR exit animations
        for (const item of onAirItems) {
          wsService.sendOverlayVisibility(instanceId, false, onAirExitAnimation, onAirExitAnims);
          overlayService.setRundownItemOnAir(item.id, false);
        }

        // Calculate max exit animation duration from on-air template (delay + duration)
        exitDurationMs = onAirExitAnims.reduce(
          (max, anim) => Math.max(max, (anim.delay || 0) + (anim.duration || 300)),
          300 // Default 300ms if no exit animations
        );

        // Add buffer for safety
        exitDurationMs += 100;

        console.log('[take] Waiting', exitDurationMs, 'ms for exit animations to complete');
        await new Promise(resolve => setTimeout(resolve, exitDurationMs));
      }

      // Send template data first (in case overlay doesn't have it cued)
      // This ensures the overlay has the correct template before TAKE ON fires
      wsService.sendOverlayTemplateUpdate(instanceId, templateData);

      // Brief delay to ensure template update is processed before visibility
      await new Promise(resolve => setTimeout(resolve, 50));

      // Send TAKE ON visibility (overlay will use cued template if available, otherwise build now)
      console.log('[take] TAKE ON — enterAnims:', enterElementAnims.length, 'timeline:', JSON.stringify(timelineConfig));
      wsService.sendOverlayVisibility(instanceId, true, enterAnimation, enterElementAnims, timelineConfig);
      overlayService.setRundownItemOnAir(itemId, true);

      // AUTO-CUE: Automatically cue the next rundown item for instant transitions (if enabled)
      if (autoCue) {
        try {
          const currentItem = db.prepare('SELECT order_index FROM rundown_items WHERE id = ?').get(itemId);
          if (currentItem) {
          const nextItem = db.prepare(
            'SELECT * FROM rundown_items WHERE instance_id = ? AND order_index > ? ORDER BY order_index ASC LIMIT 1'
          ).get(instanceId, currentItem.order_index);

          if (nextItem) {
            console.log('[auto-cue] Cueing next rundown item:', nextItem.id);

            // Get next item's template and config
            const nextTemplateData = overlayService.getTemplate(nextItem.template_id);
            const nextConfigOverrides = nextItem.config_overrides ? JSON.parse(nextItem.config_overrides) : {};

            // Extract animations for next item
            let nextEnterAnims = [];
            let nextTimelineConfig = null;
            if (nextTemplateData) {
              try {
                const tData = typeof nextTemplateData.template_data === 'string'
                  ? JSON.parse(nextTemplateData.template_data)
                  : nextTemplateData.template_data;

                if (tData && tData.timeline) {
                  nextTimelineConfig = tData.timeline;
                }

                if (tData && Array.isArray(tData.elements)) {
                  for (const el of tData.elements) {
                    const anim = el.animation || {};
                    const hasEnterPreset = anim.enter && anim.enter.type && anim.enter.type !== 'none';
                    const hasEnterKeyframes = anim.enterKeyframes?.enabled
                      && Array.isArray(anim.enterKeyframes.tracks) && anim.enterKeyframes.tracks.length > 0;
                    if (hasEnterPreset || hasEnterKeyframes) {
                      nextEnterAnims.push({
                        elementId: el.id,
                        type: (anim.enter && anim.enter.type) || 'none',
                        duration: (anim.enter && anim.enter.duration) || 300,
                        delay: (anim.enter && anim.enter.delay) || 0,
                        easing: (anim.enter && anim.enter.easing) || 'power2.out',
                      });
                    }
                  }
                }
              } catch (_) { /* ignore parse errors */ }
            }

            // Send CUE for next item
            wsService.sendOverlayCue(
              instanceId,
              nextTemplateData,
              nextConfigOverrides,
              nextEnterAnims,
              nextTimelineConfig
            );
          }
        }
      } catch (err) {
        console.warn('[auto-cue] Failed to cue next item:', err.message);
        // Don't fail the TAKE ON if auto-cue fails
      }
      }
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
