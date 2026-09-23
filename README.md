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

**Requirements:** Node.js 22 LTS (22.13.0 or newer within 22.x, required for `node:sqlite` without an experimental flag). No database server needed.

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

## 📺 Embedded video players

Movies can show a responsive embedded player on their page, streamed directly from the provider — **MOVIXA never downloads, copies or stores video files**.

**Workflow:** Admin → Movies → Add/Edit → **Video Source** → choose:
- **Dailymotion** — paste the Video ID (e.g. `x8abc12`) or any Dailymotion video/embed URL (`dailymotion.com`, `geo.dailymotion.com` player, `dai.ly` links all work)
- **YouTube** — paste the Video ID (e.g. `aqz-KE-bpKQ`) or any watch / embed / Shorts / `youtu.be` URL
- **Vimeo** — paste the numeric Video ID (e.g. `123456789`) or any Vimeo video / player URL
- **Google Drive** — paste the file's sharing link (`.../file/d/FILE_ID/...`), `open?id=` or `uc?id=` URL. The file must be shared as "Anyone with the link". Displayed via Drive's preview player; nothing is ever downloaded to our server
- **Custom Embed** — paste an authorized `https://` video URL from another compatible provider (watch links and full `<iframe>` snippets are accepted and normalized to a clean canonical embed URL)
- **No embedded player** — external watch-link only

Use the **Preview** button in the form to verify the player before saving. The source can be changed or removed anytime from the same form — no code edits. If the provider's player fails to load, the page shows a clear fallback message with a link to the official source instead of breaking.

**Safety:** URLs are validated server-side (HTTPS-only, approved-provider allowlist, ID extraction) and re-validated at render time; only the normalized URL is ever placed in an `iframe src` (escaped), so arbitrary scripts can never be injected. CSP `frame-src` covers YouTube, Vimeo, Dailymotion and Google Drive.

**Adding a provider:** register it in `src/video-providers.js` (`registerProvider(id, { label, hosts, extract, buildEmbed })`), add its player host to the CSP `frameSrc` list in `server.js`, and it becomes available to Custom Embed immediately.

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

### Railway runtime

`railway.json` explicitly selects the Dockerfile builder. `Dockerfile` uses
`node:22-bookworm-slim` for **both build and runtime**, installs the lockfile with
`npm ci`, and starts with `npm start` → `node --no-warnings server.js`.
The image build prints `MOVIXA runtime: v22.x.x` and checks that `node:sqlite`
loads without `--experimental-sqlite`; an incompatible runtime fails the build.
`package.json` and `package-lock.json` require `22.x`; `.nvmrc` and `.node-version`
also select 22. `nixpacks.toml` is only a fallback for Nixpacks, not used by
Railpack or this Dockerfile deployment.

To apply and verify this fix on Railway:

1. Deploy the revision containing these files. Verify the service's source
   repository/branch and root directory point to this application, and its config
   file is `/railway.json` (relative to the repository root).
2. Confirm the resolved builder is **Dockerfile**, the Dockerfile path is
   `Dockerfile`, and the start command is **`npm start`**. Remove stale Node 18
   overrides such as `RAILPACK_NODE_VERSION`, `NIXPACKS_NODE_VERSION`, or
   `NODE_VERSION`, and any custom `PATH`/start command that selects an old Node.
   The Dockerfile itself does not use those version variables.
3. Trigger a new build of that revision, not a restart of the old image. Confirm
   the build uses `node:22-bookworm-slim` and prints the runtime/SQLite checks above.
4. In the running service (`railway ssh`, not `railway run`, which runs locally),
   verify `node -v` returns `v22.x.x` and
   `node -e "require('node:sqlite'); console.log('node:sqlite OK')"` succeeds.
   Check `/healthz` returns `{"ok":true,"service":"movixa"}`.

If deployment logs still report Node 18.20.8, the service is not running the
intended Dockerfile runtime; check the deployed revision, config source and
service overrides before treating the incident as resolved. Keep existing
persistent volumes; this image stores the database at `/app/data/movixa.db`
and uploads at `/app/public/uploads/`.

### Other Node hosts

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
