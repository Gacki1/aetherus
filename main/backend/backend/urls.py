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
from django.urls import path, include
from .views import (
    SessionLogoutView, 
    UserProfileView, 
    SessionLoginView, 
    DashboardView, 
    login_page_view, 
    start_page_view, 
    register_page_view
)

urlpatterns = [
    path('admin/', admin.site.urls), 

    # HTML Seiten
    path("", start_page_view, name="start"),
    path("main", DashboardView.as_view(), name="dashboard"),
    path("login", login_page_view, name="login_page"),
    path("register", register_page_view, name="register_page"),

    # API Endpunkte
    path("api/auth/login/", SessionLoginView.as_view(), name="api_login"),
    path("api/auth/logout/", SessionLogoutView.as_view(), name="api_logout"),
    path("api/auth/me/", UserProfileView.as_view(), name="user_me"),

    path('api/auth/', include('djoser.urls')),
]
