const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');

// ── Templates ──

function getAllTemplates() {
  return getDb().prepare(
    'SELECT id, name, overlay_type, description, canvas_width, canvas_height, is_default, created_by_id, created_at, updated_at FROM overlay_templates ORDER BY updated_at DESC'
  ).all();
}

function getTemplate(id) {
  const row = getDb().prepare('SELECT * FROM overlay_templates WHERE id = ?').get(id);
  if (row) {
    row.template_data = JSON.parse(row.template_data);
  }
  return row;
}

function createTemplate(data, userId) {
  const { name, overlay_type, description, template_data, canvas_width, canvas_height } = data;

  if (!name || !overlay_type) {
    throw new Error('name and overlay_type required');
  }

  const now = new Date().toISOString();
  const templateJson = typeof template_data === 'string' ? template_data : JSON.stringify(template_data || { elements: [], groups: [] });

  const result = getDb().prepare(
    `INSERT INTO overlay_templates (name, overlay_type, description, template_data, canvas_width, canvas_height, created_by_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, overlay_type, description || null, templateJson, canvas_width || 1920, canvas_height || 1080, userId, now, now);

  return getTemplate(result.lastInsertRowid);
}

function updateTemplate(id, data) {
  const existing = getDb().prepare('SELECT id FROM overlay_templates WHERE id = ?').get(id);
  if (!existing) return null;

  const { name, overlay_type, description, template_data, canvas_width, canvas_height } = data;
  const now = new Date().toISOString();

  const sets = [];
  const params = [];

  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (overlay_type !== undefined) { sets.push('overlay_type = ?'); params.push(overlay_type); }
  if (description !== undefined) { sets.push('description = ?'); params.push(description); }
  if (template_data !== undefined) {
    sets.push('template_data = ?');
    params.push(typeof template_data === 'string' ? template_data : JSON.stringify(template_data));
  }
  if (canvas_width !== undefined) { sets.push('canvas_width = ?'); params.push(canvas_width); }
  if (canvas_height !== undefined) { sets.push('canvas_height = ?'); params.push(canvas_height); }

  sets.push('updated_at = ?');
  params.push(now);
  params.push(id);

  getDb().prepare(`UPDATE overlay_templates SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  return getTemplate(id);
}

function deleteTemplate(id) {
  getDb().prepare('DELETE FROM overlay_templates WHERE id = ?').run(id);
}

function duplicateTemplate(id, userId) {
  const original = getTemplate(id);
  if (!original) return null;

  return createTemplate({
    name: `${original.name} (Copy)`,
    overlay_type: original.overlay_type,
    description: original.description,
    template_data: original.template_data,
    canvas_width: original.canvas_width,
    canvas_height: original.canvas_height,
  }, userId);
}

// ── Instances ──

function getAllInstances() {
  const rows = getDb().prepare(
    `SELECT oi.*, ot.name as template_name, ot.overlay_type
     FROM overlay_instances oi
     LEFT JOIN overlay_templates ot ON oi.template_id = ot.id
     ORDER BY oi.updated_at DESC`
  ).all();

  return rows.map(r => ({
    ...r,
    instance_config: JSON.parse(r.instance_config || '{}'),
  }));
}

function getInstance(id) {
  const row = getDb().prepare(
    `SELECT oi.*, ot.name as template_name, ot.overlay_type
     FROM overlay_instances oi
     LEFT JOIN overlay_templates ot ON oi.template_id = ot.id
     WHERE oi.id = ?`
  ).get(id);

  if (row) {
    row.instance_config = JSON.parse(row.instance_config || '{}');
  }
  return row;
}

function getInstanceByToken(accessToken) {
  const row = getDb().prepare(
    `SELECT oi.*, ot.name as template_name, ot.overlay_type, ot.template_data
     FROM overlay_instances oi
     LEFT JOIN overlay_templates ot ON oi.template_id = ot.id
     WHERE oi.access_token = ?`
  ).get(accessToken);

  if (row) {
    row.instance_config = JSON.parse(row.instance_config || '{}');
    row.template_data = row.template_data ? JSON.parse(row.template_data) : null;
  }
  return row;
}

function createInstance(data) {
  const { template_id, name, delay_seconds, instance_config, folder_id } = data;

  if (!name) {
    throw new Error('name is required');
  }

  // Verify template exists if provided
  if (template_id) {
    const template = getDb().prepare('SELECT id FROM overlay_templates WHERE id = ?').get(template_id);
    if (!template) throw new Error('Template not found');
  }

  const now = new Date().toISOString();
  const accessToken = uuidv4();
  const configJson = JSON.stringify(instance_config || {});

  const result = getDb().prepare(
    `INSERT INTO overlay_instances (template_id, name, instance_config, delay_seconds, access_token, folder_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(template_id || null, name, configJson, delay_seconds || 0, accessToken, folder_id || null, now, now);

  return getInstance(result.lastInsertRowid);
}

function updateInstance(id, data) {
  const existing = getDb().prepare('SELECT id FROM overlay_instances WHERE id = ?').get(id);
  if (!existing) return null;

  const { name, template_id, instance_config, is_active, delay_seconds, folder_id } = data;
  const now = new Date().toISOString();

  const sets = [];
  const params = [];

  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (template_id !== undefined) { sets.push('template_id = ?'); params.push(template_id); }
  if (instance_config !== undefined) {
    sets.push('instance_config = ?');
    params.push(JSON.stringify(instance_config));
  }
  if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (delay_seconds !== undefined) { sets.push('delay_seconds = ?'); params.push(delay_seconds); }
  if (folder_id !== undefined) { sets.push('folder_id = ?'); params.push(folder_id); }

  sets.push('updated_at = ?');
  params.push(now);
  params.push(id);

  getDb().prepare(`UPDATE overlay_instances SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  return getInstance(id);
}

function updateInstanceDelay(id, delaySeconds) {
  const now = new Date().toISOString();
  getDb().prepare('UPDATE overlay_instances SET delay_seconds = ?, updated_at = ? WHERE id = ?')
    .run(delaySeconds, now, id);
  return getInstance(id);
}

function deleteInstance(id) {
  getDb().prepare('DELETE FROM overlay_instances WHERE id = ?').run(id);
}

// ── Folders ──

function getFolders() {
  return getDb().prepare(
    'SELECT * FROM output_folders ORDER BY sort_order ASC, name ASC'
  ).all();
}

function createFolder(name, parentId) {
  if (!name) throw new Error('Folder name is required');

  const now = new Date().toISOString();
  const result = getDb().prepare(
    `INSERT INTO output_folders (name, parent_id, sort_order, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?)`
  ).run(name, parentId || null, now, now);

  return getDb().prepare('SELECT * FROM output_folders WHERE id = ?').get(result.lastInsertRowid);
}

function updateFolder(id, data) {
  const existing = getDb().prepare('SELECT id FROM output_folders WHERE id = ?').get(id);
  if (!existing) return null;

  const { name, sort_order, parent_id } = data;
  const now = new Date().toISOString();

  const sets = [];
  const params = [];

  if (name !== undefined) { sets.push('name = ?'); params.push(name); }
  if (sort_order !== undefined) { sets.push('sort_order = ?'); params.push(sort_order); }
  if (parent_id !== undefined) { sets.push('parent_id = ?'); params.push(parent_id); }

  sets.push('updated_at = ?');
  params.push(now);
  params.push(id);

  getDb().prepare(`UPDATE output_folders SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  return getDb().prepare('SELECT * FROM output_folders WHERE id = ?').get(id);
}

function deleteFolder(id) {
  getDb().prepare('DELETE FROM output_folders WHERE id = ?').run(id);
}

// ── Rundown Items ──

function getRundownItems(instanceId) {
  return getDb().prepare(
    `SELECT ri.*, ot.name as template_name, ot.overlay_type, ot.template_data
     FROM rundown_items ri
     JOIN overlay_templates ot ON ri.template_id = ot.id
     WHERE ri.instance_id = ?
     ORDER BY ri.sort_order ASC`
  ).all(instanceId).map(r => {
    const configOverrides = JSON.parse(r.config_overrides || '{}');

    // Extract exposed elements from template_data
    let exposedElements = [];
    if (r.template_data) {
      try {
        const td = JSON.parse(r.template_data);
        const elems = td.elements || [];
        exposedElements = elems
          .filter(el => el.exposed)
          .map(el => ({
            id: el.id,
            name: el.name || el.type,
            type: el.type,
            defaultValue: _getDefaultEditableValue(el),
          }));
      } catch (_) { /* ignore parse errors */ }
    }

    // Don't send raw template_data to the client
    delete r.template_data;

    return {
      ...r,
      config_overrides: configOverrides,
      exposed_elements: exposedElements,
    };
  });
}

/** Get the default editable value for an exposed element based on its type. */
function _getDefaultEditableValue(el) {
  const p = el.props || {};
  switch (el.type) {
    case 'text': return p.text || '';
    case 'image': return p.src || '';
    case 'shape': return p.fill || '';
    case 'data': return p.fallback || '---';
    default: return '';
  }
}

function addRundownItem(instanceId, templateId, sortOrder) {
  if (!instanceId || !templateId) throw new Error('instance_id and template_id required');

  const now = new Date().toISOString();
  const result = getDb().prepare(
    `INSERT INTO rundown_items (instance_id, template_id, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(instanceId, templateId, sortOrder || 0, now, now);

  const row = getDb().prepare(
    `SELECT ri.*, ot.name as template_name, ot.overlay_type
     FROM rundown_items ri
     JOIN overlay_templates ot ON ri.template_id = ot.id
     WHERE ri.id = ?`
  ).get(result.lastInsertRowid);

  if (row) row.config_overrides = JSON.parse(row.config_overrides || '{}');
  return row;
}

function updateRundownItem(itemId, data) {
  const existing = getDb().prepare('SELECT id FROM rundown_items WHERE id = ?').get(itemId);
  if (!existing) return null;

  const { sort_order, config_overrides, is_on_air } = data;
  const now = new Date().toISOString();

  const sets = [];
  const params = [];

  if (sort_order !== undefined) { sets.push('sort_order = ?'); params.push(sort_order); }
  if (config_overrides !== undefined) {
    sets.push('config_overrides = ?');
    params.push(typeof config_overrides === 'string' ? config_overrides : JSON.stringify(config_overrides));
  }
  if (is_on_air !== undefined) { sets.push('is_on_air = ?'); params.push(is_on_air ? 1 : 0); }

  sets.push('updated_at = ?');
  params.push(now);
  params.push(itemId);

  getDb().prepare(`UPDATE rundown_items SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  const row = getDb().prepare(
    `SELECT ri.*, ot.name as template_name, ot.overlay_type
     FROM rundown_items ri
     JOIN overlay_templates ot ON ri.template_id = ot.id
     WHERE ri.id = ?`
  ).get(itemId);

  if (row) row.config_overrides = JSON.parse(row.config_overrides || '{}');
  return row;
}

function deleteRundownItem(itemId) {
  getDb().prepare('DELETE FROM rundown_items WHERE id = ?').run(itemId);
}

function setRundownItemOnAir(itemId, isOnAir) {
  const now = new Date().toISOString();
  const existing = getDb().prepare('SELECT id FROM rundown_items WHERE id = ?').get(itemId);
  if (!existing) return null;

  getDb().prepare('UPDATE rundown_items SET is_on_air = ?, updated_at = ? WHERE id = ?')
    .run(isOnAir ? 1 : 0, now, itemId);

  const row = getDb().prepare(
    `SELECT ri.*, ot.name as template_name, ot.overlay_type
     FROM rundown_items ri
     JOIN overlay_templates ot ON ri.template_id = ot.id
     WHERE ri.id = ?`
  ).get(itemId);

  if (row) row.config_overrides = JSON.parse(row.config_overrides || '{}');
  return row;
}

module.exports = {
  getAllTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  duplicateTemplate,
  getAllInstances,
  getInstance,
  getInstanceByToken,
  createInstance,
  updateInstance,
  updateInstanceDelay,
  deleteInstance,
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  getRundownItems,
  addRundownItem,
  updateRundownItem,
  deleteRundownItem,
  setRundownItemOnAir,
};
