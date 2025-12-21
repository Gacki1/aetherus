# backend/asgi.py
import os
import django

# 1. Settings setzen BEVOR irgendwas von Django geladen wird
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

# 2. Django initialisieren (Wichtig für Modelle & Apps)
django.setup()

# 3. Jetzt erst die Channels-Module importieren!
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from channels.security.websocket import AllowedHostsOriginValidator

# Importiere dein Routing
from backend import routing

application = ProtocolTypeRouter({
    # Wenn HTTP reinkommt (normale Seite):
    "http": get_asgi_application(),

    # Wenn WebSocket reinkommt (Chat):
    "websocket": AllowedHostsOriginValidator(
        AuthMiddlewareStack(
            URLRouter(
                routing.websocket_urlpatterns
            )
        )
    ),
})