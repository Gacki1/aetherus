"""
Ensure CloudFile table exists.

If 0001_initial was applied before CloudFile was added,
the table won't exist even though Django thinks it does.
"""
from django.db import migrations, connection


POSTGRES_SQL = """
CREATE TABLE IF NOT EXISTS backend_cloudfile (
    id bigserial PRIMARY KEY,
    file varchar(100) NOT NULL,
    filename varchar(255) NOT NULL,
    uploaded_at timestamp with time zone NOT NULL DEFAULT now(),
    file_size bigint NOT NULL DEFAULT 0,
    user_id integer NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS backend_cloudfile_user_id_idx ON backend_cloudfile(user_id);
"""

SQLITE_SQL = """
CREATE TABLE IF NOT EXISTS backend_cloudfile (
    id integer PRIMARY KEY AUTOINCREMENT,
    file varchar(100) NOT NULL,
    filename varchar(255) NOT NULL,
    uploaded_at datetime NOT NULL,
    file_size bigint unsigned NOT NULL DEFAULT 0,
    user_id integer NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
"""


def create_cloudfile_if_missing(apps, schema_editor):
    vendor = connection.vendor
    if vendor == 'postgresql':
        schema_editor.execute(POSTGRES_SQL)
    else:
        schema_editor.execute(SQLITE_SQL)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('backend', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(create_cloudfile_if_missing, noop),
    ]
