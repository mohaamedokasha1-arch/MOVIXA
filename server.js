/* MOVIXA — legal streaming platform. Entry point. */
require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const morgan = require('morgan');
const layouts = require('express-ejs-layouts');

require('./src/db'); // migrations + seed
const { loadGlobals, maintenanceGuard } = require('./src/middleware');
const H = require('./src/helpers');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(layouts);
app.set('layout', 'layout');

/* Security headers — allow YouTube/Vimeo embeds + Google Fonts */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://www.youtube.com', 'https://player.vimeo.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
      mediaSrc: ["'self'", 'https:'],
      frameSrc: ["'self'", 'https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://www.dailymotion.com', 'https://geo.dailymotion.com'],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

if (process.env.NODE_ENV !== 'test') app.use(morgan('tiny'));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '1mb' }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'movixa-dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== '0' }
}));

/* Static assets with caching */
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d', etag: true }));

/* Expose helpers to all views */
app.use((req, res, next) => { res.locals.H = H; next(); });
app.use(loadGlobals);
app.use(maintenanceGuard);

/* Routes */
app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

/* Custom pages by slug (non-core custom pages) */
app.get('/:slug', (req, res, next) => {
  const { db } = require('./src/db');
  const page = db.prepare(`SELECT * FROM pages WHERE slug = ? AND status = 'published' AND type = 'custom' AND is_core = 0`).get(req.params.slug);
  if (!page) return next();
  const base = H.baseUrl(req);
  const crumbs = [{ label: 'Home', href: '/' }, { label: page.title }];
  res.render('pages/static', {
    title: page.seo_title || `${page.title} - MOVIXA`,
    metaDescription: page.seo_description || H.excerpt(page.content, 155),
    canonical: base + '/' + page.slug,
    ogType: 'website', ogImage: '', jsonLd: [], crumbs, page
  });
});

/* Health check */
app.get('/healthz', (req, res) => res.json({ ok: true, service: 'movixa' }));

/* 404 */
app.use((req, res) => {
  res.status(404).render('pages/404', {
    title: 'Page Not Found - MOVIXA',
    metaDescription: 'The page you are looking for could not be found.',
    canonical: H.baseUrl(req) + req.path,
    ogType: 'website', ogImage: '', noIndex: true, jsonLd: [],
    crumbs: [{ label: 'Home', href: '/' }, { label: 'Not Found' }]
  });
});

/* Error handler */
app.use((err, req, res, next) => {
  console.error('[movixa]', err);
  if (res.headersSent) return next(err);
  res.status(500).render('pages/500', {
    title: 'Something went wrong - MOVIXA',
    metaDescription: 'An unexpected error occurred.',
    canonical: H.baseUrl(req) + req.path,
    ogType: 'website', ogImage: '', noIndex: true, jsonLd: [],
    crumbs: [{ label: 'Home', href: '/' }, { label: 'Error' }]
  });
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[movixa] Running at http://localhost:${PORT} (env: ${process.env.NODE_ENV || 'development'})`);
  });
}

module.exports = app;
