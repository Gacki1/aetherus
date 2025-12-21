document.getElementById('register-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    // 1. Button und Original-Text holen
    const submitBtn = this.querySelector('button[type="submit"]'); // Sucht den Button im Formular
    const originalBtnText = submitBtn.textContent;

    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const re_password = document.getElementById('reg-password-confirm').value;

    // Nachrichtbox vorher leeren/ausblenden
    const messageBox = document.getElementById('message-box');
    messageBox.style.display = 'none';

    if (password !== re_password) {
        showMessage("Passwörter stimmen nicht überein!", "error");
        return;
    }

    // 2. Button sperren & Lade-Text anzeigen
    submitBtn.disabled = true;
    submitBtn.textContent = "Verarbeite..."; // Oder ein Spinner-Icon
    submitBtn.style.opacity = "0.7"; // Optional: Optisch ausgrauen

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

        const data = await response.json();

        if (response.ok) {
            showMessage("Account erstellt! Bitte prüfe deine E-Mails (auch den Spam Ordner) zur Aktivierung.", "success");

            // Button bleibt deaktiviert, damit niemand während der Weiterleitung nochmal klickt

            setTimeout(() => {
                window.location.href = '/login';
            }, 3000);
        } else {
            // Fehlerausgabe
            let errorMsg = "Registrierung fehlgeschlagen.";
            if (data.email) errorMsg = `E-Mail: ${data.email[0]}`;
            else if (data.username) errorMsg = `Username: ${data.username[0]}`;
            else if (data.password) errorMsg = `Passwort: ${data.password[0]}`;

            showMessage(errorMsg, "error");

            // 3. WICHTIG: Button wieder freigeben, falls es ein Fehler war!
            submitBtn.disabled = false;
            submitBtn.textContent = originalBtnText;
            submitBtn.style.opacity = "1";
        }
    } catch (error) {
        showMessage("Serverfehler. Bitte später versuchen.", "error");

        // Auch hier Button wieder freigeben
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
        submitBtn.style.opacity = "1";
    }
});

function showMessage(text, type) {
    const messageBox = document.getElementById('message-box');
    messageBox.textContent = text;
    messageBox.className = `message ${type}`;
    messageBox.style.display = 'block';
}