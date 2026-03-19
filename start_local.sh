#!/bin/bash
echo "========================================"
echo "  AETHERUS - Lokale Entwicklungsumgebung"
echo "========================================"
echo ""

# Navigate to backend folder relative to this script
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/main/backend" || { echo "FEHLER: main/backend/ Ordner nicht gefunden!"; exit 1; }

if [ ! -f "manage.py" ]; then
    echo "FEHLER: manage.py nicht gefunden!"
    echo "Bitte stelle sicher, dass diese Datei im Hauptordner des"
    echo "Repositories liegt (neben dem 'main' Ordner)."
    exit 1
fi

# Check if Python is available
if command -v python3 &>/dev/null; then
    PY=python3
elif command -v python &>/dev/null; then
    PY=python
else
    echo "FEHLER: Python nicht gefunden!"
    echo "Bitte installiere Python 3.10+ (https://python.org)"
    exit 1
fi

echo "Python gefunden: $PY"
$PY --version
echo ""

# Create venv if needed
if [ ! -d "venv" ]; then
    echo "[1/4] Erstelle virtuelle Umgebung..."
    $PY -m venv venv || { echo "FEHLER: Virtuelle Umgebung konnte nicht erstellt werden!"; exit 1; }
fi

# Activate venv
source venv/bin/activate

# Install dependencies
echo "[2/4] Installiere Abhängigkeiten..."
pip install -q -r requirements.txt || { echo "FEHLER: Abhängigkeiten konnten nicht installiert werden!"; exit 1; }

# Set settings
export DJANGO_SETTINGS_MODULE=backend.settings_local

# Run migrations
echo "[3/4] Erstelle Datenbank..."
python manage.py migrate --run-syncdb 2>/dev/null

# Create test users if they don't exist
python -c "
import django, os
os.environ['DJANGO_SETTINGS_MODULE']='backend.settings_local'
django.setup()
from django.contrib.auth.models import User
if not User.objects.filter(username='admin').exists():
    User.objects.create_superuser('admin','admin@aetherus.net','admin123')
if not User.objects.filter(username='testuser').exists():
    u = User.objects.create_user('testuser','test@aetherus.net','test1234')
    u.is_active = True
    u.save()
" 2>/dev/null

echo ""
echo "========================================"
echo "  Server läuft auf: http://localhost:8000"
echo ""
echo "  Login-Daten:"
echo "    Admin:    admin / admin123"
echo "    Benutzer: testuser / test1234"
echo ""
echo "  Zum Beenden: Ctrl+C"
echo "========================================"
echo ""

# Start server
echo "[4/4] Starte Server..."
python manage.py runserver 8000
