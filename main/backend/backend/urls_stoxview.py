from django.urls import path
from .views import pages

urlpatterns = [
    path('', pages.stoxview_page_view, name="stoxview"),
]

handler404 = 'backend.views.pages.custom_404'
