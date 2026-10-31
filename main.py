import hashlib
import os
import re
import tempfile
import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = Path(os.environ.get("DOCS_DIR", BASE_DIR / "documents"))
PROJECTS_DIR = Path(os.environ.get("PROJECTS_DIR", Path.home() / "git"))
STATIC_DIR = BASE_DIR / "static"
DOCS_DIR.mkdir(parents=True, exist_ok=True)

_VALID = re.compile(r"^[\w\- .()]+\.md$")

MAX_BYTES = 5 * 1024 * 1024

PROJECT_EXTS = {".md", ".yaml", ".yml"}
# Build output and dependency trees; hidden dirs (.git, .venv, …) are skipped anyway.
SKIP_DIRS = {"node_modules", "target", "dist", "build", "venv", "__pycache__"}
MAX_TREE_FILES = 5000

# Dotfile so the *.md listing and safe_path never expose it.
SETTINGS_NAME = ".settings.json"

# Serializes precondition check + write so two requests can't both pass If-Match.
_write_lock = threading.Lock()

# Markdown may link external images; everything else must come from this origin.
CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "img-src 'self' data: https:; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


def safe_path(name: str) -> Path:
    if not _VALID.match(name):
        raise HTTPException(400, "Invalid filename")
    p = (DOCS_DIR / name).resolve()
    if not p.is_relative_to(DOCS_DIR.resolve()):
        raise HTTPException(400, "Path traversal detected")
    return p


def _visible(name: str) -> bool:
    return bool(name) and not name.startswith(".") and name not in SKIP_DIRS


def project_dir(name: str) -> Path:
    if not _visible(name) or "/" in name or "\\" in name:
        raise HTTPException(400, "Invalid project")
    p = PROJECTS_DIR / name
    if not p.is_dir():
        raise HTTPException(404, "Project not found")
    return p


def project_path(project: str, rel: str) -> Path:
    root = project_dir(project).resolve()
    *dirs, filename = rel.split("/")
    if (
        not all(_visible(d) for d in dirs)
        or not filename
        or filename.startswith(".")
        or Path(filename).suffix.lower() not in PROJECT_EXTS
    ):
        raise HTTPException(400, "Invalid path")
    p = (root / rel).resolve()
    if not p.is_relative_to(root):
        raise HTTPException(400, "Path traversal detected")
    return p


def list_tree(root: Path) -> tuple[list[str], bool]:
    files: list[str] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if _visible(d))
        base = Path(dirpath).relative_to(root)
        for f in sorted(filenames):
            if f.startswith(".") or Path(f).suffix.lower() not in PROJECT_EXTS:
                continue
            files.append((base / f).as_posix())
            if len(files) >= MAX_TREE_FILES:
                return sorted(files), True
    return sorted(files), False


def etag(data: bytes) -> str:
    return '"' + hashlib.sha256(data).hexdigest() + '"'


def _etag_matches(header: str, current: str | None) -> bool:
    if current is None:
        return False
    if header.strip() == "*":
        return True
    return current in {t.strip() for t in header.split(",")}


async def read_body(request: Request) -> bytes:
    try:
        declared = int(request.headers.get("content-length", "0"))
    except ValueError:
        raise HTTPException(400, "Invalid Content-Length")
    if declared > MAX_BYTES:
        raise HTTPException(413, "File too large")
    # Content-Length may be absent (chunked) or wrong, so enforce while reading too.
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > MAX_BYTES:
            raise HTTPException(413, "File too large")
    return bytes(body)


def atomic_write(p: Path, data: bytes) -> None:
    fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, p.stat().st_mode & 0o777 if p.exists() else 0o644)
        os.replace(tmp, p)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def write_checked(
    p: Path, data: bytes, if_match: str | None, if_none_match: str | None
) -> str:
    with _write_lock:
        current = etag(p.read_bytes()) if p.exists() else None
        if if_match is not None and not _etag_matches(if_match, current):
            raise HTTPException(412, "File was modified on the server")
        if if_none_match is not None and _etag_matches(if_none_match, current):
            raise HTTPException(412, "File already exists")
        atomic_write(p, data)
    return etag(data)


def rename_checked(src: Path, dst: Path) -> None:
    with _write_lock:
        if not src.exists():
            raise HTTPException(404)
        if dst.exists():
            raise HTTPException(409, "Target already exists")
        src.rename(dst)


class Settings(BaseModel):
    # None = never saved, so the client can seed it from its own selection.
    projects: list[str] | None = Field(default=None, max_length=1000)

    @field_validator("projects")
    @classmethod
    def _project_names(cls, v: list[str] | None) -> list[str] | None:
        # Names only, not existence: a vanished project stays selected until unticked.
        for name in v or []:
            if not _visible(name) or "/" in name or "\\" in name:
                raise ValueError(f"Invalid project: {name!r}")
        return v


def read_settings() -> Settings:
    try:
        return Settings.model_validate_json((DOCS_DIR / SETTINGS_NAME).read_bytes())
    except FileNotFoundError, ValueError:
        return Settings()


def write_settings(s: Settings) -> None:
    with _write_lock:
        atomic_write(DOCS_DIR / SETTINGS_NAME, s.model_dump_json().encode())


async def read_text(p: Path) -> PlainTextResponse:
    try:
        data = await run_in_threadpool(p.read_bytes)
    except FileNotFoundError, IsADirectoryError:
        raise HTTPException(404)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File is not valid UTF-8")
    return PlainTextResponse(text, headers={"ETag": etag(data)})


async def write_text(p: Path, request: Request, response: Response) -> None:
    data = await read_body(request)
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "Body must be valid UTF-8")
    response.headers["ETag"] = await run_in_threadpool(
        write_checked,
        p,
        data,
        request.headers.get("if-match"),
        request.headers.get("if-none-match"),
    )


app = FastAPI()


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/health")
async def health():
    # A broken volume mount or wrong UID leaves the process up but unable to save.
    if not os.access(DOCS_DIR, os.W_OK):
        raise HTTPException(503, "DOCS_DIR not writable")
    return {"status": "ok"}


@app.get("/api/settings")
async def get_settings() -> Settings:
    return await run_in_threadpool(read_settings)


@app.put("/api/settings", status_code=204)
async def put_settings(s: Settings):
    await run_in_threadpool(write_settings, s)


@app.get("/api/files")
async def list_files():
    names = await run_in_threadpool(lambda: [f.name for f in DOCS_DIR.glob("*.md")])
    return sorted(names)


@app.get("/api/files/{name}")
async def read_file(name: str):
    return await read_text(safe_path(name))


@app.put("/api/files/{name}", status_code=204)
async def write_file(name: str, request: Request, response: Response):
    await write_text(safe_path(name), request, response)


@app.post("/api/files/{name}/rename", status_code=204)
async def rename_file(name: str, to: str):
    src = safe_path(name)
    dst = safe_path(to)
    if src == dst:
        return
    await run_in_threadpool(rename_checked, src, dst)


@app.delete("/api/files/{name}", status_code=204)
async def delete_file(name: str):
    p = safe_path(name)
    try:
        await run_in_threadpool(p.unlink)
    except FileNotFoundError:
        raise HTTPException(404)


@app.get("/api/projects")
async def list_projects():
    def scan() -> list[str]:
        if not PROJECTS_DIR.is_dir():
            return []
        return sorted(
            d.name for d in PROJECTS_DIR.iterdir() if d.is_dir() and _visible(d.name)
        )

    return await run_in_threadpool(scan)


@app.get("/api/projects/{project}/tree")
async def project_tree(project: str):
    files, truncated = await run_in_threadpool(
        list_tree, project_dir(project).resolve()
    )
    return {"files": files, "truncated": truncated}


@app.get("/api/projects/{project}/files/{path:path}")
async def read_project_file(project: str, path: str):
    return await read_text(project_path(project, path))


@app.put("/api/projects/{project}/files/{path:path}", status_code=204)
async def write_project_file(
    project: str, path: str, request: Request, response: Response
):
    p = project_path(project, path)
    # Only files inside existing folders; the editor never creates directories.
    if not p.parent.is_dir():
        raise HTTPException(404, "Folder not found")
    await write_text(p, request, response)


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8063)
