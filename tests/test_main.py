from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main


@pytest.fixture
def docs_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(main, "DOCS_DIR", tmp_path)
    return tmp_path


@pytest.fixture
def client(docs_dir: Path) -> TestClient:
    return TestClient(main.app)


# --- safe_path ---


@pytest.mark.parametrize(
    "name",
    [
        "notes.md",
        "my-notes.md",
        "my_notes.md",
        "my notes.md",
        "notes (1).md",
        "v1.2.md",
        "Ümlaut.md",
    ],
)
def test_safe_path_accepts_valid_names(docs_dir: Path, name: str):
    assert main.safe_path(name) == (docs_dir / name).resolve()


@pytest.mark.parametrize(
    "name",
    [
        "",
        ".md",
        "notes.txt",
        "notes",
        "notes.md.txt",
        "../notes.md",
        "sub/notes.md",
        "a\\b.md",
        "x;.md",
    ],
)
def test_safe_path_rejects_invalid_names(docs_dir: Path, name: str):
    with pytest.raises(HTTPException) as exc:
        main.safe_path(name)
    assert exc.value.status_code == 400


# --- GET /api/files ---


def test_list_files_empty(client: TestClient):
    r = client.get("/api/files")
    assert r.status_code == 200
    assert r.json() == []


def test_list_files_sorted_and_only_md(client: TestClient, docs_dir: Path):
    for name in ["b.md", "a.md", "c.txt"]:
        (docs_dir / name).write_text("x", "utf-8")
    r = client.get("/api/files")
    assert r.status_code == 200
    assert r.json() == ["a.md", "b.md"]


# --- GET /api/files/{name} ---


def test_read_file(client: TestClient, docs_dir: Path):
    (docs_dir / "doc.md").write_text("# Hallo Wörld", "utf-8")
    r = client.get("/api/files/doc.md")
    assert r.status_code == 200
    assert r.text == "# Hallo Wörld"
    assert r.headers["content-type"].startswith("text/plain")


def test_read_missing_file(client: TestClient):
    assert client.get("/api/files/missing.md").status_code == 404


def test_read_invalid_name(client: TestClient):
    assert client.get("/api/files/doc.txt").status_code == 400


# --- POST /api/files/{name} ---


def test_write_file_creates(client: TestClient, docs_dir: Path):
    r = client.post("/api/files/new.md", content=b"# Neu")
    assert r.status_code == 204
    assert (docs_dir / "new.md").read_text("utf-8") == "# Neu"


def test_write_file_overwrites(client: TestClient, docs_dir: Path):
    (docs_dir / "doc.md").write_text("alt", "utf-8")
    r = client.post("/api/files/doc.md", content=b"neu")
    assert r.status_code == 204
    assert (docs_dir / "doc.md").read_text("utf-8") == "neu"


def test_write_empty_body(client: TestClient, docs_dir: Path):
    r = client.post("/api/files/empty.md", content=b"")
    assert r.status_code == 204
    assert (docs_dir / "empty.md").read_text("utf-8") == ""


def test_write_invalid_utf8(client: TestClient, docs_dir: Path):
    r = client.post("/api/files/bad.md", content=b"\xff\xfe\xfd")
    assert r.status_code == 400
    assert not (docs_dir / "bad.md").exists()


def test_write_invalid_name(client: TestClient, docs_dir: Path):
    r = client.post("/api/files/evil.sh", content=b"x")
    assert r.status_code == 400
    assert list(docs_dir.iterdir()) == []


def test_write_then_read_roundtrip(client: TestClient):
    text = "# Titel\n\n- Punkt äöü ✓\n"
    assert (
        client.post("/api/files/rt.md", content=text.encode("utf-8")).status_code == 204
    )
    assert client.get("/api/files/rt.md").text == text
    assert client.get("/api/files").json() == ["rt.md"]


# --- DELETE /api/files/{name} ---


def test_delete_file(client: TestClient, docs_dir: Path):
    (docs_dir / "doc.md").write_text("x", "utf-8")
    r = client.delete("/api/files/doc.md")
    assert r.status_code == 204
    assert not (docs_dir / "doc.md").exists()


def test_delete_missing_file(client: TestClient):
    assert client.delete("/api/files/missing.md").status_code == 404


def test_delete_invalid_name(client: TestClient):
    assert client.delete("/api/files/doc.txt").status_code == 400


# --- static ---


def test_index(client: TestClient):
    r = client.get("/")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    assert r.text == (main.STATIC_DIR / "index.html").read_text("utf-8")


def test_static_file(client: TestClient):
    r = client.get("/static/app.js")
    assert r.status_code == 200


def test_index_loads_sanitizer(client: TestClient):
    assert '<script src="/static/purify.min.js"></script>' in client.get("/").text


# --- security headers ---


@pytest.mark.parametrize(
    "url", ["/", "/api/files", "/static/app.js", "/api/files/missing.md"]
)
def test_security_headers(client: TestClient, url: str):
    r = client.get(url)
    assert r.headers["content-security-policy"] == main.CSP
    assert r.headers["x-content-type-options"] == "nosniff"


def test_csp_blocks_inline_script(client: TestClient):
    csp = client.get("/").headers["content-security-policy"]
    assert "script-src 'self';" in csp
    assert "unsafe-inline" not in csp
