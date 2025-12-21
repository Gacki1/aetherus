from django.urls import path
from . import consumers

websocket_urlpatterns = [
    # Wenn der Browser "ws://deine-seite/ws/chat/" aufruft,
    # kümmert sich der ChatConsumer darum.
    path('ws/chat/', consumers.ChatConsumer.as_asgi()),
]