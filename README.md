# FitCrew

Offline-Fitness-App (PWA) fürs iPhone. Alle Daten liegen im Gerät (IndexedDB), kein Server nötig.

## Funktionen
- **Studio**: Kette wählen (Clever Fit, McFit, FitX, John Reed, Kieser …) → typische Geräte mit Fotos, Muskelgruppen,
  Wiederholungen und Startgewicht (aus fettfreier Masse berechnet) werden angelegt. Eigene Fotos per Kamera.
- **Training**: Sätze mit Gewicht/Wiederholungen, Vorschlag fürs nächste Mal, Pausen-Timer.
- **Körper**: berechneter Körper (Größe, Gewicht → Körperfett/Form; Training → Muskelgröße).
  Trainierte Muskeln leuchten so lange, wie Muskelkater typischerweise anhält. Zeitreise-Regler, Vorher/Jetzt/Ziel.
- **Coach**: Trainings- und Essensplan (Abnehmen / Muskeln / Cardio) – mit Claude (API-Key im Admin-Bereich) oder eingebauten Regeln.
- **Admin**: `Florian` ist fest als Global-Admin eingestellt (`SUPER_ADMIN` in `web/db.js`). Admins verwalten Benutzer und den Anthropic-API-Key.
- **Sicherung**: Export/Import als JSON-Datei.

## Aufbau
- `web/` – die komplette App (statische Dateien). `db.js` lokale Datenbank + „API“, `planner.js` Regel-Coach,
  `coach.js` Claude, `body.js` Körper-Grafik, `bodystate.js` Fett/Muskeln/Muskelkater, `catalog.js` Geräte & Ketten.
- `web/vendor/anthropic.mjs` – gebündeltes Anthropic-SDK (`npx esbuild build/sdk-entry.js --bundle --format=esm --platform=browser --minify --outfile=web/vendor/anthropic.mjs`).
- Nach jeder Änderung: `node build/make-sw.mjs` (Offline-Cache neu erzeugen).
- Desktop: `./fitcrew-launch` (Omarchy-Launcher „FitCrew“). `server.js`/`public/` = alte Server-Version, nicht mehr benutzt.

## iPhone
Die App muss einmal über HTTPS geladen werden (z. B. GitHub Pages). Safari → Teilen → „Zum Home-Bildschirm“.
Danach läuft sie offline; nur der KI-Coach braucht Internet.
