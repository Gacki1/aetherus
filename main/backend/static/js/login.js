// login.js

// Determine redirect URL: honour ?next= param (for subdomain login flow)
function getRedirectUrl() {
    const params = new URLSearchParams(window.location.search);
    const next = params.get('next');
    // Only allow redirects to aetherus.net subdomains (prevent open redirect)
    if (next && /^https:\/\/[a-z0-9-]+\.aetherus\.net(\/.*)?(\?.*)?$/i.test(next)) {
        return next;
    }
    return '/main';
}
const REDIRECT_URL = getRedirectUrl();

// Show activation/reset messages from URL params
document.addEventListener('DOMContentLoaded', function() {
    const params = new URLSearchParams(window.location.search);
    const messageBox = document.getElementById('message-box');

    if (params.get('activated') === 'true') {
        messageBox.textContent = 'Account erfolgreich aktiviert! Du kannst dich jetzt einloggen.';
        messageBox.className = 'message success';
        messageBox.style.display = 'block';
    } else if (params.get('already_active') === 'true') {
        messageBox.textContent = 'Account ist bereits aktiviert.';
        messageBox.className = 'message info';
        messageBox.style.display = 'block';
    } else if (params.get('activation_expired') === 'true') {
        messageBox.textContent = 'Aktivierungslink ist abgelaufen. Bitte registriere dich erneut.';
        messageBox.className = 'message error';
        messageBox.style.display = 'block';
    } else if (params.get('activation_invalid') === 'true') {
        messageBox.textContent = 'Ungültiger Aktivierungslink.';
        messageBox.className = 'message error';
        messageBox.style.display = 'block';
    }

    // Clean URL params without page reload (keep ?next= intact)
    const cleanParams = new URLSearchParams(window.location.search);
    const nextParam = cleanParams.get('next');
    if (cleanParams.toString()) {
        const keepUrl = nextParam ? `/login?next=${encodeURIComponent(nextParam)}` : '/login';
        window.history.replaceState({}, '', keepUrl);
    }
});

document.getElementById('login-form').addEventListener('submit', function (event) {
    event.preventDefault();

    const form = event.target;
    const username = form.username.value;
    const password = form.password.value;
    const messageBox = document.getElementById('message-box');
    const rememberMe = document.getElementById("rememberMeCheckbox").checked;
    const submitBtn = form.querySelector('button[type="submit"]');

    // Reset
    messageBox.style.display = 'none';
    messageBox.textContent = '';

    // Disable button
    submitBtn.disabled = true;
    submitBtn.textContent = 'Anmelden...';

    function getCookie(name) {
        let cookieValue = null;
        if (document.cookie && document.cookie !== "") {
            const cookies = document.cookie.split(";");
            for (let i = 0; i < cookies.length; i++) {
                const cookie = cookies[i].trim();
                if (cookie.substring(0, name.length + 1) === (name + "=")) {
                    cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                }
            }
        }
        return cookieValue;
    }

    fetch('/api/auth/login/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            "X-CSRFToken": getCookie("csrftoken"),
        },
        body: JSON.stringify({
            username,
            password,
            rememberMe: rememberMe,
        })
    })
    .then(async response => {
        const data = await response.json();

        if (response.status === 200) {
            localStorage.setItem('auth_mode', data.mode);

            messageBox.textContent = 'Login erfolgreich! Weiterleitung...';
            messageBox.className = 'message success';
            messageBox.style.display = 'block';

            setTimeout(() => {
                window.location.href = REDIRECT_URL;
            }, 500);

        } else if (response.status === 429) {
            throw new Error(data.error || 'Zu viele Versuche. Bitte warte etwas.');
        } else if (response.status === 401) {
            throw new Error(data.error || 'Anmeldung fehlgeschlagen.');
        } else {
            throw new Error('Serverfehler (' + response.status + ')');
        }
    })
    .catch(error => {
        messageBox.textContent = error.message || 'Ein Netzwerkfehler ist aufgetreten.';
        messageBox.className = 'message error';
        messageBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Einloggen';
    });
});
