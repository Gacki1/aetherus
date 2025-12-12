// 1. Hilfsfunktion: Überprüft den Login-Status und ruft das Token ab

function getAccessToken() {
    const token = localStorage.getItem('access_token');

    // WICHTIG: Wenn kein Access Token vorhanden ist, leiten wir zur Login-Seite um.
    if (!token) {
        // Dies fängt den Fall ab, dass jemand direkt main.html aufruft
        // oder das Token abgelaufen ist und der Refresh-Mechanismus versagt hat.
        console.error("Kein Access Token gefunden. Weiterleitung zum Login.");
        window.location.href = '/login.html';
        return null; // Stoppt die weitere Ausführung
    }
    return token;
}

// 2. Funktion zum Abrufen geschützter Daten
async function fetchProtectedData() {
    const token = getAccessToken();
    if (!token) {
        // Die getAccessToken Funktion hat bereits die Umleitung durchgeführt
        return;
    }

    console.log("Versuche, geschützte Daten abzurufen...");

    try {
        const response = await fetch('/api/user/data/', { // Beispiel-Endpunkt
            method: 'GET',
            headers: {
                // ESSENZIELL: Das Access Token im 'Bearer' Format senden
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // Die JWT-Middleware in Django prüft diesen Header.

        if (response.status === 200) {
            const data = await response.json();
            console.log("Daten erfolgreich abgerufen:", data);

            // Hier könnten Sie die Daten auf der main.html anzeigen (z.B. user.name)
            document.getElementById('welcome-message').textContent = `Willkommen, ${data.username}!`;

        } else if (response.status === 401) {
            // Dies tritt ein, wenn das Access Token ABGELAUFEN ist.
            // Die token_manager.js sollte es bereits erneuern, aber falls nicht:
            console.error("Access Token abgelaufen oder ungültig. Automatische Erneuerung sollte starten.");

            // In einer Produktionsumgebung würden Sie hier einen manuellen Refresh auslösen,
            // aber da wir den automatischen Timer haben, warten wir im Normalfall.

        } else {
            console.error("Fehler beim Abruf der Daten:", response.status);
        }
    } catch (error) {
        console.error("Netzwerkfehler beim Abrufen geschützter Daten:", error);
    }
}

// 3. Ausführung beim Laden der Seite
document.addEventListener('DOMContentLoaded', () => {
    // 1. Überprüfe den Login-Status und starte den Refresh-Timer (in token_manager.js)
    // 2. Lade die Benutzerdaten
    fetchProtectedData();
});