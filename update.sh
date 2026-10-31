#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$(readlink -f "$0")")"

git pull --ff-only

# Container writes into the mounted dirs as the calling user
export APP_UID="$(id -u)"
export APP_GID="$(id -g)"

# Docker would create a missing bind-mount source as root
mkdir -p documents

docker compose build --pull
docker compose up -d
docker compose ps
