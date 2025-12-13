document.getElementById('register-form').addEventListener('submit', async function (e) {
    e.preventDefault();

    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const re_password = document.getElementById('reg-password-confirm').value;
    const messageBox = document.getElementById('message-box');

    // Einfacher Check vorab
    if (password !== re_password) {
        showMessage("Passwörter stimmen nicht überein!", "error");
        return;
    }

    try {
        const response = await fetch('/api/auth/users/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: username,
                password: password,
                re_password: re_password
            })
        });

        const data = await response.json();

        if (response.ok) {
            showMessage("Account erfolgreich erstellt! Leite zum Login weiter...", "success");
            setTimeout(() => {
                window.location.href = '/login.html';
            }, 2000);
        } else {
            // Djoser gibt Fehlermeldungen oft als Objekt zurück (z.B. {username: ["Schon vergeben"]})
            const errorMsg = data.username || data.password || data.non_field_errors || "Registrierung fehlgeschlagen.";
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