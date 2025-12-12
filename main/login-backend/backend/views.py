from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth import authenticate, login
import json

# @csrf_exempt lassen bis richtiges Token System!!
@csrf_exempt
def login_view(request):
    if request.method == "POST":
        try:
            # Json Daten aus Anfrage lesen
            data = json.loads(request.body)
            username = data.get("username")
            password = data.get("password")

            # Django Auth // User/Pswd gegen die DB prüfen
            user = authenticate(request, username=username, password=password)

            if user is not None:

                # Wenn Daten korrekt => Session starten
                login(request, user)

                print(f"Login Erfolgreich für Benutzer: {username}")
                return JsonResponse({"succes": True, "redirect": "/main/main.html"})
            else:

                # Daten sind falsch
                print(f"Login Fehlgeschlagen für Benutzer: {username}")
                return JsonResponse({"succes": False, "message": "Falscher Benutzername oder Passwort"}, status=401)
            
        except json.JSONDecoreError:
            return JsonResponse({"succes": False, "message": "Ungültiges JSON"}, status=400)
        
    return JsonResponse({"message": "Nur POST erlaubt"}, status=405)