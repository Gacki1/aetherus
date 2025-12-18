document.getElementById('register-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    const username = document.getElementById('reg-username').value;
    const email = document.getElementById('reg-email').value; // E-Mail aus dem Feld holen
    const password = document.getElementById('reg-password').value;
    const re_password = document.getElementById('reg-password-confirm').value;

    if (password !== re_password) {
        showMessage("Passwörter stimmen nicht überein!", "error");
        return;
    }

    try {
        const response = await fetch('/api/auth/register/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: username,
                email: email,      // E-Mail an das Backend senden
                password: password,
                re_password: re_password
            })
        });

        const data = await response.json();

        if (response.ok) {
            // Text angepasst, da der User erst verifizieren muss
            showMessage("Account erstellt! Bitte prüfe deine E-Mails (auch den Spam Ordner) zur Aktivierung.", "success");
            setTimeout(() => {
                window.location.href = '/login'; // .html entfernt für Clean URLs
            }, 3000);
        } else {
            // Fehlerausgabe verfeinert
            let errorMsg = "Registrierung fehlgeschlagen.";
            if (data.email) errorMsg = `E-Mail: ${data.email[0]}`;
            else if (data.username) errorMsg = `Username: ${data.username[0]}`;
            else if (data.password) errorMsg = `Passwort: ${data.password[0]}`;

            showMessage(errorMsg, "error");
        }
    } catch (error) {
        showMessage("Serverfehler. Bitte später versuchen.", "error");
    }
});

function showMessage(text, type) {
    const messageBox = document.getElementById('message-box');
    messageBox.textContent = text;
    messageBox.className = `message ${type}`;
    messageBox.style.display = 'block';
}