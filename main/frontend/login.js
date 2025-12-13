// login.js

// Konstante für die Weiterleitung nach erfolgreichem Login
const REDIRECT_URL = "/main.html";

document.getElementById('login-form').addEventListener('submit', function (event) {
    // Verhindert das Standard-Senden des Formulars (Seiten-Neuladen)
    event.preventDefault();

    // Elemente holen
    const form = event.target;
    const username = form.username.value;
    const password = form.password.value;
    const messageBox = document.getElementById('message-box');
    const rememberMe = document.getElementById("rememberMeCheckbox").checked;

    // 1. Anzeige leeren
    messageBox.style.display = 'none';
    messageBox.className = 'message';
    messageBox.textContent = '';

    // 2. POST-Anfrage an das Backend senden (DRF Token Obtain View)
    fetch('/api/token/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        // Daten als JSON-String senden
        body: JSON.stringify({
            username,
            password,
            rememberMe: rememberMe,
        })
    })
        .then(async response => {

            if (response.status === 200) {
                const data = await response.json();
                if (response.ok) {
                    // Speichern, ob wir im Tab- oder Browser-Modus sind
                    localStorage.setItem('auth_mode', data.mode);
                    window.location.href = '/main.html';
                }
                return response.json();
            } else if (response.status === 401) {
                // Fehler (Unauthorized), JSON-Daten lesen
                return response.json().then(data => {
                    // DRF verwendet den Schlüssel "detail" für Fehlermeldungen
                    throw new Error(data.detail || 'Anmeldung fehlgeschlagen.');
                });
            } else {
                // Unbekannter Serverfehler
                throw new Error('Serverfehler (' + response.status + ')');
            }
        })
        .then(data => {
            // 3. Erfolg verarbeiten (200 OK)

            // Speichere das kurzlebige Access Token für API-Aufrufe
            localStorage.setItem("access_token", data.access);

            // Das Refresh Token wird automatisch vom Backend als HttpOnly Cookie gesetzt
            // und muss hier NICHT gespeichert werden.

            messageBox.textContent = 'Login erfolgreich! Weiterleitung...';
            messageBox.className = 'message success';
            messageBox.style.display = 'block';

            form.username.value = "";
            form.password.value = "";

            // Weiterleitung zur Zielseite
            window.location.href = REDIRECT_URL;
        })
        .catch(error => {
            // 4. Fehler verarbeiten (401, Netzwerkfehler, ungültiges JSON)
            messageBox.textContent = error.message || 'Ein unbekannter Fehler ist aufgetreten.';
            messageBox.className = 'message error';
            messageBox.style.display = 'block';
        });
});