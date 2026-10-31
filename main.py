import hashlib
import os
import re
import tempfile
import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = BASE_DIR / "documents"
STATIC_DIR = BASE_DIR / "static"
DOCS_DIR.mkdir(exist_ok=True)

_VALID = re.compile(r"^[\w\- .()]+\.md$")

MAX_BYTES = 5 * 1024 * 1024

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


app = FastAPI()


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/files")
async def list_files():
    names = await run_in_threadpool(lambda: [f.name for f in DOCS_DIR.glob("*.md")])
    return sorted(names)


@app.get("/api/files/{name}")
async def read_file(name: str):
    p = safe_path(name)
    if not await run_in_threadpool(p.exists):
        raise HTTPException(404)
    data = await run_in_threadpool(p.read_bytes)
    return PlainTextResponse(data.decode("utf-8"), headers={"ETag": etag(data)})


@app.post("/api/files/{name}", status_code=204)
async def write_file(name: str, request: Request, response: Response):
    p = safe_path(name)
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
    if not await run_in_threadpool(p.exists):
        raise HTTPException(404)
    await run_in_threadpool(p.unlink)


@app.get("/")
async def index():
    content = await run_in_threadpool((STATIC_DIR / "index.html").read_text, "utf-8")
    return HTMLResponse(content)


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
