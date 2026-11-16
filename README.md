# WinAssistent

Ein Windows-11-Tool mit animiertem Aktionsrad, globalem Hotkey, Tray-Symbol und Einstellungsfenster. Die Oberfläche nutzt Electron, HTML und CSS.

Meldungen, Fehler und Ergebnisfenster verwenden ein eigenes WinAssistent-Design. Die Dateieigenschaften öffnen direkt über die Windows Shell. Der Windows-Dateiauswahldialog und die Windows-Eigenschaften selbst bleiben Systemfenster.

## Starten

Voraussetzungen für die Entwicklung: Windows 11, Node.js, npm und Visual Studio Build Tools mit C++-Werkzeugen.

```powershell
npm install
npm start
```

Der Standard-Hotkey ist **Strg + Alt + Leertaste**. Auch **Alt + Rechtsklick** öffnet das Rad; für diesen Klick wird das normale Kontextmenü unterdrückt. Ein Doppelklick auf das Tray-Symbol öffnet die Einstellungen. Im Tray-Menü lässt sich das Rad öffnen, pausieren und wieder aktivieren oder die App beenden. Der Pause-Schalter ist auch in den Einstellungen verfügbar; während der Pause bleiben Einstellungen und Tray erreichbar.

In den Einstellungen kann **Bei Vollbild pausieren** aktiviert werden. Dann greift WinAssistent Alt + Rechtsklick in Vollbildanwendungen nicht ab; der Klick geht normal an die Anwendung. Der Tastatur-Hotkey bleibt nutzbar. Die Option ist anfangs ausgeschaltet.

Das Einstellungsfenster hat die Bereiche **Allgemein** und **Aktionsrad**. Unter Allgemein lässt sich die Anzeigegröße der Einstellungen auf 100, 115 oder 130 Prozent stellen; die Vorschau erscheint sofort und wird mit **Speichern** übernommen.
Nach dem Speichern erscheint oben kurz eine Bestätigung. Fehler und Hinweise werden dort ebenfalls angezeigt.
Im Bereich Aktionsrad sind die acht Plätze bei jedem Profil sichtbar. Standard, Developer und Gamer zeigen ihre feste Belegung als Vorschau; nur das Custom-Profil lässt sich direkt bearbeiten.

Für eine Richtungsgeste **Alt + Rechtsklick halten**, mindestens 60 Pixel zu einem der acht Plätze ziehen und loslassen. Bei einem kurzen Klick bleibt das Rad offen. Eine nicht verfügbare Aktion wird nicht ausgelöst; bei einem Platz mit Untermenü öffnet sich dieses zur weiteren Auswahl.

## Aktionen

- Terminal im aktuellen Explorer-Ordner öffnen
- Mehrere markierte Dateien oder Ordner in einem neuen Ordner zusammenfassen
- Namen, einen Pfad, alle Pfade oder Dateiinformationen kopieren (Smart Copy)
- Eigenschaften anzeigen, SHA-256 einer Datei kopieren, zwei Dateien nach Größe und Inhalt vergleichen oder eine `.exe` als Administrator starten
- Für eine ausgewählte Datei prüfen, welche Prozesse sie laut Windows Restart Manager derzeit verwenden
- 2 bis 100 Dateien mit Vorschau umbenennen: Präfix, Suffix, Suchen und Ersetzen sowie Nummerierung; Dateiendungen bleiben erhalten
- Auswahl in gespeicherte, offene oder zuletzt genutzte Ordner kopieren oder verschieben (Schnell ablegen)
- Größe, Datei- und Ordnerzahl einer Auswahl inklusive Unterordnern anzeigen
- SHA-256 einer Datei gegen eine bekannte Prüfsumme prüfen; beim Vergleich zweier Dateien beide Hashes anzeigen
- Identische Dateien in markierten Ordnern oder einer Dateiauswahl finden, ohne sie zu verändern
- Geräte-Manager, Dienste, Ereignisanzeige und Systeminformationen öffnen
- Aktuellen Ordner öffnen
- Einstellungen öffnen

In den Einstellungen gibt es vier Profile mit festen Positionen: **Standard**, **Developer**, **Gamer** und **Custom**. Developer erkennt Projektordner anhand von `.git`, `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod` oder einer `.sln`-Datei. Dort lassen sich ein Terminal im Projekt öffnen und Projektpfade kopieren. Gamer öffnet direkt den Task-Manager sowie Windows-Seiten für Spielmodus, Game Bar und Aufnahmen und den Ressourcenmonitor.

Das **Custom-Profil** lässt alle acht Richtungen einzeln belegen. Eigene `.exe`-Programme können per Dateidialog hinzugefügt und mit Namen, optionalem Arbeitsordner und Startargumenten versehen werden. Jedes Argument steht in einer eigenen Zeile. Das Programmsymbol wird aus der EXE gelesen und im Editor sowie im Rad angezeigt. Fehlt die EXE oder der Arbeitsordner später, bleibt der Radplatz sichtbar, aber deaktiviert. Programme werden direkt ohne Shell gestartet.

Custom-Profile lassen sich als JSON-Datei exportieren oder importieren. Der Export enthält auch die EXE-Pfade, Arbeitsordner und Argumente der eigenen Programme; Hotkey und Schnellablageziele sind nicht enthalten. Ältere Profil-Dateien bleiben importierbar. Nach einem Import wird das Profil erst mit **Speichern** aktiv.

Unter **Allgemein → Sprache** stehen Deutsch und Englisch zur Wahl. Die Sprache wird mit den Einstellungen gespeichert und gilt für Einstellungen, Aktionsrad, Tray und die WinAssistent-Dialoge. Die Textdateien liegen in `locales/de.json` und `locales/en.json`.

Der Update-Bereich zeigt die aktuelle Version und bietet eine manuelle Prüfung. Ein installierter Release-Build prüft beim Start und danach alle sechs Stunden auf GitHub nach Updates, einschließlich Beta-Versionen. Bei einer neuen Version erscheint das Symbol in der Titelleiste. Download und Installation werden dort vom Benutzer gestartet. Der normale Entwicklungs-Build (`npm run dist`) enthält noch keine Release-Quelle; dafür wird `npm run release:build` mit dem GitHub-Repository benötigt. Installer, passende Blockmap und `latest.yml` müssen zusammen veröffentlicht werden. `scripts/clean-dist.js` bewahrt diese Dateien für die aktuelle Version auf.

Das Rad erscheint sofort. Ein natives Windows-Modul im Electron-Prozess erkennt Alt + Rechtsklick, das aktive Fenster und liest Ordner sowie Auswahl über die Windows Shell. Schlägt diese Abfrage fehl, wird die bisherige Shell-Abfrage verwendet. Solange keine verlässliche Explorer-Auswahl vorliegt, bleiben Dateiaktionen deaktiviert. Außerhalb des Explorers öffnet Terminal im Benutzerordner. Einstellungen liegen im Electron-Benutzerdatenordner. Für den automatischen Start gibt es in den Einstellungen einen Schalter.

Bei **Alt + Rechtsklick** auf einer unmarkierten Datei wird deren Name über Windows UI Automation erkannt und im aktuellen Ordner aufgelöst. Markierte Dateien werden auch beim Tastenkürzel berücksichtigt. Das gilt ebenfalls für Dateien auf dem Windows-Desktop, einschließlich des öffentlichen Desktops. Virtuelle Desktop-Symbole ohne echten Dateipfad bleiben von Dateiaktionen ausgeschlossen. Für Schnell ablegen sind Downloads, Dokumente und Desktop anfänglich als Zielordner hinterlegt; die Liste lässt sich in den Einstellungen ändern. Existiert am Ziel bereits ein Name, wird eine nummerierte Kopie angelegt.

Bei Schnell ablegen zeigt das Rad übertragene Bytes und Prozentwert sowie den Fortschritt pro ausgewähltem Element. Die Größe von Ordnern wird vor dem Transfer ermittelt. Fehler bei einzelnen Dateien stoppen die übrige Auswahl nicht; erledigte und fehlgeschlagene Elemente werden getrennt ausgewiesen. Eine laufende Übertragung lässt sich im Rad oder über das Tray-Menü abbrechen. Bereits abgeschlossene Elemente bleiben am Ziel; die gerade vorbereitete Kopie wird entfernt und noch nicht begonnene Elemente bleiben unberührt. Kopien werden am Ziel vorbereitet und erst nach vollständigem Kopieren sichtbar. Bei einem Verschieben über Laufwerksgrenzen bleibt die vollständige Kopie erhalten, falls das Entfernen der Quelle fehlschlägt.

Die Massenumbenennung liegt unter **Datei → Massenumbenennung**. Sie zeigt vor dem Ausführen die geplanten Namen und prüft den Ordner erneut beim Bestätigen. Bestehende Dateien werden nicht überschrieben. Bei einem Fehler versucht WinAssistent, bereits geänderte Namen zurückzusetzen und meldet, falls das nicht vollständig gelingt.

Unter **Datei → Dateisperre prüfen** zeigt WinAssistent die Prozesse, die Windows für die ausgewählte Datei als Verwender meldet. Die Abfrage verändert oder beendet keine Prozesse. Ein leeres Ergebnis beweist nicht, dass keine kurzzeitige oder anderweitig nicht erkannte Sperre besteht.

## Projektstruktur

- `src/`: Electron-Hauptprozess, Fenster und Oberflächen
- `src/action-registry.js`: Aktionsdefinitionen, Verfügbarkeit und Acht-Platz-Profile
- `src/explorer-context.js`: Explorer-Abfrage und Prüfung der tatsächlichen Auswahl
- `src/project-context.js`: Erkennung des nächsten Projektordners
- `src/config.js`: Migration und Speicherung der Einstellungen
- `src/i18n.js`, `src/localize.js`, `locales/`: Sprachdateien und Übersetzung der Oberfläche
- `src/program-actions.js`: Start eigener EXE-Programme ohne Shell
- `src/rename-actions.js`: Planung, Kollisionsprüfung und Rückabwicklung der Massenumbenennung
- `src/app-dialog.js`, `src/dialog.*`: gemeinsame WinAssistent-Fenster für Meldungen und Fehler
- `src/profile-transfer.js`: validierter JSON-Import und -Export des Custom-Profils
- `native/`: C++-Quellcode für Alt + Rechtsklick, Explorer-Kontext und Dateitransfer; wird als Node-Modul in den App-Prozess geladen
- `assets/`: abgerundetes Logo mit schwarzem Hintergrund als PNG für die Oberfläche und als ICO mit mehreren Größen für Tray, Taskleiste und EXE
- `scripts/`: prüft beim Entwicklungsstart, ob das native Modul gebaut werden muss

```powershell
npm run dist
```

`dist/` enthält danach einen Windows-Installer. Er legt Verknüpfungen auf dem Desktop und im Startmenü an. Die installierte App startet als `WinAssistent.exe`; das native Modul läuft im selben Prozess. Für die Entwicklung wird das Modul bei Bedarf automatisch kompiliert. Der Installer ist derzeit nicht signiert.

Für einen Release-Build mit dem GitHub-Repository `mambuzrrr/WinAssistent`:

```powershell
npm run release:build
```

Der Befehl baut lokal und lädt nichts hoch. Er prüft, ob der Installer, seine Blockmap, `latest.yml` und die im Paket hinterlegte GitHub-Quelle vorhanden sind. Nur die so erzeugten Dateien gehören in denselben GitHub-Release. Bereits installierte Entwicklungs-Builds ohne Update-Quelle brauchen zunächst eine manuelle Neuinstallation.

Die Vorbereitung für eine spätere Veröffentlichung steht in [RELEASE.md](RELEASE.md). Das [GitHub-Repository](https://github.com/mambuzrrr/WinAssistent) existiert bereits; der Quellcode wurde noch nicht hochgeladen.

Hinweise für künftige Beiträge stehen in [CONTRIBUTING.md](CONTRIBUTING.md).

Der App-Code steht unter [GPL-3.0-only](LICENSE). Diese Lizenz erlaubt eigene Versionen und Weitergabe unter ihren Bedingungen. Der Name **WinAssistent** und das Logo kennzeichnen das offizielle Projekt; die Softwarelizenz macht fremde Versionen nicht zu offiziellen WinAssistent-Releases. Fremde Abhängigkeiten behalten ihre jeweiligen Lizenzen.
