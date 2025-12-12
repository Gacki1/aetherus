// main.js

// 1. Zugriffsprüfung und Token-Abruf (Der Schutz-Mechanismus)
function getAccessTokenAndProtect() {
    const token = localStorage.getItem('access_token');

    // WICHTIG: Wenn kein Token vorhanden ist, wird sofort umgeleitet.
    if (!token) {
        console.warn("Zugriff verweigert. Kein Access Token gefunden.");
        // Leitet zur Login-Seite um, bevor die geschützte Seite vollständig lädt.
        window.location.href = '/login.html';
        return null; // Stoppt die weitere Ausführung
    }
    return token;
}

// 2. Funktion zum Abrufen geschützter Daten
async function fetchProtectedData() {
    // Ruft das Token ab ODER leitet den Benutzer um (wegen getAccessTokenAndProtect)
    const token = getAccessTokenAndProtect();
    if (!token) {
        // Die Umleitung ist bereits erfolgt
        return;
    }

    console.log("Versuche, geschützte Daten abzurufen...");

    try {
        const response = await fetch('/api/user/data/', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });

        // ... (Restliche Logik für 200/401 Statuscodes) ...

        if (response.status === 200) {
            const data = await response.json();
            console.log("Daten erfolgreich abgerufen:", data);
            document.getElementById('welcome-message').textContent = `Willkommen, ${data.username}!`;

        } else if (response.status === 401) {
            // Dies kann passieren, wenn das Access Token gerade abgelaufen ist und 
            // der automatische Refresh in token_manager.js noch nicht abgeschlossen ist.
            console.error("Access Token abgelaufen. Der Refresh-Mechanismus sollte dieses Problem beheben.");

            // Optional: Wenn der Refresh-Mechanismus fehlschlägt, den Benutzer ausloggen:
            // localStorage.removeItem('access_token');
            // window.location.href = '/login.html'; 

        } else {
            console.error("Fehler beim Abruf der Daten:", response.status);
        }
    } catch (error) {
        console.error("Netzwerkfehler beim Abrufen geschützter Daten:", error);
    }
}

// 3. Ausführung beim Laden der Seite
document.addEventListener('DOMContentLoaded', () => {
    // Führt zuerst den Schutz-Check aus, dann die Datenabfrage.
    fetchProtectedData();
});