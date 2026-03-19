from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView
from django.shortcuts import redirect, render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db.models import Sum, Count
from django.conf import settings
from django.http import JsonResponse
from django.core.files.base import ContentFile
from ..models import CloudFile, ChatMessage
import logging
import json

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


def login_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "login.html")


@login_required(login_url='/login')
def chat_page_view(request):
    return render(request, "chat.html")


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

        # GET request - list user files with storage info
        user_files = CloudFile.objects.filter(user=user)
        total_storage = user_files.aggregate(total=Sum('file_size'))['total'] or 0
        storage_percent = round((total_storage / storage_limit) * 100, 1) if storage_limit > 0 else 0

        return render(request, "cloud.html", {
            "files": user_files,
            "storage_used": total_storage,
            "storage_limit": storage_limit,
            "storage_percent": min(storage_percent, 100),
        })
    except Exception:
        logger.warning("CloudFile table not available — run migrations")
        return render(request, "cloud.html", {
            "files": [],
            "storage_used": 0,
            "storage_limit": storage_limit,
            "storage_percent": 0,
        })


@login_required(login_url='/login')
def profile_page_view(request):
    return render(request, "profile.html")


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


def custom_404(request, exception):
    return render(request, "404.html", status=404)
