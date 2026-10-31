# MD Explorer

Ein minimaler, browserbasierter Markdown- und YAML-Editor mit lokalem Backend (FastAPI).

## Features

- **Multi-Tab-Editing** – mehrere Dokumente gleichzeitig öffnen, benennen und schließen. Ein Klick auf den Namen des aktiven Tabs benennt ihn um; ist das Dokument schon gespeichert, wird die Datei auf dem Server mit umbenannt. Projektdateien behalten ihren Namen.
- **Live-Vorschau** – Markdown wird via [marked.js](https://marked.js.org/) in Echtzeit gerendert und mit [DOMPurify](https://github.com/cure53/DOMPurify) bereinigt. Die Vorschau scrollt proportional mit dem Editor mit.
- **Editor-Komfort** – `Tab`/`Shift+Tab` rücken die Zeile oder Auswahl um 2 Leerzeichen ein bzw. aus. `Enter` übernimmt die Einrückung und setzt Listen fort (`- `, `1. `, `- [ ] `); `Enter` auf einem leeren Listenpunkt beendet die Liste. In YAML wird nach `key:` eine Ebene tiefer eingerückt. Markdown bricht lange Zeilen um, YAML nicht. Alle Eingaben lassen sich mit `Ctrl+Z` rückgängig machen, auch eingefügte Vorlagen.
- **Zeilennummern & Kontext-Menü** – Zeilenleiste mit `+`-Button zum Einfügen von Vorlagen (Überschrift, Code-Block als Code, YAML oder Text, Tabelle, Link, Bild)
- **Server-Dateiverwaltung** – Dateien werden auf dem Server gespeichert, geöffnet und gelöscht
- **Lokaler Import / Download** – `.md`-Dateien vom lokalen Rechner importieren oder herunterladen
- **Autosave** – automatisches Speichern 1,5 Sekunden nach der letzten Änderung. Der Punkt am Tab zeigt den Stand: orange = ungespeichert, blau pulsierend = speichert, kein Punkt = gespeichert. Hinweise erscheinen nur bei Fehlern.
- **Konflikte** – Hat sich die Datei auf dem Server inzwischen geändert, bekommt der Tab ein rotes `!` und der Autosave hält an. Eine Leiste über dem Editor bietet **Vom Server neu laden** (die eigene Fassung lässt sich mit `Ctrl+Z` zurückholen) oder **Überschreiben**. `Ctrl+S` fragt in diesem Fall direkt nach.
- **Session-Persistenz** – offene Tabs und Inhalte überleben Browser-Neustarts via `localStorage`
- **Schnellsuche** – `Ctrl+P` sucht Dateien in den Dokumenten und allen ausgewählten Projekten, auch mit Lücken (`apiend` findet `api/endpoints.md`)
- **Projekt-Explorer** – ausklappbare Seitenleiste mit Markdown- und YAML-Dateien aus ausgewählten Projekten unter `~/git`
- **YAML-Highlighting** – YAML-Dateien sind schon im Editor eingefärbt, mit Einrückungslinien. Eine Vorschau gibt es für sie nicht, im Präsentationsmodus werden sie aber mit Zeilennummern angezeigt. ` ```yaml `-Blöcke in Markdown werden in der Vorschau ebenfalls eingefärbt.
- **Präsentationsmodus** – Vollbild-Vorschau ohne Editor und Tabs
- **Tastaturkürzel** – vollständig per Tastatur bedienbar

## Tastaturkürzel

| Kürzel      | Aktion                          |
|-------------|----------------------------------|
| `Ctrl+S`    | Speichern (ggf. „Speichern unter") |
| `Ctrl+P`    | Schnellsuche (`↑`/`↓` wählen, `Enter` öffnet) |
| `Alt+O`     | Datei vom Server öffnen         |
| `Alt+I`     | Lokale Datei importieren        |
| `Alt+D`     | Aktives Dokument herunterladen  |
| `Alt+S`     | Speichern                       |
| `Alt+P`     | Vorschau ein-/ausblenden        |
| `Alt+C`     | Aktiven Tab schließen           |
| `Alt+E`     | Explorer ein-/ausblenden        |
| `Alt+F`     | Präsentationsmodus ein/aus (`Esc` beendet) |

Auf macOS gilt `Option` statt `Alt`. Manche Browser belegen unter Linux und Windows einzelne Alt-Kürzel selbst (`Alt+D` Adressleiste, `Alt+E`/`Alt+F` Menü, in Firefox auch `Alt+S`). Dann geht dasselbe mit `Alt+Shift`, also z. B. `Alt+Shift+D`.

## Projekt-Explorer

Das Datei-Symbol links oben klappt den Explorer auf. Neben den lokalen Dokumenten zeigt er Projekte aus `~/git`, aber nur die, die über das Regler-Symbol ausgewählt wurden. Standardmäßig ist keins ausgewählt. Mit dem Suchfeld lässt sich die Projektliste eingrenzen.

Mit den Checkboxen **Markdown** und **YAML** (`.yaml`, `.yml`) wird der Baum nach Dateityp gefiltert. Ausgeblendet sind versteckte Ordner (`.git`, `.venv`, …) sowie `node_modules`, `target`, `dist`, `build`, `venv` und `__pycache__`.

Ein Klick öffnet die Datei in einem neuen Tab. Ist sie bereits offen, wird nur zu ihrem Tab gewechselt. Ein leerer, ungespeicherter Tab wird dabei ersetzt.

Projektdateien werden wie Dokumente per Autosave direkt ins Repository geschrieben. Die Projektauswahl speichert der Server in `DOCS_DIR/.settings.json`, sie gilt also in jedem Browser und auf jedem Gerät. Filter und aufgeklappte Ordner bleiben pro Browser im `localStorage`.

Das Projektverzeichnis lässt sich über `PROJECTS_DIR` ändern:

```bash
PROJECTS_DIR=/srv/repos uv run main.py
```

## Installation & Start

Voraussetzungen: Python 3.14 und [uv](https://docs.astral.sh/uv/).

```bash
uv sync
uv run main.py
```

Der Editor ist danach unter `http://localhost:8063` erreichbar. Der Server bindet an `0.0.0.0` und hat keine Authentifizierung, ist also im ganzen Netzwerk erreichbar und kann dort Dateien in `DOCS_DIR` und `PROJECTS_DIR` schreiben.

Markdown-Dateien werden im Verzeichnis `documents/` gespeichert. Erlaubt sind Namen aus Buchstaben, Ziffern, `_`, `-`, Leerzeichen, `.` und Klammern mit der Endung `.md`. Ein anderes Verzeichnis (z. B. ein Container-Volume) lässt sich über die Umgebungsvariable `DOCS_DIR` setzen:

```bash
DOCS_DIR=/data/docs uv run main.py
```

## Docker

```bash
./update.sh
```

Das Skript macht `git pull`, baut das Image und startet den Container per `docker compose up -d`. Der Editor läuft dann unter `http://localhost:8063`.

Gemountet werden `./documents` als Dokumentverzeichnis und `~/git` als Projektverzeichnis. Ein anderes Projektverzeichnis lässt sich über `PROJECTS_HOST_DIR` setzen. Der Container läuft mit UID/GID des Aufrufers, damit gespeicherte Dateien auf dem Host nicht `root` gehören.

## API

| Methode   | Pfad                  | Beschreibung                  |
|-----------|------------------------|-------------------------------|
| `GET`     | `/api/health`         | `200`, wenn `DOCS_DIR` beschreibbar ist, sonst `503` |
| `GET`     | `/api/settings`       | Projektauswahl (`{"projects": null}`, solange nie gespeichert) |
| `PUT`     | `/api/settings`       | Projektauswahl speichern     |
| `GET`     | `/api/files`          | Liste aller `.md`-Dateien     |
| `GET`     | `/api/files/{name}`   | Dateiinhalt lesen             |
| `PUT`     | `/api/files/{name}`   | Datei schreiben / erstellen   |
| `POST`    | `/api/files/{name}/rename?to={neu}` | Datei umbenennen (`409`, wenn das Ziel existiert) |
| `DELETE`  | `/api/files/{name}`   | Datei löschen                 |
| `GET`     | `/api/projects`       | Projektordner in `PROJECTS_DIR` |
| `GET`     | `/api/projects/{project}/tree` | Alle `.md`/`.yaml`/`.yml`-Pfade eines Projekts (max. 5000, sonst `truncated: true`) |
| `GET`     | `/api/projects/{project}/files/{path}` | Projektdatei lesen |
| `PUT`     | `/api/projects/{project}/files/{path}` | Projektdatei schreiben (nur in bestehende Ordner) |

`GET` und `PUT` (für Dokumente wie Projektdateien) liefern einen `ETag` (SHA-256 des Inhalts). `PUT` wertet optional aus:

- `If-Match: <etag>` – nur schreiben, wenn die Datei noch diese Version hat, sonst `412`
- `If-None-Match: *` – nur anlegen, wenn die Datei noch nicht existiert, sonst `412`

Ohne diese Header wird unbedingt überschrieben. Der Body muss gültiges UTF-8 sein (sonst `400`) und darf höchstens 5 MB groß sein, sonst `413`. Geschrieben wird atomar über eine Temp-Datei und `os.replace`.

Alle Antworten tragen eine Content-Security-Policy, die Skripte und Styles nur vom eigenen Server zulässt. Bilder dürfen zusätzlich per `https:` und `data:` geladen werden.

## Entwicklung

```bash
uv run ruff check .   # Lint
uv run pyright .      # Typprüfung
uv run pytest         # Tests
```

Dieselben drei Schritte laufen in der GitHub-Actions-CI ([.github/workflows/ci.yml](.github/workflows/ci.yml)) bei jedem Push und Pull Request auf `main`.

## Lizenz

[Apache License 2.0](LICENSE)
