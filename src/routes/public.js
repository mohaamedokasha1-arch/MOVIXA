/* MOVIXA public routes */
const express = require('express');
const { db, getSetting } = require('../db');
const { setFlash } = require('../middleware');
const H = require('../helpers');

const router = express.Router();

/* ---------- shared query helpers ---------- */
function genresFor(type, id) {
  return db.prepare(`SELECT g.* FROM genres g
    JOIN content_genres cg ON cg.genre_id = g.id
    WHERE cg.content_type = ? AND cg.content_id = ? ORDER BY g.name`).all(type, id);
}

function castFor(type, id) {
  return db.prepare(`SELECT p.*, cc.character_name FROM people p
    JOIN content_cast cc ON cc.cast_id = p.id
    WHERE cc.content_type = ? AND cc.content_id = ? ORDER BY p.name`).all(type, id);
}

function seasonCounts(seriesId) {
  return db.prepare('SELECT COUNT(*) c FROM seasons WHERE series_id = ?').get(seriesId).c;
}

function episodeCountForSeries(seriesId) {
  return db.prepare(`SELECT COUNT(*) c FROM episodes WHERE series_id = ? AND status = 'published'`).get(seriesId).c;
}

function relatedContent(type, id, genreIds, limit = 8) {
  if (!genreIds.length) {
    const table = type === 'movie' ? 'movies' : 'series';
    const statusCol = type === 'movie' ? 'status' : 'publish_status';
    return db.prepare(`SELECT *, '${type}' AS content_type FROM ${table} WHERE id != ? AND ${statusCol} = 'published' ORDER BY view_count DESC LIMIT ?`).all(id, limit);
  }
  const table = type === 'movie' ? 'movies' : 'series';
  const statusCol = type === 'movie' ? 'status' : 'publish_status';
  const ph = genreIds.map(() => '?').join(',');
  return db.prepare(`SELECT DISTINCT t.*, '${type}' AS content_type FROM ${table} t
    JOIN content_genres cg ON cg.content_id = t.id AND cg.content_type = ?
    WHERE t.id != ? AND t.${statusCol} = 'published' AND cg.genre_id IN (${ph})
    ORDER BY t.view_count DESC LIMIT ?`).all(type, id, ...genreIds, limit);
}

function seoTitle(req, title) {
  const tpl = getSetting('seo_title_template', '{title} - MOVIXA');
  return tpl.replace('{title}', title);
}

function breadcrumbLd(base, crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: base + c.href } : {})
    }))
  };
}

/* ---------- homepage ---------- */
router.get('/', (req, res) => {
  const base = H.baseUrl(req);
  const heroLimit = parseInt(getSetting('hero_limit', '5'), 10) || 5;
  const featuredMovies = db.prepare(`SELECT *, 'movie' AS content_type FROM movies WHERE status = 'published' AND featured = 1 ORDER BY updated_at DESC LIMIT ?`).all(heroLimit);
  const featuredSeries = db.prepare(`SELECT *, 'series' AS content_type FROM series WHERE publish_status = 'published' AND featured = 1 ORDER BY updated_at DESC LIMIT ?`).all(heroLimit);
  const hero = [...featuredMovies, ...featuredSeries]
    .sort((a, b) => (b.view_count || 0) - (a.view_count || 0)).slice(0, heroLimit);
  // Fallback: newest published if nothing featured
  if (!hero.length) {
    const m = db.prepare(`SELECT *, 'movie' AS content_type FROM movies WHERE status = 'published' ORDER BY created_at DESC LIMIT 3`).all();
    const s = db.prepare(`SELECT *, 'series' AS content_type FROM series WHERE publish_status = 'published' ORDER BY created_at DESC LIMIT 3`).all();
    hero.push(...m, ...s);
  }
  const trendingM = db.prepare(`SELECT *, 'movie' AS content_type FROM movies WHERE status = 'published' ORDER BY view_count DESC LIMIT 10`).all();
  const trendingS = db.prepare(`SELECT *, 'series' AS content_type FROM series WHERE publish_status = 'published' ORDER BY view_count DESC LIMIT 10`).all();
  const trending = [...trendingM, ...trendingS].sort((a, b) => b.view_count - a.view_count).slice(0, 12);
  const latestMovies = db.prepare(`SELECT *, 'movie' AS content_type FROM movies WHERE status = 'published' ORDER BY created_at DESC LIMIT 8`).all();
  const popularSeries = db.prepare(`SELECT *, 'series' AS content_type FROM series WHERE publish_status = 'published' ORDER BY view_count DESC LIMIT 8`).all();
  const genreCards = db.prepare(`SELECT g.*,
      (SELECT COUNT(*) FROM content_genres cg JOIN movies m ON m.id = cg.content_id WHERE cg.genre_id = g.id AND cg.content_type = 'movie' AND m.status = 'published') +
      (SELECT COUNT(*) FROM content_genres cg JOIN series s ON s.id = cg.content_id WHERE cg.genre_id = g.id AND cg.content_type = 'series' AND s.publish_status = 'published') AS total
    FROM genres g ORDER BY g.sort_order, g.name LIMIT 12`).all();

  const jsonLd = [{
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: res.locals.siteName,
    url: base + '/',
    potentialAction: {
      '@type': 'SearchAction',
      target: base + '/search?q={search_term_string}',
      'query-input': 'required name=search_term_string'
    }
  }];

  res.render('pages/home', {
    title: `${res.locals.siteName} — ${getSetting('tagline', 'Discover. Watch. Legally.')}`,
    metaDescription: getSetting('seo_default_description', ''),
    canonical: base + '/',
    ogType: 'website',
    ogImage: '',
    jsonLd,
    hero, trending, latestMovies, popularSeries, genreCards
  });
});

/* ---------- movies listing ---------- */
function listingQuery(table, statusCol, yearCol, req, extraWhere = '', extraParams = []) {
  const { genre, year, language, rating, sort = 'latest', page = '1' } = req.query;
  const where = [`t.${statusCol} = 'published'`];
  const params = [...extraParams];
  let join = '';
  if (genre) {
    join = 'JOIN content_genres cg ON cg.content_id = t.id AND cg.content_type = ? JOIN genres g ON g.id = cg.genre_id AND g.slug = ?';
    params.unshift(req.query._ctype || 'movie', genre);
  }
  if (extraWhere) where.push(extraWhere);
  if (year && /^\d{4}$/.test(year)) { where.push(`t.${yearCol} = ?`); params.push(parseInt(year, 10)); }
  if (language) { where.push('t.language = ?'); params.push(language); }
  if (rating && !isNaN(parseFloat(rating))) { where.push('t.rating >= ?'); params.push(parseFloat(rating)); }
  const sorts = {
    latest: `t.${yearCol} DESC, t.created_at DESC`,
    popular: 't.view_count DESC',
    rating: 't.rating DESC',
    az: 't.title ASC'
  };
  const orderBy = sorts[sort] || sorts.latest;
  const total = db.prepare(`SELECT COUNT(DISTINCT t.id) c FROM ${table} t ${join} WHERE ${where.join(' AND ')}`).get(...params).c;
  const perPage = parseInt(getSetting('movies_per_page', '12'), 10) || 12;
  const pg = H.paginate(total, parseInt(page, 10) || 1, perPage);
  const items = db.prepare(`SELECT DISTINCT t.* FROM ${table} t ${join} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, pg.perPage, pg.offset);
  return { items, pg, filters: { genre: genre || '', year: year || '', language: language || '', rating: rating || '', sort } };
}

router.get('/movies', (req, res) => {
  req.query._ctype = 'movie';
  const { items, pg, filters } = listingQuery('movies', 'status', 'release_year', req);
  items.forEach(m => { m.genres = genresFor('movie', m.id); });
  const years = db.prepare(`SELECT DISTINCT release_year y FROM movies WHERE status = 'published' AND release_year IS NOT NULL ORDER BY y DESC`).all().map(r => r.y);
  const languages = db.prepare(`SELECT DISTINCT language FROM movies WHERE status = 'published' AND language != '' ORDER BY language`).all().map(r => r.language);
  const base = H.baseUrl(req);
  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Movies' }];
  res.render('pages/movies', {
    title: seoTitle(req, 'Movies'),
    metaDescription: `Browse all movies on ${res.locals.siteName} — filter by genre, year, language and rating. 100% legal streaming.`,
    canonical: base + '/movies',
    ogType: 'website', ogImage: '', jsonLd: [breadcrumbLd(base, crumbs)],
    crumbs, items, pg, filters, years, languages,
    queryString: (over = {}) => '?' + new URLSearchParams({ ...req.query, ...over, _ctype: undefined }).toString().replace(/_ctype=[^&]*&?/, '')
  });
});

/* ---------- series listing ---------- */
router.get('/series', (req, res) => {
  req.query._ctype = 'series';
  const { status } = req.query;
  let extraWhere = '', extraParams = [];
  if (status && ['ongoing', 'completed', 'cancelled'].includes(status)) { extraWhere = 't.status = ?'; extraParams = [status]; }
  const { items, pg, filters } = listingQuery('series', 'publish_status', 'first_air_year', req, extraWhere, extraParams);
  items.forEach(s => { s.genres = genresFor('series', s.id); s.seasons_count = seasonCounts(s.id); });
  const years = db.prepare(`SELECT DISTINCT first_air_year y FROM series WHERE publish_status = 'published' AND first_air_year IS NOT NULL ORDER BY y DESC`).all().map(r => r.y);
  const languages = db.prepare(`SELECT DISTINCT language FROM series WHERE publish_status = 'published' AND language != '' ORDER BY language`).all().map(r => r.language);
  const base = H.baseUrl(req);
  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Series' }];
  res.render('pages/series', {
    title: seoTitle(req, 'Series'),
    metaDescription: `Browse all series on ${res.locals.siteName} — filter by genre, year, language and status. 100% legal streaming.`,
    canonical: base + '/series',
    ogType: 'website', ogImage: '', jsonLd: [breadcrumbLd(base, crumbs)],
    crumbs, items, pg, filters: { ...filters, status: status || '' }, years, languages,
    queryString: (over = {}) => '?' + new URLSearchParams({ ...req.query, ...over, _ctype: undefined }).toString().replace(/_ctype=[^&]*&?/, '')
  });
});

/* ---------- movie detail ---------- */
router.get('/movie/:slug', (req, res, next) => {
  const movie = db.prepare(`SELECT * FROM movies WHERE slug = ? AND status = 'published'`).get(req.params.slug);
  if (!movie) return next();
  db.prepare('UPDATE movies SET view_count = view_count + 1 WHERE id = ?').run(movie.id);
  movie.view_count += 1;
  movie.genres = genresFor('movie', movie.id);
  movie.cast = castFor('movie', movie.id);
  movie.directors = movie.cast.filter(p => p.role === 'director');
  movie.actors = movie.cast.filter(p => p.role !== 'director');
  const related = relatedContent('movie', movie.id, movie.genres.map(g => g.id));
  related.forEach(m => { m.genres = genresFor('movie', m.id); });
  const base = H.baseUrl(req);
  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Movies', href: '/movies' }, { label: movie.title }];
  const jsonLd = [breadcrumbLd(base, crumbs), {
    '@context': 'https://schema.org',
    '@type': 'Movie',
    name: movie.title,
    image: movie.poster_image || undefined,
    datePublished: movie.release_year ? String(movie.release_year) : undefined,
    description: H.excerpt(movie.description || movie.short_description, 300),
    genre: movie.genres.map(g => g.name),
    inLanguage: movie.language || undefined,
    duration: movie.runtime ? `PT${movie.runtime}M` : undefined,
    ...(movie.director ? { director: { '@type': 'Person', name: movie.director } } : {}),
    ...(movie.actors.length ? { actor: movie.actors.slice(0, 10).map(a => ({ '@type': 'Person', name: a.name })) } : {}),
    ...(movie.rating > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: movie.rating, bestRating: 10, ratingCount: Math.max(1, Math.round(movie.view_count / 10)) } } : {})
  }];
  res.render('pages/movie-detail', {
    title: movie.seo_title || seoTitle(req, `${movie.title}${movie.release_year ? ` (${movie.release_year})` : ''}`),
    metaDescription: movie.seo_description || H.excerpt(movie.description || movie.short_description, 155) || `${movie.title} — watch legally on ${res.locals.siteName}.`,
    canonical: base + '/movie/' + movie.slug,
    ogType: 'video.movie', ogImage: movie.og_image || movie.backdrop_image || movie.poster_image,
    jsonLd, crumbs, movie, related,
    trailerEmbed: H.embedUrl(movie.trailer_url)
  });
});

/* ---------- series detail ---------- */
router.get('/series/:slug', (req, res, next) => {
  const show = db.prepare(`SELECT * FROM series WHERE slug = ? AND publish_status = 'published'`).get(req.params.slug);
  if (!show) return next();
  db.prepare('UPDATE series SET view_count = view_count + 1 WHERE id = ?').run(show.id);
  show.view_count += 1;
  show.genres = genresFor('series', show.id);
  show.cast = castFor('series', show.id);
  show.actors = show.cast.filter(p => p.role !== 'director');
  show.seasons = db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM episodes e WHERE e.season_id = s.id AND e.status = 'published') AS published_episodes
    FROM seasons s WHERE s.series_id = ? ORDER BY s.season_number`).all(show.id);
  show.total_episodes = episodeCountForSeries(show.id);
  const related = relatedContent('series', show.id, show.genres.map(g => g.id));
  related.forEach(s => { s.genres = genresFor('series', s.id); s.seasons_count = seasonCounts(s.id); });
  const base = H.baseUrl(req);
  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Series', href: '/series' }, { label: show.title }];
  const jsonLd = [breadcrumbLd(base, crumbs), {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    name: show.title,
    image: show.poster_image || undefined,
    description: H.excerpt(show.description || show.short_description, 300),
    genre: show.genres.map(g => g.name),
    inLanguage: show.language || undefined,
    numberOfSeasons: show.seasons.length,
    ...(show.actors.length ? { actor: show.actors.slice(0, 10).map(a => ({ '@type': 'Person', name: a.name })) } : {}),
    ...(show.rating > 0 ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: show.rating, bestRating: 10, ratingCount: Math.max(1, Math.round(show.view_count / 10)) } } : {})
  }];
  res.render('pages/series-detail', {
    title: show.seo_title || seoTitle(req, show.title),
    metaDescription: show.seo_description || H.excerpt(show.description || show.short_description, 155) || `${show.title} — watch legally on ${res.locals.siteName}.`,
    canonical: base + '/series/' + show.slug,
    ogType: 'video.tv_show', ogImage: show.og_image || show.backdrop_image || show.poster_image,
    jsonLd, crumbs, show, related,
    trailerEmbed: H.embedUrl(show.trailer_url)
  });
});

/* ---------- season page ---------- */
router.get('/series/:slug/season-:num', (req, res, next) => {
  const show = db.prepare(`SELECT * FROM series WHERE slug = ? AND publish_status = 'published'`).get(req.params.slug);
  if (!show) return next();
  const season = db.prepare('SELECT * FROM seasons WHERE series_id = ? AND season_number = ?').get(show.id, parseInt(req.params.num, 10));
  if (!season) return next();
  season.episodes = db.prepare(`SELECT * FROM episodes WHERE season_id = ? AND status = 'published' ORDER BY episode_number`).all(season.id);
  const allSeasons = db.prepare('SELECT * FROM seasons WHERE series_id = ? ORDER BY season_number').all(show.id);
  const base = H.baseUrl(req);
  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Series', href: '/series' }, { label: show.title, href: '/series/' + show.slug }, { label: season.title || `Season ${season.season_number}` }];
  res.render('pages/season', {
    title: seoTitle(req, `${show.title} ${season.title || 'Season ' + season.season_number}`),
    metaDescription: `${show.title} ${season.title || 'Season ' + season.season_number} — episode guide. Watch legally on ${res.locals.siteName}.`,
    canonical: `${base}/series/${show.slug}/season-${season.season_number}`,
    ogType: 'website', ogImage: season.poster_image || show.backdrop_image,
    jsonLd: [breadcrumbLd(base, crumbs)],
    crumbs, show, season, allSeasons
  });
});

/* ---------- episode page ---------- */
router.get('/series/:slug/season-:num/episode-:ep', (req, res, next) => {
  const show = db.prepare(`SELECT * FROM series WHERE slug = ? AND publish_status = 'published'`).get(req.params.slug);
  if (!show) return next();
  const season = db.prepare('SELECT * FROM seasons WHERE series_id = ? AND season_number = ?').get(show.id, parseInt(req.params.num, 10));
  if (!season) return next();
  const ep = db.prepare('SELECT * FROM episodes WHERE season_id = ? AND episode_number = ? AND status = \'published\'').get(season.id, parseInt(req.params.ep, 10));
  if (!ep) return next();
  db.prepare('UPDATE episodes SET view_count = view_count + 1 WHERE id = ?').run(ep.id);
  ep.view_count += 1;
  const prev = db.prepare('SELECT * FROM episodes WHERE season_id = ? AND episode_number < ? AND status = \'published\' ORDER BY episode_number DESC LIMIT 1').get(season.id, ep.episode_number);
  const nextEp = db.prepare('SELECT * FROM episodes WHERE season_id = ? AND episode_number > ? AND status = \'published\' ORDER BY episode_number ASC LIMIT 1').get(season.id, ep.episode_number);
  const base = H.baseUrl(req);
  const crumbs = [
    { label: 'Home', href: '/' }, { label: 'Series', href: '/series' },
    { label: show.title, href: '/series/' + show.slug },
    { label: season.title || `Season ${season.season_number}`, href: `/series/${show.slug}/season-${season.season_number}` },
    { label: `Episode ${ep.episode_number}` }
  ];
  const jsonLd = [breadcrumbLd(base, crumbs), {
    '@context': 'https://schema.org',
    '@type': 'TVEpisode',
    name: ep.title,
    episodeNumber: ep.episode_number,
    seasonNumber: season.season_number,
    description: H.excerpt(ep.description, 300),
    image: ep.thumbnail_image || undefined,
    datePublished: ep.air_date || undefined,
    partOfSeries: { '@type': 'TVSeries', name: show.title, url: base + '/series/' + show.slug }
  }];
  res.render('pages/episode', {
    title: ep.seo_title || seoTitle(req, `${show.title} S${season.season_number} E${ep.episode_number}: ${ep.title}`),
    metaDescription: ep.seo_description || H.excerpt(ep.description, 155) || `${ep.title} — ${show.title}. Watch legally on ${res.locals.siteName}.`,
    canonical: `${base}/series/${show.slug}/season-${season.season_number}/episode-${ep.episode_number}`,
    ogType: 'video.episode', ogImage: ep.thumbnail_image || show.backdrop_image,
    jsonLd, crumbs, show, season, ep, prev, nextEp
  });
});

/* ---------- genre page ---------- */
router.get('/genre/:slug', (req, res, next) => {
  const genre = db.prepare('SELECT * FROM genres WHERE slug = ?').get(req.params.slug);
  if (!genre) return next();
  const type = ['movies', 'series'].includes(req.query.type) ? req.query.type : 'all';
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(getSetting('movies_per_page', '12'), 10) || 12;
  let items = [];
  if (type === 'all' || type === 'movies') {
    const m = db.prepare(`SELECT t.*, 'movie' AS content_type FROM movies t
      JOIN content_genres cg ON cg.content_id = t.id AND cg.content_type = 'movie'
      WHERE cg.genre_id = ? AND t.status = 'published' ORDER BY t.view_count DESC`).all(genre.id);
    items.push(...m);
  }
  if (type === 'all' || type === 'series') {
    const s = db.prepare(`SELECT t.*, 'series' AS content_type FROM series t
      JOIN content_genres cg ON cg.content_id = t.id AND cg.content_type = 'series'
      WHERE cg.genre_id = ? AND t.publish_status = 'published' ORDER BY t.view_count DESC`).all(genre.id);
    items.push(...s);
  }
  items.sort((a, b) => b.view_count - a.view_count);
  const pg = H.paginate(items.length, page, perPage);
  const paged = items.slice(pg.offset, pg.offset + pg.perPage);
  paged.forEach(it => {
    it.genres = genresFor(it.content_type, it.id);
    if (it.content_type === 'series') it.seasons_count = seasonCounts(it.id);
  });
  const base = H.baseUrl(req);
  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Genres' }, { label: genre.name }];
  res.render('pages/genre', {
    title: genre.seo_title || seoTitle(req, `${genre.name} Movies & Series`),
    metaDescription: genre.seo_description || `Best ${genre.name.toLowerCase()} movies and series to watch legally on ${res.locals.siteName}.`,
    canonical: base + '/genre/' + genre.slug,
    ogType: 'website', ogImage: genre.image || '', jsonLd: [breadcrumbLd(base, crumbs)],
    crumbs, genre, items: paged, pg, activeType: type
  });
});

/* ---------- search ---------- */
router.get('/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const type = ['movies', 'series', 'episodes'].includes(req.query.type) ? req.query.type : 'all';
  const genre = req.query.genre || '';
  const year = req.query.year || '';
  const sort = req.query.sort || 'relevance';
  const page = parseInt(req.query.page, 10) || 1;
  const perPage = parseInt(getSetting('movies_per_page', '12'), 10) || 12;
  let results = [];
  if (q.length >= 1) {
    const like = `%${q.replace(/[%_]/g, '')}%`;
    if (type === 'all' || type === 'movies') {
      let sql = `SELECT t.*, 'movie' AS content_type FROM movies t WHERE t.status = 'published' AND (t.title LIKE ? OR t.original_title LIKE ? OR t.description LIKE ? OR t.short_description LIKE ?)`;
      const params = [like, like, like, like];
      if (genre) { sql += ` AND EXISTS (SELECT 1 FROM content_genres cg JOIN genres g ON g.id = cg.genre_id WHERE cg.content_id = t.id AND cg.content_type = 'movie' AND g.slug = ?)`; params.push(genre); }
      if (/^\d{4}$/.test(year)) { sql += ' AND t.release_year = ?'; params.push(parseInt(year, 10)); }
      results.push(...db.prepare(sql).all(...params));
    }
    if (type === 'all' || type === 'series') {
      let sql = `SELECT t.*, 'series' AS content_type FROM series t WHERE t.publish_status = 'published' AND (t.title LIKE ? OR t.original_title LIKE ? OR t.description LIKE ? OR t.short_description LIKE ?)`;
      const params = [like, like, like, like];
      if (genre) { sql += ` AND EXISTS (SELECT 1 FROM content_genres cg JOIN genres g ON g.id = cg.genre_id WHERE cg.content_id = t.id AND cg.content_type = 'series' AND g.slug = ?)`; params.push(genre); }
      if (/^\d{4}$/.test(year)) { sql += ' AND t.first_air_year = ?'; params.push(parseInt(year, 10)); }
      results.push(...db.prepare(sql).all(...params));
    }
    if (type === 'all' || type === 'episodes') {
      const eps = db.prepare(`SELECT e.*, 'episode' AS content_type, s.slug AS series_slug, s.title AS series_title, se.season_number
        FROM episodes e JOIN series s ON s.id = e.series_id JOIN seasons se ON se.id = e.season_id
        WHERE e.status = 'published' AND s.publish_status = 'published' AND (e.title LIKE ? OR e.description LIKE ?)`).all(like, like);
      results.push(...eps);
    }
    // relevance: title starts-with > title contains > description
    const ql = q.toLowerCase();
    const score = (r) => {
      const t = (r.title || '').toLowerCase();
      if (t === ql) return 0;
      if (t.startsWith(ql)) return 1;
      if (t.includes(ql)) return 2;
      return 3;
    };
    if (sort === 'latest') results.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    else if (sort === 'rating') results.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    else if (sort === 'az') results.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    else results.sort((a, b) => score(a) - score(b) || (b.view_count || 0) - (a.view_count || 0));
  }
  const pg = H.paginate(results.length, page, perPage);
  const paged = results.slice(pg.offset, pg.offset + pg.perPage);
  paged.forEach(r => {
    if (r.content_type === 'movie' || r.content_type === 'series') {
      r.genres = genresFor(r.content_type, r.id);
      if (r.content_type === 'series') r.seasons_count = seasonCounts(r.id);
    }
  });
  const base = H.baseUrl(req);
  const crumbs = [{ label: 'Home', href: '/' }, { label: 'Search' }];
  res.render('pages/search', {
    title: q ? seoTitle(req, `Search: ${q}`) : seoTitle(req, 'Search'),
    metaDescription: q ? `Search results for "${q}" on ${res.locals.siteName}.` : `Search movies and series on ${res.locals.siteName}.`,
    canonical: base + '/search',
    ogType: 'website', ogImage: '', noIndex: true, jsonLd: [breadcrumbLd(base, crumbs)],
    crumbs, q, results: paged, pg, activeType: type, activeGenre: genre, activeYear: year, activeSort: sort
  });
});

/* ---------- autocomplete suggestions ---------- */
router.get('/api/suggest', (req, res) => {
  const q = (req.query.q || '').trim().replace(/[%_]/g, '');
  if (q.length < 2) return res.json({ results: [] });
  const like = `%${q}%`;
  const starts = `${q}%`;
  const movies = db.prepare(`SELECT title, slug, poster_image, release_year AS year, 'movie' AS type FROM movies
    WHERE status = 'published' AND (title LIKE ? OR original_title LIKE ?) ORDER BY CASE WHEN title LIKE ? THEN 0 ELSE 1 END, view_count DESC LIMIT 5`).all(like, like, starts);
  const series = db.prepare(`SELECT title, slug, poster_image, first_air_year AS year, 'series' AS type FROM series
    WHERE publish_status = 'published' AND (title LIKE ? OR original_title LIKE ?) ORDER BY CASE WHEN title LIKE ? THEN 0 ELSE 1 END, view_count DESC LIMIT 5`).all(like, like, starts);
  res.json({ results: [...movies, ...series].slice(0, 8) });
});

/* ---------- static pages ---------- */
function renderStaticPage(slug) {
  return (req, res, next) => {
    const page = db.prepare(`SELECT * FROM pages WHERE slug = ? AND status = 'published'`).get(slug);
    if (!page) return next();
    const base = H.baseUrl(req);
    const crumbs = [{ label: 'Home', href: '/' }, { label: page.title }];
    res.render(slug === 'contact' ? 'pages/contact' : 'pages/static', {
      title: page.seo_title || seoTitle(req, page.title),
      metaDescription: page.seo_description || H.excerpt(page.content, 155),
      canonical: base + '/' + page.slug,
      ogType: 'website', ogImage: '', jsonLd: [breadcrumbLd(base, crumbs)],
      crumbs, page
    });
  };
}
router.get('/about', renderStaticPage('about'));
router.get('/contact', renderStaticPage('contact'));
router.get('/privacy', renderStaticPage('privacy'));
router.get('/terms', renderStaticPage('terms'));
router.get('/copyright', renderStaticPage('copyright'));
router.get('/dmca', (req, res) => res.redirect(301, '/copyright'));

/* ---------- contact form ---------- */
router.post('/contact', (req, res) => {
  const { name = '', email = '', subject = '', message = '' } = req.body || {};
  const errors = [];
  if (name.trim().length < 2) errors.push('Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.push('Please enter a valid email address.');
  if (message.trim().length < 10) errors.push('Your message must be at least 10 characters.');
  if (errors.length) {
    setFlash(req, 'error', errors.join(' '));
    return res.redirect('/contact');
  }
  db.prepare('INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)')
    .run(name.trim().slice(0, 100), email.trim().slice(0, 160), subject.trim().slice(0, 160), message.trim().slice(0, 5000));
  setFlash(req, 'success', 'Thank you! Your message has been received. We will get back to you soon.');
  res.redirect('/contact');
});

/* ---------- newsletter ---------- */
router.post('/newsletter', (req, res) => {
  const email = ((req.body || {}).email || '').trim();
  const wantsJson = req.headers.accept && req.headers.accept.includes('application/json');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (wantsJson) return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    setFlash(req, 'error', 'Please enter a valid email address.');
    return res.redirect('back');
  }
  try {
    db.prepare('INSERT INTO subscribers (email) VALUES (?)').run(email.slice(0, 160));
  } catch (e) { /* already subscribed — treat as success */ }
  if (wantsJson) return res.json({ ok: true, message: 'Subscribed successfully!' });
  setFlash(req, 'success', 'You are subscribed! Welcome to MOVIXA updates.');
  res.redirect('back');
});

/* ---------- sitemap ---------- */
router.get('/sitemap.xml', (req, res) => {
  const base = H.baseUrl(req);
  const urls = [
    { loc: base + '/', changefreq: 'daily', priority: '1.0' },
    { loc: base + '/movies', changefreq: 'daily', priority: '0.9' },
    { loc: base + '/series', changefreq: 'daily', priority: '0.9' }
  ];
  db.prepare(`SELECT slug, updated_at FROM movies WHERE status = 'published'`).all()
    .forEach(m => urls.push({ loc: `${base}/movie/${m.slug}`, changefreq: 'weekly', priority: '0.8', lastmod: (m.updated_at || '').slice(0, 10) }));
  db.prepare(`SELECT slug, updated_at FROM series WHERE publish_status = 'published'`).all()
    .forEach(s => urls.push({ loc: `${base}/series/${s.slug}`, changefreq: 'weekly', priority: '0.8', lastmod: (s.updated_at || '').slice(0, 10) }));
  db.prepare(`SELECT s.slug AS series_slug, se.season_number FROM seasons se JOIN series s ON s.id = se.series_id WHERE s.publish_status = 'published'`).all()
    .forEach(r => urls.push({ loc: `${base}/series/${r.series_slug}/season-${r.season_number}`, changefreq: 'monthly', priority: '0.6' }));
  db.prepare(`SELECT s.slug AS series_slug, se.season_number, e.episode_number FROM episodes e
    JOIN series s ON s.id = e.series_id JOIN seasons se ON se.id = e.season_id
    WHERE e.status = 'published' AND s.publish_status = 'published'`).all()
    .forEach(r => urls.push({ loc: `${base}/series/${r.series_slug}/season-${r.season_number}/episode-${r.episode_number}`, changefreq: 'monthly', priority: '0.6' }));
  db.prepare('SELECT slug FROM genres').all()
    .forEach(g => urls.push({ loc: `${base}/genre/${g.slug}`, changefreq: 'weekly', priority: '0.7' }));
  db.prepare(`SELECT slug FROM pages WHERE status = 'published'`).all()
    .forEach(p => urls.push({ loc: `${base}/${p.slug}`, changefreq: 'monthly', priority: '0.5' }));
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(u => `  <url><loc>${H.escapeHtml(u.loc)}</loc>` +
      (u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : '') +
      `<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n') +
    `\n</urlset>`;
  res.type('application/xml').send(xml);
});

router.get('/robots.txt', (req, res) => {
  const base = H.baseUrl(req);
  res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin/*\n\nSitemap: ${base}/sitemap.xml\n`);
});

module.exports = router;
