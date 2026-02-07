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
     JOIN overlay_templates ot ON oi.template_id = ot.id
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
     JOIN overlay_templates ot ON oi.template_id = ot.id
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
     JOIN overlay_templates ot ON oi.template_id = ot.id
     WHERE oi.access_token = ?`
  ).get(accessToken);

  if (row) {
    row.instance_config = JSON.parse(row.instance_config || '{}');
    row.template_data = JSON.parse(row.template_data);
  }
  return row;
}

function createInstance(data) {
  const { template_id, name, delay_seconds, instance_config } = data;

  if (!template_id || !name) {
    throw new Error('template_id and name required');
  }

  // Verify template exists
  const template = getDb().prepare('SELECT id FROM overlay_templates WHERE id = ?').get(template_id);
  if (!template) throw new Error('Template not found');

  const now = new Date().toISOString();
  const accessToken = uuidv4();
  const configJson = JSON.stringify(instance_config || {});

  const result = getDb().prepare(
    `INSERT INTO overlay_instances (template_id, name, instance_config, delay_seconds, access_token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(template_id, name, configJson, delay_seconds || 0, accessToken, now, now);

  return getInstance(result.lastInsertRowid);
}

function updateInstance(id, data) {
  const existing = getDb().prepare('SELECT id FROM overlay_instances WHERE id = ?').get(id);
  if (!existing) return null;

  const { name, template_id, instance_config, is_active, delay_seconds } = data;
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
};
