# Aetherus - Lokale Entwicklungsumgebung

## Voraussetzungen
- Python 3.10+ installiert
- pip (Python-Paketmanager)

## Schnellstart

### Windows
Doppelklick auf `start_local.bat` — fertig. Der Server startet automatisch.

### Linux / Mac
```bash
chmod +x start_local.sh
./start_local.sh
```

## Manuelle Installation

### 1. Terminal öffnen & in den Backend-Ordner wechseln
```bash
cd main/backend
```

### 2. Virtuelle Umgebung erstellen
```bash
python -m venv venv
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate
```

### 3. Abhängigkeiten installieren
```bash
pip install -r requirements.txt
```

### 4. Datenbank erstellen & Testbenutzer anlegen
```bash
# Windows:
set DJANGO_SETTINGS_MODULE=backend.settings_local
python manage.py migrate
python manage.py createsuperuser

# Linux/Mac:
DJANGO_SETTINGS_MODULE=backend.settings_local python manage.py migrate
DJANGO_SETTINGS_MODULE=backend.settings_local python manage.py createsuperuser
```

### 5. Server starten
```bash
# Windows:
set DJANGO_SETTINGS_MODULE=backend.settings_local
python manage.py runserver 8000

# Linux/Mac:
DJANGO_SETTINGS_MODULE=backend.settings_local python manage.py runserver 8000
```

### 6. Im Browser öffnen
```
http://localhost:8000
```

## Was `settings_local.py` ändert
- **Kein Redis nötig** → nutzt In-Memory Cache & Channel Layer
- **Kein Docker nötig** → läuft direkt mit `runserver`
- **Kein S3/Hetzner nötig** → nutzt In-Memory File Storage
- **Keine echten E-Mails** → E-Mails werden in der Konsole ausgegeben
- **Debug = True** → detaillierte Fehlermeldungen
- **HTTPS deaktiviert** → Cookies/CSRF funktionieren über HTTP

## Hinweise
- Der WebSocket-Chat funktioniert im Dev-Modus mit dem InMemoryChannelLayer.
  Nachrichten werden übertragen, aber nur innerhalb desselben Prozesses.
- Hochgeladene Dateien (Cloud) werden im In-Memory-Storage gespeichert und
  gehen beim Server-Neustart verloren.
