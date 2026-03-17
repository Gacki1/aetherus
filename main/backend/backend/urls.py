from django.contrib import admin
from django.urls import path, include
from django.views.generic import RedirectView
from .views import pages, auth

urlpatterns = [
    path('', RedirectView.as_view(url='/start', permanent=False)),

    # 1. API Registrierung & Aktivierung (Muss vor Djoser stehen!)
    path("api/auth/register/", auth.RegisterAPIView.as_view(), name="api_register"),
    # Geänderter Pfad für den TimestampSigner Workflow:
    path("api/auth/activate/<str:activation_key>/", auth.ActivateAccountView.as_view(), name="activate"),

    # 2. Django Admin
    path('admin/', admin.site.urls), 

    path("start", pages.start_page_view, name="start"),
    path("chat", pages.chat_page_view, name="chat"),
    path("main", pages.DashboardView.as_view(), name="dashboard"),
    path("cloud", pages.cloud_page_view, name="cloud"),
    path("login", pages.login_page_view, name="login_page"),
    path("register", pages.register_page_view, name="register_page"),

    # 4. API Authentifizierung
    path("api/auth/login/", auth.SessionLoginView.as_view(), name="api_login"),
    path("api/auth/logout/", auth.SessionLogoutView.as_view(), name="api_logout"),
    path("api/auth/me/", auth.UserProfileView.as_view(), name="user_me"),

    # 5. Djoser (für Passwort-Reset etc.)
    path('api/auth/', include('djoser.urls')),
    path("api/auth/", include("djoser.urls.authtoken")),
]