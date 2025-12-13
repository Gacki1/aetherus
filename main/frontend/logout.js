async function logoutUser() {
    try {
        const response = await fetch("/api/auth/logout/", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            }
        });

        if (response.ok) {
            console.log("Cookie gelöscht");

            window.location.href = "/start.html";
        } else {
            alert("Logout fehlgeschlagen.");
        }
    } catch (error) {
        console.error("Fehler beim Logout: ", error);
    }
}