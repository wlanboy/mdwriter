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

`GET` und `PUT` liefern einen `ETag` (SHA-256 des Inhalts). `PUT` wertet optional aus:

- `If-Match: <etag>` – nur schreiben, wenn die Datei noch diese Version hat, sonst `412`
- `If-None-Match: *` – nur anlegen, wenn die Datei noch nicht existiert, sonst `412`

Ohne diese Header wird unbedingt überschrieben. Der Body darf höchstens 5 MB groß sein, sonst `413`. Geschrieben wird atomar über eine Temp-Datei und `os.replace`.
