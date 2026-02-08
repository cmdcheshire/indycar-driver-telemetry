const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const constants = require('./constants');

let db = null;

function getDb() {
  if (db) return db;

  // Ensure data directory exists
  const dir = path.dirname(constants.DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(constants.DB_PATH);

  // Performance settings
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  return db;
}

function initializeDatabase() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin' CHECK(role IN ('viewer','operator','admin')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      refresh_token_hash TEXT UNIQUE,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_activity TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS drivers (
      car_number TEXT PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      team TEXT,
      headshot_path TEXT,
      car_logo_path TEXT,
      team_logo_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reference_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      image_path TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(category, name)
    );
    CREATE INDEX IF NOT EXISTS idx_ref_images_category ON reference_images(category);

    CREATE TABLE IF NOT EXISTS overlay_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      overlay_type TEXT NOT NULL,
      description TEXT,
      template_data TEXT NOT NULL,
      canvas_width INTEGER NOT NULL DEFAULT 1920,
      canvas_height INTEGER NOT NULL DEFAULT 1080,
      is_default INTEGER DEFAULT 0,
      created_by_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_templates_type ON overlay_templates(overlay_type);

    CREATE TABLE IF NOT EXISTS overlay_instances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER,
      name TEXT NOT NULL,
      instance_config TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      delay_seconds REAL DEFAULT 0,
      access_token TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (template_id) REFERENCES overlay_templates(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_instances_token ON overlay_instances(access_token);

    CREATE TABLE IF NOT EXISTS system_settings (
      settings_key TEXT PRIMARY KEY NOT NULL,
      settings_value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

    CREATE TABLE IF NOT EXISTS output_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES output_folders(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rundown_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id INTEGER NOT NULL REFERENCES overlay_instances(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES overlay_templates(id) ON DELETE CASCADE,
      sort_order INTEGER DEFAULT 0,
      is_on_air INTEGER DEFAULT 0,
      config_overrides TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES library_folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS template_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (parent_id) REFERENCES template_folders(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS library_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      file_size INTEGER DEFAULT 0,
      width INTEGER,
      height INTEGER,
      folder_id INTEGER,
      tags TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      FOREIGN KEY (folder_id) REFERENCES library_folders(id) ON DELETE SET NULL
    );
  `);

  // Add folder_id column to overlay_templates if it doesn't exist
  try {
    db.exec('ALTER TABLE overlay_templates ADD COLUMN folder_id INTEGER REFERENCES template_folders(id) ON DELETE SET NULL');
  } catch (e) {
    // Column already exists — ignore
  }

  // Add folder_id column to overlay_instances if it doesn't exist
  try {
    db.exec('ALTER TABLE overlay_instances ADD COLUMN folder_id INTEGER REFERENCES output_folders(id) ON DELETE SET NULL');
  } catch (e) {
    // Column already exists — ignore
  }

  // Migrate overlay_instances to allow nullable template_id (existing DBs have NOT NULL)
  try {
    const colInfo = db.pragma('table_info(overlay_instances)');
    const templateCol = colInfo.find(c => c.name === 'template_id');
    if (templateCol && templateCol.notnull === 1) {
      db.exec(`
        CREATE TABLE overlay_instances_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          template_id INTEGER,
          name TEXT NOT NULL,
          instance_config TEXT NOT NULL DEFAULT '{}',
          is_active INTEGER DEFAULT 1,
          delay_seconds REAL DEFAULT 0,
          access_token TEXT UNIQUE NOT NULL,
          folder_id INTEGER REFERENCES output_folders(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (template_id) REFERENCES overlay_templates(id) ON DELETE SET NULL
        );
        INSERT INTO overlay_instances_new SELECT id, template_id, name, instance_config, is_active, delay_seconds, access_token, folder_id, created_at, updated_at FROM overlay_instances;
        DROP TABLE overlay_instances;
        ALTER TABLE overlay_instances_new RENAME TO overlay_instances;
        CREATE INDEX IF NOT EXISTS idx_instances_token ON overlay_instances(access_token);
      `);
      console.log('Migrated overlay_instances: template_id now nullable.');
    }
  } catch (e) {
    console.warn('overlay_instances migration skipped:', e.message);
  }

  // Seed default system settings if they don't exist
  const seedSettings = {
    tcp_host: constants.DEFAULT_TCP_HOST,
    tcp_port: String(constants.DEFAULT_TCP_PORT),
    is_online: 'false',
    target_cars: JSON.stringify([null, null, null]),
    manual_dnf: JSON.stringify([]),
    reconnect_delay: String(constants.RECONNECT_DELAY),
    broadcast_interval: String(constants.BROADCAST_INTERVAL),
  };

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO system_settings (settings_key, settings_value, updated_at) VALUES (?, ?, ?)'
  );

  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(seedSettings)) {
    insertSetting.run(key, value, now);
  }

  console.log('Database initialized.');
  return db;
}

function getSetting(key) {
  const row = getDb().prepare('SELECT settings_value FROM system_settings WHERE settings_key = ?').get(key);
  return row ? row.settings_value : null;
}

function setSetting(key, value) {
  const now = new Date().toISOString();
  getDb().prepare(
    'INSERT INTO system_settings (settings_key, settings_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(settings_key) DO UPDATE SET settings_value = excluded.settings_value, updated_at = excluded.updated_at'
  ).run(key, value, now);
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, initializeDatabase, getSetting, setSetting, closeDatabase };
