import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from .models import ChatMessage

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_group_name = "global_chat"
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        # Letzte 300 Nachrichten laden (jetzt MIT ID!)
        recent_messages = await self.get_last_300_messages()
        for msg in recent_messages:
            await self.send(text_data=json.dumps({
                'type': 'chat_message',
                'id': msg['id'],
                'message': msg['content'],
                'username': msg['username']
            }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get('type', 'chat_message')

        # --- FALL 1: NACHRICHT LÖSCHEN (Nur Admin) ---
        if msg_type == 'delete_message':
            # Sicherheits-Check: Ist der User wirklich Admin?
            if self.scope["user"].is_staff:
                msg_id = data['message_id']
                await self.delete_message_from_db(msg_id)
                
                # An alle senden: "Löscht diese ID!"
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'message_deleted', # Ruft unten die Methode auf
                        'message_id': msg_id
                    }
                )
            return

        # --- FALL 2: NORMALE NACHRICHT SENDEN ---
        message = data['message']
        username = self.scope["user"].username

        # Nachricht speichern und ID zurückbekommen
        new_msg_id = await self.save_message(username, message)

        # An alle senden
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'id': new_msg_id,
                'message': message,
                'username': username
            }
        )

    # --- HANDLER FÜR BROADCASTS ---

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'id': event['id'],
            'message': event['message'],
            'username': event['username']
        }))

    async def message_deleted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_deleted',
            'message_id': event['message_id']
        }))

    # --- DATENBANK FUNKTIONEN ---

    @database_sync_to_async
    def save_message(self, username, message):
        user = User.objects.get(username=username)
        msg = ChatMessage.objects.create(user=user, content=message)
        
        # Max 300 Logik
        if ChatMessage.objects.count() > 300:
            last_300_ids = ChatMessage.objects.order_by('-timestamp').values_list('id', flat=True)[:300]
            ChatMessage.objects.exclude(id__in=last_300_ids).delete()
            
        return msg.id  # Wichtig: Wir brauchen die ID zurück

    @database_sync_to_async
    def get_last_300_messages(self):
        messages = ChatMessage.objects.all().order_by('timestamp')[:300]
        # Wir geben jetzt auch die ID mit zurück
        return [{'id': m.id, 'username': m.user.username, 'content': m.content} for m in messages]

    @database_sync_to_async
    def delete_message_from_db(self, msg_id):
        ChatMessage.objects.filter(id=msg_id).delete()