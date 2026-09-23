/* MOVIXA shared helpers */
const sanitizeHtml = require('sanitize-html');

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'untitled';
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanRich(html) {
  return sanitizeHtml(String(html || ''), {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1', 'h2', 'h3', 'h4', 'img', 'iframe']),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      a: ['href', 'title', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
      iframe: ['src', 'width', 'height', 'frameborder', 'allow', 'allowfullscreen', 'title']
    },
    allowedIframeHostnames: ['www.youtube.com', 'youtube.com', 'player.vimeo.com', 'vimeo.com']
  });
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function excerpt(html, len = 160) {
  const t = stripTags(html);
  return t.length > len ? t.slice(0, len - 1).trim() + '…' : t;
}

function formatRuntime(min) {
  min = parseInt(min, 10);
  if (!min || min <= 0) return '';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const t = new Date(String(iso).includes('T') ? iso : String(iso).replace(' ', 'T') + 'Z').getTime();
  if (isNaN(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function formatCount(n) {
  n = parseInt(n, 10) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K';
  return String(n);
}

/** Convert YouTube/Vimeo watch URLs to embed URLs. Returns '' if not embeddable. */
function embedUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
      let id = '';
      if (host === 'youtu.be') id = u.pathname.slice(1);
      else if (u.pathname === '/watch') id = u.searchParams.get('v') || '';
      else if (u.pathname.startsWith('/embed/')) id = u.pathname.split('/')[2] || '';
      else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] || '';
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const m = u.pathname.match(/(\d+)/);
      if (m) return `https://player.vimeo.com/video/${m[1]}`;
    }
  } catch (e) { /* invalid url */ }
  return '';
}

function isValidUrl(url) {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
}

function baseUrl(req) {
  const env = process.env.BASE_URL;
  if (env) return env.replace(/\/+$/, '');
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}`;
}

function canonicalUrl(req) {
  return baseUrl(req) + req.path;
}

function paginate(total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  page = Math.min(Math.max(1, page), pages);
  return { total, page, perPage, pages, offset: (page - 1) * perPage,
    hasPrev: page > 1, hasNext: page < pages,
    prev: page - 1, next: page + 1 };
}

function stars(rating) {
  const r = Math.max(0, Math.min(10, parseFloat(rating) || 0));
  return { full: Math.round((r / 10) * 5 * 2) / 2, value: r.toFixed(1) };
}

function highlight(text, q) {
  const safe = escapeHtml(text);
  if (!q) return safe;
  const needle = q.trim().split(/\s+/).filter(Boolean).map(w =>
    w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!needle) return safe;
  try {
    return safe.replace(new RegExp(`(${needle})`, 'gi'), '<mark>$1</mark>');
  } catch (e) { return safe; }
}

module.exports = {
  slugify, escapeHtml, cleanRich, stripTags, excerpt, formatRuntime,
  timeAgo, formatCount, embedUrl, isValidUrl, baseUrl, canonicalUrl,
  paginate, stars, highlight
};
