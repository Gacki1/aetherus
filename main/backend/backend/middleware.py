from django.shortcuts import redirect

class GuestRestrictionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # 1. Eingeloggte User dürfen alles
        if request.user.is_authenticated:
            return self.get_response(request)

        # 2. Liste der erlaubten Präfixe (OHNE '/')
        allowed_prefixes = [
            '/', 
            '/login', 
            '/register', 
            '/static/', 
            '/media/', 
            '/api/',
            '/admin/'
        ]

        if request.path == '/' or any(request.path.startswith(prefix) for prefix in allowed_prefixes):
            return self.get_response(request)

        return redirect('/login')