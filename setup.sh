#!/usr/bin/env bash
set -euo pipefail

APP_NAME="wms-cpc"
APPDATA_ROOT="/opt/appdata/${APP_NAME}"

echo "== ${APP_NAME}: first-time setup =="

# 1. Create persistent data directories
echo "-- creating ${APPDATA_ROOT}"
mkdir -p "${APPDATA_ROOT}"

# 2. Ownership matching the non-root container UID/GID
echo "-- chown 1000:1000 ${APPDATA_ROOT}"
chown -R 1000:1000 "${APPDATA_ROOT}"

# 3. Seed .env from .env.example (never overwrite an existing .env)
if [ ! -f .env ]; then
    echo "-- creating .env from .env.example (fill in secrets before starting)"
    cp .env.example .env
else
    echo "-- .env already exists, leaving it untouched"
fi

# 4. Verify Docker + Compose are installed
if ! command -v docker >/dev/null 2>&1; then
    echo "ERROR: docker is not installed or not on PATH." >&2
    echo "Install Docker (with the Compose plugin) before continuing: https://docs.docker.com/engine/install/" >&2
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "ERROR: 'docker compose' (v2 plugin) is not available." >&2
    echo "Install the Docker Compose plugin: https://docs.docker.com/compose/install/" >&2
    exit 1
fi

# 5. Build images (no private registry in use)
echo "-- building images"
docker compose build --pull

echo "== setup complete =="
echo "Next steps:"
echo "  1. Fill in secrets in .env (POSTGRES_PASSWORD, SECRET_KEY, BACKEND_CORS_ORIGINS, ...)"
echo "  2. Confirm PostgreSQL is running on this host and reachable on the configured port"
echo "  3. docker compose up -d"
