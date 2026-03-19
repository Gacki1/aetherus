@echo off
title Aetherus - Lokaler Server
echo ========================================
echo   AETHERUS - Lokale Entwicklungsumgebung
echo ========================================
echo.

:: Navigate to the backend folder
cd /d "%~dp0main\backend"
if not exist "manage.py" (
    echo FEHLER: manage.py nicht gefunden!
    echo Bitte stelle sicher, dass diese Datei im Hauptordner des
    echo Repositories liegt (neben dem "main" Ordner).
    echo.
    pause
    exit /b 1
)

:: Try to find Python - check multiple common names
set PY=
where py >nul 2>&1 && set PY=py && goto :found_python
where python >nul 2>&1 && set PY=python && goto :found_python
where python3 >nul 2>&1 && set PY=python3 && goto :found_python

:: Python not in PATH - check common install locations
if exist "%LocalAppData%\Programs\Python\Python313\python.exe" (
    set "PY=%LocalAppData%\Programs\Python\Python313\python.exe"
    goto :found_python
)
if exist "%LocalAppData%\Programs\Python\Python312\python.exe" (
    set "PY=%LocalAppData%\Programs\Python\Python312\python.exe"
    goto :found_python
)
if exist "%LocalAppData%\Programs\Python\Python311\python.exe" (
    set "PY=%LocalAppData%\Programs\Python\Python311\python.exe"
    goto :found_python
)
if exist "%LocalAppData%\Programs\Python\Python310\python.exe" (
    set "PY=%LocalAppData%\Programs\Python\Python310\python.exe"
    goto :found_python
)
if exist "C:\Python313\python.exe" set "PY=C:\Python313\python.exe" && goto :found_python
if exist "C:\Python312\python.exe" set "PY=C:\Python312\python.exe" && goto :found_python
if exist "C:\Python311\python.exe" set "PY=C:\Python311\python.exe" && goto :found_python
if exist "C:\Python310\python.exe" set "PY=C:\Python310\python.exe" && goto :found_python

echo FEHLER: Python nicht gefunden!
echo.
echo Du hast Python gerade erst installiert? Dann musst du deinen
echo PC einmal neu starten, damit Windows den neuen PATH uebernimmt.
echo.
echo Falls du Python noch nicht installiert hast:
echo   1. Gehe zu https://python.org/downloads
echo   2. Lade Python 3.10+ herunter
echo   3. WICHTIG: Setze den Haken bei "Add Python to PATH"
echo   4. Installiere und starte deinen PC neu
echo   5. Fuehre diese Datei erneut aus
echo.
pause
exit /b 1

:found_python
echo Python gefunden: %PY%
%PY% --version
echo.

:: Check if venv exists
if not exist "venv" (
    echo [1/4] Erstelle virtuelle Umgebung...
    %PY% -m venv venv
    if errorlevel 1 (
        echo FEHLER: Virtuelle Umgebung konnte nicht erstellt werden!
        pause
        exit /b 1
    )
)

:: Activate venv
call venv\Scripts\activate

:: Install dependencies
echo [2/4] Installiere Abhaengigkeiten...
pip install -q -r requirements.txt
if errorlevel 1 (
    echo FEHLER: Abhaengigkeiten konnten nicht installiert werden!
    pause
    exit /b 1
)

:: Set settings
set DJANGO_SETTINGS_MODULE=backend.settings_local

:: Run migrations
echo [3/4] Erstelle Datenbank...
python manage.py migrate --run-syncdb 2>nul

:: Create test users if they don't exist
python -c "import django; import os; os.environ['DJANGO_SETTINGS_MODULE']='backend.settings_local'; django.setup(); from django.contrib.auth.models import User; User.objects.filter(username='admin').exists() or User.objects.create_superuser('admin','admin@aetherus.net','admin123'); User.objects.filter(username='testuser').exists() or (lambda u: (setattr(u,'is_active',True), u.save()))(User.objects.create_user('testuser','test@aetherus.net','test1234'))" 2>nul

echo.
echo ========================================
echo   Server laeuft auf: http://localhost:8000
echo.
echo   Login-Daten:
echo     Admin:    admin / admin123
echo     Benutzer: testuser / test1234
echo.
echo   Zum Beenden: Ctrl+C
echo ========================================
echo.

:: Start server
echo [4/4] Starte Server...
python manage.py runserver 8000

:: If server exits, keep window open
echo.
echo Server wurde beendet.
pause
