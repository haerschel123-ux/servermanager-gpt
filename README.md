# 🧟 DayZ Nitrado Server-Manager (Handy-App)

Verwalte deinen **DayZ-Konsolenserver (PS4/PS5/Xbox) bei Nitrado** direkt im
Browser – auch komplett vom Handy aus:

**👉 App öffnen: https://haerschel123-ux.github.io/Init_c-Manager-f-r-claude/**

- 📁 Alle Server-Dateien finden & bearbeiten (auch die, die das
  Nitrado-Panel nicht anzeigt), mit Suche über den ganzen Server
- 🗺️ Interaktive Chernarus-Karte: Spawnpunkte, Events (Heli-Crashes …) und
  Objekte/Gebäude per Fingertipp setzen, verschieben, löschen
- 🎒 Loot-Editor für `types.xml` als durchsuchbare Tabelle
- 🖥️ Serverstatus, Neustart und Stopp per Knopfdruck
- 💾 Automatisches Backup vor jedem Speichern (im Browser, unter ⚙️ abrufbar)

## Erste Schritte

1. Die App-Adresse oben am Handy öffnen
2. Nitrado-API-Token einfügen – so bekommst du ihn:
   [account.nitrado.net → Entwicklerportal → Tokens](https://account.nitrado.net/developer/tokens),
   „Token erstellen“, Berechtigung **`service`** ankreuzen, Code kopieren
3. Deinen DayZ-Server antippen – fertig!
4. Tipp: Über das Browser-Menü **„Zum Startbildschirm hinzufügen“** wird die
   Seite zur App mit eigenem Symbol.

## Sicherheit

- Dein API-Token wird **nur auf deinem Gerät** gespeichert (im Browser) und
  direkt an die offizielle Nitrado-API geschickt – niemals an andere Server.
- Dieses Repository enthält nur den App-Code, **keinerlei Zugangsdaten**.
  Bitte auch nie welche hier eintragen – es ist öffentlich.
- Token versehentlich geteilt? Im Nitrado-Entwicklerportal widerrufen.

## Ehrliche Grenzen (Konsolenserver)

- Eine **`init.c` gibt es auf Konsolenservern nicht** – eigenes Scripting
  ist nur auf PC-Servern möglich. Alles, was auf Konsole anpassbar ist,
  liegt im Missionsordner, und genau den macht die App komplett zugänglich.
- **Live-Teleport / Items ohne Neustart spawnen** ist auf Konsole technisch
  unmöglich. Die App bietet das Machbare: ändern → speichern → Server per
  Knopfdruck neu starten (2–5 Minuten).

## Technik

Reine statische Web-App (HTML/JS, Leaflet lokal gebündelt), gehostet über
GitHub Pages (`.github/workflows/pages.yml` veröffentlicht bei jedem Push
automatisch). Die zugehörige PC-Version mit lokalem Python-Server liegt im
privaten Repo `Dayz-bot-test` (Branch `claude/dayz-init-c-manager-v33r82`).
