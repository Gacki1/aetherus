from django.shortcuts import redirect

class GuestRestrictionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated:
            return self.get_response(request)
        
        allowed_paths = [
            "/start",
            "/login",
            "/register",
            "/static/",
            "/media/",
            "/api/",
            "/admin/"
        ]

        current_path = request.path
        is_allowed = False
        for path in allowed_paths:
            if current_path.startswith(path):
                is_allowed = True
                break
        
        if is_allowed:
            return self.get_response(request)
        else:
            return redirect("")