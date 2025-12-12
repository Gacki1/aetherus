const express = require("express");
const app = express();
const port = 3000;

app.use(express.json());
app.post("/api/login", (req, res) => {
    const { username, password} = req.body;

    if (username === "andiriechtgut" && password === "coolesau") {
        console.log("Login Erfolgreich");
        res.status(200).json({ success: true, redirect: "/main.html"});
    } else {
        console.log("Login Fehlgeschlagen");
        res.status(401).json({ success: false, message: "Falscher Benutzername oder Passwort"});
    }
});

app.listen(port, () => {
    console.log("Login Backend läuft auf http://localhost:${port}");
});