import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from channels.auth import AuthMiddlewareStack

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

# 1. Django App initialisieren (muss zuerst passieren!)
django_asgi_app = get_asgi_application()

# 2. Jetzt erst importieren wir das Routing (sonst Fehler!)
from backend import routing

application = ProtocolTypeRouter({
    # HTTP Anfragen -> Normales Django
    "http": django_asgi_app,

    # WebSocket Anfragen -> Unsere neue Chat-Logik
    "websocket": AllowedHostsOriginValidator(
        AuthMiddlewareStack(
            URLRouter(
                routing.websocket_urlpatterns
            )
        )
    ),
})