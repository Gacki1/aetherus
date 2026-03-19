from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("backend", "0005_reset_ankeadmin_pw"),
    ]

    operations = [
        migrations.AddField(
            model_name="fileshare",
            name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Ausstehend"),
                    ("accepted", "Akzeptiert"),
                    ("declined", "Abgelehnt"),
                ],
                default="accepted",
                max_length=10,
            ),
        ),
    ]
