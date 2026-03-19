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
    path("stoxview", pages.stoxview_page_view, name="stoxview"),
    path("cloud/edit/<int:file_id>/", pages.editor_page_view, name="editor"),
    path("cloud/edit/<int:file_id>/save/", pages.editor_save_view, name="editor_save"),
    path("cloud/share/<int:file_id>/", pages.share_file_view, name="cloud_share"),
    path("cloud/unshare/<int:share_id>/", pages.unshare_file_view, name="cloud_unshare"),
    path("cloud/share/accept/<int:share_id>/", pages.accept_share_view, name="cloud_share_accept"),
    path("cloud/share/decline/<int:share_id>/", pages.decline_share_view, name="cloud_share_decline"),
    path("cloud/share/remove/<int:share_id>/", pages.remove_received_share_view, name="cloud_share_remove"),
    path("cloud/delete/<int:file_id>/", pages.cloud_delete_file_view, name="cloud_delete_file"),
    path("share/<uuid:token>/", pages.shared_download_view, name="shared_download"),
    path("login", pages.login_page_view, name="login_page"),
    path("register", pages.register_page_view, name="register_page"),
    path("profile", pages.profile_page_view, name="profile"),
    path("profile/avatar/upload/", pages.avatar_upload_view, name="avatar_upload"),
    path("profile/avatar/delete/", pages.avatar_delete_view, name="avatar_delete"),
    path("password-reset", pages.password_reset_page_view, name="password_reset_page"),

    # 4. API Authentication
    path("api/auth/login/", auth.SessionLoginView.as_view(), name="api_login"),
    path("api/auth/logout/", auth.SessionLogoutView.as_view(), name="api_logout"),
    path("api/auth/me/", auth.UserProfileView.as_view(), name="user_me"),
    path("api/auth/change-password/", auth.ChangePasswordView.as_view(), name="change_password"),
    path("api/auth/change-username/", auth.ChangeUsernameView.as_view(), name="change_username"),
    path("api/auth/change-email/", auth.ChangeEmailView.as_view(), name="change_email"),
    path("api/auth/password-reset/", auth.PasswordResetRequestView.as_view(), name="password_reset"),
    path("api/auth/password-reset/confirm/", auth.PasswordResetConfirmView.as_view(), name="password_reset_confirm"),

    # 5. Djoser (for further auth management)
    path('api/auth/', include('djoser.urls')),
    path("api/auth/", include("djoser.urls.authtoken")),

    # 6. Chat Group API
    path("api/chat/groups/", pages.chat_groups_list_view, name="chat_groups_list"),
    path("api/chat/groups/create/", pages.chat_group_create_view, name="chat_group_create"),
    path("api/chat/groups/<int:group_id>/invite/", pages.chat_group_invite_view, name="chat_group_invite"),
    path("api/chat/groups/<int:group_id>/accept/", pages.chat_group_accept_invite_view, name="chat_group_accept"),
    path("api/chat/groups/<int:group_id>/decline/", pages.chat_group_decline_invite_view, name="chat_group_decline"),
    path("api/chat/groups/<int:group_id>/leave/", pages.chat_group_leave_view, name="chat_group_leave"),
    path("api/chat/groups/<int:group_id>/delete/", pages.chat_group_delete_view, name="chat_group_delete"),
    path("api/chat/groups/<int:group_id>/icon/upload/", pages.chat_group_icon_upload_view, name="chat_group_icon_upload"),
    path("api/chat/groups/<int:group_id>/icon/delete/", pages.chat_group_icon_delete_view, name="chat_group_icon_delete"),
    path("api/chat/groups/<int:group_id>/members/", pages.chat_group_members_view, name="chat_group_members"),
    path("api/chat/groups/<int:group_id>/role/", pages.chat_group_change_role_view, name="chat_group_change_role"),
    path("api/chat/groups/<int:group_id>/kick/", pages.chat_group_kick_view, name="chat_group_kick"),
    path("api/chat/groups/<int:group_id>/rename/", pages.chat_group_rename_view, name="chat_group_rename"),
]

# Custom error handlers
handler404 = 'backend.views.pages.custom_404'
