# Gym Check

Gym Check zeigt Fortschritt, Kennzahlen, Übungsverläufe, Muskelgruppen-Verteilung und eine Schätzung des
Muskelaufbaus aus dem CSV-Export der Hevy-App. Statische Web-App, läuft komplett im Browser.

## Export aus Hevy

Sinngemäß: in Hevy Profil → Einstellungen → Daten exportieren → Workouts exportieren (CSV).

## Nutzung auf Android

1. Seite in Chrome öffnen: <https://bobtale.github.io/gym-check/>
2. Menü → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.
3. „CSV auswählen“ tippen und die Datei aus „Downloads“ wählen.

Die Daten bleiben gespeichert, „Daten löschen“ entfernt sie. Am Desktop die Datei einfach ins Fenster ziehen.

## Datenschutz

Keine Übertragung, kein Server, kein Tracking: die Daten liegen nur im lokalen Speicher des Browsers. Einzige externe
Ressource ist Chart.js von jsDelivr (ohne Daten). CSV-Dateien sind per `.gitignore` vom Repo ausgeschlossen.

## Hinweis

Der Muskelaufbau ist eine Schätzung aus Literaturmodellen, keine Messung.

Kein offizielles Produkt von Hevy und nicht mit Hevy verbunden; die App liest nur den CSV-Export, den Hevy selbst anbietet.

## Lizenz

[MIT](LICENSE)

## Veröffentlichen

GitHub → Settings → Pages → Branch `main`, Ordner `/ (root)`.
