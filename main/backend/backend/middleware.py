# backend/middleware.py
from django.shortcuts import redirect

class GuestRestrictionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        print(f"--- MIDDLEWARE CHECK: {request.path} ---")

        # 1. Ist User eingeloggt?
        if request.user.is_authenticated:
            print(f"DEBUG: User {request.user} ist eingeloggt -> ERLAUBT")
            return self.get_response(request)
        
        print("DEBUG: User ist Gast.")

        # 2. Liste verbessern (Mit Slashes am Ende!)
        allowed_prefixes = [
            '/start/', 
            '/login/', 
            '/register/', 
            '/static/', 
            '/media/', 
            '/api/',
            '/admin/'
        ]

        # Prüfung
        # Wir prüfen: Ist es exakt "/" ODER fängt es mit einem erlaubten Pfad an?
        if request.path == '/' or any(request.path.startswith(prefix) for prefix in allowed_prefixes):
             print("DEBUG: Pfad steht auf der Whitelist -> ERLAUBT")
             return self.get_response(request)

        # 3. Rauswurf
        print(f"DEBUG: {request.path} ist verboten -> REDIRECT zu /login")
        return redirect('/login')