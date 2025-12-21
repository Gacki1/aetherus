from django.contrib import admin
from django.urls import path, include
from .views import (
    SessionLogoutView, 
    UserProfileView, 
    SessionLoginView, 
    DashboardView, 
    login_page_view, 
    start_page_view, 
    register_page_view,
    chat_page_view,
    RegisterAPIView,
    ActivateAccountView
)

urlpatterns = [
    # 1. API Registrierung & Aktivierung (Muss vor Djoser stehen!)
    path("api/auth/register/", RegisterAPIView.as_view(), name="api_register"),
    # Geänderter Pfad für den TimestampSigner Workflow:
    path("api/auth/activate/<str:activation_key>/", ActivateAccountView.as_view(), name="activate"),

    # 2. Django Admin
    path('admin/', admin.site.urls), 

    # 3. HTML Seiten (Frontend-Routen)
    path("", start_page_view, name="start"),
    path("chat", chat_page_view, name="chat"),
    path("main", DashboardView.as_view(), name="dashboard"),
    path("login", login_page_view, name="login_page"),
    path("register", register_page_view, name="register_page"),

    # 4. API Authentifizierung
    path("api/auth/login/", SessionLoginView.as_view(), name="api_login"),
    path("api/auth/logout/", SessionLogoutView.as_view(), name="api_logout"),
    path("api/auth/me/", UserProfileView.as_view(), name="user_me"),

    # 5. Djoser (für Passwort-Reset etc.)
    path('api/auth/', include('djoser.urls')),
    path("api/auth/", include("djoser.urls.authtoken")),
]