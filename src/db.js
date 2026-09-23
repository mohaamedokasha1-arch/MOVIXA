/* MOVIXA database layer — SQLite via Node's built-in node:sqlite
 * Tables: movies, series, seasons, episodes, genres, categories,
 * people, content_cast, content_genres, users, pages, settings,
 * media, contact_messages, subscribers
 */
const path = require('path');
const fs = require('fs');
const Database = require('./sqlite-compat');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'movixa.db');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    original_title TEXT DEFAULT '',
    slug TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    short_description TEXT DEFAULT '',
    release_year INTEGER,
    runtime INTEGER,
    language TEXT DEFAULT '',
    country TEXT DEFAULT '',
    director TEXT DEFAULT '',
    poster_image TEXT DEFAULT '',
    backdrop_image TEXT DEFAULT '',
    trailer_url TEXT DEFAULT '',
    official_watch_url TEXT DEFAULT '',
    official_source_name TEXT DEFAULT '',
    rating REAL DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    featured INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    tags TEXT DEFAULT '',
    seo_title TEXT DEFAULT '',
    seo_description TEXT DEFAULT '',
    og_image TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    original_title TEXT DEFAULT '',
    slug TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    short_description TEXT DEFAULT '',
    first_air_year INTEGER,
    last_air_year INTEGER,
    status TEXT DEFAULT 'ongoing',
    language TEXT DEFAULT '',
    country TEXT DEFAULT '',
    poster_image TEXT DEFAULT '',
    backdrop_image TEXT DEFAULT '',
    trailer_url TEXT DEFAULT '',
    rating REAL DEFAULT 0,
    view_count INTEGER DEFAULT 0,
    featured INTEGER DEFAULT 0,
    publish_status TEXT DEFAULT 'draft',
    tags TEXT DEFAULT '',
    seo_title TEXT DEFAULT '',
    seo_description TEXT DEFAULT '',
    og_image TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    title TEXT DEFAULT '',
    description TEXT DEFAULT '',
    air_year INTEGER,
    poster_image TEXT DEFAULT '',
    episode_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'published',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(series_id, season_number)
  );
  CREATE TABLE IF NOT EXISTS episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    episode_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    slug TEXT DEFAULT '',
    description TEXT DEFAULT '',
    air_date TEXT DEFAULT '',
    runtime INTEGER,
    thumbnail_image TEXT DEFAULT '',
    official_watch_url TEXT DEFAULT '',
    official_source_name TEXT DEFAULT '',
    view_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'draft',
    seo_title TEXT DEFAULT '',
    seo_description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(season_id, episode_number)
  );
  CREATE TABLE IF NOT EXISTS genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT DEFAULT '',
    image TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    seo_title TEXT DEFAULT '',
    seo_description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    type TEXT DEFAULT 'both'
  );
  CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'actor',
    image TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS content_cast (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    cast_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    character_name TEXT DEFAULT '',
    UNIQUE(content_id, content_type, cast_id)
  );
  CREATE TABLE IF NOT EXISTS content_genres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    genre_id INTEGER NOT NULL REFERENCES genres(id) ON DELETE CASCADE,
    UNIQUE(content_id, content_type, genre_id)
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    content TEXT DEFAULT '',
    type TEXT DEFAULT 'custom',
    seo_title TEXT DEFAULT '',
    seo_description TEXT DEFAULT '',
    status TEXT DEFAULT 'published',
    is_core INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    mimetype TEXT DEFAULT '',
    size INTEGER DEFAULT 0,
    width INTEGER,
    height INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT DEFAULT '',
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_movies_slug ON movies(slug);
  CREATE INDEX IF NOT EXISTS idx_movies_status ON movies(status);
  CREATE INDEX IF NOT EXISTS idx_movies_featured ON movies(featured);
  CREATE INDEX IF NOT EXISTS idx_movies_views ON movies(view_count);
  CREATE INDEX IF NOT EXISTS idx_series_slug ON series(slug);
  CREATE INDEX IF NOT EXISTS idx_series_publish ON series(publish_status);
  CREATE INDEX IF NOT EXISTS idx_episodes_season ON episodes(season_id);
  CREATE INDEX IF NOT EXISTS idx_seasons_series ON seasons(series_id);
  CREATE INDEX IF NOT EXISTS idx_cg_lookup ON content_genres(content_type, content_id);
  CREATE INDEX IF NOT EXISTS idx_cg_genre ON content_genres(genre_id);
  CREATE INDEX IF NOT EXISTS idx_cc_lookup ON content_cast(content_type, content_id);
  CREATE INDEX IF NOT EXISTS idx_genres_slug ON genres(slug);
  CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages(slug);
  `);
}

function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value == null ? '' : String(value));
}

function allSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
}

function seed() {
  // --- Admin user ---
  const userCount = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (userCount === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const email = process.env.ADMIN_EMAIL || 'admin@movixa.com';
    const password = process.env.ADMIN_PASSWORD || 'Admin123!';
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)')
      .run(username, email, hash, 'super_admin');
    console.log(`[movixa] Created admin user "${username}" (${email})`);
  }

  // --- Settings ---
  if (db.prepare('SELECT COUNT(*) c FROM settings').get().c === 0) {
    const defaults = {
      site_name: 'MOVIXA',
      site_description: 'MOVIXA — Your legal streaming destination. Discover movies and series from official, licensed sources.',
      tagline: 'Discover. Watch. Legally.',
      logo: '',
      favicon: '',
      contact_email: 'hello@movixa.com',
      social_facebook: '',
      social_twitter: '',
      social_instagram: '',
      social_youtube: '',
      maintenance_mode: '0',
      analytics_code: '',
      search_console_code: '',
      seo_title_template: '{title} - MOVIXA',
      seo_default_description: 'Watch movies and series legally on MOVIXA. Discover trending films and shows from official licensed sources.',
      dmca_email: 'dmca@movixa.com',
      copyright_notice: 'All content available on this site is either owned by MOVIXA, licensed for distribution, or linked to official legal sources.',
      movies_per_page: '12',
      hero_limit: '5'
    };
    const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    const tx = db.transaction((obj) => { for (const [k, v] of Object.entries(obj)) ins.run(k, v); });
    tx(defaults);
  }

  // --- Genres ---
  if (db.prepare('SELECT COUNT(*) c FROM genres').get().c === 0) {
    const genres = [
      ['Action', 'High-octane thrills, battles and heroic feats.'],
      ['Adventure', 'Epic journeys and explorations into the unknown.'],
      ['Animation', 'Animated films and series for all ages.'],
      ['Comedy', 'Laugh-out-loud stories and feel-good entertainment.'],
      ['Crime', 'Mysteries, heists and detective stories.'],
      ['Documentary', 'Real stories, real people, real discovery.'],
      ['Drama', 'Emotional, character-driven storytelling.'],
      ['Fantasy', 'Magical worlds and mythical adventures.'],
      ['Horror', 'Chills, thrills and things that go bump in the night.'],
      ['Romance', 'Love stories that touch the heart.'],
      ['Sci-Fi', 'Futuristic worlds, technology and space exploration.'],
      ['Thriller', 'Suspenseful stories that keep you on the edge.']
    ];
    const ins = db.prepare('INSERT INTO genres (name, slug, description, sort_order) VALUES (?, ?, ?, ?)');
    const tx = db.transaction((list) => list.forEach(([n, d], i) =>
      ins.run(n, n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), d, i)));
    tx(genres);
  }

  // --- Categories ---
  if (db.prepare('SELECT COUNT(*) c FROM categories').get().c === 0) {
    const ins = db.prepare('INSERT INTO categories (name, slug, type) VALUES (?, ?, ?)');
    [['Trending', 'trending', 'both'], ['Latest', 'latest', 'both'], ['Top Rated', 'top-rated', 'both']]
      .forEach(([n, s, t]) => ins.run(n, s, t));
  }

  // --- Core pages ---
  if (db.prepare('SELECT COUNT(*) c FROM pages').get().c === 0) {
    const pages = [
      ['About Us', 'about', 'about', `<p><strong>MOVIXA</strong> is a legal streaming discovery platform for movies and series. Our mission is simple: connect audiences with great stories through official, licensed sources.</p><p>Every title on MOVIXA is either owned by us, licensed for distribution, or linked directly to the official source where you can watch it legally — such as YouTube, Vimeo, or the rights holder's own platform.</p><h2>Why MOVIXA?</h2><ul><li>100% legal content from licensed and official sources</li><li>Curated catalog of movies and series</li><li>Fast, mobile-friendly, cinematic experience</li><li>Respect for creators and copyright holders</li></ul><h2>Our promise</h2><p>We respect copyright and intellectual property rights. If you are a rights holder and have a concern, please contact us and we will respond promptly.</p>`],
      ['Contact Us', 'contact', 'contact', `<p>Have a question, suggestion, or business inquiry? We would love to hear from you. Use the contact form below or email us directly — we aim to respond within 2 business days.</p>`],
      ['Privacy Policy', 'privacy', 'privacy', `<p><em>Last updated: 2026</em></p><p>MOVIXA ("we", "us") respects your privacy. This policy explains what information we collect and how we use it.</p><h2>Information we collect</h2><ul><li><strong>Contact messages:</strong> when you use our contact form, we receive your name, email and message.</li><li><strong>Newsletter:</strong> if you subscribe, we store your email address to send updates.</li><li><strong>Analytics:</strong> we may use privacy-friendly analytics to understand aggregate usage.</li></ul><h2>How we use information</h2><p>We use your information only to respond to inquiries, send newsletters you opted into, and improve the platform. We do not sell personal data.</p><h2>Third-party services</h2><p>Watch links direct you to external official sources (e.g., YouTube, Vimeo). Their privacy policies apply once you leave our site.</p><h2>Your rights</h2><p>You may request access, correction, or deletion of your data at any time by contacting us.</p>`],
      ['Terms of Service', 'terms', 'terms', `<p><em>Last updated: 2026</em></p><p>By accessing MOVIXA you agree to these terms.</p><h2>Acceptable use</h2><ul><li>You will not attempt to download, redistribute, or infringe content linked from this site.</li><li>You will not misuse the platform, attempt unauthorized access, or submit unlawful content.</li><li>You will respect the terms of external official sources you visit via our links.</li></ul><h2>Content</h2><p>MOVIXA provides information and links to official legal sources. Availability of external content is controlled by those sources.</p><h2>Disclaimer</h2><p>The platform is provided "as is" without warranties. To the maximum extent permitted by law, we disclaim liability for external content and availability.</p>`],
      ['Copyright & DMCA Policy', 'copyright', 'dmca', `<p><strong>MOVIXA is a legal streaming platform.</strong> All content available on this site is either owned by MOVIXA, licensed for distribution, or linked to official legal sources. We respect copyright and intellectual property rights and respond promptly to valid complaints.</p><h2>Reporting infringement</h2><p>If you believe content linked from MOVIXA infringes your copyright, send a notice to our DMCA contact with:</p><ul><li>Your full name and contact details</li><li>Identification of the copyrighted work</li><li>The exact URL of the allegedly infringing material</li><li>A good-faith statement that the use is not authorized</li><li>A statement under penalty of perjury that you are the rights holder or authorized agent</li><li>Your physical or electronic signature</li></ul><h2>What happens next</h2><p>We review valid notices promptly (usually within 48 hours), remove or disable access to infringing material, and notify the provider where appropriate. Repeat infringers are not tolerated.</p><h2>Counter-notices</h2><p>If your content was removed in error, you may submit a counter-notice with your details, the removed URL, consent to jurisdiction, and a good-faith statement. We will restore content where the law requires it.</p>`]
    ];
    const ins = db.prepare('INSERT INTO pages (title, slug, content, type, seo_title, seo_description, is_core) VALUES (?, ?, ?, ?, ?, ?, 1)');
    const tx = db.transaction((list) => list.forEach(([t, s, type, c]) =>
      ins.run(t, s, c, type, `${t} - MOVIXA`, `${t} — MOVIXA legal streaming platform.`)));
    tx(pages);
  }

  // --- Sample catalog (open-licensed Blender Foundation films) ---
  if (db.prepare('SELECT COUNT(*) c FROM movies').get().c === 0) {
    const gid = (slug) => db.prepare('SELECT id FROM genres WHERE slug = ?').get(slug).id;
    const movies = [
      {
        title: 'Big Buck Bunny', original_title: 'Big Buck Bunny', slug: 'big-buck-bunny',
        description: `<p>A giant, gentle rabbit takes revenge on three bullying rodents in this classic open-source comedy from the Blender Institute. A beloved short film that showcases open movie-making at its best.</p><p>Released under a Creative Commons license by the Blender Foundation, Big Buck Bunny remains one of the most-watched open films of all time.</p>`,
        short: 'A gentle giant rabbit outsmarts three bullying rodents in this open-source comedy classic.',
        year: 2008, runtime: 10, language: 'English', country: 'Netherlands', director: 'Sacha Goedegebure',
        poster: 'https://picsum.photos/seed/movixa-bbb/600/900', backdrop: 'https://picsum.photos/seed/movixa-bbb-bg/1280/720',
        trailer: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', watch: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', source: 'YouTube',
        rating: 7.8, featured: 1, status: 'published', tags: 'open movie,short,family',
        genres: ['animation', 'comedy', 'adventure']
      },
      {
        title: 'Sintel', original_title: 'Sintel', slug: 'sintel',
        description: `<p>A lonely young woman searches for the baby dragon she once befriended in this epic fantasy short from the Blender Institute. A sweeping tale of love, loss and adventure.</p><p>Sintel was released under a Creative Commons license and funded entirely by the open community.</p>`,
        short: 'A lone warrior searches for the dragon she once befriended in this epic open fantasy film.',
        year: 2010, runtime: 15, language: 'English', country: 'Netherlands', director: 'Colin Levy',
        poster: 'https://picsum.photos/seed/movixa-sintel/600/900', backdrop: 'https://picsum.photos/seed/movixa-sintel-bg/1280/720',
        trailer: 'https://www.youtube.com/watch?v=eRsGyueVLvQ', watch: 'https://www.youtube.com/watch?v=eRsGyueVLvQ', source: 'YouTube',
        rating: 8.4, featured: 1, status: 'published', tags: 'open movie,fantasy,epic',
        genres: ['fantasy', 'adventure', 'drama', 'animation']
      },
      {
        title: 'Tears of Steel', original_title: 'Tears of Steel', slug: 'tears-of-steel',
        description: `<p>In a future Amsterdam, a group of warriors and scientists must save the world from rampaging robots. The Blender Institute's ambitious sci-fi epic blending live action and animation.</p><p>Released under Creative Commons, Tears of Steel pushed open-source visual effects to a new level.</p>`,
        short: 'Warriors and scientists defend future Amsterdam from robot invaders in this open sci-fi epic.',
        year: 2012, runtime: 12, language: 'English', country: 'Netherlands', director: 'Ian Hubert',
        poster: 'https://picsum.photos/seed/movixa-tos/600/900', backdrop: 'https://picsum.photos/seed/movixa-tos-bg/1280/720',
        trailer: 'https://www.youtube.com/watch?v=R6MlUcmOul8', watch: 'https://www.youtube.com/watch?v=R6MlUcmOul8', source: 'YouTube',
        rating: 7.5, featured: 1, status: 'published', tags: 'open movie,sci-fi,robots',
        genres: ['sci-fi', 'action', 'adventure']
      },
      {
        title: 'Elephants Dream', original_title: 'Elephants Dream', slug: 'elephants-dream',
        description: `<p>Two travelers explore a strange, infinite machine in the very first open-source short film ever made. A surreal landmark in animation history from the Orange Open Movie Project.</p>`,
        short: 'Two travelers explore a strange infinite machine in the first open-source film ever made.',
        year: 2006, runtime: 11, language: 'English', country: 'Netherlands', director: 'Bassam Kurdali',
        poster: 'https://picsum.photos/seed/movixa-ed/600/900', backdrop: 'https://picsum.photos/seed/movixa-ed-bg/1280/720',
        trailer: 'https://www.youtube.com/watch?v=tlB1pM8G0AY', watch: 'https://www.youtube.com/watch?v=tlB1pM8G0AY', source: 'YouTube',
        rating: 7.1, featured: 0, status: 'published', tags: 'open movie,surreal,classic',
        genres: ['animation', 'sci-fi', 'fantasy']
      },
      {
        title: 'Caminandes: Llama Drama', original_title: 'Caminandes: Llama Drama', slug: 'caminandes-llama-drama',
        description: `<p>Koro the llama attempts to eat some roadside grass and gets into hilarious trouble in this charming Blender Institute short. Family-friendly fun for all ages.</p>`,
        short: 'Koro the llama gets into hilarious trouble chasing roadside grass.',
        year: 2013, runtime: 2, language: 'None', country: 'Netherlands', director: 'Pablo Vazquez',
        poster: 'https://picsum.photos/seed/movixa-koro/600/900', backdrop: 'https://picsum.photos/seed/movixa-koro-bg/1280/720',
        trailer: 'https://www.youtube.com/watch?v=Z4C82eyhwgU', watch: 'https://www.youtube.com/watch?v=Z4C82eyhwgU', source: 'YouTube',
        rating: 7.9, featured: 0, status: 'published', tags: 'open movie,short,family,funny',
        genres: ['animation', 'comedy']
      },
      {
        title: 'Spring', original_title: 'Spring', slug: 'spring',
        description: `<p>A shepherd girl and her dog confront ancient spirits to bring back the spring in this visually stunning open film from the Blender Animation Studio.</p>`,
        short: 'A shepherd girl confronts ancient spirits to bring back the spring.',
        year: 2019, runtime: 8, language: 'English', country: 'Netherlands', director: 'Andy Goralczyk',
        poster: 'https://picsum.photos/seed/movixa-spring/600/900', backdrop: 'https://picsum.photos/seed/movixa-spring-bg/1280/720',
        trailer: 'https://www.youtube.com/watch?v=WhWc3b3KhnY', watch: 'https://www.youtube.com/watch?v=WhWc3b3KhnY', source: 'YouTube',
        rating: 8.1, featured: 1, status: 'published', tags: 'open movie,fantasy,visual',
        genres: ['fantasy', 'adventure', 'animation']
      }
    ];
    const insM = db.prepare(`INSERT INTO movies (title, original_title, slug, description, short_description, release_year, runtime, language, country, director, poster_image, backdrop_image, trailer_url, official_watch_url, official_source_name, rating, view_count, featured, status, tags, seo_title, seo_description, og_image)
      VALUES (@title, @original_title, @slug, @description, @short_description, @release_year, @runtime, @language, @country, @director, @poster_image, @backdrop_image, @trailer_url, @official_watch_url, @official_source_name, @rating, @view_count, @featured, @status, @tags, @seo_title, @seo_description, @og_image)`);
    const insG = db.prepare('INSERT INTO content_genres (content_id, content_type, genre_id) VALUES (?, ?, ?)');
    const tx = db.transaction((list) => {
      list.forEach((m, i) => {
        const info = insM.run({
          title: m.title, original_title: m.original_title, slug: m.slug, description: m.description,
          short_description: m.short, release_year: m.year, runtime: m.runtime, language: m.language,
          country: m.country, director: m.director, poster_image: m.poster, backdrop_image: m.backdrop,
          trailer_url: m.trailer, official_watch_url: m.watch, official_source_name: m.source,
          rating: m.rating, view_count: 1200 - i * 137, featured: m.featured, status: m.status, tags: m.tags,
          seo_title: `${m.title} (${m.year}) - Watch Legally | MOVIXA`,
          seo_description: m.short.slice(0, 155),
          og_image: m.backdrop
        });
        m.genres.forEach(g => insG.run(info.lastInsertRowid, 'movie', gid(g)));
      });
    });
    tx(movies);

    // People + cast links for sample movies
    const insP = db.prepare('INSERT INTO people (name, role, bio) VALUES (?, ?, ?)');
    const p1 = insP.run('Blender Institute', 'director', 'Amsterdam-based studio behind the world-famous open movies.').lastInsertRowid;
    const insC = db.prepare('INSERT INTO content_cast (content_id, content_type, cast_id, character_name) VALUES (?, ?, ?, ?)');
    const movieIds = db.prepare('SELECT id FROM movies').all();
    movieIds.forEach(r => { try { insC.run(r.id, 'movie', p1, ''); } catch (e) { /* ignore dup */ } });

    // Sample series
    const insS = db.prepare(`INSERT INTO series (title, original_title, slug, description, short_description, first_air_year, last_air_year, status, language, country, poster_image, backdrop_image, trailer_url, rating, view_count, featured, publish_status, tags, seo_title, seo_description, og_image)
      VALUES (@title, @original_title, @slug, @description, @short_description, @first_air_year, @last_air_year, @status, @language, @country, @poster_image, @backdrop_image, @trailer_url, @rating, @view_count, @featured, @publish_status, @tags, @seo_title, @seo_description, @og_image)`);
    const s1 = insS.run({
      title: 'Caminandes Shorts', original_title: 'Caminandes Shorts', slug: 'caminandes-shorts',
      description: `<p>Follow Koro the llama and his friends through hilarious Patagonian misadventures in this delightful open-animated short series from the Blender Institute.</p>`,
      short_description: 'Koro the llama stars in hilarious open-animated short adventures.',
      first_air_year: 2013, last_air_year: 2016, status: 'completed', language: 'None', country: 'Netherlands',
      poster_image: 'https://picsum.photos/seed/movixa-camin/600/900',
      backdrop_image: 'https://picsum.photos/seed/movixa-camin-bg/1280/720',
      trailer_url: 'https://www.youtube.com/watch?v=Z4C82eyhwgU',
      rating: 8.0, view_count: 980, featured: 1, publish_status: 'published', tags: 'open series,shorts,family',
      seo_title: 'Caminandes Shorts - Watch Legally | MOVIXA',
      seo_description: 'Koro the llama stars in hilarious open-animated short adventures. Watch legally on MOVIXA.',
      og_image: 'https://picsum.photos/seed/movixa-camin-bg/1280/720'
    }).lastInsertRowid;
    const s2 = insS.run({
      title: 'Blender Open Documentaries', original_title: 'Blender Open Documentaries', slug: 'blender-open-documentaries',
      description: `<p>Behind-the-scenes documentaries following the making of the world's most famous open movies — from storyboard to final render.</p>`,
      short_description: 'Behind-the-scenes documentaries on the making of open movies.',
      first_air_year: 2015, last_air_year: 2024, status: 'ongoing', language: 'English', country: 'Netherlands',
      poster_image: 'https://picsum.photos/seed/movixa-doc/600/900',
      backdrop_image: 'https://picsum.photos/seed/movixa-doc-bg/1280/720',
      trailer_url: '', rating: 7.6, view_count: 640, featured: 0, publish_status: 'published', tags: 'documentary,making-of',
      seo_title: 'Blender Open Documentaries - Watch Legally | MOVIXA',
      seo_description: 'Behind-the-scenes documentaries on the making of open movies. Watch legally on MOVIXA.',
      og_image: 'https://picsum.photos/seed/movixa-doc-bg/1280/720'
    }).lastInsertRowid;
    [ ['animation', s1], ['comedy', s1], ['documentary', s2], ['animation', s2] ]
      .forEach(([g, sid]) => insG.run(sid, 'series', gid(g)));

    // Seasons + episodes
    const insSe = db.prepare('INSERT INTO seasons (series_id, season_number, title, description, air_year, poster_image, episode_count, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insE = db.prepare(`INSERT INTO episodes (series_id, season_id, episode_number, title, slug, description, air_date, runtime, thumbnail_image, official_watch_url, official_source_name, view_count, status, seo_title, seo_description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const se1 = insSe.run(s1, 1, 'Season 1', 'The original Koro adventures.', 2013, 'https://picsum.photos/seed/movixa-camin-s1/600/900', 3, 'published').lastInsertRowid;
    const se2 = insSe.run(s2, 1, 'Season 1', 'Making of the open movies.', 2015, 'https://picsum.photos/seed/movixa-doc-s1/600/900', 2, 'published').lastInsertRowid;
    [
      [s1, se1, 1, 'Llama Drama', 'llama-drama', 'Koro tries to eat roadside grass and chaos follows.', '2013-01-01', 2, 'https://picsum.photos/seed/movixa-e1/640/360', 'https://www.youtube.com/watch?v=Z4C82eyhwgU', 'YouTube', 720],
      [s1, se1, 2, 'Gran Dillama', 'gran-dillama', 'Koro faces a closed gate and a tempting treat.', '2013-06-01', 2, 'https://picsum.photos/seed/movixa-e2/640/360', 'https://www.youtube.com/watch?v=Z4C82eyhwgU', 'YouTube', 540],
      [s1, se1, 3, 'Llamigos', 'llamigos', 'Koro makes an unlikely friend on the road.', '2016-01-01', 3, 'https://picsum.photos/seed/movixa-e3/640/360', 'https://www.youtube.com/watch?v=Z4C82eyhwgU', 'YouTube', 410],
      [s2, se2, 1, 'The Open Movie Story', 'the-open-movie-story', 'How a community built films in the open.', '2015-03-01', 12, 'https://picsum.photos/seed/movixa-d1/640/360', 'https://www.youtube.com/watch?v=eRsGyueVLvQ', 'YouTube', 300],
      [s2, se2, 2, 'Rendering the Future', 'rendering-the-future', 'Inside the render farms and pipelines.', '2016-03-01', 14, 'https://picsum.photos/seed/movixa-d2/640/360', 'https://www.youtube.com/watch?v=R6MlUcmOul8', 'YouTube', 220]
    ].forEach(([sid, seid, n, t, sl, d, ad, rt, th, w, src, vc]) =>
      insE.run(sid, seid, n, t, sl, d, ad, rt, th, w, src, vc, 'published', `${t} - MOVIXA`, d.slice(0, 155)));

    console.log('[movixa] Seeded sample catalog (open-licensed films)');
  }
}

migrate();
seed();

module.exports = { db, getSetting, setSetting, allSettings };
