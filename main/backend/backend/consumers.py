import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from .models import ChatMessage

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_group_name = "global_chat"

        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        await self.accept()

        # WENN EINER BEITRITT: Die letzten 300 Nachrichten laden und senden
        # Wir senden sie einzeln, damit dein JavaScript sie einfach "unten anhängen" kann.
        recent_messages = await self.get_last_300_messages()
        for msg in recent_messages:
            await self.send(text_data=json.dumps({
                'message': msg['content'],
                'username': msg['username']
            }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    async def receive(self, text_data):
        data = json.loads(text_data)
        message = data['message']
        username = data.get('username', 'Gast')

        # 1. Nachricht in der Datenbank speichern & aufräumen
        await self.save_message(username, message)

        # 2. An alle senden
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'message': message,
                'username': username
            }
        )

    async def chat_message(self, event):
        message = event['message']
        username = event['username']

        await self.send(text_data=json.dumps({
            'message': message,
            'username': username
        }))

    # --- DATENBANK FUNKTIONEN (Müssen synchron sein) ---

    @database_sync_to_async
    def save_message(self, username, message):
        # User finden (oder Fehler vermeiden, falls User gelöscht wurde)
        try:
            user = User.objects.get(username=username)
            ChatMessage.objects.create(user=user, content=message)
            
            # --- DIE "MAX 300" LOGIK ---
            # Wir prüfen, ob es zu viele sind.
            count = ChatMessage.objects.count()
            if count > 300:
                # Die IDs der neusten 300 Nachrichten holen
                last_300_ids = ChatMessage.objects.order_by('-timestamp').values_list('id', flat=True)[:300]
                # Alles löschen, was NICHT in dieser Liste ist (also die alten)
                ChatMessage.objects.exclude(id__in=last_300_ids).delete()
                
        except User.DoesNotExist:
            # Fallback, falls der User nicht existiert (sollte nicht passieren)
            pass

    @database_sync_to_async
    def get_last_300_messages(self):
        # Wir holen die Objekte und wandeln sie direkt in ein Format um, 
        # das wir verschicken können.
        messages = ChatMessage.objects.all().order_by('timestamp')[:300]
        return [
            {'username': msg.user.username, 'content': msg.content} 
            for msg in messages
        ]