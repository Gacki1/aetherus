# backend/asgi.py

import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack
from channels.security.websocket import AllowedHostsOriginValidator

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'backend.settings')

# Initialisiere die Standard-Django Anwendung (für HTTP)
django_asgi_app = get_asgi_application()

# Wir importieren das Routing erst HIER, damit Django schon geladen ist
# (Das erstellen wir gleich im nächsten Schritt, daher erst mal Platzhalter)
# from backend import routing 

application = ProtocolTypeRouter({
    "http": django_asgi_app,
    # Hier kommt später der WebSocket-Teil rein:
    # "websocket": AllowedHostsOriginValidator(
    #     AuthMiddlewareStack(
    #         URLRouter(
    #             routing.websocket_urlpatterns
    #         )
    #     )
    # ),
})