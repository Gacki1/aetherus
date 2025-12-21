from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView
from django.shortcuts import redirect, render

class DashboardView(LoginRequiredMixin, TemplateView):
    template_name = "main.html"
    login_url = "/login"


def login_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "login.html")

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