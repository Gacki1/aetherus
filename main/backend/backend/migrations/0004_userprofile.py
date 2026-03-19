from django.conf import settings
from django.db import migrations, models, connection
import django.db.models.deletion


def create_userprofile_if_missing(apps, schema_editor):
    """Create UserProfile table using CREATE TABLE IF NOT EXISTS for safety."""
    vendor = connection.vendor
    if vendor == 'postgresql':
        schema_editor.execute("""
            CREATE TABLE IF NOT EXISTS backend_userprofile (
                id bigserial PRIMARY KEY,
                avatar varchar(100),
                user_id integer NOT NULL UNIQUE REFERENCES auth_user(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS backend_userprofile_user_id_idx ON backend_userprofile(user_id);
        """)
    else:
        schema_editor.execute("""
            CREATE TABLE IF NOT EXISTS backend_userprofile (
                id integer PRIMARY KEY AUTOINCREMENT,
                avatar varchar(100),
                user_id integer NOT NULL UNIQUE REFERENCES auth_user(id) ON DELETE CASCADE
            );
        """)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('backend', '0003_fileshare'),
    ]

    operations = [
        migrations.RunPython(create_userprofile_if_missing, noop),
    ]
