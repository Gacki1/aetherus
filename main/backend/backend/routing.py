from django.urls import path
from . import consumers

websocket_urlpatterns = [
    # Achte auf den Pfad: ws/chat/ (ohne führenden Slash, mit Slash am Ende)
    path('ws/chat/', consumers.ChatConsumer.as_asgi()),
    path('ws/chat/group/<int:group_id>/', consumers.GroupChatConsumer.as_asgi()),
]