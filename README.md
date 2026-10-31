# MD Writer

Ein minimaler, browserbasierter Markdown-Editor mit lokalem Backend.

## Features

- **Multi-Tab-Editing** – mehrere Dokumente gleichzeitig öffnen, benennen und schließen
- **Live-Vorschau** – Markdown wird via [marked.js](https://marked.js.org/) in Echtzeit gerendert und mit [DOMPurify](https://github.com/cure53/DOMPurify) bereinigt
- **Zeilennummern & Kontext-Menü** – Zeilenleiste mit `+`-Button zum Einfügen von Vorlagen (Überschrift, Code, Tabelle, Link, Bild)
- **Server-Dateiverwaltung** – Dateien werden auf dem Server gespeichert, geöffnet und gelöscht
- **Lokaler Import / Download** – `.md`-Dateien vom lokalen Rechner importieren oder herunterladen
- **Autosave** – automatisches Speichern 1,5 Sekunden nach der letzten Änderung
- **Session-Persistenz** – offene Tabs und Inhalte überleben Browser-Neustarts via `localStorage`
- **Projekt-Explorer** – ausklappbare Seitenleiste mit Markdown- und YAML-Dateien aus ausgewählten Projekten unter `~/git`
- **YAML-Ansicht** – YAML-Dateien und ` ```yaml `-Blöcke werden mit Syntax-Highlighting, Einrückungslinien und Zeilennummern angezeigt
- **Präsentationsmodus** – Vollbild-Vorschau ohne Editor und Tabs
- **Tastaturkürzel** – vollständig per Tastatur bedienbar

## Tastaturkürzel

| Kürzel      | Aktion                          |
|-------------|----------------------------------|
| `Ctrl+S`    | Speichern (ggf. „Speichern unter") |
| `Alt+O`     | Datei vom Server öffnen         |
| `Alt+I`     | Lokale Datei importieren        |
| `Alt+D`     | Aktives Dokument herunterladen  |
| `Alt+S`     | Speichern                       |
| `Alt+P`     | Vorschau ein-/ausblenden        |
| `Alt+C`     | Aktiven Tab schließen           |
| `Alt+E`     | Explorer ein-/ausblenden        |
| `Alt+F`     | Präsentationsmodus ein/aus (`Esc` beendet) |

## Projekt-Explorer

Das Datei-Symbol links oben klappt den Explorer auf. Neben den lokalen Dokumenten zeigt er Projekte aus `~/git`, aber nur die, die über das Regler-Symbol ausgewählt wurden. Standardmäßig ist keins ausgewählt. Mit dem Suchfeld lässt sich die Projektliste eingrenzen.

Mit den Checkboxen **Markdown** und **YAML** (`.yaml`, `.yml`) wird der Baum nach Dateityp gefiltert. Ausgeblendet sind versteckte Ordner (`.git`, `.venv`, …) sowie `node_modules`, `target`, `dist`, `build`, `venv` und `__pycache__`.

Ein Klick öffnet die Datei in einem neuen Tab. Ist sie bereits offen, wird nur zu ihrem Tab gewechselt. Ein leerer, ungespeicherter Tab wird dabei ersetzt.

Projektdateien werden wie Dokumente per Autosave direkt ins Repository geschrieben. Auswahl, Filter und aufgeklappte Ordner werden im `localStorage` gespeichert.

Das Projektverzeichnis lässt sich über `PROJECTS_DIR` ändern:

```bash
PROJECTS_DIR=/srv/repos uv run main.py
```

## Installation & Start

```bash
uv sync
uv run main.py
```

Der Editor ist danach unter `http://localhost:8000` erreichbar.

Markdown-Dateien werden im Verzeichnis `documents/` gespeichert. Ein anderes Verzeichnis (z. B. ein Container-Volume) lässt sich über die Umgebungsvariable `DOCS_DIR` setzen:

```bash
DOCS_DIR=/data/docs uv run main.py
```

## API

| Methode   | Pfad                  | Beschreibung                  |
|-----------|------------------------|-------------------------------|
| `GET`     | `/api/files`          | Liste aller `.md`-Dateien     |
| `GET`     | `/api/files/{name}`   | Dateiinhalt lesen             |
| `PUT`     | `/api/files/{name}`   | Datei schreiben / erstellen   |
| `DELETE`  | `/api/files/{name}`   | Datei löschen                 |
| `GET`     | `/api/projects`       | Projektordner in `PROJECTS_DIR` |
| `GET`     | `/api/projects/{project}/tree` | Alle `.md`/`.yaml`/`.yml`-Pfade eines Projekts (max. 5000, sonst `truncated: true`) |
| `GET`     | `/api/projects/{project}/files/{path}` | Projektdatei lesen |
| `PUT`     | `/api/projects/{project}/files/{path}` | Projektdatei schreiben (nur in bestehende Ordner) |

`GET` und `PUT` (für Dokumente wie Projektdateien) liefern einen `ETag` (SHA-256 des Inhalts). `PUT` wertet optional aus:

- `If-Match: <etag>` – nur schreiben, wenn die Datei noch diese Version hat, sonst `412`
- `If-None-Match: *` – nur anlegen, wenn die Datei noch nicht existiert, sonst `412`

Ohne diese Header wird unbedingt überschrieben. Der Body darf höchstens 5 MB groß sein, sonst `413`. Geschrieben wird atomar über eine Temp-Datei und `os.replace`.
