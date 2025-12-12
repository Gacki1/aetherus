document.getElementById('login-form').addEventListener('submit', function (event) {
    // Verhindert das Standard-Senden des Formulars (Seiten-Neuladen)
    event.preventDefault();

    // Elemente holen
    const form = event.target;
    const username = form.username.value;
    const password = form.password.value;
    const messageBox = document.getElementById('message-box');

    // 1. Anzeige leeren
    messageBox.style.display = 'none';
    messageBox.className = 'message';
    messageBox.textContent = '';

    // 2. POST-Anfrage an das Backend senden
    fetch('/api/token/', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        // Daten als JSON-String senden
        body: JSON.stringify({ username, password })
    })
        .then(response => {
            // Den Statuscode überprüfen
            if (response.status === 200) {
                // Erfolg, JSON-Daten lesen
                return response.json();
            } else if (response.status === 401) {
                // Fehler, auch JSON-Daten lesen
                return response.json().then(data => {
                    // Wirf einen Fehler, um in den .catch Block zu springen
                    throw new Error(data.message || 'Anmeldung fehlgeschlagen.');
                });
            } else {
                throw new Error('Serverfehler (' + response.status + ')');
            }
        })
        .then(data => {
            localStorage.setItem("access_token", data.access);
            localStorage.setItem("refresh_token", data.refresh);
            const REDIRECT_URL = "/main.html";

            messageBox.textContent = 'Login erfolgreich! Weiterleitung...';
            messageBox.className = 'message success';
            messageBox.style.display = 'block';

            form.username.value = "";
            form.password.value = "";

            // Weiterleitung zur Zielseite
            window.location.href = REDIRECT_URL;
        })
        .catch(error => {
            // 4. Fehler verarbeiten (401 oder Netzwerkfehler)
            messageBox.textContent = error.message || 'Ein unbekannter Fehler ist aufgetreten.';
            messageBox.className = 'message error';
            messageBox.style.display = 'block';
        });
});