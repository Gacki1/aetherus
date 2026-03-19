import logging
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from django.shortcuts import redirect
from django.core.mail import send_mail
from django.core.signing import TimestampSigner, SignatureExpired
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.conf import settings

logger = logging.getLogger('backend')


def get_client_ip(request):
    """Extract client IP, respecting proxy headers."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        return x_forwarded_for.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def check_rate_limit(key_prefix, identifier, max_attempts, window):
    """Check and enforce rate limiting using Django cache. Returns (allowed, attempts_left)."""
    cache_key = f"rate_limit:{key_prefix}:{identifier}"
    attempts = cache.get(cache_key, 0)
    if attempts >= max_attempts:
        return False, 0
    return True, max_attempts - attempts


def increment_rate_limit(key_prefix, identifier, window):
    """Increment the rate limit counter."""
    cache_key = f"rate_limit:{key_prefix}:{identifier}"
    attempts = cache.get(cache_key, 0)
    cache.set(cache_key, attempts + 1, window)


def clear_rate_limit(key_prefix, identifier):
    """Clear rate limit on successful action (e.g. login)."""
    cache_key = f"rate_limit:{key_prefix}:{identifier}"
    cache.delete(cache_key)


class RegisterAPIView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        ip = get_client_ip(request)

        # Rate limiting
        allowed, _ = check_rate_limit(
            'register', ip,
            settings.RATE_LIMIT_REGISTER_ATTEMPTS,
            settings.RATE_LIMIT_REGISTER_WINDOW
        )
        if not allowed:
            return Response(
                {"error": "Zu viele Registrierungsversuche. Bitte warte eine Stunde."},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )

        username = request.data.get("username", "").strip()
        email = request.data.get("email", "").strip()
        password = request.data.get("password")
        re_password = request.data.get("re_password")

        # Validation
        if not username or not email or not password:
            return Response({"error": "Alle Felder sind erforderlich."}, status=status.HTTP_400_BAD_REQUEST)

        if len(username) < 3 or len(username) > 30:
            return Response({"error": "Benutzername muss zwischen 3 und 30 Zeichen lang sein."}, status=status.HTTP_400_BAD_REQUEST)

        if password != re_password:
            return Response({"error": "Passwörter stimmen nicht überein."}, status=status.HTTP_400_BAD_REQUEST)

        # Django password validation
        try:
            validate_password(password)
        except ValidationError as e:
            return Response({"error": e.messages[0]}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username=username).exists():
            return Response({"error": "Benutzername bereits vergeben."}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(email=email).exists():
            return Response({"error": "E-Mail-Adresse wird bereits verwendet."}, status=status.HTTP_400_BAD_REQUEST)

        # Create inactive user
        user = User.objects.create_user(username=username, email=email, password=password)
        user.is_active = False
        user.save()

        # Generate activation link
        signer = TimestampSigner()
        activation_key = signer.sign(user.username)
        activation_link = f"https://aetherus.net/api/auth/activate/{activation_key}/"

        # Send verification email
        subject = 'Aetherus - Account verifizieren'
        message = (
            f'Willkommen {username}!\n\n'
            f'Es freut uns, dass du dich auf Aetherus etwas umsehen willst!\n\n'
            f'Klicke auf den Link, um dein Konto zu aktivieren: {activation_link}\n\n'
            f'Der Link ist 48 Stunden gültig.\n\n'
            f'Dein Aetherus Team.'
        )

        try:
            send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)
            logger.info(f"Activation email sent to {email}")
        except Exception as e:
            logger.error(f"Failed to send activation email: {e}")
            # Don't expose internal error details to user
            user.delete()
            return Response(
                {"error": "E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        increment_rate_limit('register', ip, settings.RATE_LIMIT_REGISTER_WINDOW)
        return Response({"message": "Bitte prüfe deine E-Mails!"}, status=status.HTTP_201_CREATED)


class ActivateAccountView(APIView):
    permission_classes = [AllowAny]

    def get(self, request, activation_key):
        signer = TimestampSigner()
        try:
            username = signer.unsign(activation_key, max_age=172800)  # 48 hours
            user = User.objects.get(username=username)
        except SignatureExpired:
            return redirect("/login?activation_expired=true")
        except (User.DoesNotExist, Exception):
            return redirect("/login?activation_invalid=true")

        if not user.is_active:
            user.is_active = True
            user.save()
            logger.info(f"User {username} activated successfully")
            return redirect("/login?activated=true")

        return redirect("/login?already_active=true")


class SessionLoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        ip = get_client_ip(request)

        # Rate limiting
        allowed, _ = check_rate_limit(
            'login', ip,
            settings.RATE_LIMIT_LOGIN_ATTEMPTS,
            settings.RATE_LIMIT_LOGIN_WINDOW
        )
        if not allowed:
            return Response(
                {"error": "Zu viele Login-Versuche. Bitte warte 5 Minuten."},
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )

        username = request.data.get("username")
        password = request.data.get("password")
        remember_me = request.data.get("rememberMe", False)

        user = authenticate(request, username=username, password=password)

        if user is not None:
            login(request, user)
            clear_rate_limit('login', ip)

            if remember_me:
                request.session.set_expiry(2592000)  # 30 days
            else:
                request.session.set_expiry(0)

            return Response({
                "message": "Erfolgreich eingeloggt",
                "username": user.username,
                "mode": "browser" if remember_me else "tab"
            }, status=status.HTTP_200_OK)

        increment_rate_limit('login', ip, settings.RATE_LIMIT_LOGIN_WINDOW)
        return Response({"error": "Ungültige Anmeldedaten."}, status=status.HTTP_401_UNAUTHORIZED)


class SessionLogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        logout(request)
        return Response({"message": "Erfolgreich ausgeloggt."}, status=status.HTTP_200_OK)


class UserProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        from ..models import CloudFile
        from django.db.models import Sum

        total_files = CloudFile.objects.filter(user=user).count()
        total_storage = CloudFile.objects.filter(user=user).aggregate(total=Sum('file_size'))['total'] or 0

        return Response({
            "username": user.username,
            "email": user.email,
            "date_joined": user.date_joined.isoformat(),
            "last_login": user.last_login.isoformat() if user.last_login else None,
            "is_staff": user.is_staff,
            "cloud_files": total_files,
            "cloud_storage_used": total_storage,
            "cloud_storage_limit": settings.MAX_CLOUD_STORAGE_PER_USER,
        })


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        old_password = request.data.get("old_password")
        new_password = request.data.get("new_password")
        confirm_password = request.data.get("confirm_password")

        if not request.user.check_password(old_password):
            return Response({"error": "Aktuelles Passwort ist falsch."}, status=status.HTTP_400_BAD_REQUEST)

        if new_password != confirm_password:
            return Response({"error": "Neue Passwörter stimmen nicht überein."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(new_password, request.user)
        except ValidationError as e:
            return Response({"error": e.messages[0]}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_password)
        request.user.save()
        update_session_auth_hash(request, request.user)
        logger.info(f"User {request.user.username} changed password")
        return Response({"message": "Passwort erfolgreich geändert."})


class PasswordResetRequestView(APIView):
    """Send a password reset email."""
    permission_classes = [AllowAny]

    def post(self, request):
        email = request.data.get("email", "").strip()
        ip = get_client_ip(request)

        # Rate limit password resets
        allowed, _ = check_rate_limit('pw_reset', ip, 3, 3600)
        if not allowed:
            return Response(
                {"message": "Falls die E-Mail-Adresse existiert, wurde ein Link versendet."},
                status=status.HTTP_200_OK
            )

        # Always return same message (don't reveal if email exists)
        try:
            user = User.objects.get(email=email, is_active=True)
        except User.DoesNotExist:
            return Response(
                {"message": "Falls die E-Mail-Adresse existiert, wurde ein Link versendet."},
                status=status.HTTP_200_OK
            )

        signer = TimestampSigner()
        reset_key = signer.sign(user.username)
        reset_link = f"https://aetherus.net/password-reset?key={reset_key}"

        subject = 'Aetherus - Passwort zurücksetzen'
        message = (
            f'Hallo {user.username},\n\n'
            f'Du hast angefragt, dein Passwort zurückzusetzen.\n\n'
            f'Klicke auf diesen Link: {reset_link}\n\n'
            f'Der Link ist 1 Stunde gültig. Falls du diese Anfrage nicht gestellt hast, '
            f'kannst du diese E-Mail ignorieren.\n\n'
            f'Dein Aetherus Team.'
        )

        try:
            send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)
        except Exception as e:
            logger.error(f"Failed to send password reset email: {e}")

        increment_rate_limit('pw_reset', ip, 3600)
        return Response({"message": "Falls die E-Mail-Adresse existiert, wurde ein Link versendet."})


class PasswordResetConfirmView(APIView):
    """Confirm a password reset with a new password."""
    permission_classes = [AllowAny]

    def post(self, request):
        reset_key = request.data.get("key")
        new_password = request.data.get("new_password")
        confirm_password = request.data.get("confirm_password")

        if new_password != confirm_password:
            return Response({"error": "Passwörter stimmen nicht überein."}, status=status.HTTP_400_BAD_REQUEST)

        signer = TimestampSigner()
        try:
            username = signer.unsign(reset_key, max_age=3600)  # 1 hour
            user = User.objects.get(username=username)
        except SignatureExpired:
            return Response({"error": "Link ist abgelaufen. Bitte fordere einen neuen an."}, status=status.HTTP_400_BAD_REQUEST)
        except (User.DoesNotExist, Exception):
            return Response({"error": "Ungültiger Link."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(new_password, user)
        except ValidationError as e:
            return Response({"error": e.messages[0]}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save()
        logger.info(f"User {username} reset password successfully")
        return Response({"message": "Passwort erfolgreich geändert. Du kannst dich jetzt einloggen."})
