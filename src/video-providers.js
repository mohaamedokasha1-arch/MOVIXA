/* MOVIXA video provider registry — external embeds ONLY.
 *
 * - Video files are NEVER downloaded, copied or stored on our server.
 * - Only https URLs from approved providers are accepted; everything else
 *   (javascript:, data:, unknown hosts, raw HTML/scripts) is rejected.
 * - Stored URLs are re-validated at render time (defense in depth).
 *
 * EXTENDING: to add a legitimate provider, call:
 *   registerProvider('id', {
 *     label: 'Provider Name',
 *     hosts: ['example.com', 'player.example.com'],   // without www.
 *     extract: (urlObj) => 'video-id' | null,          // parse ID from any provider URL
 *     buildEmbed: (id) => 'https://.../embed/' + id,   // canonical embed URL
 *     idPattern: /^[A-Za-z0-9]+$/,                     // (optional) bare-ID validation
 *     idExample: 'abc123',                             // (optional) shown in admin hints
 *   });
 * ...and add it to ADMIN_VIDEO_OPTIONS below if admins should select it directly.
 */

const providers = new Map();

function registerProvider(id, def) {
  if (!id || !def || !def.label || !Array.isArray(def.hosts) || !def.hosts.length ||
      typeof def.extract !== 'function' || typeof def.buildEmbed !== 'function') {
    throw new Error('Invalid video provider definition for "' + id + '"');
  }
  providers.set(id, {
    id,
    label: def.label,
    hosts: def.hosts.map((h) => String(h).toLowerCase().replace(/^www\./, '')),
    extract: def.extract,
    buildEmbed: def.buildEmbed,
    idPattern: def.idPattern || null,
    idExample: def.idExample || ''
  });
}

function getProvider(id) {
  return providers.get(String(id || '').toLowerCase()) || null;
}

function stripWww(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

function findProviderByHost(hostname) {
  const h = stripWww(hostname);
  for (const p of providers.values()) {
    if (p.hosts.includes(h)) return p;
  }
  return null;
}

/* If an admin pastes a full <iframe ...> snippet, extract just the src URL.
 * The extracted URL still goes through the full allowlist validation. */
function extractSrcFromEmbedCode(input) {
  const m = String(input || '').match(/<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

/* ---------- built-in providers ---------- */

const YT_ID = /^[A-Za-z0-9_-]{6,20}$/;
function extractYouTube(u) {
  const host = stripWww(u.hostname);
  const path = u.pathname || '';
  let id = null;
  if (host === 'youtu.be') id = path.slice(1).split(/[/?#]/)[0];
  else if (path === '/watch') id = u.searchParams.get('v');
  else if (path.startsWith('/embed/') || path.startsWith('/shorts/') || path.startsWith('/live/')) {
    id = path.split('/')[2];
  } else if (host === 'youtube-nocookie.com' && path.startsWith('/embed/')) {
    id = path.split('/')[2];
  }
  id = (id || '').trim();
  return YT_ID.test(id) ? id : null;
}

const VIMEO_ID = /^\d{4,}$/;
function extractVimeo(u) {
  // matches /123456, /video/123456, /channels/x/123456, /manage/videos/123456 etc.
  const segs = (u.pathname || '').split('/').filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (VIMEO_ID.test(segs[i])) return segs[i];
  }
  return null;
}

const DM_ID = /^[A-Za-z0-9]{3,32}$/;
function extractDailymotion(u) {
  const host = stripWww(u.hostname);
  const path = u.pathname || '';
  if (host === 'dai.ly') {
    const id = path.slice(1).split(/[/?#]/)[0];
    return DM_ID.test(id) ? id : null;
  }
  if (path.endsWith('player.html')) {
    const id = (u.searchParams.get('video') || '').trim();
    return DM_ID.test(id) ? id : null;
  }
  const m = path.match(/\/(?:embed\/video|video)\/([^_/?#&]+)/);
  if (m && DM_ID.test(m[1])) return m[1];
  return null;
}

const DRIVE_ID = /^[A-Za-z0-9_-]{10,}$/;
function extractDrive(u) {
  // https://drive.google.com/file/d/FILE_ID/view (or /preview, /edit...)
  const m = (u.pathname || '').match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  if (m && DRIVE_ID.test(m[1])) return m[1];
  // https://drive.google.com/open?id=FILE_ID  |  /uc?id=FILE_ID / /uc?export=download&id=FILE_ID
  const q = (u.searchParams.get('id') || '').trim();
  if (DRIVE_ID.test(q)) return q;
  return null;
}

registerProvider('youtube', {
  label: 'YouTube',
  hosts: ['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'],
  extract: extractYouTube,
  buildEmbed: (id) => 'https://www.youtube.com/embed/' + id,
  idPattern: YT_ID,
  idExample: 'aqz-KE-bpKQ'
});

registerProvider('vimeo', {
  label: 'Vimeo',
  hosts: ['vimeo.com', 'player.vimeo.com'],
  extract: extractVimeo,
  buildEmbed: (id) => 'https://player.vimeo.com/video/' + id,
  idPattern: VIMEO_ID,
  idExample: '123456789'
});

registerProvider('dailymotion', {
  label: 'Dailymotion',
  hosts: ['dailymotion.com', 'geo.dailymotion.com', 'dai.ly'],
  extract: extractDailymotion,
  buildEmbed: (id) => 'https://www.dailymotion.com/embed/video/' + id,
  idPattern: DM_ID,
  idExample: 'x8abc12'
});

registerProvider('googledrive', {
  label: 'Google Drive',
  hosts: ['drive.google.com'],
  extract: extractDrive,
  buildEmbed: (id) => 'https://drive.google.com/file/d/' + id + '/preview',
  idPattern: DRIVE_ID,
  idExample: '1A2b3C4d5E6f7G8h9I0jKLmnOPqRs'
});

/* ---------- admin-facing options ---------- */
const ADMIN_VIDEO_OPTIONS = [
  { id: 'none', label: 'No embedded player (external watch link only)' },
  {
    id: 'dailymotion', label: 'Dailymotion',
    inputLabel: 'Dailymotion Video ID or Embed URL',
    hint: 'Paste the Video ID (e.g. x8abc12) or any Dailymotion video / embed URL.'
  },
  {
    id: 'youtube', label: 'YouTube',
    inputLabel: 'YouTube Video ID or Embed URL',
    hint: 'Paste the Video ID (e.g. aqz-KE-bpKQ) or any YouTube watch / embed / Shorts URL.'
  },
  {
    id: 'vimeo', label: 'Vimeo',
    inputLabel: 'Vimeo Video ID or Embed URL',
    hint: 'Paste the numeric Video ID (e.g. 123456789) or any Vimeo video / player URL.'
  },
  {
    id: 'googledrive', label: 'Google Drive',
    inputLabel: 'Google Drive Share / Embed URL',
    hint: 'Paste the file sharing link (.../file/d/FILE_ID/...) or preview URL. The file must be shared as "Anyone with the link". Nothing is downloaded to our server.'
  },
  {
    id: 'custom', label: 'Custom Embed (other authorized provider URL)',
    inputLabel: 'Authorized Embed URL',
    hint: 'Paste an https video URL from an authorized provider (YouTube, Vimeo, Dailymotion, Google Drive).'
  }
];

/* ---------- validation / normalization ---------- */

/** Validate + normalize any provider URL (or iframe snippet) to a canonical embed URL. */
function normalizeEmbedUrl(raw) {
  let input = String(raw || '').trim();
  if (!input) return { ok: false, error: 'Embed URL is empty.' };
  if (input.includes('<')) {
    const src = extractSrcFromEmbedCode(input);
    if (!src) return { ok: false, error: 'Could not find a video URL in that embed code. Paste the video URL instead.' };
    input = src;
  }
  let u;
  try {
    u = new URL(input);
  } catch (e) {
    return { ok: false, error: 'That is not a valid URL.' };
  }
  if (u.protocol !== 'https:') {
    return { ok: false, error: 'Embed URL must start with https:// — insecure or script URLs are not allowed.' };
  }
  const provider = findProviderByHost(u.hostname);
  if (!provider) {
    return { ok: false, error: `Videos from "${u.hostname}" are not permitted. Only authorized providers (YouTube, Vimeo, Dailymotion, Google Drive) may be embedded.` };
  }
  const id = provider.extract(u);
  if (!id) {
    return { ok: false, error: `Could not find a video ID in that ${provider.label} URL. Check the link and try again.` };
  }
  return { ok: true, provider: provider.id, videoId: id, embedUrl: provider.buildEmbed(id) };
}

/** Parse the admin's (provider, input) selection into safe stored fields. */
function parseVideoSource(providerId, input) {
  const p = String(providerId || 'none').toLowerCase();
  const value = String(input || '').trim();
  if (p === 'none' || p === '') {
    return { ok: true, provider: 'none', videoId: '', embedUrl: '' };
  }
  if (p === 'custom') {
    if (!value) return { ok: false, error: 'Enter an authorized Embed URL.' };
    const n = normalizeEmbedUrl(value);
    if (!n.ok) return n;
    return { ok: true, provider: 'custom', videoId: n.videoId, embedUrl: n.embedUrl, sourceProvider: n.provider };
  }
  const provider = getProvider(p);
  if (!provider) return { ok: false, error: 'Unknown video provider selected.' };
  if (!value) return { ok: false, error: `Enter a ${provider.label} Video ID or Embed URL.` };
  if (provider.idPattern && provider.idPattern.test(value)) {
    return { ok: true, provider: provider.id, videoId: value, embedUrl: provider.buildEmbed(value) };
  }
  const n = normalizeEmbedUrl(value);
  if (!n.ok) return n;
  if (n.provider !== provider.id) {
    return { ok: false, error: `That URL is not a ${provider.label} video. Use “Custom Embed” for other providers.` };
  }
  return { ok: true, provider: provider.id, videoId: n.videoId, embedUrl: n.embedUrl };
}

/** Re-validate a stored embed URL at render time. Returns safe URL or ''. */
function safeEmbedUrl(stored) {
  if (!stored) return '';
  const n = normalizeEmbedUrl(stored);
  return n.ok ? n.embedUrl : '';
}

function isAllowedEmbedUrl(url) {
  return normalizeEmbedUrl(url).ok;
}

module.exports = {
  registerProvider,
  getProvider,
  normalizeEmbedUrl,
  parseVideoSource,
  safeEmbedUrl,
  isAllowedEmbedUrl,
  ADMIN_VIDEO_OPTIONS
};
