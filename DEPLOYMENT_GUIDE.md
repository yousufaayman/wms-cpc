# WMS-CPC — Deployment Guide

Deployed per the company [Internal App Deployment Framework](./Internal_App_Deployment_Framework.md) v2.0.

## 1. Prerequisites

- Docker Engine + Compose plugin on the VM host.
- **PostgreSQL running on the Windows Server host itself (not containerized)**, reachable from containers via `host.docker.internal`. Create the database and a login role for this app before first start.
- Bash (Git Bash or WSL) to run `setup.sh`.
- Host port `82` free (see §9 below).

## 2. First-time setup

```bash
./setup.sh
```

This creates `/opt/appdata/wms-cpc/`, sets ownership to `1000:1000`, copies `.env.example` → `.env` (only if `.env` doesn't already exist), verifies Docker/Compose are installed, and builds the images.

After it runs, edit `.env` and fill in the real secrets (see table below), and make sure the target Postgres database/role already exist on the host.

## 3. `.env` variable reference

| Variable | Description |
|---|---|
| `POSTGRES_HOST` | Overridden to the explicit host IP (`192.168.0.249`) inside `docker-compose.yml`; kept in `.env` for local/dev reference only. |
| `POSTGRES_PORT` | Port the host Postgres listens on. Default `5432`. |
| `POSTGRES_DATABASE` | Database name for this app. |
| `POSTGRES_USER` | Postgres login role for this app. |
| `POSTGRES_PASSWORD` | Password for that role. |
| `BACKEND_CORS_ORIGINS` | Comma-separated or JSON array of origins allowed to call the API. |
| `SECRET_KEY` | JWT signing secret — generate with `openssl rand -hex 32`. |
| `ALGORITHM` | JWT algorithm, default `HS256`. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access token lifetime in minutes. |

## 4. Build & start

```bash
docker compose build --pull
docker compose up -d
```

## 5. Validation

```bash
docker compose ps                                   # all services healthy
curl -fsS http://127.0.0.1:82/                       # nginx entrypoint
curl -fsS http://127.0.0.1:82/api/v1/openapi.json    # backend via proxy
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
| Validate nginx | `curl -fsS http://127.0.0.1:82/` |
| Validate backend via proxy | `curl -fsS http://127.0.0.1:82/api/v1/openapi.json` |
| Tail logs | `docker compose logs -f <service>` |

## 7. Persistent data

This app has no file-based media/report storage — the only persistent state is the PostgreSQL database, which lives on the host outside Docker (back it up via the host's normal Postgres backup process, not `/opt/appdata`).

`/opt/appdata/wms-cpc/` exists per the standing convention but currently holds no app data; owned `1000:1000`.

## 8. Troubleshooting

- **Backend can't reach Postgres**: confirm the host's `pg_hba.conf`/`listen_addresses` accept connections from the Docker bridge network, not just `localhost`, and that the Windows Firewall allows the container-to-host route.
- **502 from nginx**: check `docker compose ps` — usually means `backend` or `frontend` failed its healthcheck and never came up. `docker compose logs backend` / `logs frontend`.
- **CORS errors in the browser**: verify `BACKEND_CORS_ORIGINS` in `.env` includes the exact origin used to reach the app (scheme + host + port). CORS is handled entirely by the backend — nginx never sets CORS headers (Rule 1).

## 9. Port assignment

| App | Host Port (external) | Notes |
|---|---|---|
| wms-cpc | `82` | nginx entrypoint → container port 80 |
