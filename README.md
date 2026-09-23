# 🎬 MOVIXA — Legal Streaming Platform

A complete, production-ready streaming discovery platform for **movies & series** with a full **admin dashboard**. 100% legal by design: every title links to its **official licensed source** (YouTube, Vimeo, rights-holder sites).

Mobile-first cinematic dark theme · SEO-first (meta, Open Graph, JSON-LD, sitemap) · No build step · SQLite database (zero-config).

---

## ✨ Features

### Public site
- **Homepage** — featured hero slider, Trending Now carousel, Latest Movies, Popular Series, Browse by Genre, legal-trust banner
- **Movies / Series catalogs** — filter by genre, year, language, rating, status; sort by latest / popular / rating / A–Z; pagination
- **Detail pages** — backdrop hero, poster, cast & crew, trailer modal, genre tags, facts, related titles, social share, view counter
- **Series → Season → Episode hierarchy** — season guides, episode pages with prev/next navigation, per-episode official watch links
- **Genre pages** with Movies/Series tabs
- **Search** — across movies, series & episodes; autocomplete suggestions; highlighting; filters; empty states
- **Legal pages** — About, Contact (working form), Privacy, Terms, Copyright/DMCA + custom 404 / 500 / maintenance pages
- **SEO** — unique titles/descriptions, canonicals, Open Graph + Twitter cards, Movie/TVSeries/TVEpisode/BreadcrumbList/WebSite schemas, `sitemap.xml`, `robots.txt`
- **Newsletter signup**, breadcrumbs everywhere, lazy-loaded responsive images

### Admin dashboard (`/admin`)
- Secure login (bcrypt, rate-limited, remember-me, session timeout)
- **Dashboard** — stats (movies, series, episodes, views…), top content, recent activity, quick actions
- **Movies / Series CRUD** — rich forms: media upload-or-URL, legal source, genres, cast with character names, SEO fields, draft/published/archived, featured flag, bulk actions
- **Seasons & Episodes** nested management with auto-increment numbering
- **Genres** with drag-and-drop ordering · **Cast & Crew** directory · **Pages** (core pages protected) · **Media library** (upload, copy URL, delete) · **Contact messages** inbox · **Newsletter subscribers** · **Users** (super-admin only) · **Settings** (general, social, SEO, legal tabs + maintenance mode)

---

## 🚀 Quick start

**Requirements:** Node.js 18+ (22 recommended). No database server needed.

```bash
npm install
cp .env.example .env   # then edit: SESSION_SECRET, BASE_URL, admin credentials
npm start              # → http://localhost:3000
```

On first run the SQLite database is created at `data/movixa.db` and seeded with:
- An admin user (from `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`, defaults `admin` / `Admin123!`)
- 12 genres, core legal pages, site settings
- A sample catalog of open-licensed films (Blender Foundation CC shorts) so every page works out of the box — delete or replace them from the dashboard

**Admin login:** http://localhost:3000/admin/login

```bash
npm run dev    # development with auto-reload
npm run seed   # re-run migrations + seed (idempotent)
```

---

## ⚙️ Configuration (`.env`)

| Variable | Description |
|---|---|
| `PORT` | Server port (default `3000`) |
| `BASE_URL` | Public site URL — used for canonicals, sitemap, OG tags (e.g. `https://movixa.com`) |
| `SESSION_SECRET` | Long random string for sessions (**must change in production**) |
| `ADMIN_USERNAME` / `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeded super-admin (first run only) |
| `NODE_ENV` | `production` enables secure cookies (requires HTTPS) |
| `COOKIE_SECURE` | Set `0` to allow HTTP cookies behind non-TLS proxies |

---

## 📁 Project structure

```
server.js               # Express app: security headers, sessions, routes, errors
src/
  db.js                 # Schema, migrations, seed data
  sqlite-compat.js      # Zero-dependency wrapper over Node's built-in node:sqlite
  helpers.js            # Slugs, SEO, embeds, pagination, formatting
  middleware.js         # Auth guards, settings loader, uploads
  routes/public.js      # Homepage, catalogs, details, search, sitemap, API
  routes/admin.js       # Dashboard + all CRUD
views/
  layout.ejs            # Public layout (head/SEO/header/footer)
  partials/             # header, footer, card, breadcrumbs, pagination, share, search overlay
  pages/                # home, movies, series, details, season, episode, genre, search, static, contact, errors
  admin/                # dashboard + all management screens
public/
  css/style.css         # Public cinematic theme (mobile-first)
  css/admin.css         # Admin theme
  js/main.js            # Hero slider, carousels, search overlay, trailer modal
  js/admin.js           # Slug auto-gen, confirms, drag-reorder, tabs
  uploads/              # Uploaded media (gitignored)
data/movixa.db          # SQLite database (gitignored — back this file up!)
```

---

## 🌍 Deployment

Works on any Node host (VPS, Render, Railway, Fly.io, Coolify…). Example with PM2:

```bash
npm install --omit=dev
NODE_ENV=production BASE_URL=https://movixa.com pm2 start server.js --name movixa
```

Checklist:
- [ ] Set `SESSION_SECRET`, `BASE_URL`, strong admin password (change it in **Users** after first login)
- [ ] Serve over **HTTPS** (Caddy/Nginx/Cloudflare) — required for secure cookies
- [ ] Persist `data/movixa.db` and `public/uploads/` (volumes/backups)
- [ ] Point your domain, submit `/sitemap.xml` to Search Console
- [ ] Paste analytics snippet in **Settings → SEO**

---

## 🔒 Legal model

MOVIXA hosts no copyrighted video. Admins add titles they own or are licensed to distribute, and every **Watch** button links to the title's official external source with the source name clearly labeled. The footer, Copyright/DMCA page, and contact channels document the takedown procedure.

---

© MOVIXA — Discover. Watch. Legally.
