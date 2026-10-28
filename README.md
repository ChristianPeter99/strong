# Kraftzyklus

Kraft-Masse-Kalkulation als Web-App fürs iPhone. Aus vier Bestwerten berechnet die App die Zielgewichte für 10 Zyklen à 5 Wochen, gleiche Formeln wie in der Kalkulationstabelle.

- Läuft komplett offline, alle Daten bleiben lokal auf dem iPhone (keine Cloud, kein Konto, kein Tracking)
- Backups sind mit Passwort verschlüsselt (AES-256-GCM, Schlüssel per PBKDF2-SHA-256)
- Keine externen Dateien: Schrift und Icons liegen im Repo, strikte Content-Security-Policy

## Einrichten auf GitHub Pages

1. Auf github.com ein **neues Repository** anlegen, z. B. `kraftzyklus` (Public, sonst geht Pages nur mit bezahltem Plan).
2. **Add file › Upload files** und den kompletten Inhalt dieses Ordners hineinziehen, inklusive der Ordner `fonts` und `icons`. Danach **Commit changes**.
3. **Settings › Pages**: Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`, **Save**.
4. Nach 1–2 Minuten ist die App erreichbar unter `https://<dein-benutzername>.github.io/kraftzyklus/`.
5. Die Adresse auf dem iPhone in **Safari** öffnen › **Teilen** › **Zum Home-Bildschirm**.
6. App einmal vom Home-Bildschirm starten, solange du online bist. Ab dann funktioniert sie offline.

## Neue Version veröffentlichen

1. Versionsnummer an **zwei** Stellen gleich erhöhen, z. B. auf `1.0.1`:
   - `app.js`: `const APP_VERSION = '1.0.1';`
   - `sw.js`: `const VERSION = '1.0.1';`
2. Geänderte Dateien ins Repository hochladen.
3. In der App: **Plan › Zahnrad › Version aktualisieren** › **Update installieren**. Deine Daten bleiben erhalten.

## Backup

- **Plan › Zahnrad › Backup erstellen**: Passwort vergeben › **Verschlüsseln** › **Datei sichern** › z. B. „In Dateien sichern“.
- **Backup importieren** funktioniert auch auf einem neuen iPhone direkt auf dem Startbildschirm der App.
- Ohne Passwort lässt sich ein Backup nicht öffnen – es gibt keine Wiederherstellung.

## Formeln

- Maximalkraft: `1RM = MROUND(Gewicht + Gewicht × Wdh × 0,033; 2,5)` – am genauesten bei 8–10 Wiederholungen
- 1RM in Zyklus n: Test-1RM + Steigerung × Anzahl Zyklen mit Steigerung (Standard +2,5 kg Bank/Schulter, +5 kg Kniebeuge/Kreuzheben)
- Wochengewicht: `MROUND(1RM × Prozent; 2,5)`, Prozente und Sätze wie in der Tabelle, Woche 5 = Deload mit 60 % · 4 × 8
- Aufwärmen: 50 % × 8 und 75 % × 3 des Arbeitsgewichts (mind. Stange)
- Scheibenrechner: 20-kg-Stange, Scheiben 20 / 15 / 10 / 5 / 2,5 / 1,25 kg
- Ab 2× „nicht geschafft“ in einem Zyklus schlägt die App vor, die Steigerung für diese Übung im nächsten Zyklus auszusetzen

Schrift: Barlow Condensed, SIL Open Font License (`fonts/OFL.txt`).
