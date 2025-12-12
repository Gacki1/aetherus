// Funktion zum Abrufen des Tokens
function getAccessToken() {
    return localStorage.getItem('access_token');
}

async function fetchUserData() {
    const token = getAccessToken();
    if (!token) {
        // Optional: Benutzer umleiten, wenn kein Token vorhanden
        // window.location.href = '/login.html';
        return;
    }

    const response = await fetch('/api/user/data/', {
        method: 'GET',
        headers: {
            // Fügen Sie das Token im "Bearer" Format hinzu!
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (response.status === 200) {
        return response.json();
    } else if (response.status === 401) {
        // WICHTIG: Wenn der Token-Refresh fehlschlägt, ist das Access Token abgelaufen.
        // Die Refresh-Logik sollte dieses Problem bereits beheben, aber hier wäre die Notfall-Logik.
        console.error("Zugriff verweigert. Token ist abgelaufen oder ungültig.");
    }
}