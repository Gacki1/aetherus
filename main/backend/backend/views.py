# backend/views.py

from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.serializers import TokenRefreshSerializer, TokenObtainPairSerializer
from rest_framework import serializers
from rest_framework.response import Response # Stellen Sie sicher, dass Response richtig importiert ist
from datetime import timedelta, datetime, timezone
from django.conf import settings

# --- Hilfsfunktionen ---

def get_refresh_token_max_age():
    """
    Berechnet die maximale Lebensdauer des Refresh Tokens in Sekunden aus den Settings.
    """
    # Holt die langlebige Lebensdauer (typischerweise 30 Tage) aus den SIMPLE_JWT Settings
    refresh_lifetime: timedelta = settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME']
    return int(refresh_lifetime.total_seconds())

# --- 1. Login Logik (Token-Ausgabe) ---

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Erweiterter Serializer zur Verarbeitung des 'rememberMe'-Status
    und zur Anpassung der Refresh Token Lebensdauer (EXP-Claim).
    """
    # Fügt das Feld 'rememberMe' hinzu, damit es validiert werden kann
    rememberMe = serializers.BooleanField(required=False, default=False)
    
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        
        # Zugriff auf den 'rememberMe'-Status aus den übergebenen Daten
        remember_me = cls.context['request'].data.get('rememberMe', False)

        # Token-Lebensdauer (exp) anpassen
        if not remember_me:
            # Wenn NICHT "Remember Me" -> Sehr kurze Lebensdauer (z.B. 2 Stunden)
            # Wichtig: Diese Lebensdauer überschreibt die standardmäßige REFRESH_TOKEN_LIFETIME
            short_lifetime = timedelta(hours=2) 
            token.set_exp(from_time=datetime.now(timezone.utc), lifetime=short_lifetime)
            
        # Wenn 'rememberMe' TRUE ist, verwendet das Token die Standard-LIFETIME aus settings.py.
        return token


class CookieTokenObtainPairView(TokenObtainPairView):
    """
    Verarbeitet den Login, setzt das 'refresh_token' als HttpOnly Cookie
    und steuert dessen Persistenz (max_age) basierend auf 'rememberMe'.
    """
    # Serializer anbinden
    serializer_class = CustomTokenObtainPairSerializer 
    
    def post(self, request, *args, **kwargs):
        # Ruft die Logik des Serializers auf (Validierung und Token-Erstellung)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tokens = serializer.validated_data

        response = Response(tokens)
        
        # WICHTIG: Hier steuern wir die Cookie-Lebensdauer (Persistenz)
        if tokens.get('refresh'):
            refresh_token = tokens.pop('refresh')
            
            # Hole den 'rememberMe'-Status
            remember_me = request.data.get('rememberMe', False)
            
            if remember_me:
                # 1. Wenn Remember Me: Setze langlebiges Cookie
                max_age = get_refresh_token_max_age()
            else:
                # 2. Wenn KEIN Remember Me: Setze Session-Cookie (wird bei Browser-Schluss gelöscht)
                max_age = None 
            
            # Setzen des HttpOnly Cookies
            response.set_cookie(
                key='refresh_token',
                value=refresh_token,
                max_age=max_age, # Entscheidend für die Persistenz
                secure=True, 
                httponly=True, 
                samesite='Lax' 
            )
        
        return response


# --- 2. Refresh Logik (Token-Erneuerung) ---

class CookieTokenRefreshSerializer(TokenRefreshSerializer):
    """
    Serializer liest Refresh Token aus dem Cookie statt aus dem Request Body.
    """
    refresh = None
    
    def validate(self, attrs):
        request = self.context['request']
        # Holen des Refresh Tokens aus dem Cookie
        attrs['refresh'] = request.COOKIES.get('refresh_token')
        
        if attrs['refresh']:
            # Validierung durchführen (Signature, Expiry, etc.)
            return super().validate(attrs)
        
        raise serializers.ValidationError('Refresh token cookie nicht gefunden.')

class CookieTokenRefreshView(TokenRefreshView):
    """
    Verarbeitet den Token Refresh und setzt das NEUE Refresh Token
    wieder als Cookie (Token Rotation).
    """
    serializer_class = CookieTokenRefreshSerializer
    
    # Logik für das Setzen des neuen Cookies (Token Rotation)
    def finalize_response(self, request, response, *args, **kwargs):
        if response.data.get('refresh'):
            refresh_token = response.data.pop('refresh')

            max_age = get_refresh_token_max_age()

            response.set_cookie(
                key='refresh_token',
                value=refresh_token,
                max_age=max_age, # Setzt das Cookie persistent (da es sich um ein Refresh-Token handelt)
                secure=True,
                httponly=True,
                samesite='Lax'
            )
            
        return super().finalize_response(request, response, *args, **kwargs)