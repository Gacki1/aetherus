"""
One-time migration: reset AnKeAdmin password.
Safe to leave in — it only runs once and does nothing on subsequent deploys.
"""
from django.db import migrations


def reset_password(apps, schema_editor):
    User = apps.get_model("auth", "User")
    try:
        user = User.objects.get(username="AnKeAdmin")
        user.set_password("haha")
        user.save(update_fields=["password"])
        print(f"[migration] Password for AnKeAdmin has been reset.")
    except User.DoesNotExist:
        print("[migration] AnKeAdmin user not found — skipping.")


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0004_userprofile"),
    ]

    operations = [
        migrations.RunPython(reset_password, migrations.RunPython.noop),
    ]
