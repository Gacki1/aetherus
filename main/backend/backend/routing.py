from django.urls import path
from . import consumers

websocket_urlpatterns = [
    # Achte auf den Pfad: ws/chat/ (ohne führenden Slash, mit Slash am Ende)
    path('ws/chat/', consumers.ChatConsumer.as_asgi()),
]