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
from .views import SessionLogoutView, UserProfileView, SessionLoginView, DashboardView
from django.urls import path, include


urlpatterns = [
    # 1. Admin-Pfad:
    path('admin/', admin.site.urls), 

    path("main.html", DashboardView.as_view(), name="dashboard"),
    path("login.html", DashboardView.as_view(), name="login"),

    path("api/auth/login/", SessionLoginView.as_view(), name="login"),
    path("api/auth/logout/", SessionLogoutView.as_view(), name="logout"),
    path("api/auth/me/", UserProfileView.as_view(), name="user_me"),

    path('api/auth/', include('djoser.urls')),

]
