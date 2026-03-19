from django.db import migrations, models


def upgrade_creators_to_owner(apps, schema_editor):
    """Set all group creators' role from 'admin' to 'owner'."""
    ChatGroup = apps.get_model('backend', 'ChatGroup')
    ChatGroupMembership = apps.get_model('backend', 'ChatGroupMembership')
    for group in ChatGroup.objects.all():
        ChatGroupMembership.objects.filter(
            group=group, user=group.created_by, role='admin'
        ).update(role='owner')


class Migration(migrations.Migration):

    dependencies = [
        ('backend', '0007_chat_groups'),
    ]

    operations = [
        # Add status field to ChatGroupMembership (default='accepted' so existing rows work)
        migrations.AddField(
            model_name='chatgroupmembership',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending', 'Ausstehend'),
                    ('accepted', 'Akzeptiert'),
                    ('declined', 'Abgelehnt'),
                ],
                default='accepted',
                max_length=10,
            ),
        ),
        # Add icon ImageField to ChatGroup
        migrations.AddField(
            model_name='chatgroup',
            name='icon',
            field=models.ImageField(blank=True, null=True, upload_to='group_icons/'),
        ),
        # Expand role choices to include 'owner'
        migrations.AlterField(
            model_name='chatgroupmembership',
            name='role',
            field=models.CharField(
                choices=[('owner', 'Eigentümer'), ('admin', 'Admin'), ('member', 'Mitglied')],
                default='member',
                max_length=10,
            ),
        ),
        # Upgrade existing group creators to 'owner' role
        migrations.RunPython(upgrade_creators_to_owner, migrations.RunPython.noop),
    ]
