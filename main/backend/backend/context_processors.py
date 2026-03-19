from .models import UserProfile


def user_profile(request):
    """Make the user's profile (with avatar) available in all templates."""
    if request.user.is_authenticated:
        try:
            profile, _ = UserProfile.objects.get_or_create(user=request.user)
            return {'user_profile': profile}
        except Exception:
            pass
    return {'user_profile': None}
