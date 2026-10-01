# WMS-CPC — Deployment Guide

Deployed per the company [Internal App Deployment Framework](./Internal_App_Deployment_Framework.md) v2.0.

## 1. Prerequisites

- Docker Engine + Compose plugin on the VM host.
- **PostgreSQL running on the Windows Server host itself (not containerized)**, reachable from containers via `host.docker.internal`. Create a login role for this app before first start (the database itself is created automatically if missing).
- Bash (Git Bash or WSL) to run `setup.sh`.
- Host port `83` free (configurable via `APP_PORT`) (see §9 below).

## 2. First-time setup

```bash
./setup.sh
```

This creates `/opt/appdata/wms-cpc/`, sets ownership to `1000:1000`, copies `.env.example` → `.env` (only if `.env` doesn't already exist), verifies Docker/Compose are installed, and builds the images.

After it runs, edit `.env` and fill in the real secrets (see table below), and make sure the target Postgres role exists on the host and that the `core` schema is already present in the database.

## 3. `.env` variable reference

| Variable | Description |
|---|---|
| `POSTGRES_HOST` | Overridden to `host.docker.internal` inside `docker-compose.yml`; kept in `.env` for local/dev reference only. |
| `POSTGRES_PORT` | Port the host Postgres listens on. Default `5432`. |
| `POSTGRES_DATABASE` | Database name for this app. |
| `POSTGRES_USER` | Postgres login role for this app. |
| `POSTGRES_PASSWORD` | Password for that role. |
| `APP_PORT` | Host port nginx is published on. Default `83`. |
| `BACKEND_CORS_ORIGINS` | Comma-separated or JSON array of origins allowed to call the API. Each origin's port must match `APP_PORT`. |
| `SECRET_KEY` | JWT signing secret — generate with `openssl rand -hex 32`. |
| `ALGORITHM` | JWT algorithm, default `HS256`. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token lifetime in minutes. |

## 4. Build & start

```bash
docker compose build --pull
docker compose up -d
```

On every container start, `python -m backend.init_db` runs once before uvicorn: it creates the database if missing, then the `wms` schema, the ENUM types, and finally the tables. If it fails, the container exits and `docker compose logs backend` shows why.

## 5. Validation

```bash
docker compose ps                                   # all services healthy
curl -fsS http://127.0.0.1:${APP_PORT:-83}/                       # nginx entrypoint
curl -fsS http://127.0.0.1:${APP_PORT:-83}/api/v1/openapi.json    # backend via proxy
```

Note: the backend's `/health` route is mounted at the app root, not under `/api/v1`, so it's only reachable from inside the Docker network (that's what the `backend` service's own healthcheck uses) — not through the public nginx entrypoint. `/api/v1/openapi.json` is the equivalent externally-reachable check.

## 6. Operations

| Task | Command |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Restart | `docker compose restart` |
| Rebuild one service | `docker compose build <service> && docker compose up -d <service>` |
| Validate stack | `docker compose ps` |
| Validate nginx | `curl -fsS http://127.0.0.1:${APP_PORT:-83}/` |
| Validate backend via proxy | `curl -fsS http://127.0.0.1:${APP_PORT:-83}/api/v1/openapi.json` |
| Tail logs | `docker compose logs -f <service>` |

## 7. Persistent data

This app has no file-based media/report storage — the only persistent state is the PostgreSQL database, which lives on the host outside Docker (back it up via the host's normal Postgres backup process, not `/opt/appdata`).

`/opt/appdata/wms-cpc/` exists per the standing convention but currently holds no app data; owned `1000:1000`.

## 8. Troubleshooting

- **Backend can't reach Postgres**: confirm the host's `pg_hba.conf`/`listen_addresses` accept connections from the Docker bridge network, not just `localhost`, and that the Windows Firewall allows the container-to-host route.
- **502 from nginx**: check `docker compose ps` — usually means `backend` or `frontend` failed its healthcheck and never came up. `docker compose logs backend` / `logs frontend`.
- **CORS errors in the browser**: verify `BACKEND_CORS_ORIGINS` in `.env` includes the exact origin used to reach the app (scheme + host + port; port must be `APP_PORT`). CORS is handled entirely by the backend — nginx never sets CORS headers (Rule 1).

## 9. Port assignment

| App | Host Port (external) | Notes |
|---|---|---|
| wms-cpc | `83` (`APP_PORT`) | nginx entrypoint → container port 80 |

## 10. Automated deploys (GitHub Actions)

`.github/workflows/deploy.yml` runs on the self-hosted runner for every push to `main` (and manually via `workflow_dispatch`). Runs are serialized under `concurrency: deploy-wms`. It:

1. Resets `/home/cpc_services/apps/wms-cpc` to `origin/main`.
2. Logs the deployed commit.
3. Writes `.env` from the `ENV_FILE` secret (in the `production` environment). That secret must contain every variable in §3, including `APP_PORT=83` and CORS origins on port 83.
4. Runs `docker compose up -d --build --remove-orphans --wait`, then prunes old images.

Dependencies in `backend/requirements.txt` are pinned for the core stack (SQLAlchemy 2.0.x with `psycopg2`, `passlib` 1.7.4 with `bcrypt` 4.0.1); don't loosen them, as newer majors break the DB driver URL and password hashing.

nginx forwards `Host $http_host` so redirects keep the published port; don't change it back to `$host`.
