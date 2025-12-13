# backend/views.py (FINALE KORREKTUR)

from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.serializers import TokenRefreshSerializer, TokenObtainPairSerializer
from rest_framework import serializers
from rest_framework.response import Response
from datetime import timedelta, datetime, timezone
from django.conf import settings
from rest_framework.views import APIView
from rest_framework import status
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView
from django.contrib.auth import login
from django.contrib.auth import logout

from rest_framework_simplejwt.tokens import RefreshToken 

def get_refresh_token_max_age():

    refresh_lifetime: timedelta = settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME']
    return int(refresh_lifetime.total_seconds())

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):

    rememberMe = serializers.BooleanField(required=False, default=False)
    pass

class CookieTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer 
    
    def post(self, request, *args, **kwargs):
        # 1. Validierung über den Serializer (holt User & generiert Tokens)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tokens = serializer.validated_data # Enthält 'access' und 'refresh'
        
        # 2. Remember Me Logik abrufen
        # Wir erwarten vom Frontend 'rememberMe': true/false
        remember_me = request.data.get('rememberMe', False)
        
        # 3. Refresh Token Objekt für Manipulation laden
        refresh_token_str = tokens.get('refresh')
        refresh_token_obj = RefreshToken(refresh_token_str)

        # Modus für das Frontend mitschicken, damit JS weiß, ob es 'Tab-Logout' machen soll
        auth_mode = 'browser_session' if remember_me else 'tab_session'

        if not remember_me:
            # Wenn KEIN Remember Me: Token-Lebensdauer im JWT selbst kurz halten
            # (z.B. 2 Stunden, falls der Browser-Logout-Event mal fehlschlägt)
            refresh_token_obj.set_exp(
                from_time=datetime.now(timezone.utc), 
                lifetime=timedelta(hours=2)
            )
            tokens['refresh'] = str(refresh_token_obj)

        # 4. Response vorbereiten (Access Token bleibt im Body für das JS-Frontend)
        response = Response({
            'access': tokens.get('access'),
            'mode': auth_mode  # Hilft dem Frontend bei der Tab-Close-Logik
        })
        
        # 5. Refresh Token aus Body entfernen und in HttpOnly Cookie packen
        if tokens.get('refresh'):
            refresh_token = tokens.pop('refresh')

            max_age = None

            response.set_cookie(
                key='refresh_token',
                value=refresh_token,
                max_age=max_age, 
                secure=True,     # Nur über HTTPS (im Deployment)
                httponly=True,   # Schutz gegen XSS
                samesite='Lax',  # Schutz gegen CSRF
                path='/'         # Gültig für die gesamte Domain
            )
        
        # 6. Synchronisation mit Django-Backend-Sessions (für main.html Schutz)
        user = serializer.user
        if user:
            login(request, user)
            
        return response

# --- 2. Refresh Logik (Token-Erneuerung) ---

class CookieTokenRefreshSerializer(TokenRefreshSerializer):
    """
    Serializer liest Refresh Token aus dem Cookie statt aus dem Request Body.
    """
    refresh = None
    
    def validate(self, attrs):
        request = self.context['request']
        attrs['refresh'] = request.COOKIES.get('refresh_token')
        
        if attrs['refresh']:
            return super().validate(attrs)
        
        raise serializers.ValidationError('Refresh token cookie nicht gefunden.')

class CookieTokenRefreshView(TokenRefreshView):
    """
    Verarbeitet den Token Refresh und setzt das NEUE Refresh Token wieder als Cookie.
    """
    serializer_class = CookieTokenRefreshSerializer
    
    def finalize_response(self, request, response, *args, **kwargs):
        if response.data.get('refresh'):
            refresh_token = response.data.pop('refresh')

            max_age = get_refresh_token_max_age()
            
            response.set_cookie(
                key='refresh_token',
                value=refresh_token,
                max_age=max_age, 
                secure=True,
                httponly=True,
                samesite='Lax'
            )
            
        return super().finalize_response(request, response, *args, **kwargs)
    
class LogoutView(APIView):
    def post(self, request):
        logout(request)
        response = Response({"message": "Logout erfolgreich"}, status=status.HTTP_200_OK)
        
        # Cookie löschen
        response.set_cookie(
            key='refresh_token',
            value='',
            max_age=0,
            expires='Thu, 01 Jan 1970 00:00:00 GMT',
            path='/', # Sicherstellen, dass der Pfad übereinstimmt!
            secure=True,
            httponly=True,
            samesite='Lax'
        )
        return response
    
class DashboardView(LoginRequiredMixin, TemplateView):
    template_name="main.html"
    login_url="/login.html"