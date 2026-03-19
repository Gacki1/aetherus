from django.db import models
from django.contrib.auth.models import User
import uuid

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


class FileShare(models.Model):
    """A share link for a cloud file. Anyone with the token can download."""
    cloud_file = models.ForeignKey(CloudFile, on_delete=models.CASCADE, related_name='shares')
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    shared_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='shared_files')
    shared_with = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='received_shares',
        null=True, blank=True,
        help_text='If set, only this user sees it in their Shared tab. If null, link-only share.'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = [('cloud_file', 'shared_with')]  # prevent duplicate shares to same user

    def __str__(self):
        target = self.shared_with.username if self.shared_with else 'link'
        return f"{self.shared_by.username} → {target}: {self.cloud_file.filename}"