import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from .models import ChatMessage, UserProfile
from django.utils.html import escape
from django.utils import timezone

# Track online users (in-memory, resets on restart)
online_users = set()


class ChatConsumer(AsyncWebsocketConsumer):

    async def connect(self):
        self.room_group_name = "global_chat"
        self.username = self.scope["user"].username if self.scope["user"].is_authenticated else None

        if not self.username:
            await self.close()
            return

        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        # Track online user
        online_users.add(self.username)
        await self.broadcast_online_count()

        # Load last 300 messages with timestamps and avatars
        recent_messages = await self.get_last_300_messages()
        for msg in recent_messages:
            await self.send(text_data=json.dumps({
                'type': 'chat_message',
                'id': msg['id'],
                'message': msg['content'],
                'username': msg['username'],
                'timestamp': msg['timestamp'],
                'avatar_url': msg['avatar_url'],
            }))

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

        # Remove from online tracking
        if self.username:
            online_users.discard(self.username)
            await self.broadcast_online_count()

    async def receive(self, text_data):
        data = json.loads(text_data)
        msg_type = data.get('type', 'chat_message')

        # --- TYPING INDICATOR ---
        if msg_type == 'typing':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_typing',
                    'username': self.username,
                }
            )
            return

        if msg_type == 'stop_typing':
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_stop_typing',
                    'username': self.username,
                }
            )
            return

        # --- DELETE MESSAGE (Admin only) ---
        if msg_type == 'delete_message':
            if self.scope["user"].is_staff:
                msg_id = data['message_id']
                await self.delete_message_from_db(msg_id)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'message_deleted',
                        'message_id': msg_id
                    }
                )
            return

        # --- NORMAL MESSAGE ---
        message = data.get('message', '')

        # Server-side message length validation
        if len(message) > 500:
            message = message[:500]

        if not message.strip():
            return

        username = self.scope["user"].username

        # Save and get timestamp + avatar
        new_msg_id, timestamp, avatar_url = await self.save_message(username, message)

        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'chat_message',
                'id': new_msg_id,
                'message': message,
                'username': username,
                'timestamp': timestamp,
                'avatar_url': avatar_url,
            }
        )

    # --- BROADCAST HANDLERS ---

    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'id': event['id'],
            'message': event['message'],
            'username': event['username'],
            'timestamp': event.get('timestamp', ''),
            'avatar_url': event.get('avatar_url', ''),
        }))

    async def message_deleted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'message_deleted',
            'message_id': event['message_id']
        }))

    async def user_typing(self, event):
        await self.send(text_data=json.dumps({
            'type': 'typing',
            'username': event['username']
        }))

    async def user_stop_typing(self, event):
        await self.send(text_data=json.dumps({
            'type': 'stop_typing',
            'username': event['username']
        }))

    async def online_count_update(self, event):
        await self.send(text_data=json.dumps({
            'type': 'online_count',
            'count': event['count']
        }))

    # --- HELPERS ---

    async def broadcast_online_count(self):
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'online_count_update',
                'count': len(online_users)
            }
        )

    # --- DATABASE ---

    @database_sync_to_async
    def save_message(self, username, message):
        user = User.objects.get(username=username)
        msg = ChatMessage.objects.create(user=user, content=message)

        # Keep max 300 messages
        if ChatMessage.objects.count() > 300:
            last_300_ids = ChatMessage.objects.order_by('-timestamp').values_list('id', flat=True)[:300]
            ChatMessage.objects.exclude(id__in=last_300_ids).delete()

        avatar_url = ''
        try:
            profile = user.profile
            if profile.avatar:
                avatar_url = profile.avatar.url
        except UserProfile.DoesNotExist:
            pass

        return msg.id, msg.timestamp.isoformat(), avatar_url

    @database_sync_to_async
    def get_last_300_messages(self):
        messages = list(ChatMessage.objects.select_related('user').order_by('timestamp')[:300])
        result = []
        # Pre-fetch all avatar URLs for these users
        user_ids = set(m.user_id for m in messages)
        profiles = {p.user_id: p for p in UserProfile.objects.filter(user_id__in=user_ids)}
        for m in messages:
            avatar_url = ''
            profile = profiles.get(m.user_id)
            if profile and profile.avatar:
                avatar_url = profile.avatar.url
            result.append({
                'id': m.id,
                'username': m.user.username,
                'content': m.content,
                'timestamp': m.timestamp.isoformat(),
                'avatar_url': avatar_url,
            })
        return result

    @database_sync_to_async
    def delete_message_from_db(self, msg_id):
        ChatMessage.objects.filter(id=msg_id).delete()
