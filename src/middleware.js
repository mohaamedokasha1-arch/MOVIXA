/* MOVIXA middleware: settings loader, auth guards, uploads */
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { db, allSettings } = require('./db');

function loadGlobals(req, res, next) {
  const settings = allSettings();
  const genres = db.prepare('SELECT * FROM genres ORDER BY sort_order, name').all();
  res.locals.settings = settings;
  res.locals.siteName = settings.site_name || 'MOVIXA';
  res.locals.genres = genres;
  res.locals.currentUser = null;
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  if (req.session && req.session.userId) {
    const u = db.prepare('SELECT id, username, email, role, created_at FROM users WHERE id = ?').get(req.session.userId);
    if (u) res.locals.currentUser = u;
    else delete req.session.userId;
  }
  // flash messages
  res.locals.flash = req.session ? (req.session.flash || null) : null;
  if (req.session) delete req.session.flash;
  next();
}

function setFlash(req, type, message) {
  if (req.session) req.session.flash = { type, message };
}

function requireAdmin(req, res, next) {
  if (!res.locals.currentUser) {
    setFlash(req, 'error', 'Please log in to access the admin dashboard.');
    return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

function requireSuperAdmin(req, res, next) {
  if (!res.locals.currentUser || res.locals.currentUser.role !== 'super_admin') {
    setFlash(req, 'error', 'Only super admins can manage users.');
    return res.redirect('/admin');
  }
  next();
}

function maintenanceGuard(req, res, next) {
  const settings = res.locals.settings || {};
  if (settings.maintenance_mode === '1' && !res.locals.currentUser && !req.path.startsWith('/admin')) {
    res.status(503);
    return res.render('pages/maintenance', {
      title: 'Maintenance - MOVIXA',
      metaDescription: 'MOVIXA is undergoing scheduled maintenance.',
      noIndex: true
    });
  }
  next();
}

// --- File uploads ---
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.writeFileSync(path.join(UPLOAD_DIR, '.gitkeep'), '', { flag: 'a' });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'file';
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/avif']);

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed (JPG, PNG, WebP, GIF, SVG, AVIF).'));
  }
});

function trackMedia(file) {
  const info = db.prepare('INSERT INTO media (filename, filepath, mimetype, size) VALUES (?, ?, ?, ?)')
    .run(file.originalname, '/uploads/' + file.filename, file.mimetype, file.size);
  return { id: info.lastInsertRowid, url: '/uploads/' + file.filename };
}

module.exports = { loadGlobals, setFlash, requireAdmin, requireSuperAdmin, maintenanceGuard, upload, trackMedia, UPLOAD_DIR };
