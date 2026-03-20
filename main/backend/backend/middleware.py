# backend/middleware.py
from django.shortcuts import redirect
from django.http import HttpResponseRedirect
from urllib.parse import quote

MAIN_DOMAIN = "aetherus.net"


class GuestRestrictionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Authenticated users pass through
        if request.user.is_authenticated:
            return self.get_response(request)

        host = request.get_host().split(':')[0]
        is_subdomain = (
            host != MAIN_DOMAIN
            and host != f"www.{MAIN_DOMAIN}"
            and host.endswith(f".{MAIN_DOMAIN}")
        )

        # Subdomain guests: allow static/media/API, redirect rest to main login
        if is_subdomain:
            allowed_prefixes = ['/static/', '/media/', '/api/']
            if any(request.path.startswith(prefix) for prefix in allowed_prefixes):
                return self.get_response(request)
            # Redirect to main domain login with ?next= back to subdomain
            scheme = 'https' if request.is_secure() else 'http'
            next_url = f"{scheme}://{host}{request.get_full_path()}"
            return HttpResponseRedirect(
                f"https://{MAIN_DOMAIN}/login?next={quote(next_url)}"
            )

        # Main domain: allowed paths for guests
        allowed_prefixes = [
            '/start',
            '/login',
            '/logout',
            '/register',
            '/password-reset',
            '/static/',
            '/media/',
            '/api/',
            '/admin/',
            '/share/',
        ]

        if request.path == '/' or any(request.path.startswith(prefix) for prefix in allowed_prefixes):
            return self.get_response(request)

        return redirect('/login')
