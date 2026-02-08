const path = require('path');

const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

module.exports = {
  APP_NAME: 'IndyCar Telemetry Overlay',
  APP_VERSION: '2.0.0',

  // Server
  PORT: parseInt(process.env.PORT, 10) || 3000,

  // Paths
  DATA_DIR,
  DB_PATH: path.join(DATA_DIR, 'telemetry.db'),
  UPLOADS_DIR,
  DRIVERS_UPLOAD_DIR: path.join(UPLOADS_DIR, 'drivers'),
  TEAMS_UPLOAD_DIR: path.join(UPLOADS_DIR, 'teams'),
  OVERLAYS_UPLOAD_DIR: path.join(UPLOADS_DIR, 'overlays'),
  LIBRARY_UPLOAD_DIR: path.join(UPLOADS_DIR, 'library'),

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'indycar-telemetry-secret-change-me',
  JWT_EXPIRATION: parseInt(process.env.JWT_EXPIRATION, 10) || 3600,           // 1 hour
  REFRESH_TOKEN_EXPIRATION: parseInt(process.env.REFRESH_EXPIRATION, 10) || 604800, // 7 days

  // TCP defaults
  DEFAULT_TCP_HOST: 'localhost',
  DEFAULT_TCP_PORT: 5000,
  RECONNECT_DELAY: 5000,

  // WebSocket broadcast interval (ms) for periodic state broadcasts
  BROADCAST_INTERVAL: 100,

  // S3 Storage (for graphics library)
  S3_BUCKET: process.env.S3_BUCKET || '',
  S3_REGION: process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1',
  S3_PREFIX: process.env.S3_PREFIX || 'library/',

  // Metrics broadcast interval
  METRICS_INTERVAL: 5000,

  // Default admin user (first run)
  DEFAULT_USERNAME: 'admin',
  DEFAULT_PASSWORD: 'admin',
};
