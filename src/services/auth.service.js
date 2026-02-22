const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const constants = require('../config/constants');
const { getDb } = require('../config/database');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createUser(username, password, role = 'admin') {
  const db = getDb();
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(password, 12);

  const result = db.prepare(
    'INSERT INTO users (username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
  ).run(username, passwordHash, role, now, now);

  return { id: result.lastInsertRowid, username, role };
}

async function authenticateUser(username, password) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);

  if (!user) return null;

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;

  // Update last login
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(new Date().toISOString(), user.id);

  return { id: user.id, username: user.username, role: user.role };
}

function generateTokens(user) {
  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    constants.JWT_SECRET,
    { expiresIn: constants.JWT_EXPIRATION }
  );

  const refreshToken = crypto.randomBytes(64).toString('hex');

  return { token, refreshToken, expiresIn: constants.JWT_EXPIRATION };
}

function createSession(userId, token, refreshToken, ip, userAgent) {
  const db = getDb();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + constants.REFRESH_TOKEN_EXPIRATION * 1000).toISOString();

  db.prepare(
    `INSERT INTO sessions (user_id, token_hash, refresh_token_hash, ip_address, user_agent, created_at, expires_at, last_activity)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, hashToken(token), hashToken(refreshToken), ip, userAgent, now, expiresAt, now);
}

function verifyToken(token) {
  return jwt.verify(token, constants.JWT_SECRET);
}

function refreshSession(refreshToken) {
  const db = getDb();
  const tokenHash = hashToken(refreshToken);

  const session = db.prepare(
    'SELECT s.*, u.username, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.refresh_token_hash = ? AND s.expires_at > ?'
  ).get(tokenHash, new Date().toISOString());

  if (!session) return null;

  const user = { id: session.user_id, username: session.username, role: session.role };
  const tokens = generateTokens(user);

  // Update session with new token hash
  const now = new Date().toISOString();
  db.prepare('UPDATE sessions SET token_hash = ?, last_activity = ? WHERE id = ?')
    .run(hashToken(tokens.token), now, session.id);

  return { user, ...tokens };
}

function invalidateSession(token) {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function cleanExpiredSessions() {
  const db = getDb();
  const deleted = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  if (deleted.changes > 0) {
    console.log(`Cleaned ${deleted.changes} expired sessions.`);
  }
}

function getUserCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM users').get().count;
}

function getAllUsers() {
  return getDb().prepare('SELECT id, username, role, created_at, last_login, is_active FROM users').all();
}

module.exports = {
  createUser,
  authenticateUser,
  generateTokens,
  createSession,
  verifyToken,
  refreshSession,
  invalidateSession,
  cleanExpiredSessions,
  getUserCount,
  getAllUsers,
};
