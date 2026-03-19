# Aetherus

Multi-purpose web platform running on [aetherus.net](https://aetherus.net), built with Django and deployed via Docker Compose on an Ubuntu server.

## Features

- **Dashboard** — Storage usage, file count, recent files, chat activity, and account overview widgets
- **Real-time Chat** — WebSocket-based messaging with avatars, timestamps, typing indicators, online counter, and auto-reconnect
- **Cloud Storage** — Drag & drop upload, file preview, per-file limit (50 MB), per-user quota (500 MB), and file sharing via link (personal / shared tabs)
- **Stoxview** — Stock market viewer powered by a dedicated Node.js service
- **User Profiles** — Avatar upload, username change, email change, and password change
- **Password Reset** — Email-based reset flow with time-limited tokens (1 h expiry)
- **Mobile Responsive** — Dropdown navigation with SVG icons, hamburger menu on smaller screens
- **Custom 404 Page** — Dark themed with glitch animation and scanline effects
- **Security** — Rate limiting on auth endpoints, environment-based secrets, HTTPS via Caddy

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Django 5.2, Django Channels, Daphne (ASGI) |
| Frontend | HTML, CSS, JavaScript |
| Database | PostgreSQL |
| Cache / Channels | Redis |
| File Storage | Hetzner S3 |
| Stock Data | Node.js (Stoxview) |
| Email | Mailcow (self-hosted) |
| Reverse Proxy | Caddy (automatic HTTPS) |
| Deployment | Docker Compose, GitHub Actions |

## Architecture

```
Internet
  │
  ├─ aetherus.net ──▶ Caddy (:80/:443)
  │                     │
  │                     ├─ /static/*        ──▶ staticfiles volume
  │                     ├─ /stoxview-api/*  ──▶ Stoxview (Node.js :5000)
  │                     └─ /*               ──▶ Daphne (Django ASGI :8000)
  │                                                │
  │                                                ├──▶ PostgreSQL
  │                                                ├──▶ Redis
  │                                                └──▶ Hetzner S3
  │
  └─ mail.aetherus.net ──▶ Caddy ──▶ Mailcow
```

### Containers

| Container | Image / Build | Purpose |
|-----------|--------------|---------|
| `caddy` | `caddy:2-alpine` | Reverse proxy, TLS termination, static file serving |
| `backend` | `./main/backend` | Django app (Daphne ASGI) |
| `stoxview` | `./main/stoxview` | Stock market data API (Node.js) |
| `aetherus-redis` | `redis:7-alpine` | Channel layer + cache |

PostgreSQL is provided externally via `DATABASE_URL` in `.env`.

## Deployment

Every push to `main` triggers automatic deployment via GitHub Actions:

1. SSH into the server (`/home/aetherus`)
2. `git pull origin main` + `git reset --hard origin/main`
3. `docker compose build --no-cache backend stoxview`
4. `docker compose up -d --force-recreate --remove-orphans`
5. `docker compose exec backend python manage.py makemigrations`
6. `docker compose exec backend python manage.py migrate`

### Environment Variables

Configure via `.env` at the project root:

```env
SECRET_KEY=...
DEBUG=False
DATABASE_URL=...
HETZNER_S3_ACCESS_KEY=...
HETZNER_S3_SECRET_KEY=...
HETZNER_S3_BUCKET_NAME=...
HETZNER_S3_ENDPOINT=...
```

### Caddy

The Caddyfile in `caddy-setup/` handles:

- **aetherus.net** — static files from the shared volume, Stoxview reverse proxy, and Django fallback
- **mail.aetherus.net** — proxies to the Mailcow Nginx container

Caddy manages TLS certificates automatically.

## Project Structure

```
aetherus/
├── main/
│   ├── backend/
│   │   ├── backend/          # Django project (settings, urls, views, consumers)
│   │   ├── static/           # CSS, JS, images
│   │   ├── templates/        # HTML templates
│   │   ├── manage.py
│   │   └── requirements.txt
│   └── stoxview/             # Node.js stock data service
├── caddy-setup/              # Caddyfile
├── .github/workflows/        # CI/CD auto-deploy pipeline
└── docker-compose.yml
```
