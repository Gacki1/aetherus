from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.mixins import LoginRequiredMixin
from django.views.generic import TemplateView
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.shortcuts import redirect

class DashboardView(LoginRequiredMixin, TemplateView):
    template_name="main.html"
    login_url="/login.html"

class SessionLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username")
        password = request.data.get("password")
        remember_me = request.data.get("rememberMe", False)

        user = authenticate(request, username=username, password=password)

        if user is not None:
            login(request, user)

            if remember_me:
                request.session.set_expiry(2592000)
            else:
                request.session.set_expiry(0)

            return Response({
                "message": "Erfolgreich eingeloggt",
                "username": user.username,
                "mode": "browser" if remember_me else "tab"
            }, status=status.HTTP_200_OK)
        
        return Response({"error": "Ungültige Anmeldedaten"}, status=status.HTTP_401_UNAUTHORIZED)
    
class SessionLogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({"message": "Erfolgreich ausgeloggt"}, status=status.HTTP_200_OK)
    
class UserProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({
            "username": request.user.username,
            "email": request.user.email
        })

class RedirectIfLoggedInMixin:
    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            return redirect("/main.html")
        return super().dispatch(request, *args, **kwargs)