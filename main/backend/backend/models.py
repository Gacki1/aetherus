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

class CloudFile(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="cloud_files")
    file = models.FileField(upload_to="cloud_files/%Y/%m/%d/")
    filename = models.CharField(max_length=255)
    uploaded_at = models.DateTimeField(auto_now_add=True)
    file_size = models.PositiveBigIntegerField(default=0)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f"{self.user.username} - {self.filename}"