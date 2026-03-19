from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView
from django.shortcuts import redirect, render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db.models import Sum, Count
from django.conf import settings
from ..models import CloudFile, ChatMessage


class DashboardView(LoginRequiredMixin, TemplateView):
    template_name = "main.html"
    login_url = "/login"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        user = self.request.user

        # Cloud storage stats
        cloud_files = CloudFile.objects.filter(user=user)
        total_storage = cloud_files.aggregate(total=Sum('file_size'))['total'] or 0
        storage_limit = settings.MAX_CLOUD_STORAGE_PER_USER
        storage_percent = round((total_storage / storage_limit) * 100, 1) if storage_limit > 0 else 0

        # Recent files
        recent_files = cloud_files[:5]

        # Chat stats
        user_message_count = ChatMessage.objects.filter(user=user).count()
        total_message_count = ChatMessage.objects.count()

        context.update({
            'cloud_file_count': cloud_files.count(),
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


@login_required(login_url='/login')
def profile_page_view(request):
    return render(request, "profile.html")


def password_reset_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "password_reset.html")


def custom_404(request, exception):
    return render(request, "404.html", status=404)
