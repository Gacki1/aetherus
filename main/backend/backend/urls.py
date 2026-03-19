from django.contrib import admin
from django.urls import path, include
from django.views.generic import RedirectView
from .views import pages, auth

urlpatterns = [
    path('', RedirectView.as_view(url='/start', permanent=False)),

    # 1. API Registration & Activation
    path("api/auth/register/", auth.RegisterAPIView.as_view(), name="api_register"),
    path("api/auth/activate/<str:activation_key>/", auth.ActivateAccountView.as_view(), name="activate"),

    # 2. Django Admin
    path('admin/', admin.site.urls),

    # 3. Pages
    path("start", pages.start_page_view, name="start"),
    path("chat", pages.chat_page_view, name="chat"),
    path("main", pages.DashboardView.as_view(), name="dashboard"),
    path("cloud", pages.cloud_page_view, name="cloud"),
    path("login", pages.login_page_view, name="login_page"),
    path("register", pages.register_page_view, name="register_page"),
    path("profile", pages.profile_page_view, name="profile"),
    path("password-reset", pages.password_reset_page_view, name="password_reset_page"),

    # 4. API Authentication
    path("api/auth/login/", auth.SessionLoginView.as_view(), name="api_login"),
    path("api/auth/logout/", auth.SessionLogoutView.as_view(), name="api_logout"),
    path("api/auth/me/", auth.UserProfileView.as_view(), name="user_me"),
    path("api/auth/change-password/", auth.ChangePasswordView.as_view(), name="change_password"),
    path("api/auth/password-reset/", auth.PasswordResetRequestView.as_view(), name="password_reset"),
    path("api/auth/password-reset/confirm/", auth.PasswordResetConfirmView.as_view(), name="password_reset_confirm"),

    # 5. Djoser (for further auth management)
    path('api/auth/', include('djoser.urls')),
    path("api/auth/", include("djoser.urls.authtoken")),
]

# Custom error handlers
handler404 = 'backend.views.pages.custom_404'
