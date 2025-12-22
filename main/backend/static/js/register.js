document.addEventListener("DOMContentLoaded", function () {
    const registerForm = document.getElementById('register-form');

    // Nur ausführen, wenn das Formular auf der Seite existiert
    if (registerForm) {
        registerForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            // 1. Elemente holen
            const submitBtn = this.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.textContent;

            const username = document.getElementById('reg-username').value;
            const email = document.getElementById('reg-email').value;
            const password = document.getElementById('reg-password').value;
            const re_password = document.getElementById('reg-password-confirm').value;

            // Nachrichtbox zurücksetzen
            const messageBox = document.getElementById('message-box');
            messageBox.style.display = 'none';
            messageBox.className = 'message'; // Klassen resetten

            // 2. Client-Side Validierung (Passwörter)
            if (password !== re_password) {
                showMessage("Die Passwörter stimmen nicht überein!", "error");
                return;
            }

            // 3. Button sperren & Lade-Status
            submitBtn.disabled = true;
            submitBtn.textContent = "Verarbeite...";
            submitBtn.style.opacity = "0.7";

            try {
                const response = await fetch('/api/auth/register/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        username: username,
                        email: email,
                        password: password,
                        re_password: re_password
                    })
                });

                // Antwort parsen
                const data = await response.json();

                if (response.ok) {
                    // --- ERFOLG ---
                    showMessage("Account erfolgreich erstellt! Bitte prüfe deine E-Mails.", "success");

                    // Optional: Weiterleitung nach 2 Sekunden
                    // setTimeout(() => window.location.href = '/login', 2000);

                    // Wir lassen den Button disabled, damit man nicht doppelt klickt
                } else {
                    // --- FEHLER ---
                    console.log("Server Error Data:", data); // Für Debugging (F12)

                    let errorMsg = "Registrierung fehlgeschlagen.";

                    // Wir prüfen alle möglichen Fehlerquellen ab, die Django senden könnte:

                    // 1. Spezifische Felder
                    if (data.email) {
                        errorMsg = `E-Mail: ${getErrorText(data.email)}`;
                    }
                    else if (data.username) {
                        errorMsg = `Username: ${getErrorText(data.username)}`;
                    }
                    else if (data.password) {
                        errorMsg = `Passwort: ${getErrorText(data.password)}`;
                    }
                    else if (data.re_password) {
                        errorMsg = `Passwort Wdh: ${getErrorText(data.re_password)}`;
                    }
                    // 2. Allgemeine Fehler (Django 'non_field_errors')
                    else if (data.non_field_errors) {
                        errorMsg = getErrorText(data.non_field_errors);
                    }
                    // 3. Detail Fehler (oft bei Auth/Throttling)
                    else if (data.detail) {
                        errorMsg = data.detail;
                    }
                    // 4. Fallback: Irgendeinen anderen Key suchen
                    else {
                        const keys = Object.keys(data);
                        if (keys.length > 0) {
                            const firstKey = keys[0];
                            errorMsg = `${firstKey}: ${getErrorText(data[firstKey])}`;
                        }
                    }

                    showMessage(errorMsg, "error");
                    resetButton(submitBtn, originalBtnText);
                }

            } catch (error) {
                console.error("Netzwerkfehler:", error);
                showMessage("Verbindung zum Server fehlgeschlagen.", "error");
                resetButton(submitBtn, originalBtnText);
            }
        });
    }
});

/**
 * Hilfsfunktion: Setzt den Button zurück
 */
function resetButton(btn, originalText) {
    btn.disabled = false;
    btn.textContent = originalText;
    btn.style.opacity = "1";
}

/**
 * Hilfsfunktion: Zeigt die Message-Box an
 */
function showMessage(text, type) {
    const messageBox = document.getElementById('message-box');
    messageBox.textContent = text;
    // Klassen setzen: 'message' ist Basis, 'error'/'success' für Farbe
    messageBox.className = `message ${type}`;
    messageBox.style.display = 'block';
}

/**
 * Hilfsfunktion: Extrahiert Text aus Array oder String
 * Django sendet Fehler oft als Array ['Fehlertext'], manchmal als String.
 */
function getErrorText(errorData) {
    if (Array.isArray(errorData)) {
        return errorData[0];
    }
    return errorData;
}