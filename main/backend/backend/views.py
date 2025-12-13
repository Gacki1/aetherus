import json
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.shortcuts import redirect, render
from django.core.mail import send_mail

# WICHTIG: Neue Imports für die Verifizierung
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.contrib.auth.tokens import default_token_generator
from django.conf import settings

# --- Deine bestehenden Page-Views ---

class DashboardView(LoginRequiredMixin, TemplateView):
    template_name = "main.html"
    login_url = "/login"

def login_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "login.html")

def start_page_view(request):
    return render(request, "start.html")

def register_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "register.html")

# --- Neue API-Logik für die Registrierung ---

class RegisterAPIView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username")
        email = request.data.get("email")
        password = request.data.get("password")
        re_password = request.data.get("re_password")

        # Validierung
        if password != re_password:
            return Response({"error": "Passwörter stimmen nicht überein"}, status=status.HTTP_400_BAD_REQUEST)
        
        if User.objects.filter(username=username).exists():
            return Response({"error": "Benutzername bereits vergeben"}, status=status.HTTP_400_BAD_REQUEST)

        # 1. User erstellen (inaktiv!)
        user = User.objects.create_user(username=username, email=email, password=password)
        user.is_active = False 
        user.save()

        # 2. Token & Link generieren
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        # Link zeigt auf deine Aetherus Domain
        activation_link = f"https://aetherus.net/api/auth/activate/{uid}/{token}/"

        # 3. E-Mail senden
        subject = 'Aetherus - Account verifizieren'
        message = f'Willkommen {username}!\n\nKlicke auf den Link, um dein Konto zu aktivieren: {activation_link}'
        
        try:
            send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [email])
        except Exception as e:
            print(f"E-Mail Fehler: {e}") # Debugging im Terminal

        return Response({"message": "Bitte prüfe deine E-Mails!"}, status=status.HTTP_201_CREATED)

# --- View zur Account-Aktivierung ---

class ActivateAccountView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, uidb64, token):
        try:
            uid = force_str(urlsafe_base64_decode(uidb64))
            user = User.objects.get(pk=uid)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            user = None

        if user is not None and default_token_generator.check_token(user, token):
            user.is_active = True
            user.save()
            # Nach Aktivierung zum Login schicken
            return redirect("/login?activated=true")
        else:
            return Response({"error": "Ungültiger oder abgelaufener Link"}, status=status.HTTP_400_BAD_REQUEST)

class SessionLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get("email")
        username = request.data.get("username")
        password = request.data.get("password")
        remember_me = request.data.get("rememberMe", False)

        user = authenticate(request, username=username, password=password)

        if user is not None:
            login(request, user)

            if remember_me:
                request.session.set_expiry(2592000)
            else:
                request.session.set_expiry(0)

            return Response({
                "message": "Erfolgreich eingeloggt",
                "username": user.username,
                "mode": "browser" if remember_me else "tab"
            }, status=status.HTTP_200_OK)
        
        return Response({"error": "Ungültige Anmeldedaten"}, status=status.HTTP_401_UNAUTHORIZED)
    
class SessionLogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({"message": "Erfolgreich ausgeloggt"}, status=status.HTTP_200_OK)
    
class UserProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "username": request.user.username,
            "email": request.user.email
        })

class RedirectIfLoggedInMixin:
    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect("/main.html")
        return super().dispatch(request, *args, **kwargs)
    
def login_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "login.html")

def start_page_view(request):
    return render(request, "start.html")

def register_page_view(request):
    if request.user.is_authenticated:
        return redirect("/main")
    return render(request, "register.html")
