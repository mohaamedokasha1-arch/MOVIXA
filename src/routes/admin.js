/* MOVIXA admin routes — protected dashboard + full CRUD */
const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { db, getSetting, setSetting } = require('../db');
const { requireAdmin, requireSuperAdmin, setFlash, upload, trackMedia, UPLOAD_DIR } = require('../middleware');
const H = require('../helpers');
const V = require('../video-providers');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: 'draft-7',
  message: 'Too many login attempts. Please try again later.'
});

/* ---------- helpers ---------- */
function uniqueSlug(table, base, ignoreId = null) {
  let slug = H.slugify(base) || 'untitled';
  let candidate = slug, i = 2;
  while (true) {
    const row = db.prepare(`SELECT id FROM ${table} WHERE slug = ?`).get(candidate);
    if (!row || (ignoreId && row.id === ignoreId)) return candidate;
    candidate = `${slug}-${i++}`;
  }
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function setGenres(type, contentId, genreIds) {
  db.prepare('DELETE FROM content_genres WHERE content_type = ? AND content_id = ?').run(type, contentId);
  const ins = db.prepare('INSERT OR IGNORE INTO content_genres (content_id, content_type, genre_id) VALUES (?, ?, ?)');
  asArray(genreIds).forEach(g => { const id = parseInt(g, 10); if (id) ins.run(contentId, type, id); });
}

function setCast(type, contentId, body) {
  db.prepare('DELETE FROM content_cast WHERE content_type = ? AND content_id = ?').run(type, contentId);
  const ins = db.prepare('INSERT OR IGNORE INTO content_cast (content_id, content_type, cast_id, character_name) VALUES (?, ?, ?, ?)');
  asArray(body.cast_ids).forEach(c => {
    const id = parseInt(c, 10);
    if (!id) return;
    const ch = (body[`character_${id}`] || '').trim().slice(0, 120);
    ins.run(contentId, type, id, ch);
  });
}

function imageFrom(req, fileField, urlField) {
  if (req.file && req.file.fieldname === fileField) {
    // handled by caller via files map
  }
  return '';
}

/** Resolve an image value: uploaded file wins, else URL field, else existing. */
function resolveImage(files, fileField, body, urlField, existing = '') {
  const f = files && files[fileField] && files[fileField][0];
  if (f) {
    trackMedia(f);
    return '/uploads/' + f.filename;
  }
  const url = (body[urlField] || '').trim();
  if (url) return url.slice(0, 500);
  return existing || '';
}

function deleteUploadFile(filepath) {
  if (!filepath || !filepath.startsWith('/uploads/')) return;
  const full = path.join(UPLOAD_DIR, path.basename(filepath));
  fs.unlink(full, () => {});
}

/* ============================================================
   AUTH
============================================================ */
router.get('/login', (req, res) => {
  if (res.locals.currentUser) return res.redirect('/admin');
  res.render('admin/login', { layout: false, title: 'Admin Login - MOVIXA', next: req.query.next || '/admin' });
});

router.post('/login', loginLimiter, (req, res) => {
  const { username = '', password = '', remember = '' } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(username.trim(), username.trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('admin/login', { layout: false, title: 'Admin Login - MOVIXA', error: 'Invalid username or password.', next: req.query.next || req.body.next || '/admin' });
  }
  req.session.userId = user.id;
  if (remember) req.session.cookie.maxAge = 30 * 24 * 3600 * 1000; // 30 days
  const next = req.body.next && req.body.next.startsWith('/admin') ? req.body.next : '/admin';
  setFlash(req, 'success', `Welcome back, ${user.username}!`);
  res.redirect(next);
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

/* Live embed preview for the movie form — validates exactly like save does. */
router.get('/api/video-preview', requireAdmin, (req, res) => {
  const r = V.parseVideoSource(req.query.provider, req.query.input);
  if (!r.ok) return res.json({ ok: false, error: r.error });
  res.json({ ok: true, provider: r.provider, videoId: r.videoId, embedUrl: r.embedUrl });
});

/* ============================================================
   DASHBOARD
============================================================ */
router.get('/', requireAdmin, (req, res) => {
  const stats = {
    movies: db.prepare('SELECT COUNT(*) c FROM movies').get().c,
    moviesPublished: db.prepare(`SELECT COUNT(*) c FROM movies WHERE status = 'published'`).get().c,
    series: db.prepare('SELECT COUNT(*) c FROM series').get().c,
    episodes: db.prepare('SELECT COUNT(*) c FROM episodes').get().c,
    views: (db.prepare('SELECT COALESCE(SUM(view_count),0) s FROM movies').get().s || 0) +
           (db.prepare('SELECT COALESCE(SUM(view_count),0) s FROM series').get().s || 0) +
           (db.prepare('SELECT COALESCE(SUM(view_count),0) s FROM episodes').get().s || 0),
    genres: db.prepare('SELECT COUNT(*) c FROM genres').get().c,
    messages: db.prepare('SELECT COUNT(*) c FROM contact_messages WHERE is_read = 0').get().c,
    subscribers: db.prepare('SELECT COUNT(*) c FROM subscribers').get().c
  };
  const recentMovies = db.prepare('SELECT id, title, slug, status, created_at, poster_image FROM movies ORDER BY created_at DESC LIMIT 5').all();
  const recentSeries = db.prepare('SELECT id, title, slug, publish_status AS status, created_at, poster_image FROM series ORDER BY created_at DESC LIMIT 5').all();
  const recentMessages = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 5').all();
  const topContent = db.prepare(`SELECT title, slug, view_count, 'movie' AS type FROM movies WHERE status='published'
    UNION ALL SELECT title, slug, view_count, 'series' FROM series WHERE publish_status='published'
    ORDER BY view_count DESC LIMIT 6`).all();
  res.render('admin/dashboard', {
    layout: 'admin/layout', title: 'Dashboard - MOVIXA Admin', active: 'dashboard',
    stats, recentMovies, recentSeries, recentMessages, topContent
  });
});

/* ============================================================
   MOVIES
============================================================ */
router.get('/movies', requireAdmin, (req, res) => {
  const { status = '', featured = '', q = '', page = '1' } = req.query;
  const where = [];
  const params = [];
  if (['draft', 'published', 'archived'].includes(status)) { where.push('status = ?'); params.push(status); }
  if (featured === '1') where.push('featured = 1');
  if (featured === '0') where.push('featured = 0');
  if (q.trim()) { where.push('(title LIKE ? OR original_title LIKE ?)'); params.push(`%${q.trim()}%`, `%${q.trim()}%`); }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM movies ${sql}`).get(...params).c;
  const pg = H.paginate(total, parseInt(page, 10) || 1, 15);
  const items = db.prepare(`SELECT * FROM movies ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pg.perPage, pg.offset);
  res.render('admin/movies', {
    layout: 'admin/layout', title: 'Movies - MOVIXA Admin', active: 'movies',
    items, pg, filters: { status, featured, q }
  });
});

router.post('/movies/bulk', requireAdmin, (req, res) => {
  const ids = asArray(req.body.ids).map(i => parseInt(i, 10)).filter(Boolean);
  const action = req.body.bulk_action;
  if (ids.length && ['publish', 'draft', 'archive', 'delete', 'feature', 'unfeature'].includes(action)) {
    const ph = ids.map(() => '?').join(',');
    if (action === 'delete') {
      const rows = db.prepare(`SELECT poster_image, backdrop_image, og_image FROM movies WHERE id IN (${ph})`).all(...ids);
      rows.forEach(r => [r.poster_image, r.backdrop_image, r.og_image].forEach(deleteUploadFile));
      db.prepare(`DELETE FROM content_genres WHERE content_type = 'movie' AND content_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM content_cast WHERE content_type = 'movie' AND content_id IN (${ph})`).run(...ids);
      db.prepare(`DELETE FROM movies WHERE id IN (${ph})`).run(...ids);
      setFlash(req, 'success', `${ids.length} movie(s) deleted.`);
    } else if (action === 'feature' || action === 'unfeature') {
      db.prepare(`UPDATE movies SET featured = ?, updated_at = datetime('now') WHERE id IN (${ph})`).run(action === 'feature' ? 1 : 0, ...ids);
      setFlash(req, 'success', `${ids.length} movie(s) updated.`);
    } else {
      const map = { publish: 'published', draft: 'draft', archive: 'archived' };
      db.prepare(`UPDATE movies SET status = ?, updated_at = datetime('now') WHERE id IN (${ph})`).run(map[action], ...ids);
      setFlash(req, 'success', `${ids.length} movie(s) updated.`);
    }
  }
  res.redirect('/admin/movies');
});

function movieFormData(movie = {}) {
  return {
    movie: {
      title: '', original_title: '', slug: '', description: '', short_description: '',
      release_year: '', runtime: '', language: '', country: '', director: '',
      poster_image: '', backdrop_image: '', trailer_url: '',
      official_watch_url: '', official_source_name: '',
      rating: '', featured: 0, status: 'draft', tags: '',
      video_provider: 'none', video_id: '', video_embed_url: '', video_input: '',
      seo_title: '', seo_description: '', og_image: '', ...movie
    },
    videoOptions: V.ADMIN_VIDEO_OPTIONS,
    allGenres: db.prepare('SELECT * FROM genres ORDER BY name').all(),
    allPeople: db.prepare('SELECT * FROM people ORDER BY name').all(),
    selectedGenres: movie.id ? db.prepare(`SELECT genre_id FROM content_genres WHERE content_type = 'movie' AND content_id = ?`).all(movie.id).map(r => r.genre_id) : [],
    selectedCast: movie.id ? db.prepare(`SELECT cast_id, character_name FROM content_cast WHERE content_type = 'movie' AND content_id = ?`).all(movie.id) : []
  };
}

router.get('/movies/new', requireAdmin, (req, res) => {
  res.render('admin/movie-form', { layout: 'admin/layout', title: 'Add Movie - MOVIXA Admin', active: 'movies', isEdit: false, ...movieFormData() });
});

router.get('/movies/edit/:id', requireAdmin, (req, res) => {
  const movie = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (!movie) { setFlash(req, 'error', 'Movie not found.'); return res.redirect('/admin/movies'); }
  // Show the bare video ID for direct providers, otherwise the stored embed URL — editable without code.
  movie.video_input = (V.getProvider(movie.video_provider) && movie.video_id) ? movie.video_id : (movie.video_embed_url || '');
  res.render('admin/movie-form', { layout: 'admin/layout', title: 'Edit Movie - MOVIXA Admin', active: 'movies', isEdit: true, ...movieFormData(movie) });
});

const movieUpload = upload.fields([
  { name: 'poster_file', maxCount: 1 },
  { name: 'backdrop_file', maxCount: 1 },
  { name: 'og_file', maxCount: 1 }
]);

router.post(['/movies/new', '/movies/edit/:id'], requireAdmin, (req, res) => {
  movieUpload(req, res, (err) => {
    if (err) {
      setFlash(req, 'error', err.message);
      return res.redirect('back');
    }
    const b = req.body || {};
    const isEdit = !!req.params.id;
    const existing = isEdit ? db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id) : null;
    if (isEdit && !existing) { setFlash(req, 'error', 'Movie not found.'); return res.redirect('/admin/movies'); }

    const errors = [];
    if (!b.title || !b.title.trim()) errors.push('Title is required.');
    if (b.official_watch_url && b.official_watch_url.trim() && !H.isValidUrl(b.official_watch_url.trim())) errors.push('Official Watch URL is not a valid URL.');
    if (b.trailer_url && b.trailer_url.trim() && !H.isValidUrl(b.trailer_url.trim())) errors.push('Trailer URL is not a valid URL.');
    if (b.poster_image && b.poster_image.trim() && !H.isValidUrl(b.poster_image.trim()) && !b.poster_image.startsWith('/')) errors.push('Poster image must be a valid URL.');
    if (b.rating !== '' && b.rating != null && (isNaN(parseFloat(b.rating)) || parseFloat(b.rating) < 0 || parseFloat(b.rating) > 10)) errors.push('Rating must be between 0 and 10.');
    if ((b.short_description || '').length > 200) errors.push('Short description must be 200 characters or less.');
    const vs = V.parseVideoSource(b.video_provider, b.video_input);
    if (!vs.ok) errors.push(vs.error);
    if (errors.length) {
      setFlash(req, 'error', errors.join(' '));
      return res.redirect('back');
    }

    const slug = uniqueSlug('movies', b.slug && b.slug.trim() ? b.slug : b.title, isEdit ? existing.id : null);
    const data = {
      title: b.title.trim().slice(0, 200),
      original_title: (b.original_title || '').trim().slice(0, 200),
      slug,
      description: H.cleanRich(b.description || ''),
      short_description: (b.short_description || '').trim().slice(0, 200),
      release_year: b.release_year ? parseInt(b.release_year, 10) || null : null,
      runtime: b.runtime ? parseInt(b.runtime, 10) || null : null,
      language: (b.language || '').trim().slice(0, 60),
      country: (b.country || '').trim().slice(0, 60),
      director: (b.director || '').trim().slice(0, 200),
      poster_image: resolveImage(req.files, 'poster_file', b, 'poster_image', existing ? existing.poster_image : ''),
      backdrop_image: resolveImage(req.files, 'backdrop_file', b, 'backdrop_image', existing ? existing.backdrop_image : ''),
      trailer_url: (b.trailer_url || '').trim().slice(0, 500),
      official_watch_url: (b.official_watch_url || '').trim().slice(0, 500),
      official_source_name: (b.official_source_name || '').trim().slice(0, 100),
      video_provider: vs.provider,
      video_id: vs.videoId || '',
      video_embed_url: vs.embedUrl || '',
      rating: b.rating === '' || b.rating == null ? 0 : Math.max(0, Math.min(10, parseFloat(b.rating))),
      featured: b.featured ? 1 : 0,
      status: ['draft', 'published', 'archived'].includes(b.status) ? b.status : 'draft',
      tags: (b.tags || '').trim().slice(0, 300),
      seo_title: (b.seo_title || '').trim().slice(0, 200),
      seo_description: (b.seo_description || '').trim().slice(0, 200),
      og_image: resolveImage(req.files, 'og_file', b, 'og_image', existing ? existing.og_image : '')
    };
    if (isEdit) {
      ['poster_image', 'backdrop_image', 'og_image'].forEach(k => {
        if (existing[k] && data[k] !== existing[k]) deleteUploadFile(existing[k]);
      });
      const keys = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE movies SET ${keys}, updated_at = datetime('now') WHERE id = @id`).run({ ...data, id: existing.id });
      setGenres('movie', existing.id, b.genre_ids);
      setCast('movie', existing.id, b);
      if (b.add_person_name && b.add_person_name.trim()) {
        const pid = db.prepare('INSERT INTO people (name, role) VALUES (?, ?)').run(b.add_person_name.trim().slice(0, 120), b.add_person_role || 'actor').lastInsertRowid;
        db.prepare('INSERT OR IGNORE INTO content_cast (content_id, content_type, cast_id, character_name) VALUES (?, ?, ?, ?)').run(existing.id, 'movie', pid, '');
      }
      setFlash(req, 'success', 'Movie updated successfully!');
      return res.redirect(b.save_and_view ? `/movie/${slug}` : `/admin/movies/edit/${existing.id}`);
    }
    const info = db.prepare(`INSERT INTO movies (${Object.keys(data).join(', ')}) VALUES (${Object.keys(data).map(k => '@' + k).join(', ')})`).run(data);
    setGenres('movie', info.lastInsertRowid, b.genre_ids);
    setCast('movie', info.lastInsertRowid, b);
    setFlash(req, 'success', 'Movie created successfully!');
    if (b.save_and_add) return res.redirect('/admin/movies/new');
    res.redirect(b.save_and_view ? `/movie/${slug}` : `/admin/movies/edit/${info.lastInsertRowid}`);
  });
});

router.post('/movies/delete/:id', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM movies WHERE id = ?').get(req.params.id);
  if (m) {
    [m.poster_image, m.backdrop_image, m.og_image].forEach(deleteUploadFile);
    db.prepare(`DELETE FROM content_genres WHERE content_type = 'movie' AND content_id = ?`).run(m.id);
    db.prepare(`DELETE FROM content_cast WHERE content_type = 'movie' AND content_id = ?`).run(m.id);
    db.prepare('DELETE FROM movies WHERE id = ?').run(m.id);
    setFlash(req, 'success', 'Movie deleted.');
  }
  res.redirect('/admin/movies');
});

/* ============================================================
   SERIES + SEASONS + EPISODES
============================================================ */
router.get('/series', requireAdmin, (req, res) => {
  const { status = '', q = '', page = '1' } = req.query;
  const where = [];
  const params = [];
  if (['draft', 'published', 'archived'].includes(status)) { where.push('publish_status = ?'); params.push(status); }
  if (q.trim()) { where.push('(title LIKE ? OR original_title LIKE ?)'); params.push(`%${q.trim()}%`, `%${q.trim()}%`); }
  const sql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM series ${sql}`).get(...params).c;
  const pg = H.paginate(total, parseInt(page, 10) || 1, 15);
  const items = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM seasons WHERE series_id = s.id) AS seasons_count,
    (SELECT COUNT(*) FROM episodes WHERE series_id = s.id) AS episodes_count FROM series s ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pg.perPage, pg.offset);
  res.render('admin/series', { layout: 'admin/layout', title: 'Series - MOVIXA Admin', active: 'series', items, pg, filters: { status, q } });
});

function seriesFormData(show = {}) {
  return {
    show: {
      title: '', original_title: '', slug: '', description: '', short_description: '',
      first_air_year: '', last_air_year: '', status: 'ongoing', language: '', country: '',
      poster_image: '', backdrop_image: '', trailer_url: '', rating: '',
      featured: 0, publish_status: 'draft', tags: '',
      seo_title: '', seo_description: '', og_image: '', ...show
    },
    allGenres: db.prepare('SELECT * FROM genres ORDER BY name').all(),
    allPeople: db.prepare('SELECT * FROM people ORDER BY name').all(),
    selectedGenres: show.id ? db.prepare(`SELECT genre_id FROM content_genres WHERE content_type = 'series' AND content_id = ?`).all(show.id).map(r => r.genre_id) : [],
    selectedCast: show.id ? db.prepare(`SELECT cast_id, character_name FROM content_cast WHERE content_type = 'series' AND content_id = ?`).all(show.id) : []
  };
}

router.get('/series/new', requireAdmin, (req, res) => {
  res.render('admin/series-form', { layout: 'admin/layout', title: 'Add Series - MOVIXA Admin', active: 'series', isEdit: false, ...seriesFormData() });
});

router.get('/series/edit/:id', requireAdmin, (req, res) => {
  const show = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!show) { setFlash(req, 'error', 'Series not found.'); return res.redirect('/admin/series'); }
  const seasons = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM episodes WHERE season_id = s.id) AS episodes_count FROM seasons s WHERE series_id = ? ORDER BY season_number`).all(show.id);
  res.render('admin/series-form', { layout: 'admin/layout', title: 'Edit Series - MOVIXA Admin', active: 'series', isEdit: true, seasons, ...seriesFormData(show) });
});

const seriesUpload = upload.fields([
  { name: 'poster_file', maxCount: 1 },
  { name: 'backdrop_file', maxCount: 1 },
  { name: 'og_file', maxCount: 1 }
]);

router.post(['/series/new', '/series/edit/:id'], requireAdmin, (req, res) => {
  seriesUpload(req, res, (err) => {
    if (err) { setFlash(req, 'error', err.message); return res.redirect('back'); }
    const b = req.body || {};
    const isEdit = !!req.params.id;
    const existing = isEdit ? db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id) : null;
    if (isEdit && !existing) { setFlash(req, 'error', 'Series not found.'); return res.redirect('/admin/series'); }
    if (!b.title || !b.title.trim()) { setFlash(req, 'error', 'Title is required.'); return res.redirect('back'); }
    if (b.trailer_url && b.trailer_url.trim() && !H.isValidUrl(b.trailer_url.trim())) { setFlash(req, 'error', 'Trailer URL is not valid.'); return res.redirect('back'); }

    const slug = uniqueSlug('series', b.slug && b.slug.trim() ? b.slug : b.title, isEdit ? existing.id : null);
    const data = {
      title: b.title.trim().slice(0, 200),
      original_title: (b.original_title || '').trim().slice(0, 200),
      slug,
      description: H.cleanRich(b.description || ''),
      short_description: (b.short_description || '').trim().slice(0, 200),
      first_air_year: b.first_air_year ? parseInt(b.first_air_year, 10) || null : null,
      last_air_year: b.last_air_year ? parseInt(b.last_air_year, 10) || null : null,
      status: ['ongoing', 'completed', 'cancelled'].includes(b.status) ? b.status : 'ongoing',
      language: (b.language || '').trim().slice(0, 60),
      country: (b.country || '').trim().slice(0, 60),
      poster_image: resolveImage(req.files, 'poster_file', b, 'poster_image', existing ? existing.poster_image : ''),
      backdrop_image: resolveImage(req.files, 'backdrop_file', b, 'backdrop_image', existing ? existing.backdrop_image : ''),
      trailer_url: (b.trailer_url || '').trim().slice(0, 500),
      rating: b.rating === '' || b.rating == null ? 0 : Math.max(0, Math.min(10, parseFloat(b.rating) || 0)),
      featured: b.featured ? 1 : 0,
      publish_status: ['draft', 'published', 'archived'].includes(b.publish_status) ? b.publish_status : 'draft',
      tags: (b.tags || '').trim().slice(0, 300),
      seo_title: (b.seo_title || '').trim().slice(0, 200),
      seo_description: (b.seo_description || '').trim().slice(0, 200),
      og_image: resolveImage(req.files, 'og_file', b, 'og_image', existing ? existing.og_image : '')
    };
    if (isEdit) {
      ['poster_image', 'backdrop_image', 'og_image'].forEach(k => { if (existing[k] && data[k] !== existing[k]) deleteUploadFile(existing[k]); });
      const keys = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
      db.prepare(`UPDATE series SET ${keys}, updated_at = datetime('now') WHERE id = @id`).run({ ...data, id: existing.id });
      setGenres('series', existing.id, b.genre_ids);
      setCast('series', existing.id, b);
      setFlash(req, 'success', 'Series updated successfully!');
      return res.redirect(b.save_and_view ? `/series/${slug}` : `/admin/series/edit/${existing.id}`);
    }
    const info = db.prepare(`INSERT INTO series (${Object.keys(data).join(', ')}) VALUES (${Object.keys(data).map(k => '@' + k).join(', ')})`).run(data);
    setGenres('series', info.lastInsertRowid, b.genre_ids);
    setCast('series', info.lastInsertRowid, b);
    setFlash(req, 'success', 'Series created! Now add seasons.');
    res.redirect(`/admin/series/${info.lastInsertRowid}/seasons`);
  });
});

router.post('/series/delete/:id', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (s) {
    // delete related upload files
    [s.poster_image, s.backdrop_image, s.og_image].forEach(deleteUploadFile);
    db.prepare('SELECT poster_image FROM seasons WHERE series_id = ?').all(s.id).forEach(r => deleteUploadFile(r.poster_image));
    db.prepare('SELECT thumbnail_image FROM episodes WHERE series_id = ?').all(s.id).forEach(r => deleteUploadFile(r.thumbnail_image));
    db.prepare(`DELETE FROM content_genres WHERE content_type = 'series' AND content_id = ?`).run(s.id);
    db.prepare(`DELETE FROM content_cast WHERE content_type = 'series' AND content_id = ?`).run(s.id);
    db.prepare('DELETE FROM series WHERE id = ?').run(s.id);
    setFlash(req, 'success', 'Series and all its seasons/episodes deleted.');
  }
  res.redirect('/admin/series');
});

/* ---- seasons ---- */
router.get('/series/:id/seasons', requireAdmin, (req, res) => {
  const show = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!show) { setFlash(req, 'error', 'Series not found.'); return res.redirect('/admin/series'); }
  const seasons = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM episodes WHERE season_id = s.id) AS episodes_count FROM seasons s WHERE series_id = ? ORDER BY season_number`).all(show.id);
  res.render('admin/seasons', { layout: 'admin/layout', title: `Seasons - ${show.title}`, active: 'series', show, seasons });
});

router.get('/series/:id/seasons/new', requireAdmin, (req, res) => {
  const show = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!show) return res.redirect('/admin/series');
  const maxN = db.prepare('SELECT COALESCE(MAX(season_number),0) m FROM seasons WHERE series_id = ?').get(show.id).m;
  res.render('admin/season-form', {
    layout: 'admin/layout', title: 'Add Season', active: 'series', isEdit: false, show,
    season: { season_number: maxN + 1, title: `Season ${maxN + 1}`, description: '', air_year: '', poster_image: '', status: 'published' }
  });
});

router.get('/series/:id/seasons/edit/:seasonId', requireAdmin, (req, res) => {
  const show = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ? AND series_id = ?').get(req.params.seasonId, req.params.id);
  if (!show || !season) return res.redirect('/admin/series');
  res.render('admin/season-form', { layout: 'admin/layout', title: 'Edit Season', active: 'series', isEdit: true, show, season });
});

router.post(['/series/:id/seasons/new', '/series/:id/seasons/edit/:seasonId'], requireAdmin, upload.single('poster_file'), (req, res) => {
  const show = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  if (!show) return res.redirect('/admin/series');
  const b = req.body || {};
  const isEdit = !!req.params.seasonId;
  const existing = isEdit ? db.prepare('SELECT * FROM seasons WHERE id = ? AND series_id = ?').get(req.params.seasonId, show.id) : null;
  if (isEdit && !existing) return res.redirect(`/admin/series/${show.id}/seasons`);
  const num = parseInt(b.season_number, 10);
  if (!num || num < 1) { setFlash(req, 'error', 'Season number must be at least 1.'); return res.redirect('back'); }
  const dup = db.prepare('SELECT id FROM seasons WHERE series_id = ? AND season_number = ?').get(show.id, num);
  if (dup && (!isEdit || dup.id !== existing.id)) { setFlash(req, 'error', 'That season number already exists for this series.'); return res.redirect('back'); }
  let poster = existing ? existing.poster_image : '';
  if (req.file) { trackMedia(req.file); poster = '/uploads/' + req.file.filename; }
  else if ((b.poster_image || '').trim()) poster = b.poster_image.trim().slice(0, 500);
  if (isEdit) {
    if (existing.poster_image && poster !== existing.poster_image) deleteUploadFile(existing.poster_image);
    db.prepare(`UPDATE seasons SET season_number = ?, title = ?, description = ?, air_year = ?, poster_image = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(num, (b.title || `Season ${num}`).trim().slice(0, 200), H.cleanRich(b.description || ''), b.air_year ? parseInt(b.air_year, 10) || null : null, poster, b.status === 'draft' ? 'draft' : 'published', existing.id);
    setFlash(req, 'success', 'Season updated!');
  } else {
    const info = db.prepare('INSERT INTO seasons (series_id, season_number, title, description, air_year, poster_image, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(show.id, num, (b.title || `Season ${num}`).trim().slice(0, 200), H.cleanRich(b.description || ''), b.air_year ? parseInt(b.air_year, 10) || null : null, poster, b.status === 'draft' ? 'draft' : 'published');
    setFlash(req, 'success', 'Season created! Now add episodes.');
    return res.redirect(`/admin/series/${show.id}/season/${info.lastInsertRowid}/episodes`);
  }
  res.redirect(`/admin/series/${show.id}/seasons`);
});

router.post('/series/:id/seasons/delete/:seasonId', requireAdmin, (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ? AND series_id = ?').get(req.params.seasonId, req.params.id);
  if (season) {
    deleteUploadFile(season.poster_image);
    db.prepare('SELECT thumbnail_image FROM episodes WHERE season_id = ?').all(season.id).forEach(r => deleteUploadFile(r.thumbnail_image));
    db.prepare('DELETE FROM seasons WHERE id = ?').run(season.id);
    setFlash(req, 'success', 'Season and its episodes deleted.');
  }
  res.redirect(`/admin/series/${req.params.id}/seasons`);
});

/* ---- episodes ---- */
router.get('/series/:id/season/:seasonId/episodes', requireAdmin, (req, res) => {
  const show = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ? AND series_id = ?').get(req.params.seasonId, req.params.id);
  if (!show || !season) return res.redirect('/admin/series');
  const episodes = db.prepare('SELECT * FROM episodes WHERE season_id = ? ORDER BY episode_number').all(season.id);
  res.render('admin/episodes', { layout: 'admin/layout', title: 'Episodes', active: 'series', show, season, episodes });
});

function episodeDefaults(season) {
  const maxN = db.prepare('SELECT COALESCE(MAX(episode_number),0) m FROM episodes WHERE season_id = ?').get(season.id).m;
  return { episode_number: maxN + 1, title: '', slug: '', description: '', air_date: '', runtime: '', thumbnail_image: '', official_watch_url: '', official_source_name: '', status: 'published', seo_title: '', seo_description: '' };
}

router.get('/series/:id/season/:seasonId/episodes/new', requireAdmin, (req, res) => {
  const show = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ? AND series_id = ?').get(req.params.seasonId, req.params.id);
  if (!show || !season) return res.redirect('/admin/series');
  res.render('admin/episode-form', { layout: 'admin/layout', title: 'Add Episode', active: 'series', isEdit: false, show, season, ep: episodeDefaults(season) });
});

router.get('/series/:id/season/:seasonId/episodes/edit/:epId', requireAdmin, (req, res) => {
  const show = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ? AND series_id = ?').get(req.params.seasonId, req.params.id);
  const ep = db.prepare('SELECT * FROM episodes WHERE id = ? AND season_id = ?').get(req.params.epId, req.params.seasonId);
  if (!show || !season || !ep) return res.redirect('/admin/series');
  res.render('admin/episode-form', { layout: 'admin/layout', title: 'Edit Episode', active: 'series', isEdit: true, show, season, ep });
});

router.post(['/series/:id/season/:seasonId/episodes/new', '/series/:id/season/:seasonId/episodes/edit/:epId'], requireAdmin, upload.single('thumbnail_file'), (req, res) => {
  const show = db.prepare('SELECT * FROM series WHERE id = ?').get(req.params.id);
  const season = db.prepare('SELECT * FROM seasons WHERE id = ? AND series_id = ?').get(req.params.seasonId, req.params.id);
  if (!show || !season) return res.redirect('/admin/series');
  const b = req.body || {};
  const isEdit = !!req.params.epId;
  const existing = isEdit ? db.prepare('SELECT * FROM episodes WHERE id = ? AND season_id = ?').get(req.params.epId, season.id) : null;
  if (isEdit && !existing) return res.redirect(`/admin/series/${show.id}/season/${season.id}/episodes`);
  if (!b.title || !b.title.trim()) { setFlash(req, 'error', 'Episode title is required.'); return res.redirect('back'); }
  const num = parseInt(b.episode_number, 10);
  if (!num || num < 1) { setFlash(req, 'error', 'Episode number must be at least 1.'); return res.redirect('back'); }
  const dup = db.prepare('SELECT id FROM episodes WHERE season_id = ? AND episode_number = ?').get(season.id, num);
  if (dup && (!isEdit || dup.id !== existing.id)) { setFlash(req, 'error', 'That episode number already exists in this season.'); return res.redirect('back'); }
  if (b.official_watch_url && b.official_watch_url.trim() && !H.isValidUrl(b.official_watch_url.trim())) { setFlash(req, 'error', 'Official Watch URL is not valid.'); return res.redirect('back'); }
  let thumb = existing ? existing.thumbnail_image : '';
  if (req.file) { trackMedia(req.file); thumb = '/uploads/' + req.file.filename; }
  else if ((b.thumbnail_image || '').trim()) thumb = b.thumbnail_image.trim().slice(0, 500);
  const data = {
    episode_number: num,
    title: b.title.trim().slice(0, 200),
    slug: H.slugify(b.slug && b.slug.trim() ? b.slug : b.title),
    description: H.cleanRich(b.description || ''),
    air_date: (b.air_date || '').slice(0, 10),
    runtime: b.runtime ? parseInt(b.runtime, 10) || null : null,
    thumbnail_image: thumb,
    official_watch_url: (b.official_watch_url || '').trim().slice(0, 500),
    official_source_name: (b.official_source_name || '').trim().slice(0, 100),
    status: b.status === 'draft' ? 'draft' : 'published',
    seo_title: (b.seo_title || '').trim().slice(0, 200),
    seo_description: (b.seo_description || '').trim().slice(0, 200)
  };
  if (isEdit) {
    if (existing.thumbnail_image && thumb !== existing.thumbnail_image) deleteUploadFile(existing.thumbnail_image);
    const keys = Object.keys(data).map(k => `${k} = @${k}`).join(', ');
    db.prepare(`UPDATE episodes SET ${keys}, updated_at = datetime('now') WHERE id = @id`).run({ ...data, id: existing.id });
    setFlash(req, 'success', 'Episode updated!');
  } else {
    db.prepare(`INSERT INTO episodes (series_id, season_id, ${Object.keys(data).join(', ')}) VALUES (@series_id, @season_id, ${Object.keys(data).map(k => '@' + k).join(', ')})`).run({ series_id: show.id, season_id: season.id, ...data });
    db.prepare('UPDATE seasons SET episode_count = (SELECT COUNT(*) FROM episodes WHERE season_id = ?), updated_at = datetime(\'now\') WHERE id = ?').run(season.id, season.id);
    setFlash(req, 'success', 'Episode created!');
    if (b.save_and_add) return res.redirect(`/admin/series/${show.id}/season/${season.id}/episodes/new`);
  }
  res.redirect(`/admin/series/${show.id}/season/${season.id}/episodes`);
});

router.post('/series/:id/season/:seasonId/episodes/delete/:epId', requireAdmin, (req, res) => {
  const ep = db.prepare('SELECT * FROM episodes WHERE id = ? AND season_id = ?').get(req.params.epId, req.params.seasonId);
  if (ep) {
    deleteUploadFile(ep.thumbnail_image);
    db.prepare('DELETE FROM episodes WHERE id = ?').run(ep.id);
    db.prepare('UPDATE seasons SET episode_count = (SELECT COUNT(*) FROM episodes WHERE season_id = ?) WHERE id = ?').run(ep.season_id, ep.season_id);
    setFlash(req, 'success', 'Episode deleted.');
  }
  res.redirect(`/admin/series/${req.params.id}/season/${req.params.seasonId}/episodes`);
});

/* ============================================================
   GENRES
============================================================ */
router.get('/genres', requireAdmin, (req, res) => {
  const items = db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM content_genres WHERE genre_id = g.id) AS usage_count FROM genres g ORDER BY sort_order, name`).all();
  res.render('admin/genres', { layout: 'admin/layout', title: 'Genres - MOVIXA Admin', active: 'genres', items });
});

router.get('/genres/new', requireAdmin, (req, res) => {
  res.render('admin/genre-form', { layout: 'admin/layout', title: 'Add Genre', active: 'genres', isEdit: false, genre: { name: '', slug: '', description: '', image: '', seo_title: '', seo_description: '' } });
});

router.get('/genres/edit/:id', requireAdmin, (req, res) => {
  const genre = db.prepare('SELECT * FROM genres WHERE id = ?').get(req.params.id);
  if (!genre) return res.redirect('/admin/genres');
  res.render('admin/genre-form', { layout: 'admin/layout', title: 'Edit Genre', active: 'genres', isEdit: true, genre });
});

router.post(['/genres/new', '/genres/edit/:id'], requireAdmin, upload.single('image_file'), (req, res) => {
  const b = req.body || {};
  const isEdit = !!req.params.id;
  const existing = isEdit ? db.prepare('SELECT * FROM genres WHERE id = ?').get(req.params.id) : null;
  if (isEdit && !existing) return res.redirect('/admin/genres');
  if (!b.name || !b.name.trim()) { setFlash(req, 'error', 'Genre name is required.'); return res.redirect('back'); }
  let image = existing ? existing.image : '';
  if (req.file) { trackMedia(req.file); image = '/uploads/' + req.file.filename; }
  else if ((b.image || '').trim()) image = b.image.trim().slice(0, 500);
  const slug = uniqueSlug('genres', b.slug && b.slug.trim() ? b.slug : b.name, isEdit ? existing.id : null);
  if (isEdit) {
    if (existing.image && image !== existing.image) deleteUploadFile(existing.image);
    db.prepare('UPDATE genres SET name = ?, slug = ?, description = ?, image = ?, seo_title = ?, seo_description = ? WHERE id = ?')
      .run(b.name.trim().slice(0, 80), slug, (b.description || '').trim().slice(0, 500), image, (b.seo_title || '').trim().slice(0, 200), (b.seo_description || '').trim().slice(0, 200), existing.id);
    setFlash(req, 'success', 'Genre updated!');
  } else {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),-1) m FROM genres').get().m;
    db.prepare('INSERT INTO genres (name, slug, description, image, sort_order, seo_title, seo_description) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(b.name.trim().slice(0, 80), slug, (b.description || '').trim().slice(0, 500), image, maxOrder + 1, (b.seo_title || '').trim().slice(0, 200), (b.seo_description || '').trim().slice(0, 200));
    setFlash(req, 'success', 'Genre created!');
  }
  res.redirect('/admin/genres');
});

router.post('/genres/reorder', requireAdmin, (req, res) => {
  const order = asArray(req.body.order);
  const upd = db.prepare('UPDATE genres SET sort_order = ? WHERE id = ?');
  order.forEach((id, i) => { if (parseInt(id, 10)) upd.run(i, parseInt(id, 10)); });
  res.json({ ok: true });
});

router.post('/genres/delete/:id', requireAdmin, (req, res) => {
  const g = db.prepare('SELECT * FROM genres WHERE id = ?').get(req.params.id);
  if (g) {
    deleteUploadFile(g.image);
    db.prepare('DELETE FROM content_genres WHERE genre_id = ?').run(g.id);
    db.prepare('DELETE FROM genres WHERE id = ?').run(g.id);
    setFlash(req, 'success', 'Genre deleted.');
  }
  res.redirect('/admin/genres');
});

/* ============================================================
   CAST & CREW
============================================================ */
router.get('/cast', requireAdmin, (req, res) => {
  const { q = '', page = '1' } = req.query;
  const where = q.trim() ? 'WHERE name LIKE ?' : '';
  const params = q.trim() ? [`%${q.trim()}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) c FROM people ${where}`).get(...params).c;
  const pg = H.paginate(total, parseInt(page, 10) || 1, 20);
  const items = db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM content_cast WHERE cast_id = p.id) AS credits FROM people p ${where} ORDER BY name LIMIT ? OFFSET ?`).all(...params, pg.perPage, pg.offset);
  res.render('admin/cast', { layout: 'admin/layout', title: 'Cast & Crew - MOVIXA Admin', active: 'cast', items, pg, q });
});

router.get('/cast/new', requireAdmin, (req, res) => {
  res.render('admin/cast-form', { layout: 'admin/layout', title: 'Add Person', active: 'cast', isEdit: false, person: { name: '', role: 'actor', image: '', bio: '' } });
});

router.get('/cast/edit/:id', requireAdmin, (req, res) => {
  const person = db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
  if (!person) return res.redirect('/admin/cast');
  res.render('admin/cast-form', { layout: 'admin/layout', title: 'Edit Person', active: 'cast', isEdit: true, person });
});

router.post(['/cast/new', '/cast/edit/:id'], requireAdmin, upload.single('image_file'), (req, res) => {
  const b = req.body || {};
  const isEdit = !!req.params.id;
  const existing = isEdit ? db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id) : null;
  if (isEdit && !existing) return res.redirect('/admin/cast');
  if (!b.name || !b.name.trim()) { setFlash(req, 'error', 'Name is required.'); return res.redirect('back'); }
  let image = existing ? existing.image : '';
  if (req.file) { trackMedia(req.file); image = '/uploads/' + req.file.filename; }
  else if ((b.image || '').trim()) image = b.image.trim().slice(0, 500);
  if (isEdit) {
    if (existing.image && image !== existing.image) deleteUploadFile(existing.image);
    db.prepare('UPDATE people SET name = ?, role = ?, image = ?, bio = ? WHERE id = ?')
      .run(b.name.trim().slice(0, 120), ['actor', 'director', 'writer'].includes(b.role) ? b.role : 'actor', image, (b.bio || '').trim().slice(0, 2000), existing.id);
    setFlash(req, 'success', 'Person updated!');
  } else {
    db.prepare('INSERT INTO people (name, role, image, bio) VALUES (?, ?, ?, ?)')
      .run(b.name.trim().slice(0, 120), ['actor', 'director', 'writer'].includes(b.role) ? b.role : 'actor', image, (b.bio || '').trim().slice(0, 2000));
    setFlash(req, 'success', 'Person added!');
  }
  res.redirect('/admin/cast');
});

router.post('/cast/delete/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM people WHERE id = ?').get(req.params.id);
  if (p) {
    deleteUploadFile(p.image);
    db.prepare('DELETE FROM content_cast WHERE cast_id = ?').run(p.id);
    db.prepare('DELETE FROM people WHERE id = ?').run(p.id);
    setFlash(req, 'success', 'Person deleted.');
  }
  res.redirect('/admin/cast');
});

/* ============================================================
   PAGES
============================================================ */
router.get('/pages', requireAdmin, (req, res) => {
  const items = db.prepare('SELECT * FROM pages ORDER BY is_core DESC, title').all();
  res.render('admin/pages', { layout: 'admin/layout', title: 'Pages - MOVIXA Admin', active: 'pages', items });
});

router.get('/pages/new', requireAdmin, (req, res) => {
  res.render('admin/page-form', { layout: 'admin/layout', title: 'Add Page', active: 'pages', isEdit: false, page: { title: '', slug: '', content: '', type: 'custom', seo_title: '', seo_description: '', status: 'published' } });
});

router.get('/pages/edit/:id', requireAdmin, (req, res) => {
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.redirect('/admin/pages');
  res.render('admin/page-form', { layout: 'admin/layout', title: 'Edit Page', active: 'pages', isEdit: true, page });
});

router.post(['/pages/new', '/pages/edit/:id'], requireAdmin, (req, res) => {
  const b = req.body || {};
  const isEdit = !!req.params.id;
  const existing = isEdit ? db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id) : null;
  if (isEdit && !existing) return res.redirect('/admin/pages');
  if (!b.title || !b.title.trim()) { setFlash(req, 'error', 'Title is required.'); return res.redirect('back'); }
  const slug = uniqueSlug('pages', b.slug && b.slug.trim() ? b.slug : b.title, isEdit ? existing.id : null);
  if (isEdit) {
    db.prepare(`UPDATE pages SET title = ?, slug = ?, content = ?, seo_title = ?, seo_description = ?, status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(b.title.trim().slice(0, 200), slug, H.cleanRich(b.content || ''), (b.seo_title || '').trim().slice(0, 200), (b.seo_description || '').trim().slice(0, 200), b.status === 'draft' ? 'draft' : 'published', existing.id);
    setFlash(req, 'success', 'Page updated!');
  } else {
    db.prepare('INSERT INTO pages (title, slug, content, type, seo_title, seo_description, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(b.title.trim().slice(0, 200), slug, H.cleanRich(b.content || ''), 'custom', (b.seo_title || '').trim().slice(0, 200), (b.seo_description || '').trim().slice(0, 200), b.status === 'draft' ? 'draft' : 'published');
    setFlash(req, 'success', 'Page created!');
  }
  res.redirect('/admin/pages');
});

router.post('/pages/delete/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM pages WHERE id = ?').get(req.params.id);
  if (p && p.is_core) { setFlash(req, 'error', 'Core pages cannot be deleted.'); return res.redirect('/admin/pages'); }
  if (p) { db.prepare('DELETE FROM pages WHERE id = ?').run(p.id); setFlash(req, 'success', 'Page deleted.'); }
  res.redirect('/admin/pages');
});

/* ============================================================
   MEDIA LIBRARY
============================================================ */
router.get('/media', requireAdmin, (req, res) => {
  const { q = '', page = '1' } = req.query;
  const where = q.trim() ? 'WHERE filename LIKE ?' : '';
  const params = q.trim() ? [`%${q.trim()}%`] : [];
  const total = db.prepare(`SELECT COUNT(*) c FROM media ${where}`).get(...params).c;
  const pg = H.paginate(total, parseInt(page, 10) || 1, 24);
  const items = db.prepare(`SELECT * FROM media ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pg.perPage, pg.offset);
  res.render('admin/media', { layout: 'admin/layout', title: 'Media Library - MOVIXA Admin', active: 'media', items, pg, q });
});

router.post('/media/upload', requireAdmin, upload.array('files', 10), (req, res) => {
  (req.files || []).forEach(trackMedia);
  setFlash(req, 'success', `${(req.files || []).length} file(s) uploaded.`);
  res.redirect('/admin/media');
});

router.post('/media/delete/:id', requireAdmin, (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
  if (m) {
    deleteUploadFile(m.filepath);
    db.prepare('DELETE FROM media WHERE id = ?').run(m.id);
    setFlash(req, 'success', 'Media deleted.');
  }
  res.redirect('/admin/media');
});

/* ============================================================
   MESSAGES + SUBSCRIBERS
============================================================ */
router.get('/messages', requireAdmin, (req, res) => {
  const { page = '1' } = req.query;
  const total = db.prepare('SELECT COUNT(*) c FROM contact_messages').get().c;
  const pg = H.paginate(total, parseInt(page, 10) || 1, 15);
  const items = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT ? OFFSET ?').all(pg.perPage, pg.offset);
  res.render('admin/messages', { layout: 'admin/layout', title: 'Messages - MOVIXA Admin', active: 'messages', items, pg });
});

router.post('/messages/read/:id', requireAdmin, (req, res) => {
  db.prepare('UPDATE contact_messages SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin/messages');
});

router.post('/messages/delete/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM contact_messages WHERE id = ?').run(req.params.id);
  setFlash(req, 'success', 'Message deleted.');
  res.redirect('/admin/messages');
});

router.get('/subscribers', requireAdmin, (req, res) => {
  const { page = '1' } = req.query;
  const total = db.prepare('SELECT COUNT(*) c FROM subscribers').get().c;
  const pg = H.paginate(total, parseInt(page, 10) || 1, 20);
  const items = db.prepare('SELECT * FROM subscribers ORDER BY created_at DESC LIMIT ? OFFSET ?').all(pg.perPage, pg.offset);
  res.render('admin/subscribers', { layout: 'admin/layout', title: 'Subscribers - MOVIXA Admin', active: 'subscribers', items, pg });
});

router.post('/subscribers/delete/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM subscribers WHERE id = ?').run(req.params.id);
  setFlash(req, 'success', 'Subscriber removed.');
  res.redirect('/admin/subscribers');
});

/* ============================================================
   USERS (super admin only)
============================================================ */
router.get('/users', requireAdmin, requireSuperAdmin, (req, res) => {
  const items = db.prepare('SELECT id, username, email, role, created_at FROM users ORDER BY created_at').all();
  res.render('admin/users', { layout: 'admin/layout', title: 'Users - MOVIXA Admin', active: 'users', items });
});

router.get('/users/new', requireAdmin, requireSuperAdmin, (req, res) => {
  res.render('admin/user-form', { layout: 'admin/layout', title: 'Add User', active: 'users', isEdit: false, user: { username: '', email: '', role: 'admin' } });
});

router.get('/users/edit/:id', requireAdmin, requireSuperAdmin, (req, res) => {
  const user = db.prepare('SELECT id, username, email, role FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.redirect('/admin/users');
  res.render('admin/user-form', { layout: 'admin/layout', title: 'Edit User', active: 'users', isEdit: true, user });
});

router.post(['/users/new', '/users/edit/:id'], requireAdmin, requireSuperAdmin, (req, res) => {
  const b = req.body || {};
  const isEdit = !!req.params.id;
  const existing = isEdit ? db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id) : null;
  if (isEdit && !existing) return res.redirect('/admin/users');
  const errors = [];
  if (!b.username || b.username.trim().length < 3) errors.push('Username must be at least 3 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((b.email || '').trim())) errors.push('Valid email is required.');
  if (!isEdit && (!b.password || b.password.length < 8)) errors.push('Password must be at least 8 characters.');
  if (b.password && b.password !== b.confirm_password) errors.push('Passwords do not match.');
  const dupU = db.prepare('SELECT id FROM users WHERE username = ?').get((b.username || '').trim());
  if (dupU && (!isEdit || dupU.id !== existing.id)) errors.push('Username is already taken.');
  const dupE = db.prepare('SELECT id FROM users WHERE email = ?').get((b.email || '').trim());
  if (dupE && (!isEdit || dupE.id !== existing.id)) errors.push('Email is already in use.');
  if (errors.length) { setFlash(req, 'error', errors.join(' ')); return res.redirect('back'); }
  if (isEdit) {
    db.prepare('UPDATE users SET username = ?, email = ?, role = ? WHERE id = ?')
      .run(b.username.trim(), b.email.trim(), b.role === 'super_admin' ? 'super_admin' : 'admin', existing.id);
    if (b.password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(b.password, 12), existing.id);
    setFlash(req, 'success', 'User updated!');
  } else {
    db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)')
      .run(b.username.trim(), b.email.trim(), bcrypt.hashSync(b.password, 12), b.role === 'super_admin' ? 'super_admin' : 'admin');
    setFlash(req, 'success', 'User created!');
  }
  res.redirect('/admin/users');
});

router.post('/users/delete/:id', requireAdmin, requireSuperAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === res.locals.currentUser.id) { setFlash(req, 'error', 'You cannot delete your own account.'); return res.redirect('/admin/users'); }
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  setFlash(req, 'success', 'User deleted.');
  res.redirect('/admin/users');
});

/* ============================================================
   SETTINGS
============================================================ */
router.get('/settings', requireAdmin, (req, res) => {
  res.render('admin/settings', {
    layout: 'admin/layout', title: 'Settings - MOVIXA Admin', active: 'settings',
    s: {
      site_name: getSetting('site_name'), site_description: getSetting('site_description'),
      tagline: getSetting('tagline'), logo: getSetting('logo'), favicon: getSetting('favicon'),
      contact_email: getSetting('contact_email'), maintenance_mode: getSetting('maintenance_mode'),
      social_facebook: getSetting('social_facebook'), social_twitter: getSetting('social_twitter'),
      social_instagram: getSetting('social_instagram'), social_youtube: getSetting('social_youtube'),
      seo_title_template: getSetting('seo_title_template'), seo_default_description: getSetting('seo_default_description'),
      analytics_code: getSetting('analytics_code'), search_console_code: getSetting('search_console_code'),
      dmca_email: getSetting('dmca_email'), copyright_notice: getSetting('copyright_notice'),
      movies_per_page: getSetting('movies_per_page'), hero_limit: getSetting('hero_limit')
    }
  });
});

router.post('/settings', requireAdmin, upload.fields([{ name: 'logo_file', maxCount: 1 }, { name: 'favicon_file', maxCount: 1 }]), (req, res) => {
  const b = req.body || {};
  const set = (k, v) => setSetting(k, (v || '').trim());
  set('site_name', b.site_name || 'MOVIXA');
  set('site_description', b.site_description);
  set('tagline', b.tagline);
  set('contact_email', b.contact_email);
  set('maintenance_mode', b.maintenance_mode ? '1' : '0');
  set('social_facebook', b.social_facebook);
  set('social_twitter', b.social_twitter);
  set('social_instagram', b.social_instagram);
  set('social_youtube', b.social_youtube);
  set('seo_title_template', b.seo_title_template);
  set('seo_default_description', b.seo_default_description);
  setSetting('analytics_code', b.analytics_code || '');
  setSetting('search_console_code', b.search_console_code || '');
  set('dmca_email', b.dmca_email);
  set('copyright_notice', b.copyright_notice);
  set('movies_per_page', Math.min(48, Math.max(4, parseInt(b.movies_per_page, 10) || 12)));
  set('hero_limit', Math.min(10, Math.max(1, parseInt(b.hero_limit, 10) || 5)));
  if (req.files && req.files.logo_file && req.files.logo_file[0]) {
    const f = req.files.logo_file[0];
    trackMedia(f);
    const old = getSetting('logo');
    if (old && old.startsWith('/uploads/')) deleteUploadFile(old);
    setSetting('logo', '/uploads/' + f.filename);
  } else if ((b.logo || '').trim()) set('logo', b.logo);
  if (req.files && req.files.favicon_file && req.files.favicon_file[0]) {
    const f = req.files.favicon_file[0];
    trackMedia(f);
    const old = getSetting('favicon');
    if (old && old.startsWith('/uploads/')) deleteUploadFile(old);
    setSetting('favicon', '/uploads/' + f.filename);
  } else if ((b.favicon || '').trim()) set('favicon', b.favicon);
  setFlash(req, 'success', 'Settings saved!');
  res.redirect('/admin/settings');
});

module.exports = router;
