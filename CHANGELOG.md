# Changelog

Full development history of Aetherus — all changes documented by date and phase.

**Repository:** [github.com/Gacki1/aetherus](https://github.com/Gacki1/aetherus)  
**Live:** [aetherus.net](https://aetherus.net)  
**Stats:** 335+ commits · ~15,000 lines of code · 16 pages · 8 migrations

---

## [2026-03-23] Trade Republic Connection + Learning Model Rework

TR login fully working via headless Chromium, global learning model with category-based weights.

### Trade Republic login via headless Chromium

- TR's AWS WAF blocks all non-browser HTTP clients via TLS fingerprinting (403 Forbidden)
- Solution: puppeteer-core + system Chromium for login API calls
- Browser launches for login, stays alive for 2FA verification, then closes
- Cookies extracted from Chrome and used for WebSocket auth
- TR now uses `tr_claims` (JWT) instead of `tr_session` — updated cookie extraction
- WebSocket connects with cookies + browser headers + web trading platform context
- Docker image updated with Chromium + dependencies
- Node.js upgraded from 20 to 22 (yahoo-finance2 requirement)
- `TR_PHONE`, `TR_PIN`, `TR_ADMIN_PASSWORD`, `POLYGON_API_KEY` added to docker-compose.yml

### Single global model + category-based learning

- Replaced per-user learning with one shared global model
- Everyone sees the same predictions — no confusion between users
- All users' prediction outcomes feed into a single set of weights
- Category-based learning: stocks grouped into 12 sectors (Technology, Finance, Automotive, Healthcare, Industrial, Energy, Consumer, Internet, Telecom, Real Estate, Materials, Other)
- ~50 Yahoo industries mapped to broad categories
- Category weights blended 60/40 with global for stability
- Priority: category > global > defaults
- Learning badge shows sector name when category weights are active

### Evaluation countdown timers

- User-facing: 3 progress bars in prediction history (Kurzfristig/Mittelfristig/Langfristig)
- Admin-facing: same countdown in Algorithmus-Status card
- Calculated from actual prediction recording dates (not hardcoded)
- Shows "X ausgewertet · Y weitere nötig für Lernen" progress
- Bars fill up daily as evaluation dates approach, turn green when due

### Files changed

- `main/stoxview/server/tr-client.ts` — Puppeteer-based login, tr_claims cookies, WebSocket auth
- `main/stoxview/server/routes.ts` — Category learning engine, countdown API, admin panel JS
- `main/stoxview/client/src/components/prediction-history.tsx` — Countdown UI
- `main/stoxview/client/src/lib/i18n.tsx` — Countdown translations
- `main/stoxview/Dockerfile` — Node 22 + Chromium
- `docker-compose.yml` — TR/Polygon env vars

---

## [2026-03-21] Fixes & Improvements

Various fixes and improvements following the major self-learning engine release.

### Magnitude-aware learning

- Learning engine now scores sources on direction AND magnitude accuracy
- Direction component (±0.5): did the source predict the right direction?
- Magnitude component (±0.5): how close was the predicted move to the actual move?
- Sources that consistently nail both direction and size get heavily rewarded
- Predicted estimated move (%) now stored in prediction history and displayed in UI

### Watchlist pagination

- 21 stocks per page (7 full rows of 3 columns, no empty gap)
- Page number buttons + arrow navigation with "X–Y / Z" counter
- Page resets when switching tabs or changing filters

### Prediction history fixes

- All frontend components now read `uid` param correctly (was reading `user` which doesn't exist in iframe URL)
- Auto-recording: predictions recorded for ALL watchlist stocks on every batch fetch, even from cache
- Previously only stocks you clicked on individually got history entries
- Batch prediction limit raised from 20 to 50 stocks

### Admin panel fixes

- Password validated server-side before showing dashboard (was showing broken cards on wrong password)
- Shows "Falsches Passwort" on login screen instead of Unauthorized errors

### StoxView iframe fixes

- Removed double-scroll (body + iframe both scrollable)
- Fixed iframe height: navbar is 64px not 56px, removed extra 3rem margin
- Bottom of StoxView content is now fully visible

### CI

- Bumped `actions/checkout` v4 → v5 (Node.js 20 deprecation warning)

### Files changed

- `main/stoxview/server/routes.ts` — Magnitude scoring, auto-recording, batch limit, admin auth
- `main/stoxview/client/src/pages/dashboard.tsx` — Pagination, uid param, page size
- `main/stoxview/client/src/components/prediction-history.tsx` — uid param, estimated move display
- `main/stoxview/client/src/components/price-chart.tsx` — uid param
- `main/backend/templates/stoxview.html` — Scroll + height fixes
- `.github/workflows/deploy.yml` — checkout v5

---

## [2026-03-21] Self-Learning Prediction Engine + Admin Dashboard Rework

StoxView predictions now learn from their own mistakes. The admin panel has been rebuilt as a full dashboard.

### Self-learning algorithm

- Stores raw source signals (web, analyst, Finnhub, technicals, Fear & Greed, momentum) with every prediction
- After predictions are evaluated (7/28/90 days), the learning engine analyzes which sources were accurate
- Computes adjusted source weights: conservative max ±30% shift, requires 5+ evaluated predictions
- **Global baseline**: learns from all stock outcomes across the user's watchlist
- **Per-stock overrides**: individual weight tuning when a stock has enough data (blended 70/30 with global)
- `generatePrediction()` now uses learned weights instead of hardcoded ones
- Weights persisted to JSON files (`learning-weights-{user}.json`)
- New `/api/learning-stats` endpoint for transparency

### Enhanced prediction history UI

- All predictions shown immediately (including ones still waiting for evaluation)
- Expandable rows: click to see full source signal breakdown with visual bars (-1 to +1)
- Expanded view shows all 3 timeframe signals (ST/MT/LT) with hit/miss badges
- Adaptive Learning Badge: cyan Brain icon when self-learning is active
- Expandable weight comparison: learned vs default weights per source
- 15 recent predictions (up from 10)

### Admin panel dashboard rework

- Replaced tabbed interface with single-login dashboard layout
- One password entry → full dashboard with multiple card blocks
- **Trade Republic card**: status indicator + login/2FA flow
- **Algorithmus-Status card**: learning status, 4 stat boxes (total/evaluated/with signals/recent)
- **Genauigkeit card**: 3 color-coded accuracy bars per timeframe
- **Quellen-Gewichtung card**: source weight table (default vs learned vs delta)
- **Aktien-Übersicht card**: per-stock table with expandable weight details
- Route changed from `/admin/tr` to `/admin` (old URL redirects)
- Responsive 2-column grid, auto-refresh, all text in German

### Prediction history recording fix

- **Root cause**: `/api/predict/:symbol`, `/api/predictions`, and `/api/history/:symbol` were all called without the `user=` parameter
- This caused `recordPrediction()` to use `_default` as user, so the watchlist check always failed
- All frontend API calls now correctly pass the Aetherus user ID

### Files changed

- `main/stoxview/server/routes.ts` — Learning engine, admin API, admin HTML rewrite, user param fixes
- `main/stoxview/client/src/components/prediction-history.tsx` — Full rewrite with expandable rows + learning badge
- `main/stoxview/client/src/components/price-chart.tsx` — Added user param to history endpoint
- `main/stoxview/client/src/pages/dashboard.tsx` — User param on all API calls, admin link update
- `main/stoxview/client/src/lib/i18n.tsx` — 24 new translations (learning + history)

---

## [2026-03-20] Cloud: Bulk Select + Mass Delete

Select multiple files and delete them at once.

### New features

- "☐ Auswählen" button toggles select mode with custom checkboxes
- Toolbar: Alle (select all) / Keine (deselect) / Löschen / Abbrechen
- Selected files highlighted with cyan border
- AJAX bulk delete via `/api/cloud/delete-bulk/` endpoint
- Confirmation dialog with file count
- DOM updates: removes items, updates file count + storage bar in real time

### Files changed

- `main/backend/backend/views/pages.py` — `cloud_bulk_delete_view`
- `main/backend/backend/urls.py` — Bulk delete route
- `main/backend/templates/cloud.html` — Checkboxes, toolbar HTML, JS functions
- `main/backend/static/css/cloud.css` (v6) — Toolbar + checkbox styles, responsive

---

## [2026-03-20] Cloud: Multi-File Upload with Drag & Drop

Upload multiple files at once with per-file feedback.

### New features

- Drag & drop zone accepts multiple files
- File preview list with icons, names, sizes, and remove buttons
- AJAX upload via `/api/cloud/upload/` endpoint
- Per-file success/error feedback with colored indicators
- Storage quota updates in real time after upload
- 50 MB per-file limit with client-side validation

### Files changed

- `main/backend/backend/views/pages.py` — `cloud_upload_ajax_view`
- `main/backend/backend/urls.py` — Upload route
- `main/backend/templates/cloud.html` — Upload form rewrite + AJAX JS
- `main/backend/static/css/cloud.css` (v5) — Upload preview styles

---

## [2026-03-20] Cloud: Username Search + Profile Pictures in Share Modal

Replaced the user dropdown with a live search input for sharing files.

### Changes

- Text input with autocomplete instead of select dropdown
- `/api/users/search/` endpoint with username prefix matching
- Profile pictures (or initial placeholder) shown in suggestions
- Fixed suggestion dropdown clipping (modal overflow fix)
- Added all missing share URL routes to `urls.py`

### Files changed

- `main/backend/backend/views/pages.py` — `user_search_view`, removed `all_users` from context
- `main/backend/backend/urls.py` — Share, accept, decline, remove routes
- `main/backend/templates/cloud.html` — Search input + autocomplete JS
- `main/backend/static/css/cloud.css` (v4→v5) — Autocomplete + avatar styles

---

## [2026-03-20] StoxView: Trade Republic Admin Panel + Price Providers

Trade Republic WebSocket integration for real-time prices, plus an admin panel for 2FA login.

### Trade Republic & Polygon.io price providers

- `tr-client.ts` — TR WebSocket client with `initiateLogin()` and `completeLogin()` methods
- `polygon-client.ts` — Polygon.io REST client for fallback price data
- `price-provider.ts` — Unified provider with auto-failover (TR → Polygon → Yahoo)
- Bid/Ask prices from TR real-time stream

### Admin panel

- Password-protected page at `/admin/tr` (now `/admin`)
- 3-step flow: password → initiate TR login → enter 2FA code
- Live status indicator (Verbunden/Getrennt/Warte auf 2FA)
- Dark theme matching StoxView
- Shield icon button in StoxView header, visible only when `uname=Rhulksack`

### Environment variables

| Variable | Purpose |
|---|---|
| `TR_PHONE` | Trade Republic phone number |
| `TR_PIN` | Trade Republic PIN |
| `TR_ADMIN_PASSWORD` | Admin panel password |
| `POLYGON_API_KEY` | Polygon.io free tier key |

### Files changed

- `main/stoxview/server/tr-client.ts` — New file
- `main/stoxview/server/polygon-client.ts` — New file
- `main/stoxview/server/price-provider.ts` — New file
- `main/stoxview/server/routes.ts` — Admin HTML, TR endpoints, data-sources endpoint
- `main/stoxview/client/src/pages/dashboard.tsx` — Shield admin button
- `main/backend/templates/stoxview.html` — Passes `&uname={{ user.username }}`

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
