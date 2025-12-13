# backend/views.py (FINALE KORREKTUR)

from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from rest_framework_simplejwt.serializers import TokenRefreshSerializer, TokenObtainPairSerializer
from rest_framework import serializers
from rest_framework.response import Response
from datetime import timedelta, datetime, timezone
from django.conf import settings
from rest_framework.views import APIView
from rest_framework import status

from rest_framework_simplejwt.tokens import RefreshToken 

def get_refresh_token_max_age():
    """
    Berechnet die maximale Lebensdauer des Refresh Tokens in Sekunden aus den Settings.
    """
    refresh_lifetime: timedelta = settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME']
    return int(refresh_lifetime.total_seconds())

# --- 1. Login Logik (Token-Ausgabe) ---

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    """
    Erweiterter Serializer zur Verarbeitung des 'rememberMe'-Status.
    """
    rememberMe = serializers.BooleanField(required=False, default=False)
    
    # get_token wird nicht mehr überschrieben, da die Token-Anpassung in der View erfolgt.
    # Hier wird nur die Validierung sichergestellt.
    pass 


class CookieTokenObtainPairView(TokenObtainPairView):
    """
    Verarbeitet den Login, passt die Token-EXP an, setzt das Refresh Token als HttpOnly Cookie
    und steuert dessen Persistenz (max_age) basierend auf 'rememberMe'.
    """
    serializer_class = CustomTokenObtainPairSerializer 
    
    def post(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tokens = serializer.validated_data # Enthält 'access' und 'refresh'
        
        # 1. Hole den 'rememberMe'-Status
        remember_me = request.data.get('rememberMe', False)
        
        # 2. ANPASSUNG DER REFRESH TOKEN LEBENSDAUER (EXP)
        if tokens.get('refresh'):
            refresh_token_str = tokens['refresh']
            
            # Die Klasse RefreshToken muss importiert werden! (Ist jetzt behoben)
            refresh_token_obj = RefreshToken(refresh_token_str)
            
            if not remember_me:
                # Setze eine kurze Lebensdauer (z.B. 2 Stunden)
                short_lifetime = timedelta(hours=2) 
                
                refresh_token_obj.set_exp(from_time=datetime.now(timezone.utc), lifetime=short_lifetime)
                
                # Aktualisiere den String im Dictionary
                tokens['refresh'] = str(refresh_token_obj)
        
        # 3. SETZEN DES COOKIES
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
            
            # Wir verwenden die maximale Lebensdauer, da die Sicherheit über die Token-EXP
            # (die im Login gesetzt wurde) gewährleistet ist.
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
        response = Response({"message": "Logout erfolgreich!"}, status=status.HTTP_200_OK)

        response.set_cookie(
            key="refresh_token",
            values="",
            max_age=0,
            expires="Thu, 01 Jan 1970 00:00:00 GMT",
            secure=True,
            httponly=True,
            samesite="Lax"
        )
        return response