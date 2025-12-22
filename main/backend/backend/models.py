from django.db import models
from django.contrib.auth.models import User

# ... deine anderen Modelle ...

class ChatMessage(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        # Sortiert automatisch nach Zeit (alt -> neu)
        ordering = ['timestamp']

    def __str__(self):
        return f"{self.user.username}: {self.content[:20]}"