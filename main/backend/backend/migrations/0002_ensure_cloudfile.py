"""
No-op migration. CloudFile is already created in 0001_initial.
Kept for migration chain continuity.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('backend', '0001_initial'),
    ]

    operations = []
