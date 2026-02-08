const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDb } = require('../config/database');
const { LIBRARY_UPLOAD_DIR } = require('../config/constants');
const { authenticateToken, requireRole } = require('../middleware/auth.middleware');
const s3 = require('../services/s3.service');

const useS3 = s3.isConfigured();

// Local fallback: ensure upload dir exists when S3 is not configured
if (!useS3) {
  if (!fs.existsSync(LIBRARY_UPLOAD_DIR)) {
    fs.mkdirSync(LIBRARY_UPLOAD_DIR, { recursive: true });
  }
  console.log('[library] Using local disk storage (set S3_BUCKET env to use S3)');
} else {
  console.log('[library] Using S3 storage');
}

// Multer config — memory storage for S3, disk storage for local fallback
const storage = useS3
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, LIBRARY_UPLOAD_DIR),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        cb(null, `${base}_${Date.now()}${ext}`);
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.mp4', '.webm', '.ttf', '.otf', '.woff', '.woff2', '.json'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// ── Folders ──

// GET /api/library/folders - list all folders
router.get('/folders', (req, res) => {
  try {
    const folders = getDb().prepare(
      'SELECT * FROM library_folders ORDER BY name ASC'
    ).all();
    res.json({ folders });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get folders' });
  }
});

// POST /api/library/folders - create folder
router.post('/folders', authenticateToken, requireRole('operator', 'admin'), (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });

    const now = new Date().toISOString();
    const result = getDb().prepare(
      'INSERT INTO library_folders (name, parent_id, created_at, updated_at) VALUES (?, ?, ?, ?)'
    ).run(name, parent_id || null, now, now);

    const folder = getDb().prepare('SELECT * FROM library_folders WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(folder);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// PUT /api/library/folders/:id - rename or move folder
router.put('/folders/:id', authenticateToken, requireRole('operator', 'admin'), (req, res) => {
  try {
    const { name, parent_id } = req.body;
    const id = parseInt(req.params.id, 10);
    const now = new Date().toISOString();

    const sets = [];
    const params = [];
    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (parent_id !== undefined) { sets.push('parent_id = ?'); params.push(parent_id); }
    sets.push('updated_at = ?');
    params.push(now);
    params.push(id);

    getDb().prepare(`UPDATE library_folders SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    const folder = getDb().prepare('SELECT * FROM library_folders WHERE id = ?').get(id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json(folder);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

// DELETE /api/library/folders/:id - delete folder (assets get folder_id set to null)
router.delete('/folders/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const folder = getDb().prepare('SELECT * FROM library_folders WHERE id = ?').get(id);
    if (!folder) return res.status(404).json({ error: 'Folder not found' });

    // Re-parent children to this folder's parent
    getDb().prepare('UPDATE library_folders SET parent_id = ? WHERE parent_id = ?').run(folder.parent_id, id);
    getDb().prepare('UPDATE library_assets SET folder_id = NULL WHERE folder_id = ?').run(id);
    getDb().prepare('DELETE FROM library_folders WHERE id = ?').run(id);
    res.json({ message: 'Folder deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// ── Assets ──

// GET /api/library/assets - list assets, optional folder_id and search query
router.get('/assets', (req, res) => {
  try {
    const { folder_id, q } = req.query;
    let sql = 'SELECT * FROM library_assets';
    const params = [];
    const conditions = [];

    if (folder_id === 'null' || folder_id === 'root') {
      conditions.push('folder_id IS NULL');
    } else if (folder_id) {
      conditions.push('folder_id = ?');
      params.push(parseInt(folder_id, 10));
    }

    if (q) {
      conditions.push('(original_name LIKE ? OR tags LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    const assets = getDb().prepare(sql).all(...params);
    const parsed = assets.map(a => ({ ...a, tags: JSON.parse(a.tags || '[]') }));
    res.json({ assets: parsed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get assets' });
  }
});

// POST /api/library/assets/upload - upload one or more files
router.post('/assets/upload', authenticateToken, requireRole('operator', 'admin'), upload.array('files', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const folder_id = req.body.folder_id ? parseInt(req.body.folder_id, 10) : null;
    const now = new Date().toISOString();
    const results = [];

    const insert = getDb().prepare(
      'INSERT INTO library_assets (filename, original_name, mime_type, file_size, folder_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );

    for (const file of req.files) {
      let storedKey;
      // Resolve correct MIME type (multer may report application/octet-stream for fonts)
      const mime = _resolveMimeType(file.originalname, file.mimetype);

      if (useS3) {
        // Upload to S3
        const ext = path.extname(file.originalname).toLowerCase();
        const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `${base}_${Date.now()}${ext}`;
        storedKey = await s3.uploadFile(fileName, file.buffer, mime);
      } else {
        // Local disk — multer already saved it
        storedKey = file.filename;
      }

      const result = insert.run(storedKey, file.originalname, mime, file.size, folder_id, now);
      results.push({
        id: result.lastInsertRowid,
        filename: storedKey,
        original_name: file.originalname,
        mime_type: mime,
        file_size: file.size,
        folder_id,
        tags: [],
        url: `/api/library/assets/${result.lastInsertRowid}/file`,
        created_at: now,
      });
    }

    res.status(201).json({ assets: results });
  } catch (err) {
    console.error('Library upload error:', err.message);
    res.status(500).json({ error: 'Failed to upload files' });
  }
});

// PUT /api/library/assets/:id - update asset metadata (tags, folder, name)
router.put('/assets/:id', authenticateToken, requireRole('operator', 'admin'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { original_name, folder_id, tags } = req.body;

    const sets = [];
    const params = [];
    if (original_name !== undefined) { sets.push('original_name = ?'); params.push(original_name); }
    if (folder_id !== undefined) { sets.push('folder_id = ?'); params.push(folder_id); }
    if (tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(tags)); }

    if (sets.length === 0) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);

    getDb().prepare(`UPDATE library_assets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    const asset = getDb().prepare('SELECT * FROM library_assets WHERE id = ?').get(id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    asset.tags = JSON.parse(asset.tags || '[]');
    res.json(asset);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update asset' });
  }
});

// DELETE /api/library/assets/:id - delete asset from storage + DB
router.delete('/assets/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const asset = getDb().prepare('SELECT * FROM library_assets WHERE id = ?').get(id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    if (useS3) {
      // Delete from S3
      try {
        await s3.deleteFile(asset.filename);
      } catch (s3Err) {
        console.warn('[library] S3 delete failed (may already be gone):', s3Err.message);
      }
    } else {
      // Delete from local disk
      const filePath = path.join(LIBRARY_UPLOAD_DIR, asset.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }

    getDb().prepare('DELETE FROM library_assets WHERE id = ?').run(id);
    res.json({ message: 'Asset deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete asset' });
  }
});

// PUT /api/library/assets/:id/move - move asset to a different folder
router.put('/assets/:id/move', authenticateToken, requireRole('operator', 'admin'), (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { folder_id } = req.body;

    const asset = getDb().prepare('SELECT * FROM library_assets WHERE id = ?').get(id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    getDb().prepare('UPDATE library_assets SET folder_id = ? WHERE id = ?')
      .run(folder_id ?? null, id);

    const updated = getDb().prepare('SELECT * FROM library_assets WHERE id = ?').get(id);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to move asset' });
  }
});

// GET /api/library/assets/:id/file - serve the actual file (public, no auth)
// S3 mode: 302 redirect to a presigned URL (24h expiry, cached by browser)
// Local mode: serve directly from disk
router.get('/assets/:id/file', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const asset = getDb().prepare('SELECT filename, mime_type FROM library_assets WHERE id = ?').get(id);
    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    if (useS3) {
      const presignedUrl = await s3.getPresignedUrl(asset.filename, 86400); // 24h
      // Cache the redirect so browsers don't re-fetch the presigned URL on every load
      res.setHeader('Cache-Control', 'public, max-age=3600'); // cache redirect 1h
      res.redirect(302, presignedUrl);
    } else {
      const filePath = path.join(LIBRARY_UPLOAD_DIR, path.basename(asset.filename));
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found on disk' });
      }
      // Override MIME type for fonts — multer often stores application/octet-stream
      const contentType = _resolveMimeType(asset.filename, asset.mime_type);
      if (contentType) res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.sendFile(filePath);
    }
  } catch (err) {
    console.error('[library] File serve error:', err.message);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// POST /api/library/rescan - re-index orphaned files from disk into the DB
router.post('/rescan', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    if (useS3) {
      return res.status(400).json({ error: 'Re-scan is only supported for local disk storage' });
    }

    if (!fs.existsSync(LIBRARY_UPLOAD_DIR)) {
      return res.json({ recovered: 0, message: 'Upload directory does not exist' });
    }

    // Get all filenames currently tracked in the DB
    const tracked = new Set(
      getDb().prepare('SELECT filename FROM library_assets').all().map(r => r.filename)
    );

    // Scan disk for files not in DB
    const files = fs.readdirSync(LIBRARY_UPLOAD_DIR).filter(f => {
      const fullPath = path.join(LIBRARY_UPLOAD_DIR, f);
      return fs.statSync(fullPath).isFile() && !tracked.has(f);
    });

    if (files.length === 0) {
      return res.json({ recovered: 0, message: 'No orphaned files found' });
    }

    const now = new Date().toISOString();
    const insert = getDb().prepare(
      'INSERT INTO library_assets (filename, original_name, mime_type, file_size, folder_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const insertMany = getDb().transaction((fileList) => {
      const results = [];
      for (const f of fileList) {
        const fullPath = path.join(LIBRARY_UPLOAD_DIR, f);
        const stat = fs.statSync(fullPath);
        const mime = _resolveMimeType(f, 'application/octet-stream');
        // Derive a readable original name: strip the timestamp suffix before extension
        const ext = path.extname(f);
        const base = path.basename(f, ext).replace(/_\d{13}$/, '');
        const originalName = base + ext;

        const result = insert.run(f, originalName, mime, stat.size, null, now);
        results.push({ id: result.lastInsertRowid, filename: f, original_name: originalName });
      }
      return results;
    });

    const recovered = insertMany(files);
    res.json({ recovered: recovered.length, assets: recovered });
  } catch (err) {
    console.error('[library] Re-scan error:', err.message);
    res.status(500).json({ error: 'Failed to re-scan library' });
  }
});

/**
 * Resolve the correct MIME type for a file. Falls back to extension-based
 * lookup when the stored type is generic (e.g. application/octet-stream).
 */
function _resolveMimeType(filename, storedMime) {
  // If the stored MIME is specific enough, use it
  if (storedMime && storedMime !== 'application/octet-stream') return storedMime;

  const ext = (filename || '').match(/\.([^.]+)$/);
  if (!ext) return storedMime;

  const map = {
    ttf: 'font/ttf',
    otf: 'font/otf',
    woff: 'font/woff',
    woff2: 'font/woff2',
    svg: 'image/svg+xml',
    json: 'application/json',
  };
  return map[ext[1].toLowerCase()] || storedMime;
}

module.exports = router;
