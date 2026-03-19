import uuid
from django.conf import settings
from django.db import migrations, models, connection
import django.db.models.deletion


def create_fileshare_if_missing(apps, schema_editor):
    """Create FileShare table using CREATE TABLE IF NOT EXISTS for safety."""
    vendor = connection.vendor
    if vendor == 'postgresql':
        schema_editor.execute("""
            CREATE TABLE IF NOT EXISTS backend_fileshare (
                id bigserial PRIMARY KEY,
                token uuid NOT NULL UNIQUE,
                created_at timestamp with time zone NOT NULL DEFAULT now(),
                cloud_file_id bigint NOT NULL REFERENCES backend_cloudfile(id) ON DELETE CASCADE,
                shared_by_id integer NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
                shared_with_id integer REFERENCES auth_user(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS backend_fileshare_token_idx ON backend_fileshare(token);
            CREATE INDEX IF NOT EXISTS backend_fileshare_cloud_file_id_idx ON backend_fileshare(cloud_file_id);
            CREATE INDEX IF NOT EXISTS backend_fileshare_shared_by_id_idx ON backend_fileshare(shared_by_id);
            CREATE INDEX IF NOT EXISTS backend_fileshare_shared_with_id_idx ON backend_fileshare(shared_with_id);
            CREATE UNIQUE INDEX IF NOT EXISTS backend_fileshare_file_user_uniq
                ON backend_fileshare(cloud_file_id, shared_with_id)
                WHERE shared_with_id IS NOT NULL;
        """)
    else:
        schema_editor.execute("""
            CREATE TABLE IF NOT EXISTS backend_fileshare (
                id integer PRIMARY KEY AUTOINCREMENT,
                token char(32) NOT NULL UNIQUE,
                created_at datetime NOT NULL,
                cloud_file_id bigint NOT NULL REFERENCES backend_cloudfile(id) ON DELETE CASCADE,
                shared_by_id integer NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
                shared_with_id integer REFERENCES auth_user(id) ON DELETE CASCADE
            );
        """)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('backend', '0002_ensure_cloudfile'),
    ]

    operations = [
        migrations.RunPython(create_fileshare_if_missing, noop),
    ]
