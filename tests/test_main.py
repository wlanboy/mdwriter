import importlib
import os
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


def test_safe_path_rejects_sibling_dir(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    # A prefix check would accept documents2/ as inside documents/.
    docs = tmp_path / "documents"
    (tmp_path / "documents2").mkdir()
    monkeypatch.setattr(main, "DOCS_DIR", docs)
    monkeypatch.setattr(main, "_VALID", main.re.compile(r".*"))
    with pytest.raises(HTTPException) as exc:
        main.safe_path("../documents2/x.md")
    assert exc.value.status_code == 400


def test_docs_dir_from_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    target = tmp_path / "volume" / "docs"
    monkeypatch.setenv("DOCS_DIR", str(target))
    try:
        assert importlib.reload(main).DOCS_DIR == target
        assert target.is_dir()
    finally:
        monkeypatch.delenv("DOCS_DIR")
        importlib.reload(main)


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


def test_read_file_etag(client: TestClient, docs_dir: Path):
    (docs_dir / "doc.md").write_bytes(b"abc")
    assert client.get("/api/files/doc.md").headers["etag"] == main.etag(b"abc")


def test_read_missing_file(client: TestClient):
    assert client.get("/api/files/missing.md").status_code == 404


def test_read_invalid_name(client: TestClient):
    assert client.get("/api/files/doc.txt").status_code == 400


# --- PUT /api/files/{name} ---


def test_write_file_creates(client: TestClient, docs_dir: Path):
    r = client.put("/api/files/new.md", content=b"# Neu")
    assert r.status_code == 204
    assert (docs_dir / "new.md").read_text("utf-8") == "# Neu"


def test_write_file_overwrites(client: TestClient, docs_dir: Path):
    (docs_dir / "doc.md").write_text("alt", "utf-8")
    r = client.put("/api/files/doc.md", content=b"neu")
    assert r.status_code == 204
    assert (docs_dir / "doc.md").read_text("utf-8") == "neu"


def test_write_empty_body(client: TestClient, docs_dir: Path):
    r = client.put("/api/files/empty.md", content=b"")
    assert r.status_code == 204
    assert (docs_dir / "empty.md").read_text("utf-8") == ""


def test_write_invalid_utf8(client: TestClient, docs_dir: Path):
    r = client.put("/api/files/bad.md", content=b"\xff\xfe\xfd")
    assert r.status_code == 400
    assert not (docs_dir / "bad.md").exists()


def test_write_rejects_post(client: TestClient, docs_dir: Path):
    assert client.post("/api/files/doc.md", content=b"x").status_code == 405
    assert not (docs_dir / "doc.md").exists()


def test_write_invalid_name(client: TestClient, docs_dir: Path):
    r = client.put("/api/files/evil.sh", content=b"x")
    assert r.status_code == 400
    assert list(docs_dir.iterdir()) == []


def test_write_returns_etag(client: TestClient):
    r = client.put("/api/files/doc.md", content=b"neu")
    assert r.headers["etag"] == main.etag(b"neu")
    assert client.get("/api/files/doc.md").headers["etag"] == r.headers["etag"]


def test_write_too_large_by_content_length(client: TestClient, docs_dir: Path):
    r = client.put("/api/files/big.md", content=b"x" * (main.MAX_BYTES + 1))
    assert r.status_code == 413
    assert not (docs_dir / "big.md").exists()


def test_write_too_large_chunked(client: TestClient, docs_dir: Path):
    def chunks():
        for _ in range(6):
            yield b"x" * (1024 * 1024)

    r = client.put("/api/files/big.md", content=chunks())
    assert r.status_code == 413
    assert not (docs_dir / "big.md").exists()


def test_write_at_limit(client: TestClient, docs_dir: Path):
    r = client.put("/api/files/max.md", content=b"x" * main.MAX_BYTES)
    assert r.status_code == 204
    assert (docs_dir / "max.md").stat().st_size == main.MAX_BYTES


# --- preconditions ---


def test_if_match_current_version(client: TestClient, docs_dir: Path):
    (docs_dir / "doc.md").write_bytes(b"alt")
    r = client.put(
        "/api/files/doc.md", content=b"neu", headers={"If-Match": main.etag(b"alt")}
    )
    assert r.status_code == 204
    assert (docs_dir / "doc.md").read_bytes() == b"neu"


def test_if_match_stale_version(client: TestClient, docs_dir: Path):
    (docs_dir / "doc.md").write_bytes(b"fremd")
    r = client.put(
        "/api/files/doc.md", content=b"neu", headers={"If-Match": main.etag(b"alt")}
    )
    assert r.status_code == 412
    assert (docs_dir / "doc.md").read_bytes() == b"fremd"


def test_if_match_deleted_file(client: TestClient, docs_dir: Path):
    r = client.put(
        "/api/files/doc.md", content=b"neu", headers={"If-Match": main.etag(b"alt")}
    )
    assert r.status_code == 412
    assert not (docs_dir / "doc.md").exists()


def test_if_none_match_creates(client: TestClient, docs_dir: Path):
    r = client.put("/api/files/doc.md", content=b"neu", headers={"If-None-Match": "*"})
    assert r.status_code == 204
    assert (docs_dir / "doc.md").read_bytes() == b"neu"


def test_if_none_match_existing(client: TestClient, docs_dir: Path):
    (docs_dir / "doc.md").write_bytes(b"alt")
    r = client.put("/api/files/doc.md", content=b"neu", headers={"If-None-Match": "*"})
    assert r.status_code == 412
    assert (docs_dir / "doc.md").read_bytes() == b"alt"


# --- atomic write ---


def test_write_leaves_no_temp_files(client: TestClient, docs_dir: Path):
    client.put("/api/files/doc.md", content=b"neu")
    assert [f.name for f in docs_dir.iterdir()] == ["doc.md"]


def test_write_keeps_mode(client: TestClient, docs_dir: Path):
    (docs_dir / "doc.md").write_bytes(b"alt")
    os.chmod(docs_dir / "doc.md", 0o640)
    client.put("/api/files/doc.md", content=b"neu")
    assert (docs_dir / "doc.md").stat().st_mode & 0o777 == 0o640


def test_failed_write_keeps_original(
    client: TestClient, docs_dir: Path, monkeypatch: pytest.MonkeyPatch
):
    (docs_dir / "doc.md").write_bytes(b"alt")

    def crash(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(main.os, "replace", crash)
    with pytest.raises(OSError):
        client.put("/api/files/doc.md", content=b"neu")
    assert (docs_dir / "doc.md").read_bytes() == b"alt"
    assert [f.name for f in docs_dir.iterdir()] == ["doc.md"]


def test_write_then_read_roundtrip(client: TestClient):
    text = "# Titel\n\n- Punkt äöü ✓\n"
    assert (
        client.put("/api/files/rt.md", content=text.encode("utf-8")).status_code == 204
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


# --- POST /api/files/{name}/rename ---


def test_rename_file(client: TestClient, docs_dir: Path):
    (docs_dir / "old.md").write_text("x", "utf-8")
    r = client.post("/api/files/old.md/rename", params={"to": "new.md"})
    assert r.status_code == 204
    assert not (docs_dir / "old.md").exists()
    assert (docs_dir / "new.md").read_text("utf-8") == "x"


def test_rename_keeps_etag(client: TestClient, docs_dir: Path):
    (docs_dir / "old.md").write_text("x", "utf-8")
    tag = client.get("/api/files/old.md").headers["etag"]
    client.post("/api/files/old.md/rename", params={"to": "new.md"})
    assert client.get("/api/files/new.md").headers["etag"] == tag


def test_rename_same_name(client: TestClient, docs_dir: Path):
    (docs_dir / "doc.md").write_text("x", "utf-8")
    r = client.post("/api/files/doc.md/rename", params={"to": "doc.md"})
    assert r.status_code == 204
    assert (docs_dir / "doc.md").read_text("utf-8") == "x"


def test_rename_missing_source(client: TestClient):
    r = client.post("/api/files/missing.md/rename", params={"to": "new.md"})
    assert r.status_code == 404


def test_rename_target_exists(client: TestClient, docs_dir: Path):
    (docs_dir / "a.md").write_text("a", "utf-8")
    (docs_dir / "b.md").write_text("b", "utf-8")
    r = client.post("/api/files/a.md/rename", params={"to": "b.md"})
    assert r.status_code == 409
    assert (docs_dir / "a.md").read_text("utf-8") == "a"
    assert (docs_dir / "b.md").read_text("utf-8") == "b"


@pytest.mark.parametrize("to", ["new.txt", "../new.md", ""])
def test_rename_invalid_target(client: TestClient, docs_dir: Path, to: str):
    (docs_dir / "doc.md").write_text("x", "utf-8")
    r = client.post("/api/files/doc.md/rename", params={"to": to})
    assert r.status_code in (400, 422)
    assert (docs_dir / "doc.md").exists()


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
