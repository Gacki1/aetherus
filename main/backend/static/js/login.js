// login.js — v3

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
    const nextParam = params.get('next');
    if (params.toString()) {
        const keepUrl = nextParam ? `/login?next=${encodeURIComponent(nextParam)}` : '/login';
        window.history.replaceState({}, '', keepUrl);
    }
});

// Enhance form submit: show loading state, let the browser POST natively.
// The form has action="/login" method="POST", so Django handles auth + redirect.
// We just add a loading indicator and disable double-submit.
document.getElementById('login-form').addEventListener('submit', function (event) {
    const form = event.target;
    const submitBtn = form.querySelector('button[type="submit"]');
    const messageBox = document.getElementById('message-box');

    // Hide previous messages
    messageBox.style.display = 'none';
    messageBox.textContent = '';

    // Disable button to prevent double-submit
    submitBtn.disabled = true;
    submitBtn.textContent = 'Anmelden...';

    // Let the native form POST proceed (no event.preventDefault)
});
