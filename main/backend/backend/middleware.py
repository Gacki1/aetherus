# backend/middleware.py
from django.shortcuts import redirect


class GuestRestrictionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Authenticated users pass through
        if request.user.is_authenticated:
            return self.get_response(request)

        # Allowed paths for guests
        allowed_prefixes = [
            '/start',
            '/login',
            '/register',
            '/password-reset',
            '/static/',
            '/media/',
            '/api/',
            '/admin/'
        ]

        if request.path == '/' or any(request.path.startswith(prefix) for prefix in allowed_prefixes):
            return self.get_response(request)

        return redirect('/login')
