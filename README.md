# Aetherus

Multi-purpose web platform running on [aetherus.net](https://aetherus.net), built with Django and deployed via Docker Compose with auto-deployment through GitHub Actions.

## Features

- **Dashboard** — Storage usage, file count, recent files, chat activity, and account info widgets
- **Real-time Chat** — WebSocket-based with timestamps, online user counter, typing indicators, character limit (500), and auto-reconnect
- **Cloud Storage** — Drag & drop upload, file preview, per-file limit (50 MB), per-user quota (500 MB), download button, and file type icons
- **User Profiles** — Account info with password change and toast notifications
- **Password Reset** — Email-based reset flow with time-limited tokens (1h expiry)
- **Mobile Responsive** — Hamburger menu navigation on smaller screens
- **Toast Notifications** — Success, error, info, and warning with auto-dismiss
- **Custom 404 Page** — Dark themed with glitch animation and scanline effects
- **Security** — Rate limiting on auth endpoints, environment-based secrets, proper logging

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Django 5.2, Django Channels, Daphne (ASGI) |
| Frontend | HTML, CSS, JavaScript |
| Database | PostgreSQL |
| Cache / Channels | Redis |
| File Storage | Hetzner S3 |
| Email | Mailcow (self-hosted) |
| Reverse Proxy | Caddy (automatic HTTPS) |
| Deployment | Docker Compose, GitHub Actions |

## Architecture

```
Internet
  │
  ├─ aetherus.net ──▶ Caddy ──▶ Daphne (Django ASGI)
  │                     │              │
  │                     ├─ /static ──▶ staticfiles volume
  │                     │              │
  │                     │              ├──▶ Redis (cache + channels)
  │                     │              └──▶ PostgreSQL (via .env)
  │                     │
  └─ mail.aetherus.net ──▶ Mailcow
```

## Deployment

Pushes to `main` trigger automatic deployment via GitHub Actions:

1. SSH into the server
2. `git pull origin main`
3. `docker compose build --no-cache backend`
4. `docker compose up -d --force-recreate`
5. `makemigrations` + `migrate`

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

## Project Structure

```
aetherus/
├── main/
│   ├── backend/
│   │   ├── backend/          # Django project (settings, urls, views, consumers)
│   │   ├── static/           # CSS, JS
│   │   ├── templates/        # HTML templates
│   │   ├── manage.py
│   │   └── requirements.txt
│   └── frontend/
├── caddy-setup/              # Caddy reverse proxy config
├── .github/workflows/        # CI/CD auto-deploy pipeline
└── docker-compose.yml
```
