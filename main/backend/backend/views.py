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
from django.core.signing import TimestampSigner, SignatureExpired
from django.utils import timezone
import datetime

# WICHTIG: Neue Imports für die Verifizierung
from django.utils.http import urlsafe_base64_encode, urlsafe_base64_decode
from django.utils.encoding import force_bytes, force_str
from django.contrib.auth.tokens import default_token_generator
from django.conf import settings
from django.core.mail import send_mail

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

        print("--- REGISTRIERUNG GESTARTET ---")
        username = request.data.get("username")
        email = request.data.get("email")
        password = request.data.get("password")
        re_password = request.data.get("re_password")

        # Validierung
        print("Passwörter validieren...")
        if password != re_password:
            return Response({"error": "Passwörter stimmen nicht überein"}, status=status.HTTP_400_BAD_REQUEST)
        
        if User.objects.filter(username=username).exists():
            return Response({"error": "Benutzername bereits vergeben"}, status=status.HTTP_400_BAD_REQUEST)

        # 1. User erstellen (inaktiv!)
        print("Inaktiven User erstellen...")
        user = User.objects.create_user(username=username, email=email, password=password)
        user.is_active = False 
        user.save()
        print("User erfolgreich als Inaktiv gespeichert.")

        # 2. Token & Link generieren
        print("Erstelle Verifizierungs-Link...")
        signer = TimestampSigner()
        activation_key = signer.sign(user.username)
        # Link zeigt auf deine Aetherus Domain
        activation_link = f"https://aetherus.net/api/auth/activate/{activation_key}/"
        print(f"Link erstellt: {activation_link}")

        # 3. E-Mail senden
        subject = 'Aetherus - Account verifizieren'
        message = f'Willkommen {username}!\n\nKlicke auf den Link, um dein Konto zu aktivieren: {activation_link}'
        
        print(f"Sende Mail an: {email} über Backend: {settings.EMAIL_BACKEND}")
        try:
            send_mail(
                subject,
                message, 
                settings.DEFAULT_FROM_EMAIL, 
                [email],
                fail_silently=False,
                )
        except Exception as e:
            print(f"E-Mail Fehler: {e}") # Debugging im Terminal

        return Response({"message": "Bitte prüfe deine E-Mails!"}, status=status.HTTP_201_CREATED)

# --- View zur Account-Aktivierung ---

class ActivateAccountView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, activation_key):
        signer = TimestampSigner()
        try:
            # 1. Dekodiere die User-ID aus dem Link
            username = signer.unsing(activation_key, max_age=172800)
            user = User.objects.get(username)
        except (User.DoesNotExist, SignatureExpired):
            return Response({"error": "Link abgelaufen oder ungültig"}, status=400)

        except Exception:
            return Response({"error": "Ungültiger Key"}, status=400)
        
        if not user.is_active:
            user.is_active=True
            user.save()
            return redirect("login?activated=true")
        return redirect("/login?already_active=true")


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
