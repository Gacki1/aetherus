// login.js

// Konstante für die Weiterleitung nach erfolgreichem Login
const REDIRECT_URL = "/main.html";

document.getElementById('login-form').addEventListener('submit', function (event) {
    event.preventDefault();

    const form = event.target;
    const username = form.username.value;
    const password = form.password.value;
    const messageBox = document.getElementById('message-box');
    const rememberMe = document.getElementById("rememberMeCheckbox").checked;

    // Anzeige zurücksetzen
    messageBox.style.display = 'none';
    messageBox.textContent = '';

    // POST-Anfrage an den neuen Session-basierten Endpunkt
    fetch('/api/auth/login/', { // Wichtig: URL passend zur urls.py
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // Falls CSRF-Fehler auftreten, müsste hier der X-CSRFToken Header rein.
            // Da wir die View aber mit @csrf_exempt markiert haben, geht es so.
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
                // Erfolg: Wir speichern den Modus für die Tab-Close-Logik
                localStorage.setItem('auth_mode', data.mode);

                messageBox.textContent = 'Login erfolgreich! Weiterleitung...';
                messageBox.className = 'message success';
                messageBox.style.display = 'block';

                // Kurze Verzögerung, damit die Nachricht sichtbar ist und Cookies gesetzt werden
                setTimeout(() => {
                    window.location.href = REDIRECT_URL;
                }, 500);

            } else if (response.status === 401) {
                // Unauthorized (Falsche Zugangsdaten)
                throw new Error(data.error || 'Anmeldung fehlgeschlagen.');
            } else {
                // Anderer Serverfehler (z.B. 404 oder 500)
                throw new Error('Serverfehler (' + response.status + ')');
            }
        })
        .catch(error => {
            messageBox.textContent = error.message || 'Ein Netzwerkfehler ist aufgetreten.';
            messageBox.className = 'message error';
            messageBox.style.display = 'block';
        });
});