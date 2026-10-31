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
def projects_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "git"
    root.mkdir()
    monkeypatch.setattr(main, "PROJECTS_DIR", root)
    return root


@pytest.fixture
def client(docs_dir: Path) -> TestClient:
    return TestClient(main.app)


@pytest.fixture
def repo(projects_dir: Path) -> Path:
    r = projects_dir / "repo"
    (r / "docs").mkdir(parents=True)
    (r / "README.md").write_text("# Repo", "utf-8")
    (r / "docs" / "talk.md").write_text("# Talk", "utf-8")
    (r / "docs" / "values.yaml").write_text("a: 1", "utf-8")
    (r / "ci.yml").write_text("b: 2", "utf-8")
    (r / "main.py").write_text("x", "utf-8")
    return r


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


def test_safe_path_rejects_sibling_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
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


# --- GET /api/health ---


def test_health_ok(client: TestClient):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_docs_dir_missing(client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(main, "DOCS_DIR", tmp_path / "gone")
    assert client.get("/api/health").status_code == 503


# --- /api/settings ---


def test_settings_unsaved_is_null(client: TestClient):
    r = client.get("/api/settings")
    assert r.status_code == 200
    assert r.json() == {"projects": None}


def test_settings_roundtrip(client: TestClient, docs_dir: Path):
    r = client.put("/api/settings", json={"projects": ["repo", "other repo"]})
    assert r.status_code == 204
    assert client.get("/api/settings").json() == {"projects": ["repo", "other repo"]}
    assert (docs_dir / main.SETTINGS_NAME).exists()


def test_settings_hidden_from_file_api(client: TestClient):
    client.put("/api/settings", json={"projects": ["repo"]})
    assert client.get("/api/files").json() == []
    assert client.get("/api/files/.settings.json").status_code == 400


@pytest.mark.parametrize("name", ["", ".git", "a/b", "a\\b", "node_modules"])
def test_settings_rejects_invalid_project(client: TestClient, docs_dir: Path, name: str):
    r = client.put("/api/settings", json={"projects": [name]})
    assert r.status_code == 422
    assert not (docs_dir / main.SETTINGS_NAME).exists()


def test_settings_corrupt_file_reads_as_unsaved(client: TestClient, docs_dir: Path):
    (docs_dir / main.SETTINGS_NAME).write_text("{not json", "utf-8")
    assert client.get("/api/settings").json() == {"projects": None}


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


# --- GET /api/projects ---


def test_list_projects(client: TestClient, projects_dir: Path):
    for name in ["b", "a", ".hidden", "node_modules"]:
        (projects_dir / name).mkdir()
    (projects_dir / "file.md").write_text("x", "utf-8")
    assert client.get("/api/projects").json() == ["a", "b"]


def test_list_projects_missing_root(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(main, "PROJECTS_DIR", tmp_path / "nope")
    assert client.get("/api/projects").json() == []


# --- GET /api/projects/{project}/tree ---


def test_project_tree(client: TestClient, repo: Path):
    r = client.get("/api/projects/repo/tree")
    assert r.status_code == 200
    assert r.json() == {
        "files": ["README.md", "ci.yml", "docs/talk.md", "docs/values.yaml"],
        "truncated": False,
    }


def test_project_tree_skips_hidden_and_build_dirs(client: TestClient, repo: Path):
    for d in [".git", "node_modules", "target", "docs/.cache"]:
        (repo / d).mkdir()
        (repo / d / "x.md").write_text("x", "utf-8")
    (repo / ".hidden.md").write_text("x", "utf-8")
    files = client.get("/api/projects/repo/tree").json()["files"]
    assert files == ["README.md", "ci.yml", "docs/talk.md", "docs/values.yaml"]


def test_project_tree_truncates(
    client: TestClient, repo: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(main, "MAX_TREE_FILES", 2)
    body = client.get("/api/projects/repo/tree").json()
    assert len(body["files"]) == 2
    assert body["truncated"] is True


def test_project_tree_missing(client: TestClient, projects_dir: Path):
    assert client.get("/api/projects/nope/tree").status_code == 404


@pytest.mark.parametrize("name", [".git", "..", "node_modules"])
def test_project_tree_invalid_name(client: TestClient, projects_dir: Path, name: str):
    (projects_dir / ".git").mkdir()
    (projects_dir / "node_modules").mkdir()
    assert client.get(f"/api/projects/{name}/tree").status_code in (400, 404)


# --- /api/projects/{project}/files/{path} ---


def test_read_project_file(client: TestClient, repo: Path):
    r = client.get("/api/projects/repo/files/docs/values.yaml")
    assert r.status_code == 200
    assert r.text == "a: 1"
    assert r.headers["etag"] == main.etag(b"a: 1")


def test_read_project_file_missing(client: TestClient, repo: Path):
    assert client.get("/api/projects/repo/files/docs/nope.md").status_code == 404


def test_read_project_file_not_utf8(client: TestClient, repo: Path):
    (repo / "bin.md").write_bytes(b"\xff\xfe")
    assert client.get("/api/projects/repo/files/bin.md").status_code == 400


@pytest.mark.parametrize(
    "path",
    [
        "main.py",
        "../repo/README.md",
        "docs/../../README.md",
        ".git/config.md",
        "node_modules/x.md",
        "docs/.secret.md",
        "docs/",
    ],
)
def test_project_path_rejects(repo: Path, path: str):
    with pytest.raises(HTTPException) as exc:
        main.project_path("repo", path)
    assert exc.value.status_code == 400


def test_project_path_rejects_symlink_escape(repo: Path, tmp_path: Path):
    (tmp_path / "outside.md").write_text("x", "utf-8")
    (repo / "link.md").symlink_to(tmp_path / "outside.md")
    with pytest.raises(HTTPException) as exc:
        main.project_path("repo", "link.md")
    assert exc.value.status_code == 400


def test_write_project_file(client: TestClient, repo: Path):
    tag = main.etag(b"# Talk")
    r = client.put(
        "/api/projects/repo/files/docs/talk.md",
        content=b"# Neu",
        headers={"If-Match": tag},
    )
    assert r.status_code == 204
    assert r.headers["etag"] == main.etag(b"# Neu")
    assert (repo / "docs" / "talk.md").read_text("utf-8") == "# Neu"


def test_write_project_file_stale(client: TestClient, repo: Path):
    r = client.put(
        "/api/projects/repo/files/docs/talk.md",
        content=b"# Neu",
        headers={"If-Match": main.etag(b"alt")},
    )
    assert r.status_code == 412
    assert (repo / "docs" / "talk.md").read_text("utf-8") == "# Talk"


def test_write_project_file_missing_folder(client: TestClient, repo: Path):
    r = client.put("/api/projects/repo/files/new/x.md", content=b"x")
    assert r.status_code == 404
    assert not (repo / "new").exists()


def test_write_project_file_invalid_ext(client: TestClient, repo: Path):
    r = client.put("/api/projects/repo/files/main.py", content=b"evil")
    assert r.status_code == 400
    assert (repo / "main.py").read_text("utf-8") == "x"


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
