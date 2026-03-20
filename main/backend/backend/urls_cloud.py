from django.urls import path
from .views import pages

urlpatterns = [
    path('', pages.cloud_page_view, name="cloud"),
    path("edit/<int:file_id>/", pages.editor_page_view, name="editor"),
    path("edit/<int:file_id>/save/", pages.editor_save_view, name="editor_save"),
    path("share/<int:file_id>/", pages.share_file_view, name="cloud_share"),
    path("unshare/<int:share_id>/", pages.unshare_file_view, name="cloud_unshare"),
    path("share/accept/<int:share_id>/", pages.accept_share_view, name="cloud_share_accept"),
    path("share/decline/<int:share_id>/", pages.decline_share_view, name="cloud_share_decline"),
    path("share/remove/<int:share_id>/", pages.remove_received_share_view, name="cloud_share_remove"),
    path("delete/<int:file_id>/", pages.cloud_delete_file_view, name="cloud_delete_file"),
    path("share/<uuid:token>/", pages.shared_download_view, name="shared_download"),
]

handler404 = 'backend.views.pages.custom_404'
