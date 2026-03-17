from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView
from django.shortcuts import redirect, render, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from ..models import CloudFile
from django.views.generic import TemplateView
from django.shortcuts import redirect, render
from django.contrib.auth.decorators import login_required

class DashboardView(LoginRequiredMixin, TemplateView):
    template_name = "main.html"
    login_url = "/login"


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
    if request.method == "POST":
        action = request.POST.get("action")
        
        # Upload new file
        if action == "upload":
            uploaded_file = request.FILES.get("file")
            if uploaded_file:
                CloudFile.objects.create(
                    user=request.user,
                    file=uploaded_file,
                    filename=uploaded_file.name,
                    file_size=uploaded_file.size
                )
                messages.success(request, f"Datei {uploaded_file.name} wurde hochgeladen.")
            else:
                messages.error(request, "Keine Datei zum Hochladen ausgewählt.")
                
        # Delete existing file
        elif action == "delete":
            file_id = request.POST.get("file_id")
            if file_id:
                cloud_file = get_object_or_404(CloudFile, id=file_id, user=request.user)
                # This will also delete the file from S3 because of how django-storages handles it (or we can call delete directly)
                cloud_file.file.delete(save=False) 
                cloud_file.delete()
                messages.success(request, f"Datei {cloud_file.filename} wurde gelöscht.")
                
        return redirect("cloud")

    # GET request - list user files
    user_files = CloudFile.objects.filter(user=request.user)
    return render(request, "cloud.html", {"files": user_files})