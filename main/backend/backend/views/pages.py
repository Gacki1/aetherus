from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView
from django.shortcuts import redirect, render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.views.decorators.csrf import ensure_csrf_cookie
from django.contrib import messages
from django.db.models import Sum, Count
from django.conf import settings
from django.http import JsonResponse
from django.core.files.base import ContentFile
from django.contrib.auth.models import User
from django.db import models as db_models
from ..models import CloudFile, ChatMessage, FileShare, UserProfile, ChatGroup, ChatGroupMembership
import logging
import json
import uuid

logger = logging.getLogger(__name__)


class DashboardView(LoginRequiredMixin, TemplateView):
    template_name = "main.html"
    login_url = "/login"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        user = self.request.user
        storage_limit = settings.MAX_CLOUD_STORAGE_PER_USER

        # Cloud storage stats (graceful if table doesn't exist yet)
        try:
            cloud_files = CloudFile.objects.filter(user=user)
            total_storage = cloud_files.aggregate(total=Sum('file_size'))['total'] or 0
            storage_percent = round((total_storage / storage_limit) * 100, 1) if storage_limit > 0 else 0
            recent_files = list(cloud_files[:5])
            cloud_file_count = cloud_files.count()
        except Exception:
            logger.warning("CloudFile table not available — run migrations")
            total_storage = 0
            storage_percent = 0
            recent_files = []
            cloud_file_count = 0

        # Chat stats (graceful if table doesn't exist yet)
        try:
            user_message_count = ChatMessage.objects.filter(user=user).count()
            total_message_count = ChatMessage.objects.count()
        except Exception:
            logger.warning("ChatMessage table not available — run migrations")
            user_message_count = 0
            total_message_count = 0

        context.update({
            'cloud_file_count': cloud_file_count,
            'cloud_storage_used': total_storage,
            'cloud_storage_limit': storage_limit,
            'cloud_storage_percent': min(storage_percent, 100),
            'recent_files': recent_files,
            'user_message_count': user_message_count,
            'total_message_count': total_message_count,
        })
        return context


@ensure_csrf_cookie
def login_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "login.html")


@login_required(login_url='/login')
def chat_page_view(request):
    try:
        user_groups = list(
            ChatGroup.objects.filter(
                chatgroupmembership__user=request.user,
                chatgroupmembership__status='accepted'
            ).values('id', 'name').order_by('name')
        )
    except Exception:
        user_groups = []
    return render(request, "chat.html", {'user_groups': user_groups})


def start_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "start.html")


def register_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "register.html")


@login_required(login_url='/login')
def cloud_page_view(request):
    user = request.user
    storage_limit = settings.MAX_CLOUD_STORAGE_PER_USER

    try:
        if request.method == "POST":
            action = request.POST.get("action")

            if action == "upload":
                uploaded_file = request.FILES.get("file")
                if uploaded_file:
                    # Check file size limit (50 MB per file)
                    if uploaded_file.size > settings.DATA_UPLOAD_MAX_MEMORY_SIZE:
                        messages.error(request, "Datei ist zu groß. Maximum: 50 MB pro Datei.")
                        return redirect("cloud")

                    # Check storage quota
                    current_usage = CloudFile.objects.filter(user=user).aggregate(
                        total=Sum('file_size'))['total'] or 0
                    if current_usage + uploaded_file.size > storage_limit:
                        messages.error(request, "Speicherlimit erreicht. Lösche zuerst einige Dateien.")
                        return redirect("cloud")

                    CloudFile.objects.create(
                        user=user,
                        file=uploaded_file,
                        filename=uploaded_file.name,
                        file_size=uploaded_file.size
                    )
                    messages.success(request, f"Datei \"{uploaded_file.name}\" wurde hochgeladen.")
                else:
                    messages.error(request, "Keine Datei zum Hochladen ausgewählt.")

            elif action == "delete":
                file_id = request.POST.get("file_id")
                if file_id:
                    cloud_file = get_object_or_404(CloudFile, id=file_id, user=user)
                    cloud_file.file.delete(save=False)
                    cloud_file.delete()
                    messages.success(request, f"Datei \"{cloud_file.filename}\" wurde gelöscht.")

            return redirect("cloud")

        # GET request - determine active tab
        tab = request.GET.get('tab', 'personal')

        user_files = CloudFile.objects.filter(user=user)
        total_storage = user_files.aggregate(total=Sum('file_size'))['total'] or 0
        storage_percent = round((total_storage / storage_limit) * 100, 1) if storage_limit > 0 else 0

        # Get shared files (files others shared with me) — pending + accepted
        shared_with_me = FileShare.objects.filter(
            shared_with=user
        ).exclude(status='declined').select_related('cloud_file', 'shared_by')

        pending_count = shared_with_me.filter(status='pending').count()

        # For personal files, annotate with share info
        for f in user_files:
            f.share_links = f.shares.all()

        return render(request, "cloud.html", {
            "files": user_files,
            "shared_files": shared_with_me,
            "pending_count": pending_count,
            "active_tab": tab,
            "storage_used": total_storage,
            "storage_limit": storage_limit,
            "storage_percent": min(storage_percent, 100),
            "all_users": User.objects.exclude(id=user.id).order_by('username'),
        })
    except Exception as e:
        logger.warning(f"Cloud page error: {e}")
        return render(request, "cloud.html", {
            "files": [],
            "shared_files": [],
            "pending_count": 0,
            "active_tab": 'personal',
            "storage_used": 0,
            "storage_limit": storage_limit,
            "storage_percent": 0,
            "all_users": [],
        })


@login_required(login_url='/login')
def stoxview_page_view(request):
    return render(request, "stoxview.html")


@login_required(login_url='/login')
def profile_page_view(request):
    profile, _ = UserProfile.objects.get_or_create(user=request.user)
    return render(request, "profile.html", {"profile": profile})


@ensure_csrf_cookie
def password_reset_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "password_reset.html")


# ====== File Editor ======

# Extensions that can be opened in the editor
EDITABLE_EXTENSIONS = {
    # Code
    'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'less',
    'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt',
    'lua', 'r', 'pl', 'sh', 'bash', 'zsh', 'fish', 'bat', 'ps1', 'cmd',
    'sql', 'graphql', 'gql',
    # Data / Config
    'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env',
    'csv', 'tsv',
    # Text / Docs
    'txt', 'md', 'markdown', 'rst', 'log', 'tex', 'bib',
    # Web
    'svg', 'htaccess', 'nginx',
    # Docker / CI
    'dockerfile', 'dockerignore', 'gitignore', 'editorconfig',
}

# Map extensions to CodeMirror language modes
LANGUAGE_MAP = {
    'py': 'python', 'pyw': 'python',
    'js': 'javascript', 'jsx': 'javascript', 'mjs': 'javascript',
    'ts': 'javascript', 'tsx': 'javascript',
    'html': 'htmlmixed', 'htm': 'htmlmixed', 'svg': 'xml',
    'css': 'css', 'scss': 'css', 'sass': 'css', 'less': 'css',
    'json': 'javascript',
    'xml': 'xml', 'yaml': 'yaml', 'yml': 'yaml',
    'sql': 'sql',
    'md': 'markdown', 'markdown': 'markdown',
    'sh': 'shell', 'bash': 'shell', 'zsh': 'shell', 'fish': 'shell',
    'bat': 'shell', 'ps1': 'shell', 'cmd': 'shell',
    'java': 'clike', 'c': 'clike', 'cpp': 'clike', 'h': 'clike',
    'hpp': 'clike', 'cs': 'clike', 'kt': 'clike', 'swift': 'clike',
    'go': 'go', 'rs': 'rust', 'rb': 'ruby', 'php': 'php',
    'lua': 'lua', 'r': 'r', 'pl': 'perl',
    'toml': 'toml', 'ini': 'properties', 'cfg': 'properties',
    'dockerfile': 'dockerfile',
}


def _get_extension(filename):
    """Get lowercase file extension without dot."""
    if '.' in filename:
        return filename.rsplit('.', 1)[-1].lower()
    # Handle dot-files like Dockerfile, .gitignore
    return filename.lower().lstrip('.')


def is_editable(filename):
    """Check if a file can be opened in the editor."""
    ext = _get_extension(filename)
    return ext in EDITABLE_EXTENSIONS


@login_required(login_url='/login')
def editor_page_view(request, file_id):
    """Serve the file editor page."""
    cloud_file = get_object_or_404(CloudFile, id=file_id, user=request.user)

    if not is_editable(cloud_file.filename):
        messages.error(request, "Dieser Dateityp kann nicht bearbeitet werden.")
        return redirect("cloud")

    # Read file content
    try:
        cloud_file.file.open('rb')
        raw_bytes = cloud_file.file.read()
        cloud_file.file.close()

        # Try UTF-8 first, then latin-1 as fallback
        try:
            content = raw_bytes.decode('utf-8')
        except UnicodeDecodeError:
            content = raw_bytes.decode('latin-1')
    except Exception as e:
        logger.error(f"Could not read file {cloud_file.filename}: {e}")
        messages.error(request, "Datei konnte nicht gelesen werden.")
        return redirect("cloud")

    ext = _get_extension(cloud_file.filename)
    language = LANGUAGE_MAP.get(ext, '')

    return render(request, "editor.html", {
        "file": cloud_file,
        "content": content,
        "language": language,
    })


@login_required(login_url='/login')
def editor_save_view(request, file_id):
    """API endpoint to save edited file content."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    cloud_file = get_object_or_404(CloudFile, id=file_id, user=request.user)

    if not is_editable(cloud_file.filename):
        return JsonResponse({'error': 'Dateityp nicht editierbar'}, status=400)

    try:
        body = json.loads(request.body)
        new_content = body.get('content', '')
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'error': 'Ungültiger Request'}, status=400)

    try:
        # Encode content
        content_bytes = new_content.encode('utf-8')
        new_size = len(content_bytes)

        # Check quota (account for size difference)
        size_diff = new_size - cloud_file.file_size
        if size_diff > 0:
            current_usage = CloudFile.objects.filter(user=request.user).aggregate(
                total=Sum('file_size'))['total'] or 0
            if current_usage + size_diff > settings.MAX_CLOUD_STORAGE_PER_USER:
                return JsonResponse({'error': 'Speicherlimit erreicht'}, status=400)

        # Delete old file and save new content
        old_filename = cloud_file.file.name
        cloud_file.file.delete(save=False)
        cloud_file.file.save(cloud_file.filename, ContentFile(content_bytes), save=False)
        cloud_file.file_size = new_size
        cloud_file.save()

        return JsonResponse({
            'success': True,
            'new_size': new_size,
            'message': 'Datei gespeichert'
        })
    except Exception as e:
        logger.error(f"Could not save file {cloud_file.filename}: {e}")
        return JsonResponse({'error': 'Speichern fehlgeschlagen'}, status=500)


# ====== Cloud File Sharing ======

@login_required(login_url='/login')
def share_file_view(request, file_id):
    """Create a share link or share with a specific user."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    cloud_file = get_object_or_404(CloudFile, id=file_id, user=request.user)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        body = {}

    share_with_id = body.get('share_with_id')  # null = public link

    shared_with_user = None
    if share_with_id:
        shared_with_user = get_object_or_404(User, id=share_with_id)
        # Prevent duplicate
        existing = FileShare.objects.filter(
            cloud_file=cloud_file, shared_with=shared_with_user
        ).first()
        if existing:
            return JsonResponse({
                'success': True,
                'token': str(existing.token),
                'message': f'Bereits mit {shared_with_user.username} geteilt.'
            })
    else:
        # Public link: check if one already exists
        existing = FileShare.objects.filter(
            cloud_file=cloud_file, shared_with__isnull=True
        ).first()
        if existing:
            return JsonResponse({
                'success': True,
                'token': str(existing.token),
                'message': 'Link existiert bereits.'
            })

    # User-targeted shares start as 'pending'; public link shares are 'accepted' immediately
    initial_status = 'pending' if shared_with_user else 'accepted'

    share = FileShare.objects.create(
        cloud_file=cloud_file,
        shared_by=request.user,
        shared_with=shared_with_user,
        status=initial_status,
    )

    if shared_with_user:
        msg = f'Freigabeanfrage an {shared_with_user.username} gesendet.'
    else:
        msg = 'Datei wurde per Link geteilt.'

    return JsonResponse({
        'success': True,
        'token': str(share.token),
        'share_id': share.id,
        'shared_with_username': shared_with_user.username if shared_with_user else None,
        'message': msg
    })


@login_required(login_url='/login')
def unshare_file_view(request, share_id):
    """Revoke a share link. Allowed for the sharer OR the recipient."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    # Allow either the sharer or the shared_with user to delete the share
    from django.db.models import Q
    share = get_object_or_404(
        FileShare,
        Q(shared_by=request.user) | Q(shared_with=request.user),
        id=share_id
    )
    share.delete()

    return JsonResponse({'success': True, 'message': 'Freigabe wurde aufgehoben.'})


@login_required(login_url='/login')
def accept_share_view(request, share_id):
    """Recipient accepts a pending share request."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    share = get_object_or_404(FileShare, id=share_id, shared_with=request.user, status='pending')
    share.status = 'accepted'
    share.save(update_fields=['status'])

    return JsonResponse({
        'success': True,
        'message': f'Datei "{share.cloud_file.filename}" wurde akzeptiert.',
        'file_url': share.cloud_file.file.url,
        'filename': share.cloud_file.filename,
    })


@login_required(login_url='/login')
def decline_share_view(request, share_id):
    """Recipient declines a pending share request — deletes the share record."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    share = get_object_or_404(FileShare, id=share_id, shared_with=request.user, status='pending')
    filename = share.cloud_file.filename
    share.delete()

    return JsonResponse({'success': True, 'message': f'Freigabeanfrage für "{filename}" wurde abgelehnt.'})


@login_required(login_url='/login')
def remove_received_share_view(request, share_id):
    """Recipient removes an accepted share from their Shared tab."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    share = get_object_or_404(FileShare, id=share_id, shared_with=request.user, status='accepted')
    filename = share.cloud_file.filename
    share.delete()

    return JsonResponse({'success': True, 'message': f'Datei "{filename}" wurde entfernt.'})


@login_required(login_url='/login')
def cloud_delete_file_view(request, file_id):
    """AJAX endpoint to delete a personal cloud file. Returns JSON with updated storage info."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    cloud_file = get_object_or_404(CloudFile, id=file_id, user=request.user)
    filename = cloud_file.filename
    cloud_file.file.delete(save=False)
    cloud_file.delete()

    # Return updated storage info for real-time UI update
    storage_limit = settings.MAX_CLOUD_STORAGE_PER_USER
    total_storage = CloudFile.objects.filter(user=request.user).aggregate(total=Sum('file_size'))['total'] or 0
    storage_percent = round((total_storage / storage_limit) * 100, 1) if storage_limit > 0 else 0

    return JsonResponse({
        'success': True,
        'message': f'Datei "{filename}" wurde gelöscht.',
        'storage_used': total_storage,
        'storage_limit': storage_limit,
        'storage_percent': min(storage_percent, 100),
    })


def shared_download_view(request, token):
    """Public page to download a shared file via token."""
    share = get_object_or_404(FileShare, token=token)
    cloud_file = share.cloud_file

    return render(request, "shared_download.html", {
        "share": share,
        "cloud_file": cloud_file,
    })


# ====== Profile Avatar ======

@login_required(login_url='/login')
def avatar_upload_view(request):
    """Upload or replace profile avatar."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    avatar_file = request.FILES.get('avatar')
    if not avatar_file:
        return JsonResponse({'error': 'Keine Datei ausgewählt.'}, status=400)

    # Validate: must be an image, max 5 MB
    if not avatar_file.content_type.startswith('image/'):
        return JsonResponse({'error': 'Nur Bilder erlaubt.'}, status=400)
    if avatar_file.size > 5 * 1024 * 1024:
        return JsonResponse({'error': 'Maximum 5 MB.'}, status=400)

    try:
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        # Delete old avatar if exists
        if profile.avatar:
            profile.avatar.delete(save=False)
        profile.avatar = avatar_file
        profile.save()

        return JsonResponse({
            'success': True,
            'avatar_url': profile.avatar.url,
            'message': 'Profilbild aktualisiert.'
        })
    except Exception as e:
        logger.error(f"Avatar upload failed: {e}")
        return JsonResponse({'error': 'Upload fehlgeschlagen.'}, status=500)


@login_required(login_url='/login')
def avatar_delete_view(request):
    """Remove profile avatar."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        if profile.avatar:
            profile.avatar.delete(save=False)
            profile.avatar = None
            profile.save()
        return JsonResponse({'success': True, 'message': 'Profilbild entfernt.'})
    except Exception as e:
        logger.error(f"Avatar delete failed: {e}")
        return JsonResponse({'error': 'Löschen fehlgeschlagen.'}, status=500)


def custom_404(request, exception):
    return render(request, "404.html", status=404)


# ====== Chat Group API Views ======

# ====== Chat Group Icon ======

@login_required(login_url='/login')
def chat_group_icon_upload_view(request, group_id):
    """Upload or replace group icon. Only group admins can upload."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)

    # Only owner/admin can change icon
    is_privileged = ChatGroupMembership.objects.filter(
        user=request.user, group=group, role__in=['owner', 'admin']
    ).exists()
    if not is_privileged and not request.user.is_staff:
        return JsonResponse({'error': 'Nur Admins können das Gruppenicon ändern.'}, status=403)

    icon_file = request.FILES.get('icon')
    if not icon_file:
        return JsonResponse({'error': 'Keine Datei ausgewählt.'}, status=400)

    if not icon_file.content_type.startswith('image/'):
        return JsonResponse({'error': 'Nur Bilder erlaubt.'}, status=400)
    if icon_file.size > 5 * 1024 * 1024:
        return JsonResponse({'error': 'Maximum 5 MB.'}, status=400)

    # Delete old icon
    if group.icon:
        group.icon.delete(save=False)
    group.icon = icon_file
    group.save()

    return JsonResponse({
        'success': True,
        'icon_url': group.icon.url,
        'message': 'Gruppenicon aktualisiert.'
    })


@login_required(login_url='/login')
def chat_group_icon_delete_view(request, group_id):
    """Remove group icon."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)
    is_privileged = ChatGroupMembership.objects.filter(
        user=request.user, group=group, role__in=['owner', 'admin']
    ).exists()
    if not is_privileged and not request.user.is_staff:
        return JsonResponse({'error': 'Nur Admins können das Gruppenicon ändern.'}, status=403)

    if group.icon:
        group.icon.delete(save=False)
        group.icon = None
        group.save()

    return JsonResponse({'success': True, 'message': 'Gruppenicon entfernt.'})


@login_required(login_url='/login')
def chat_groups_list_view(request):
    """GET /api/chat/groups/ — list accepted groups and pending invites for the user."""
    if request.method != 'GET':
        return JsonResponse({'error': 'GET required'}, status=405)

    # Active (accepted) memberships
    accepted_groups = ChatGroup.objects.filter(
        chatgroupmembership__user=request.user,
        chatgroupmembership__status='accepted'
    ).order_by('name')
    groups_data = []
    for g in accepted_groups:
        membership = ChatGroupMembership.objects.get(user=request.user, group=g)
        groups_data.append({
            'id': g.id,
            'name': g.name,
            'role': membership.role,
            'created_by': g.created_by.username,
            'icon_url': g.icon.url if g.icon else None,
        })

    # Pending invites
    pending_memberships = ChatGroupMembership.objects.filter(
        user=request.user,
        status='pending'
    ).select_related('group').order_by('-joined_at')
    pending_data = []
    for m in pending_memberships:
        pending_data.append({
            'id': m.group.id,
            'name': m.group.name,
            'invited_by': m.group.created_by.username,
            'icon_url': m.group.icon.url if m.group.icon else None,
        })

    return JsonResponse({'groups': groups_data, 'pending_invites': pending_data})


@login_required(login_url='/login')
def chat_group_create_view(request):
    """POST /api/chat/groups/create/ — create a new group."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)
    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'error': 'Ungültiger Request'}, status=400)

    name = body.get('name', '').strip()
    if not name:
        return JsonResponse({'error': 'Gruppenname ist erforderlich.'}, status=400)
    if len(name) > 100:
        return JsonResponse({'error': 'Gruppenname zu lang (max. 100 Zeichen).'}, status=400)

    group = ChatGroup.objects.create(name=name, created_by=request.user)
    ChatGroupMembership.objects.create(user=request.user, group=group, role='owner')

    return JsonResponse({
        'success': True,
        'group': {'id': group.id, 'name': group.name, 'role': 'owner', 'created_by': request.user.username, 'icon_url': None},
        'message': f'Gruppe "{name}" wurde erstellt.',
    })


@login_required(login_url='/login')
def chat_group_invite_view(request, group_id):
    """POST /api/chat/groups/<id>/invite/ — invite a user by username."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)

    # Only admin or site staff can invite
    try:
        membership = ChatGroupMembership.objects.get(user=request.user, group=group)
    except ChatGroupMembership.DoesNotExist:
        return JsonResponse({'error': 'Kein Zugriff.'}, status=403)

    if membership.role not in ('owner', 'admin') and not request.user.is_staff:
        return JsonResponse({'error': 'Nur Admins können Nutzer einladen.'}, status=403)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'error': 'Ungültiger Request'}, status=400)

    username = body.get('username', '').strip()
    if not username:
        return JsonResponse({'error': 'Benutzername ist erforderlich.'}, status=400)

    try:
        invite_user = User.objects.get(username=username)
    except User.DoesNotExist:
        return JsonResponse({'error': f'Nutzer "{username}" nicht gefunden.'}, status=404)

    if invite_user == request.user:
        return JsonResponse({'error': 'Du bist bereits in der Gruppe.'}, status=400)

    existing = ChatGroupMembership.objects.filter(user=invite_user, group=group).first()
    if existing:
        if existing.status == 'accepted':
            return JsonResponse({'error': f'{username} ist bereits Mitglied.'}, status=400)
        elif existing.status == 'pending':
            return JsonResponse({'error': f'{username} hat bereits eine ausstehende Einladung.'}, status=400)
        elif existing.status == 'declined':
            # Re-invite: reset to pending
            existing.status = 'pending'
            existing.save(update_fields=['status'])
            return JsonResponse({'success': True, 'message': f'Einladung an {username} erneut gesendet.'})

    ChatGroupMembership.objects.create(user=invite_user, group=group, role='member', status='pending')

    return JsonResponse({
        'success': True,
        'message': f'Einladung an {username} gesendet.',
    })


@login_required(login_url='/login')
def chat_group_accept_invite_view(request, group_id):
    """POST /api/chat/groups/<id>/accept/ — accept a pending group invite."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)

    try:
        membership = ChatGroupMembership.objects.get(
            user=request.user, group=group, status='pending'
        )
    except ChatGroupMembership.DoesNotExist:
        return JsonResponse({'error': 'Keine ausstehende Einladung gefunden.'}, status=404)

    membership.status = 'accepted'
    membership.save(update_fields=['status'])

    return JsonResponse({
        'success': True,
        'group': {
            'id': group.id,
            'name': group.name,
            'role': membership.role,
        },
        'message': f'Du bist der Gruppe "{group.name}" beigetreten.',
    })


@login_required(login_url='/login')
def chat_group_decline_invite_view(request, group_id):
    """POST /api/chat/groups/<id>/decline/ — decline a pending group invite."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)

    try:
        membership = ChatGroupMembership.objects.get(
            user=request.user, group=group, status='pending'
        )
    except ChatGroupMembership.DoesNotExist:
        return JsonResponse({'error': 'Keine ausstehende Einladung gefunden.'}, status=404)

    membership.delete()

    return JsonResponse({
        'success': True,
        'message': f'Einladung zur Gruppe "{group.name}" abgelehnt.',
    })


@login_required(login_url='/login')
def chat_group_leave_view(request, group_id):
    """POST /api/chat/groups/<id>/leave/ — leave a group."""
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)

    try:
        membership = ChatGroupMembership.objects.get(user=request.user, group=group)
    except ChatGroupMembership.DoesNotExist:
        return JsonResponse({'error': 'Du bist kein Mitglied dieser Gruppe.'}, status=400)

    is_owner = (membership.role == 'owner')
    membership.delete()

    # If no accepted members left, delete the group
    remaining = ChatGroupMembership.objects.filter(group=group, status='accepted').count()
    if remaining == 0:
        group.delete()
        return JsonResponse({'success': True, 'message': 'Gruppe verlassen und gelöscht (keine Mitglieder mehr).'})

    # If the owner left, transfer ownership to an admin or oldest member
    if is_owner:
        # Try to find an existing admin first
        new_owner = ChatGroupMembership.objects.filter(
            group=group, role='admin', status='accepted'
        ).order_by('joined_at').first()
        if not new_owner:
            # Fallback to oldest accepted member
            new_owner = ChatGroupMembership.objects.filter(
                group=group, status='accepted'
            ).order_by('joined_at').first()
        if new_owner:
            new_owner.role = 'owner'
            new_owner.save()

    return JsonResponse({'success': True, 'message': f'Du hast die Gruppe "{group.name}" verlassen.'})


@login_required(login_url='/login')
def chat_group_delete_view(request, group_id):
    """DELETE /api/chat/groups/<id>/ — delete group (admin only)."""
    if request.method != 'DELETE':
        return JsonResponse({'error': 'DELETE required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)

    # Only owner or site staff can delete the group
    is_staff = request.user.is_staff
    is_owner = ChatGroupMembership.objects.filter(
        user=request.user, group=group, role='owner'
    ).exists()

    if not is_staff and not is_owner:
        return JsonResponse({'error': 'Nur der Eigentümer kann die Gruppe löschen.'}, status=403)

    group_name = group.name
    group.delete()
    return JsonResponse({'success': True, 'message': f'Gruppe "{group_name}" wurde gelöscht.'})


@login_required(login_url='/login')
def chat_group_members_view(request, group_id):
    """GET /api/chat/groups/<id>/members/ — list group members with roles."""
    if request.method != 'GET':
        return JsonResponse({'error': 'GET required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)

    # Must be a member to view
    if not ChatGroupMembership.objects.filter(
        user=request.user, group=group, status='accepted'
    ).exists():
        return JsonResponse({'error': 'Kein Zugriff.'}, status=403)

    memberships = ChatGroupMembership.objects.filter(
        group=group, status='accepted'
    ).select_related('user').order_by(
        db_models.Case(
            db_models.When(role='owner', then=0),
            db_models.When(role='admin', then=1),
            default=2,
            output_field=db_models.IntegerField(),
        ),
        'joined_at'
    )

    members = []
    for m in memberships:
        avatar_url = ''
        try:
            if m.user.profile and m.user.profile.avatar:
                avatar_url = m.user.profile.avatar.url
        except UserProfile.DoesNotExist:
            pass
        members.append({
            'user_id': m.user.id,
            'username': m.user.username,
            'role': m.role,
            'avatar_url': avatar_url,
            'joined_at': m.joined_at.isoformat(),
        })

    return JsonResponse({'members': members})


@login_required(login_url='/login')
def chat_group_change_role_view(request, group_id):
    """POST /api/chat/groups/<id>/role/ — change a member's role.
    Body: {user_id: int, role: 'admin'|'member'}
    Only owner can promote to admin or demote to member.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)

    # Only the owner can change roles
    requester_membership = ChatGroupMembership.objects.filter(
        user=request.user, group=group, role='owner', status='accepted'
    ).first()
    if not requester_membership and not request.user.is_staff:
        return JsonResponse({'error': 'Nur der Eigentümer kann Rollen ändern.'}, status=403)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'error': 'Ungültiger Request'}, status=400)

    target_user_id = body.get('user_id')
    new_role = body.get('role', '')

    if new_role not in ('admin', 'member'):
        return JsonResponse({'error': 'Ungültige Rolle. Erlaubt: admin, member.'}, status=400)

    if target_user_id == request.user.id:
        return JsonResponse({'error': 'Du kannst deine eigene Rolle nicht ändern.'}, status=400)

    target_membership = ChatGroupMembership.objects.filter(
        user_id=target_user_id, group=group, status='accepted'
    ).first()
    if not target_membership:
        return JsonResponse({'error': 'Nutzer ist kein Mitglied dieser Gruppe.'}, status=404)

    if target_membership.role == 'owner':
        return JsonResponse({'error': 'Die Eigentümer-Rolle kann nicht geändert werden.'}, status=400)

    target_membership.role = new_role
    target_membership.save(update_fields=['role'])

    role_label = 'Admin' if new_role == 'admin' else 'Mitglied'
    return JsonResponse({
        'success': True,
        'message': f'{target_membership.user.username} ist jetzt {role_label}.',
    })


@login_required(login_url='/login')
def chat_group_kick_view(request, group_id):
    """POST /api/chat/groups/<id>/kick/ — remove a member from the group.
    Body: {user_id: int}
    Owner can kick anyone. Admin can kick members (not other admins or owner).
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)

    requester_membership = ChatGroupMembership.objects.filter(
        user=request.user, group=group, status='accepted'
    ).first()
    if not requester_membership:
        return JsonResponse({'error': 'Kein Zugriff.'}, status=403)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'error': 'Ungültiger Request'}, status=400)

    target_user_id = body.get('user_id')
    if target_user_id == request.user.id:
        return JsonResponse({'error': 'Nutze "Verlassen" um die Gruppe zu verlassen.'}, status=400)

    target_membership = ChatGroupMembership.objects.filter(
        user_id=target_user_id, group=group, status='accepted'
    ).first()
    if not target_membership:
        return JsonResponse({'error': 'Nutzer ist kein Mitglied dieser Gruppe.'}, status=404)

    # Permission check: owner can kick anyone, admin can kick members only
    if requester_membership.role == 'owner':
        pass  # owner can kick anyone
    elif requester_membership.role == 'admin':
        if target_membership.role in ('owner', 'admin'):
            return JsonResponse({'error': 'Admins können nur Mitglieder entfernen.'}, status=403)
    else:
        return JsonResponse({'error': 'Keine Berechtigung.'}, status=403)

    username = target_membership.user.username
    target_membership.delete()

    return JsonResponse({
        'success': True,
        'message': f'{username} wurde aus der Gruppe entfernt.',
    })


@login_required(login_url='/login')
def chat_group_rename_view(request, group_id):
    """POST /api/chat/groups/<id>/rename/ — rename the group.
    Body: {name: str}
    Only owner/admin can rename.
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    group = get_object_or_404(ChatGroup, id=group_id)

    is_privileged = ChatGroupMembership.objects.filter(
        user=request.user, group=group, role__in=['owner', 'admin'], status='accepted'
    ).exists()
    if not is_privileged and not request.user.is_staff:
        return JsonResponse({'error': 'Nur Admins können den Gruppennamen ändern.'}, status=403)

    try:
        body = json.loads(request.body)
    except (json.JSONDecodeError, AttributeError):
        return JsonResponse({'error': 'Ungültiger Request'}, status=400)

    new_name = body.get('name', '').strip()
    if not new_name:
        return JsonResponse({'error': 'Gruppenname ist erforderlich.'}, status=400)
    if len(new_name) > 100:
        return JsonResponse({'error': 'Gruppenname zu lang (max. 100 Zeichen).'}, status=400)

    group.name = new_name
    group.save(update_fields=['name'])

    return JsonResponse({
        'success': True,
        'name': new_name,
        'message': f'Gruppe wurde in "{new_name}" umbenannt.',
    })
