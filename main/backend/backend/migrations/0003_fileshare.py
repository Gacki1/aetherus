import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('backend', '0002_ensure_cloudfile'),
    ]

    operations = [
        migrations.CreateModel(
            name='FileShare',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('token', models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('cloud_file', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='shares', to='backend.cloudfile')),
                ('shared_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='shared_files', to=settings.AUTH_USER_MODEL)),
                ('shared_with', models.ForeignKey(blank=True, help_text='If set, only this user sees it in their Shared tab. If null, link-only share.', null=True, on_delete=django.db.models.deletion.CASCADE, related_name='received_shares', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
                'unique_together': {('cloud_file', 'shared_with')},
            },
        ),
    ]
