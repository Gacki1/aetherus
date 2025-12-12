# backend/views.py
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework import serializers

# Import für die timedelta aus der settings.py, um die Cookie-Lebensdauer korrekt zu setzen.
from django.conf import settings
from datetime import timedelta

# Hilfsfunktion, um die Lebensdauer des Cookies aus den Settings zu berechnen
def get_refresh_token_max_age():
    # Holt die Lebensdauer (typischerweise 30 Tage) aus den SIMPLE_JWT Settings
    refresh_lifetime: timedelta = settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME']
    return int(refresh_lifetime.total_seconds())

# ----------------------------------------------------------------------
# 1. View für den Login (Token-Ausgabe)
# ----------------------------------------------------------------------
class CookieTokenObtainPairView(TokenObtainPairView):
    def finalize_response(self, request, response, *args, **kwargs):
        # Prüfen, ob der Token-Erwerb erfolgreich war (Status 200)
        if response.data.get('refresh'):
            
            # Refresh Token aus dem Body entfernen und in Variable speichern
            refresh_token = response.data.pop('refresh')
            max_age = get_refresh_token_max_age()

            # Setzen des HttpOnly Cookies
            response.set_cookie(
                key='refresh_token',
                value=refresh_token,
                max_age=max_age,
                secure=True,          # WICHTIG: Nur über HTTPS (daher Secure=True)
                httponly=True,        # WICHTIG: Kein JavaScript-Zugriff
                samesite='Lax'        # Empfohlen
            )
        
        # Rückgabe der finalen Antwort (enthält nur noch das Access Token)
        return super().finalize_response(request, response, *args, **kwargs)

# ----------------------------------------------------------------------
# 2. View für den Refresh (Token-Erneuerung)
# ----------------------------------------------------------------------

# Serializer liest Token aus Cookie statt Body
class CookieTokenRefreshSerializer(TokenRefreshSerializer):
    # Überschreibt das Feld, damit es nicht aus dem Request Body gelesen wird
    refresh = None
    
    def validate(self, attrs):
        # Holen des Refresh Tokens aus dem Cookie
        request = self.context['request']
        attrs['refresh'] = request.COOKIES.get('refresh_token')
        
        if attrs['refresh']:
            # Validierung durchführen (Signature, Expiry, etc.)
            return super().validate(attrs)
        
        # Fehlermeldung, falls Cookie fehlt
        raise serializers.ValidationError('Refresh token cookie nicht gefunden.')

class CookieTokenRefreshView(TokenRefreshView):
    serializer_class = CookieTokenRefreshSerializer
    
    # Logik für das Setzen des neuen Cookies (Token Rotation)
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