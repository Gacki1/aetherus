# Aetherus

A multi-purpose web platform: real-time chat, cloud storage, a stock market
viewer and account management, behind one login. Django 5.2 on Daphne, shipped
as four containers with Docker Compose, with its own self-hosted mail server.

> **Status: not currently hosted.** The containers are stopped, so
> `aetherus.net` does not answer. Everything below describes the deployment as
> it stands in this repository and on the server.

## Features

**Real-time chat.** WebSocket messaging through Django Channels, with avatars,
timestamps, a typing indicator, an online counter and automatic reconnect.

**Cloud storage.** Drag and drop upload with file preview, a 50 MB limit per
file and a 500 MB quota per user. Files can be shared by link, split into a
personal and a shared tab. Objects live in Hetzner S3.

**Dashboard.** Widgets for storage usage, file count, recent files, chat
activity and an account overview.

**Stoxview.** A stock market viewer served by a separate Node.js container
behind the same reverse proxy.

**Accounts.** Avatar upload, and changes to username, email and password.
Password reset runs by email with a token that expires after one hour.

**Interface.** Responsive, with a dropdown navigation that collapses to a
hamburger menu on small screens, and a dark 404 page with a glitch and
scanline effect.

**Hardening.** Rate limiting on the authentication endpoints, secrets kept in
an environment file outside version control, and HTTPS through Caddy.

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Django 5.2, Django Channels, Daphne (ASGI) |
| Frontend | HTML, CSS, JavaScript |
| Database | SQLite, file-backed at `main/backend/db.sqlite3` |
| Cache and channel layer | Redis 7 |
| Object storage | Hetzner S3 |
| Stock data | Node.js (Stoxview) |
| Mail | Mailcow, self-hosted |
| Reverse proxy | Caddy 2, automatic TLS |
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
  │                                                ├──▶ SQLite (bind mount)
  │                                                ├──▶ Redis
  │                                                └──▶ Hetzner S3
  │
  └─ mail.aetherus.net ──▶ Caddy ──▶ Mailcow
```

### Containers

| Container | Image or build | Purpose |
|---|---|---|
| `caddy` | `caddy:2-alpine` | Reverse proxy, TLS termination, static files |
| `backend` | `./main/backend` | Django app on Daphne |
| `stoxview` | `./main/stoxview` | Stock market data API (Node.js) |
| `aetherus-redis` | `redis:7-alpine` | Channel layer and cache |

Two networks: `aetherus-net` as an internal bridge, and the external
`mailcowdockerized_mailcow-network` so Caddy can reach the Mailcow proxy.

The `backend` container bind-mounts `./main/backend` to `/app`, so the code and
the SQLite file live on the host, not inside the image. Static files go to a
shared `static_volume` that Caddy serves directly.

## Deployment

Every push to `main` triggers a deployment through GitHub Actions:

1. SSH into the server (`/home/aetherus`)
2. `git pull origin main` and `git reset --hard origin/main`
3. `docker compose build --no-cache backend stoxview`
4. `docker compose up -d --force-recreate --remove-orphans`
5. `docker compose exec backend python manage.py makemigrations`
6. `docker compose exec backend python manage.py migrate`

The container's own start command also runs `migrate` and `collectstatic`
before launching Daphne, so a plain `docker compose up -d` is enough to bring
the stack back.

### Environment variables

All secrets live in `.env` at the project root and are never committed:

```env
EMAIL_HOST_PASSWORD=...
HETZNER_S3_ACCESS_KEY=...
HETZNER_S3_SECRET_KEY=...
HETZNER_S3_BUCKET_NAME=...
HETZNER_S3_ENDPOINT_URL=...
HETZNER_S3_REGION_NAME=...
POLYGON_API_KEY=...
FINNHUB_API_KEY=...
STOXVIEW_DATA_DIR=...
```

`DJANGO_SECRET_KEY` is read from the environment and falls back to an insecure
development default. Set it explicitly before running this in production.

### Caddy

The Caddyfile in `caddy-setup/` handles two names:

- `aetherus.net`: static files from the shared volume, the Stoxview reverse
  proxy, and Django as the fallback
- `mail.aetherus.net`: proxied to the Mailcow nginx container

Caddy obtains and renews both certificates by itself.

## Project structure

```
aetherus/
├── main/
│   ├── backend/
│   │   ├── backend/          # Django project: settings, urls, views, consumers
│   │   ├── static/           # CSS, JS, images
│   │   ├── templates/        # HTML templates
│   │   ├── db.sqlite3        # database, not in version control
│   │   ├── manage.py
│   │   └── requirements.txt
│   └── stoxview/             # Node.js stock data service
├── caddy-setup/              # Caddyfile
├── .github/workflows/        # CI/CD auto-deploy pipeline
├── docker-compose.yml
└── .env                      # secrets, not in version control
```

## Bringing it back up

```bash
cd /home/aetherus
docker compose up -d
```

Caddy publishes ports 80 and 443, so nothing else may hold them. On the current
server that matters: another site occupies both, and it has to be stopped first
or Caddy will fail to bind.
