# MD Writer

Ein minimaler, browserbasierter Markdown-Editor mit lokalem Backend.

## Features

- **Multi-Tab-Editing** – mehrere Dokumente gleichzeitig öffnen, benennen und schließen
- **Live-Vorschau** – Markdown wird via [marked.js](https://marked.js.org/) in Echtzeit gerendert
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

Markdown-Dateien werden im Verzeichnis `documents/` gespeichert.

## API

| Methode   | Pfad                  | Beschreibung                  |
|-----------|------------------------|-------------------------------|
| `GET`     | `/api/files`          | Liste aller `.md`-Dateien     |
| `GET`     | `/api/files/{name}`   | Dateiinhalt lesen             |
| `POST`    | `/api/files/{name}`   | Datei schreiben / erstellen   |
| `DELETE`  | `/api/files/{name}`   | Datei löschen                 |
