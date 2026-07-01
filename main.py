import re
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = BASE_DIR / "documents"
STATIC_DIR = BASE_DIR / "static"
DOCS_DIR.mkdir(exist_ok=True)

_VALID = re.compile(r"^[\w\- .()]+\.md$")


def safe_path(name: str) -> Path:
    if not _VALID.match(name):
        raise HTTPException(400, "Invalid filename")
    p = (DOCS_DIR / name).resolve()
    if not str(p).startswith(str(DOCS_DIR.resolve())):
        raise HTTPException(400, "Path traversal detected")
    return p


app = FastAPI()


@app.get("/api/files")
async def list_files():
    return sorted(f.name for f in DOCS_DIR.glob("*.md"))


@app.get("/api/files/{name}")
async def read_file(name: str):
    p = safe_path(name)
    if not p.exists():
        raise HTTPException(404)
    return PlainTextResponse(p.read_text("utf-8"))


@app.post("/api/files/{name}", status_code=204)
async def write_file(name: str, request: Request):
    p = safe_path(name)
    p.write_text((await request.body()).decode("utf-8"), "utf-8")


@app.delete("/api/files/{name}", status_code=204)
async def delete_file(name: str):
    p = safe_path(name)
    if not p.exists():
        raise HTTPException(404)
    p.unlink()


@app.get("/")
async def index():
    return HTMLResponse((STATIC_DIR / "index.html").read_text("utf-8"))


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
