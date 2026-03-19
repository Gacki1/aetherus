from django.db import models
from django.contrib.auth.models import User
import uuid


class UserProfile(models.Model):
    """Extended user profile with avatar."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    avatar = models.ImageField(upload_to='avatars/', null=True, blank=True)

    def __str__(self):
        return f"{self.user.username} profile"


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
    STATUS_CHOICES = [
        ('pending', 'Ausstehend'),
        ('accepted', 'Akzeptiert'),
        ('declined', 'Abgelehnt'),
    ]

    cloud_file = models.ForeignKey(CloudFile, on_delete=models.CASCADE, related_name='shares')
    token = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    shared_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='shared_files')
    shared_with = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name='received_shares',
        null=True, blank=True,
        help_text='If set, only this user sees it in their Shared tab. If null, link-only share.'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    # default='accepted' so existing shares and public links work without approval
    # Only user-targeted shares created after this migration start as 'pending'
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='accepted')

    class Meta:
        ordering = ['-created_at']
        unique_together = [('cloud_file', 'shared_with')]  # prevent duplicate shares to same user

    def __str__(self):
        target = self.shared_with.username if self.shared_with else 'link'
        return f"{self.shared_by.username} → {target}: {self.cloud_file.filename}"


# ====== Chat Groups ======

class ChatGroup(models.Model):
    """A named private chat group with multiple members."""
    name = models.CharField(max_length=100)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='created_groups')
    members = models.ManyToManyField(User, through='ChatGroupMembership', related_name='chat_groups')
    created_at = models.DateTimeField(auto_now_add=True)
    icon = models.ImageField(upload_to='group_icons/', null=True, blank=True)

    def __str__(self):
        return self.name


class ChatGroupMembership(models.Model):
    """Membership of a user in a chat group, with role and invite status."""
    STATUS_CHOICES = [('pending', 'Ausstehend'), ('accepted', 'Akzeptiert'), ('declined', 'Abgelehnt')]
    ROLE_CHOICES = [('owner', 'Eigentümer'), ('admin', 'Admin'), ('member', 'Mitglied')]
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    group = models.ForeignKey(ChatGroup, on_delete=models.CASCADE)
    role = models.CharField(max_length=10, choices=ROLE_CHOICES, default='member')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='accepted')
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'group')

    def __str__(self):
        return f"{self.user.username} in {self.group.name} ({self.role})"


class ChatGroupMessage(models.Model):
    """A message posted in a chat group."""
    group = models.ForeignKey(ChatGroup, on_delete=models.CASCADE, related_name='messages')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    content = models.TextField()
    timestamp = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['timestamp']

    def __str__(self):
        return f"{self.user.username} in {self.group.name}: {self.content[:20]}"