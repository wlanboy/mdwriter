# syntax=docker/dockerfile:1

FROM python:3.14-slim AS build

COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# Dependencies first so code changes don't invalidate this layer
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project

COPY main.py ./
COPY static ./static


FROM python:3.14-slim

LABEL org.opencontainers.image.title="mdwriter" \
      org.opencontainers.image.description="web based minimal md writer" \
      org.opencontainers.image.source="https://github.com/wlanboy/mdwriter" \
      org.opencontainers.image.licenses="Apache-2.0"

WORKDIR /app
COPY --from=build /app /app

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    DOCS_DIR=/data/docs \
    PROJECTS_DIR=/projects

# Overridden by docker-compose so written files belong to the host user
USER 1000:1000

EXPOSE 8000

CMD ["python", "main.py"]
