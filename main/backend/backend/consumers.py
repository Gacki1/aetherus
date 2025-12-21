import json
from channels.generic.websocket import AsyncWebsocketConsumer

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # Wir stecken alle User in einen Raum namens "global_chat"
        self.room_group_name = "global_chat"

        # Dem Raum beitreten
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )

        # Verbindung akzeptieren
        await self.accept()

    async def disconnect(self, close_code):
        # Aus dem Raum entfernen
        await self.channel_layer.group_discard(
            self.room_group_name,
            self.channel_name
        )

    # Nachricht vom Browser empfangen
    async def receive(self, text_data):
        data = json.loads(text_data)
        message = data['message']
        username = data.get('username', 'Gast')

        # Nachricht an die ganze Gruppe senden
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message', # Ruft die Methode unten auf
                'message': message,
                'username': username
            }
        )

    # Nachricht an den Browser senden (Broadcast)
    async def chat_message(self, event):
        message = event['message']
        username = event['username']

        # Via WebSocket zurück an den User schicken
        await self.send(text_data=json.dumps({
            'message': message,
            'username': username
        }))