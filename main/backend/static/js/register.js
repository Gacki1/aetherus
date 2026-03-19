document.addEventListener("DOMContentLoaded", function () {
    const registerForm = document.getElementById('register-form');

    if (registerForm) {
        registerForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const submitBtn = this.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.textContent;

            const username = document.getElementById('reg-username').value.trim();
            const email = document.getElementById('reg-email').value.trim();
            const password = document.getElementById('reg-password').value;
            const re_password = document.getElementById('reg-password-confirm').value;

            const messageBox = document.getElementById('message-box');
            messageBox.style.display = 'none';
            messageBox.className = 'message';

            // Client-side validation
            if (username.length < 3) {
                showMessage("Benutzername muss mindestens 3 Zeichen lang sein.", "error");
                return;
            }

            if (password !== re_password) {
                showMessage("Die Passwörter stimmen nicht überein.", "error");
                return;
            }

            if (password.length < 8) {
                showMessage("Passwort muss mindestens 8 Zeichen lang sein.", "error");
                return;
            }

            // Disable button
            submitBtn.disabled = true;
            submitBtn.textContent = "Verarbeite...";
            submitBtn.style.opacity = "0.7";

            try {
                const response = await fetch('/api/auth/register/', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ username, email, password, re_password })
                });

                const data = await response.json();

                if (response.ok) {
                    showMessage("Account erfolgreich erstellt! Bitte prüfe deine E-Mails.", "success");
                    // Keep button disabled
                } else if (response.status === 429) {
                    showMessage(data.error || "Zu viele Versuche. Bitte warte etwas.", "error");
                    resetButton(submitBtn, originalBtnText);
                } else {
                    let errorMsg = "Registrierung fehlgeschlagen.";

                    if (data.error) {
                        errorMsg = data.error;
                    } else if (data.email) {
                        errorMsg = `E-Mail: ${getErrorText(data.email)}`;
                    } else if (data.username) {
                        errorMsg = `Username: ${getErrorText(data.username)}`;
                    } else if (data.password) {
                        errorMsg = `Passwort: ${getErrorText(data.password)}`;
                    } else if (data.non_field_errors) {
                        errorMsg = getErrorText(data.non_field_errors);
                    } else if (data.detail) {
                        errorMsg = data.detail;
                    }

                    showMessage(errorMsg, "error");
                    resetButton(submitBtn, originalBtnText);
                }

            } catch (error) {
                showMessage("Verbindung zum Server fehlgeschlagen.", "error");
                resetButton(submitBtn, originalBtnText);
            }
        });
    }
});

function resetButton(btn, originalText) {
    btn.disabled = false;
    btn.textContent = originalText;
    btn.style.opacity = "1";
}

function showMessage(text, type) {
    const messageBox = document.getElementById('message-box');
    messageBox.textContent = text;
    messageBox.className = `message ${type}`;
    messageBox.style.display = 'block';
}

function getErrorText(errorData) {
    if (Array.isArray(errorData)) {
        return errorData[0];
    }
    return errorData;
}
