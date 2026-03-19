"""
Local development settings — overrides production settings
to run without Docker, Redis, or external services.
"""
from .settings import *  # noqa: F401,F403

DEBUG = True
SECRET_KEY = 'dev-only-secret-key-not-for-production'

ALLOWED_HOSTS = ['*']

# Use in-memory cache instead of Redis
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
    }
}

# Use in-memory channel layer instead of Redis
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels.layers.InMemoryChannelLayer"
    }
}

# Session via DB instead of cache (since no Redis)
SESSION_ENGINE = "django.contrib.sessions.backends.db"

# Disable SSL requirements for local dev
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
SECURE_SSL_REDIRECT = False
SECURE_HSTS_SECONDS = 0

# CSRF trusted origins for local
CSRF_TRUSTED_ORIGINS = ["http://localhost:5000", "http://127.0.0.1:5000"]

# Disable email sending — print to console instead
EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

# Use local file storage (no S3)
STORAGES = {
    "default": {
        "BACKEND": "django.core.storage.InMemoryStorage",
    },
    "staticfiles": {
        "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
    },
}

# Relaxed CORS for local
CORS_ALLOW_ALL_ORIGINS = True
