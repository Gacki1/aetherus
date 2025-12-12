// token_manager.js

// Die Lebensdauer des Access Tokens in Millisekunden (Muss mit settings.py übereinstimmen!)
// Angenommen, Sie haben 5 Minuten in settings.py:
const ACCESS_TOKEN_LIFETIME_MS = 5 * 60 * 1000;

// Startet den Refresh-Vorgang 60 Sekunden, bevor das Token abläuft.
const REFRESH_INTERVAL_MS = ACCESS_TOKEN_LIFETIME_MS - 60000;

let refreshTimer = null;

// 1. Refresh-Funktion: Sendet Anfrage an Django
async function refreshAccessToken() {
    console.log("Starte Token Refresh...");

    // WICHTIG: Keine Body-Daten oder Header für das Refresh Token erforderlich!
    // Der Browser sendet das HttpOnly-Cookie automatisch mit.
    try {
        const response = await fetch('/api/token/refresh/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            // Leerer Body, da das Refresh Token im Cookie gesendet wird
            body: JSON.stringify({})
        });

        if (response.status === 200) {
            const data = await response.json();

            // 1. Access Token im localStorage aktualisieren
            localStorage.setItem('access_token', data.access);
            console.log("Access Token erfolgreich erneuert. Neues Token gespeichert.");

            // 2. Timer für das nächste Refresh neu starten
            startRefreshTimer();
        } else if (response.status === 401) {
            // Wenn der Refresh fehlschlägt (z.B. Refresh Token abgelaufen/ungültig)
            console.error("Refresh Token ungültig oder abgelaufen. Benutzer muss sich neu anmelden.");

            // Weiterleitung zur Login-Seite
            window.location.href = '/login.html';
        } else {
            console.error("Unerwarteter Fehler beim Token Refresh:", response.status);
        }
    } catch (error) {
        console.error("Netzwerkfehler beim Token Refresh:", error);
    }
}

// 2. Scheduler-Funktion
function startRefreshTimer() {
    // Vorherigen Timer löschen, falls vorhanden
    if (refreshTimer) {
        clearTimeout(refreshTimer);
    }

    // Startet den Timer, der die refreshAccessToken-Funktion aufruft
    refreshTimer = setTimeout(() => {
        refreshAccessToken();
    }, REFRESH_INTERVAL_MS); // Erneuerung 1 Minute vor Ablauf

    console.log(`Nächster Token Refresh geplant in ${REFRESH_INTERVAL_MS / 1000} Sekunden.`);
}

// 3. Initialisierung

// Überprüfen Sie, ob ein Token vorhanden ist, und starten Sie den Refresh-Timer.
// Dies sollte auf jeder geschützten Seite (z.B. main.html) einmal aufgerufen werden.
if (localStorage.getItem('access_token')) {
    startRefreshTimer();
}