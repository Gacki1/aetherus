# Aetherus

A multi-purpose web platform built with Django, featuring real-time chat, cloud file storage, user authentication, and a responsive dashboard.

## Features

- **Dashboard** — Storage usage bar, file count, recent files, chat activity, and account info widgets
- **Real-time Chat** — WebSocket-based with timestamps, online user counter, typing indicators, character limit (500), and auto-reconnect
- **Cloud Storage** — Drag & drop upload, file preview, per-file limit (50 MB), per-user quota (500 MB) with progress bar, download button, and file type icons
- **User Profiles** — Account info display with password change functionality and toast notifications
- **Password Reset** — Email-based reset flow with time-limited tokens (1 hour expiry)
- **Mobile Responsive** — Hamburger menu navigation on smaller screens
- **Toast Notifications** — Success, error, info, and warning toasts with auto-dismiss
- **Custom 404 Page** — Dark themed with glitch animation and scanline effects
- **Security** — Rate limiting on login (5/5min), register (3/hr), password reset (3/hr), environment-based secrets, no debug statements
- **Production Ready** — Docker Compose, Caddy reverse proxy, Daphne ASGI, Redis, Hetzner S3 storage, mailcow email

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Django 5.2, Django Channels, Daphne (ASGI) |
| Frontend | HTML, CSS, JavaScript (no framework) |
| Database | PostgreSQL (production), SQLite (local dev) |
| Cache / Channels | Redis (production), In-Memory (local dev) |
| File Storage | Hetzner S3 (production), In-Memory (local dev) |
| Reverse Proxy | Caddy |
| Deployment | Docker Compose, GitHub Actions |

## Quick Start (Local Development)

### Windows
Double-click `start_local.bat` — everything is set up automatically.

### Linux / Mac
```bash
chmod +x start_local.sh
./start_local.sh
```

The script creates a virtual environment, installs dependencies, runs migrations, creates test users, and starts the dev server on `http://localhost:8000`.

**Test accounts:**
| User | Password | Role |
|------|----------|------|
| `admin` | `admin123` | Superuser |
| `testuser` | `test1234` | Regular user |

> See [LOCAL_SETUP.md](LOCAL_SETUP.md) for manual setup instructions and details about the local dev configuration.

## Production Deployment

The production stack uses Docker Compose with:
- **Caddy** as reverse proxy with automatic HTTPS
- **Daphne** as ASGI server for WebSocket support
- **Redis** for caching and channel layers
- **PostgreSQL** for the database
- **Hetzner S3** for file storage

```bash
# Configure environment variables
cp .env.example .env
# Edit .env with your production values

# Start all services
docker-compose up -d
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
│   └── frontend/             # Frontend entry point
├── caddy-setup/              # Caddy reverse proxy config
├── .github/workflows/        # CI/CD pipeline
├── docker-compose.yml
├── start_local.bat           # Windows one-click launcher
├── start_local.sh            # Linux/Mac one-click launcher
├── LOCAL_SETUP.md            # Detailed local setup guide
└── README.md
```

## License

Private project.
