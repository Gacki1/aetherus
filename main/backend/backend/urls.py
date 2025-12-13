"""
URL configuration for backend project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path
from .views import CookieTokenObtainPairView, LogoutView, DashboardView
from django.urls import path, include


urlpatterns = [
    # 1. Admin-Pfad:
    path('admin/', admin.site.urls), 

    path('api/token/', CookieTokenObtainPairView.as_view(), name='token_obtain_pair'),

    path('api/auth/', include('djoser.urls')),
    path('api/auth/', include('djoser.urls.jwt')),
    path("api/auth/logout/", LogoutView.as_view(), name="auth_logout"),
    path("main.html", DashboardView.as_view(), name="dashboard"),
]
