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
    # Fügt das Feld 'rememberMe' hinzu, damit es validiert werden kann (KEINE ÄNDERUNG HIER)
    rememberMe = serializers.BooleanField(required=False, default=False)
    
    # NEUES Instanzfeld, um den Status zu speichern
    remember_me_status = False

    def validate(self, attrs):
        # Führen Sie die Standard-Validierung und Authentifizierung durch
        data = super().validate(attrs)
        
        # NEUE LOGIK: Speichern Sie den Status auf der Serializer-Instanz
        # Wir greifen auf die validierten Daten von `rememberMe` zu
        self.remember_me_status = attrs.get('rememberMe', False)
        
        # Der Rückgabewert data enthält nun 'access' und 'refresh'
        return data

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)

        return token # Einfach das Basistoken zurückgeben


class CookieTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer 
    
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tokens = serializer.validated_data # Enthält 'access' und 'refresh'
        
        # 1. Hole den 'rememberMe'-Status
        remember_me = request.data.get('rememberMe', False)
        
        # 2. ANPASSUNG DER REFRESH TOKEN LEBENSDAUER (EXP)
        
        if tokens.get('refresh'):
            # Wir benötigen die Token-Instanz, um die EXP anzupassen
            refresh_token_str = tokens['refresh']
            refresh_token_obj = RefreshToken(refresh_token_str)
            
            if not remember_me:
                # Setze eine kurze Lebensdauer (z.B. 2 Stunden)
                short_lifetime = timedelta(hours=2) 
                
                # Der Key 'exp' wird im Token neu gesetzt
                refresh_token_obj.set_exp(from_time=datetime.now(timezone.utc), lifetime=short_lifetime)
                
                # Aktualisiere den String im Dictionary
                tokens['refresh'] = str(refresh_token_obj)
        
        # 3. SETZEN DES COOKIES (LOGIK bleibt gleich)
        response = Response(tokens)
        
        if tokens.get('refresh'):
            refresh_token = tokens.pop('refresh')
            
            if remember_me:
                max_age = get_refresh_token_max_age()
            else:
                max_age = None # Session-Cookie
            
            response.set_cookie(
                key='refresh_token',
                value=refresh_token,
                max_age=max_age, 
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