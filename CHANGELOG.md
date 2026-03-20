# Changelog

Full development history of Aetherus — all changes documented by date and phase.

**Repository:** [github.com/Gacki1/aetherus](https://github.com/Gacki1/aetherus)  
**Live:** [aetherus.net](https://aetherus.net)  
**Stats:** 311 commits · ~10,000 lines of code · 16 pages · 8 migrations

---

## [2026-03-20] Subdomain Routing & Start Page Rework

Cloud and StoxView are now accessible via dedicated subdomains. The start page has been redesigned with a service catalog.

### Subdomain routing

- **cloud.aetherus.net** — direct access to Cloud-Speicher
- **stoxview.aetherus.net** — direct access to StoxView
- Caddy reverse proxy entries added for both subdomains
- Session cookies shared across all `*.aetherus.net` subdomains (`SESSION_COOKIE_DOMAIN`)
- Unauthenticated subdomain visitors redirect to `aetherus.net/login?next=...` and return after login
- Removed `django-hosts` dependency — subdomain routing handled via simple host detection in views and middleware

### Start page redesign

- Fixed top bar with Aetherus logo, name, Login/Registrieren buttons
- Service cards for Cloud-Speicher, StoxView, and Echtzeit-Chat
- Each card links to its subdomain (or login for chat)
- Animated background glows retained, responsive layout

### Navigation changes

- Removed Cloud and StoxView from the main nav dropdown menu
- Added "Dienste" (Services) section in nav dropdown with external links to `cloud.aetherus.net` and `stoxview.aetherus.net`
- External link icon (↗) shown next to service links
- Removed Cloud-Speicher from user dropdown menu

### Files changed

`caddy-setup/Caddyfile` · `settings.py` · `urls.py` · `views/pages.py` · `middleware.py` · `base.html` · `main.html` · `editor.html` · `start.html` · `start.css` · `dashboard.css` · `login.js` · `requirements.txt`

---

## [2026-03-20] Faster Price Refresh, Delayed Badge & Bid/Ask Display

Stock prices now refresh much faster and clearly indicate when data is delayed.

### Cache TTL reductions

| Data | Old TTL | New TTL |
|------|---------|---------|
| Individual stock prediction | 3 min | 60 sec |
| Batch predictions | 3 min | 60 sec |
| Market summary | 3 min | 60 sec |
| Browse page | 5 min | 90 sec |
| German stock quotes | 5 min | 90 sec |
| Client auto-refresh | 5 min | 60 sec |

### Delayed price badge

A badge now appears next to every stock price showing the market state:
- **Verzögert** — during regular hours (Yahoo data is ~15 min delayed)
- **Nachbörslich** — after XETRA closes (17:30 CET)
- **Vorbörslich** — before market opens
- **Markt geschlossen** — weekends/holidays

### Bid/Ask prices

When Yahoo provides bid/ask data, it's displayed alongside the O/H/L row:
- **Geld** (Bid) / **Brief** (Ask) shown in the stock detail view
- Values are converted to EUR like all other prices
- Visible in both normal sidebar and expanded layout

### Files changed

- `main/stoxview/server/routes.ts` — Cache TTL reductions, added marketState/bid/ask to prediction output
- `main/stoxview/shared/schema.ts` — Added `marketState`, `bidPrice`, `askPrice` fields
- `main/stoxview/client/src/components/stock-detail.tsx` — Delayed badge + bid/ask display
- `main/stoxview/client/src/lib/i18n.tsx` — 6 new translations (DE + EN)
- `main/stoxview/client/src/pages/dashboard.tsx` — 60s auto-refresh interval

---

## [2026-03-20] ISIN Resolution Fixes

Complete rewrite of ISIN (International Securities Identification Number) resolution through 5 iterations.

### Evolution

| Version | Approach | Issue |
|---------|----------|-------|
| 1 | DuckDuckGo Regex scraping | All stocks returned same ISIN |
| 2 | + Luhn checksum validation | Better validation, still wrong ISINs |
| 3 | + Exchange→Country mapping | Filtered by expected country (XETRA→DE), still errors |
| 4 | onvista.de structured API | Replaced HTML scraping entirely — much better |
| 5 | Blocking + suffix strip | Instant loading, .DE/.F/.L suffix removal |

### Technical details (final solution)

- **API:** `https://api.onvista.de/api/v1/instruments/search?searchValue=...`
- **baseTicker:** Strips `.DE`, `.F`, `.L`, `.SW`, `.TO` suffixes from Yahoo tickers
- **EXCHANGE_TO_ISIN_COUNTRY:** Maps exchanges to expected ISIN country (XETRA→DE, NYSE→US, etc.)
- **INDEX_ISINS blocklist:** Known index ISINs ignored (e.g. DAX `DE0008469008`)
- **homeSymbol matching:** Compares against baseTicker for accuracy
- **Parallel resolution in Phase 2** (blocking, not fire-and-forget)

### Files changed

- `main/stoxview/server/routes.ts` — Complete ISIN logic rewrite
- 5 commits: `e240a82c`, `5f557cef`, `634ab7f1`, `7b2b31d2`, `bc15d9ca`

---

## [2026-03-19] Browse Card/Table View Toggle

Added card view as alternative to table view on the browse page.

### New features

- Toggle buttons (LayoutGrid / LayoutList icons) for card and table view
- `browseViewMode` state in dashboard
- Card grid shows: symbol, name, price, change, volume, avg volume, 52W high, 52W low, market cap
- i18n translations: `browse.viewTable`, `browse.viewCards`, `browse.marketCap`, `browse.52wHigh`, `browse.52wLow`, `browse.avgVolume` (DE + EN)

### Files changed

- `main/stoxview/client/src/pages/dashboard.tsx`
- `main/stoxview/client/src/lib/i18n.tsx`

---

## [2026-03-19] Replace Alpha Vantage with Self-Calculated Technicals

Alpha Vantage API was too restrictive (rate limits). Replaced with self-calculated technical indicators.

### New indicators

- **RSI** (Relative Strength Index) — 14-day calculation
- **MACD** (Moving Average Convergence Divergence)
- **SMA 20 / SMA 50** (Simple Moving Averages)
- 30-minute cache (`techCache` Map)
- Prediction cache key prefix: `v4:`

### Files changed

- `main/stoxview/server/routes.ts` — 103 insertions, 94 deletions
- `docker-compose.yml` — Removed Alpha Vantage API key

---

## [2026-03-19] API Rate Limiting

Added rate limiting for external API calls to prevent quota exhaustion.

### Changes

- **Finnhub:** 30 calls/second, queue-based throttling
- **Yahoo Finance:** 5 parallel calls max, then wait
- Cache key versioning: `v4:` prefix for invalidation

### Files changed

- `main/stoxview/server/routes.ts`

---

## [2026-03-19] Multi-Source Predictions

Expanded stock predictions from single-source (web sentiment) to 5 weighted sources.

### Source weights

| Source | Weight | Description |
|--------|--------|-------------|
| Web Sentiment | 25% | News analysis |
| Analyst Data | 25% | Finnhub analyst consensus |
| Finnhub News | 20% | Finnhub news sentiment |
| Technical Indicators | 20% | RSI, MACD, SMA (self-calculated) |
| Fear & Greed Index | 10% | CNN Fear & Greed Index |

### Additional features

- Prediction history (`prediction-history.tsx`)
- Estimated price move displayed as percentage
- Color-coded display (green/red)

### Files changed

- `main/stoxview/server/routes.ts` — 392 insertions
- `main/stoxview/client/src/components/stock-detail.tsx`
- `main/stoxview/client/src/lib/i18n.tsx`
- `main/stoxview/shared/schema.ts`

---

## [2026-03-19] Cloud Storage Real-Time Updates

Storage bar now updates immediately after file deletion (no page reload needed).

### Files changed

- `main/backend/templates/cloud.html`

---

## [2026-03-19] StoxView Signal Fixes & Stable User ID

Fixed race condition in StoxView signals/sentiment and stabilized user ID for watchlist binding.

### Files changed

- `main/stoxview/server/routes.ts`
- `main/backend/templates/stoxview.html`

---

## [2026-03-19] Real-Time Cloud UI, Group Icons, Invites & Hierarchy

Major chat and cloud feature push (1,465 insertions, 9 files).

### Chat groups

- Create, join, leave groups
- Group chat with custom icon (upload)
- Invite system with accept/decline
- Hierarchy: Owner → Admin → Member
- Only owner can delete group
- Migrations: `0007_chat_groups.py`, `0008_group_invite_and_icon.py`

### Cloud improvements

- File sharing with approval system (accept/decline)
- Real-time storage bar updates after delete
- `FileShare` model with status field (migration `0006_fileshare_status.py`)

### Files changed

- `main/backend/static/css/chat.css` (v6) — 280+ new lines
- `main/backend/static/js/chat.js` (v5) — 484+ new lines
- `main/backend/templates/chat.html`, `cloud.html`
- `main/backend/backend/models.py`
- `main/backend/backend/views/pages.py`
- `main/backend/backend/migrations/0006–0008`

---

## [2026-03-19] Chat Groups, Cloud Sharing, SEO, Password Reset Fix

Broad feature and fix commit (1,676 insertions, 14 files).

### New features

- Group chat (create, join, leave, delete)
- Cloud file sharing with approval workflow
- Counter fix for chat messages
- SEO improvements
- Password reset flow fixed
- Username uniqueness enforced

### Files changed

- `main/backend/templates/chat.html`, `cloud.html`, `password_reset.html`, `start.html`
- `main/backend/static/css/chat.css`, `cloud.css`
- `main/backend/static/js/chat.js`
- `main/backend/backend/models.py`, `views/pages.py`

---

## [2026-03-19] Logo & Branding Redesign

Complete visual rebranding with new logo, favicon, and SVG icons.

### Changes

- New Aetherus logo (`logo.png`, `logo-192.png`, `favicon-32.png`, `favicon.ico`)
- Transparent background for logo
- SVG icons for navigation menu
- Start page redesign with animations
- `README.md` completely rewritten (server-focused)

### Files changed

- `main/backend/static/img/` — All logo and favicon files
- `main/backend/templates/start.html` — Redesigned
- `README.md`

---

## [2026-03-19] StoxView Integration

Full stock market prediction module as a standalone Node.js service.

### New module: `/main/stoxview/`

- Node.js + Express + Vite + React/TypeScript
- `stoxview.html` — Embed page in Django frontend
- Yahoo Finance API integration for real-time prices
- Stock search, detail view with charts (Recharts)
- Price prediction based on web sentiment analysis
- Per-user watchlist bound to Aetherus login
- Browse page with market overview (Top Gainers, Losers, Most Active)
- i18n support (German and English)

### Files added

- `main/stoxview/server/routes.ts` — API server
- `main/stoxview/client/src/pages/dashboard.tsx` — Main UI
- `main/stoxview/client/src/components/` — stock-detail, stock-card, price-chart, market-overview, prediction-history
- `main/stoxview/client/src/lib/i18n.tsx` — Internationalization
- `main/stoxview/shared/schema.ts` — TypeScript types
- `main/stoxview/Dockerfile`

---

## [2026-03-19] Profile Pictures in Chat

Chat messages now display the sender's profile picture.

### Files changed

- `main/backend/templates/chat.html`
- `main/backend/static/css/chat.css`
- `main/backend/static/js/chat.js`
- `main/backend/backend/views/pages.py`

---

## [2026-03-19] Username & Email Change

Users can change their username and email from the profile page.

### Files changed

- `main/backend/templates/profile.html`
- `main/backend/backend/views/auth.py`

---

## [2026-03-19] Profile Picture Upload & Dropdown Navigation

- Profile picture upload functionality
- User dropdown menu in the top navigation bar
- Navigation bar polish (removed separator line, cleaned up dashboard widgets)
- `UserProfile` model with migration (`0004_userprofile.py`)

### Files changed

- `main/backend/templates/profile.html`, `main.html`
- `main/backend/static/css/profile.css`
- `main/backend/backend/models.py`
- `main/backend/backend/migrations/0004_userprofile.py`

---

## [2026-03-19] Cloud File Sharing

Added file sharing with sidebar tabs, share modal, and public download links.

### Files changed

- `main/backend/templates/cloud.html`, `shared_download.html`
- `main/backend/backend/models.py`
- `main/backend/backend/migrations/0003_fileshare.py`

---

## [2026-03-19] In-App File Editor

Cloud storage files can now be edited directly in the browser.

### Files added

- `main/backend/templates/editor.html`
- `main/backend/static/css/editor.css`

---

## [2026-03-19] Fix: Chat 'undefined' Messages

Fixed issue where some chat messages displayed 'undefined'.

### Files changed

- `main/backend/static/js/chat.js`
- `main/backend/backend/consumers.py`

---

## [2026-03-19] Fix: Missing DB Tables

Added migration to ensure CloudFile table exists and handled missing tables gracefully.

### Files changed

- `main/backend/backend/migrations/0002_ensure_cloudfile.py`
- `main/backend/backend/models.py`

---

## [2026-03-17] Major Feature Update

After 2 months pause — massive feature addition (2,888 insertions, 32 files).

### Cloud storage

- Cloud storage with Hetzner Object Storage (S3-compatible)
- `cloud.html` — File upload, download, and management
- `cloud.css` — Complete cloud design
- `CloudFile` model in Django with migrations

### New deployment pipeline

- GitHub Actions with `appleboy/ssh-action` (SSH to server)
- `git pull` → `docker compose build --no-cache` → `docker compose up -d`

### Files changed

- `main/backend/templates/cloud.html`
- `main/backend/static/css/cloud.css`
- `main/backend/backend/models.py`
- `.github/workflows/deploy.yml` — Rewritten
- `docker-compose.yml` — Hetzner S3 config

---

## [2026-03-17] Hetzner Object Storage Setup

Initial setup for cloud storage with Hetzner S3-compatible object storage.

### Files changed

- `docker-compose.yml`
- `main/backend/backend/settings.py`

---

## [2026-01-10] Optimization (Reverted)

Attempted file optimizations, immediately reverted due to issues.

- Commit: `393568ac` — Optimized some files
- Revert: `0b84d6a3` — Revert "Optimized some files"

---

## [2025-12-31] Maintenance Fixes

- File arrangement fixes
- JavaScript fixes
- **XSS protection in chat messages**

### Files changed

- `main/backend/static/js/chat.js`
- `main/backend/templates/chat.html`

---

## [2025-12-22] Chat Enhancements

- Maximum chat message limit implemented
- Admin chat message delete functionality

### Files changed

- `main/backend/backend/consumers.py`
- `main/backend/templates/chat.html`
- `main/backend/static/js/chat.js`

---

## [2025-12-21] Chat System & Dashboard

Complete real-time chat system and dashboard redesign.

### Chat system

- `chat.html` — Full chat interface
- WebSocket integration with Django Channels
- `consumers.py` and `routing.py` for WebSocket handling
- `chat.js` and `chat.css` for frontend
- Split `views.py` into separate modules (`views/auth.py`, `views/pages.py`)

### Dashboard

- `main.html` redesign as post-login dashboard
- `dashboard.css` for styling
- Multiple layout iterations

### Files changed

- `main/backend/templates/main.html`, `chat.html`
- `main/backend/static/css/dashboard.css`, `chat.css`
- `main/backend/static/js/chat.js`
- `main/backend/backend/consumers.py`, `routing.py`
- `main/backend/backend/views/` — New module structure

---

## [2025-12-15 – 2025-12-18] Caddy Migration & Mailserver

Switched from Nginx to Caddy as reverse proxy and integrated a full mailserver.

### Infrastructure changes

- Full switch from Nginx to Caddy — automatic HTTPS via Let's Encrypt
- Caddyfile configuration for all routes
- Mailcow / Docker Mailserver configuration
- Static files — resolved `collectstatic` issues
- Django admin panel customization

### Files changed

- `caddy-setup/Caddyfile`
- `docker-compose.yml`
- `main/backend/backend/settings.py`

---

## [2025-12-14] Email Verification

Email verification system for account activation.

### Changes

- `ActivateAccountView` for email confirmation
- Docker Mailserver integration
- Environment variables for email configuration
- Multiple bugfixes for email sending and account activation

### Files changed

- `main/backend/backend/views.py`
- `docker-compose.yml`
- `main/backend/backend/settings.py`

---

## [2025-12-13] Authentication & Registration

Full auth system: registration, login, logout, email verification, session management.

### New features

- `start.html` as new landing page
- `register.html` with registration form
- Switched to Djoser for login/registration handling
- Redis integration for session management
- Session-based authentication (replaced token-based)
- Auto-logout on session expiry
- Logout button on dashboard
- `.gitignore` added (excluded SQLite database)

### Design

- `register.css` — Registration page design
- Redesign of `start.html` and `login.html`

### Files changed

- `main/backend/templates/start.html`, `register.html`, `login.html`, `main.html`
- `main/backend/static/css/register.css`, `start.css`, `login.css`
- `main/backend/static/js/register.js`, `login.js`
- `main/backend/backend/views.py`, `urls.py`, `settings.py`
- `docker-compose.yml` (Redis)

---

## [2025-12-12] Django Backend & Auth Setup

Initial backend setup with Django REST Framework authentication.

### Infrastructure

- Docker Compose setup with Nginx as reverse proxy
- GitHub Actions deployment workflow (`deploy.yml`) — multiple iterations
- Nginx configuration for static files and proxy routing

### Django backend

- Login backend with Django REST Framework (DRF)
- HttpOnly cookies and token refresh mechanism
- "Remember Me" functionality
- Django settings configured (SECRET_KEY, ALLOWED_HOSTS, CORS)
- Folder structure split into `frontend/` and `backend/`

### Files changed

- `docker-compose.yml`, `nginx.conf`, `deploy.yml`
- `main/backend/backend/settings.py`, `urls.py`, `views.py`
- `main/backend/templates/login.html`
- `main/backend/static/js/login.js`, `css/login.css`

---

## [2025-12-11] Initial Commit

Project creation.

- `index.html` — First landing page
- Docker files and Caddyfile
- Nginx configuration
- `docker-compose.yml`

---

## Database Migrations

| # | Migration | Description |
|---|-----------|-------------|
| 0001 | `initial` | Base tables (Django Auth, Sessions) |
| 0002 | `ensure_cloudfile` | CloudFile table |
| 0003 | `fileshare` | FileShare model (file sharing) |
| 0004 | `userprofile` | UserProfile with profile picture |
| 0005 | `reset_ankeadmin_pw` | Admin password reset (make_password) |
| 0006 | `fileshare_status` | Status field for FileShare (accept/decline) |
| 0007 | `chat_groups` | ChatGroup, GroupMembership models |
| 0008 | `group_invite_and_icon` | GroupInvite + icon upload |

---

## Commit Summary by Day

| Date | Commits | Summary |
|------|---------|---------|
| 2025-12-11 | 6 | Initial commit, index.html, Docker, Caddyfile, Nginx |
| 2025-12-12 | 62 | deploy.yml, login backend, Django setup, DRF auth, token refresh, remember me |
| 2025-12-13 | 52 | Djoser, Redis, sessions, registration, start/login design, email verification |
| 2025-12-14 | 12 | Email verification fixes, Docker Mailserver, environment variables |
| 2025-12-15 | 26 | Caddy migration, Mailcow, admin panel design, various fixes |
| 2025-12-16 | 17 | Docker, Caddyfile, routing fixes |
| 2025-12-18 | 18 | Mailserver config, static files, various fixes |
| 2025-12-19 | 2 | Fixes |
| 2025-12-21 | 26 | Complete chat system, WebSocket, dashboard update, redirects |
| 2025-12-22 | 4 | Chat limits, admin delete, fixes |
| 2025-12-31 | 3 | File structure, JS fixes, XSS protection chat |
| 2026-01-10 | 2 | Optimization attempt (reverted) |
| 2026-03-17 | 5 | Hetzner storage, cloud files, new deploy pipeline |
| 2026-03-19 | 52 | Major update: cloud, profile, StoxView, logo, chat groups, sharing, predictions, rate limits, technicals |
| 2026-03-20 | 4 | ISIN fixes, faster price refresh, delayed badge, bid/ask display |
