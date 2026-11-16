# Veröffentlichung

## Geplanter Aufbau

- **Quellcode:** öffentliches GitHub-Repository für Issues, Ideen und Pull Requests. Der lokale Git-Verlauf bleibt bis zur Veröffentlichung unveröffentlicht.
- **Downloads:** Installer, Versionshinweise und Update-Dateien als Releases desselben Repositorys.
- **Lizenz:** Der App-Code steht unter GPL-3.0-only. Beiträge werden unter derselben Lizenz eingereicht. Lizenzen der eingebundenen Abhängigkeiten bleiben bestehen.
- **Name und Logo:** gesondert vom Code behandeln. Vor der Veröffentlichung auf bestehende Marken prüfen und festlegen, wie Dritte Name und Logo verwenden dürfen.

## Vor dem ersten Release

1. App auf einem zweiten Windows-11-PC testen: Installation, Start, Tray, Hotkey, Alt + Rechtsklick und Deinstallation.
2. Installer signieren, sobald ein Code-Signing-Zertifikat vorhanden ist. Ohne Signatur zeigt Windows möglicherweise eine Warnung.
3. `npm run release:build` ausführen. Das bettet `mambuzrrr/WinAssistent` als Update-Quelle in die App ein und erzeugt lokal Installer, Blockmap und `latest.yml`, ohne etwas hochzuladen. Für einen anderen Fork kann `WINASSISTENT_GITHUB_REPO=owner/repo` gesetzt werden.
4. Einen Update-Durchlauf mit zwei aufeinanderfolgenden Release-Versionen testen. Bereits installierte Entwicklungs-Builds ohne Update-Quelle müssen einmal manuell aktualisiert werden.
5. Release-Ordner prüfen: Installer, zugehörige Blockmap und `latest.yml` müssen zur gleichen Version gehören.
6. Erst danach Quellcode veröffentlichen und Installer sowie Update-Dateien als Assets eines öffentlichen Releases hochladen. Vor dem Push den Git-Verlauf und alle getrackten Dateien auf persönliche Daten und Geheimnisse prüfen.

Ein öffentliches Repository kann auf GitHub geforkt und lokal kopiert werden. Eine Softwarelizenz kann Bedingungen für Weitergabe und Änderungen festlegen, verhindert Kopien aber nicht technisch. Ein eigenständiger Name, ein klar geregeltes Logo und verlässliche offizielle Releases helfen, das Original erkennbar zu machen.
