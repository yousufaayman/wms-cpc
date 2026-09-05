# Internal App Deployment Framework — v2.0 (Final)

**Scope:** All internally developed apps deployed via Docker on the company VM (Windows Server host).
**Applies to any app built on the standard stack:**
- Backend: Python (FastAPI/uvicorn) or equivalent
- Frontend: Node/Vite (React) SPA, served by nginx
- Reverse proxy: nginx (single entrypoint per app)
- Optional background services: Python workers/schedulers
- Database: PostgreSQL, running on the Windows host (not containerized), reached via `host.docker.internal`
- Orchestration: Docker Compose, one stack per app

This document is stack-specific by design — if a future app deviates from this stack (different language, different DB engine, etc.), treat this as a starting point to adapt, not a rule to force-fit.

---

## 1. Standard Repository Structure

```
app-name/
├── backend/                  # API service source + its own Dockerfile
├── frontend/                 # SPA source + its own Dockerfile
├── shared/                   # optional — cross-service types/schemas consumed by both
│                              #   frontend and backend in monorepo-style apps
├── nginx/
│   ├── Dockerfile             # FROM nginx:alpine, COPY nginx.conf
│   └── nginx.conf
├── workers/                  # optional — any background job/scheduler services
│   └── <worker-name>/
│       ├── Dockerfile
│       └── *.py
├── docker-compose.yml
├── .env.example
├── .dockerignore              # required wherever a Dockerfile uses COPY . .
├── setup.sh
└── DEPLOYMENT_GUIDE.md
```

Use the `shared/` folder whenever frontend and backend need to agree on types/schemas — copy it into the frontend build context explicitly (see §4) rather than duplicating definitions in both places.

---

## 2. Standing Rules

These are non-negotiable across every app on this stack — each one closes a specific failure mode that has actually occurred, so treat them as defaults, not suggestions:

1. **CORS is owned by the backend only.** Never set `Access-Control-Allow-Origin` at the nginx layer. Two layers independently setting the same header produces duplicate headers, which browsers reject outright — and the resulting error gives no indication that nginx is the culprit.
2. **Internal service-to-service calls always use the Docker service name, never a host or LAN IP.** Any container calling another container's API must use `http://<service-name>:<port>/...` over the shared Compose network. An IP-based call works today and breaks the moment the VM's address changes — and it's a silent failure, not a loud one.
3. **Every timezone-sensitive service (schedulers, cron-like workers) installs `tzdata` in its Dockerfile**, in addition to setting `TZ` in the environment. `TZ` alone on a slim base image often silently resolves to UTC.
4. **Every Dockerfile either lists files explicitly in `COPY`, or ships a `.dockerignore`** that excludes `.env`, `.git`, `__pycache__`, `node_modules`, and any local test fixtures. `COPY . .` without a `.dockerignore` is how secrets end up baked into an image layer — recoverable from image history even after the file is later removed.
5. **The frontend never bakes an absolute API origin into the build.** Always call relative paths (`/api/v1/...`) and let nginx proxy them. A build-time `VITE_API_URL` (or equivalent) pointing at a full origin forces a rebuild for every environment and invites a hardcoded fallback IP that goes stale.
6. **Every container that can meaningfully report readiness gets a `HEALTHCHECK`**, and every service that depends on another for correct startup uses `depends_on: <service>: condition: service_healthy` — not just a bare `depends_on` list, which only guarantees container *start*, not *readiness*.
7. **All custom images run as non-root UID/GID `1000:1000`**, matching the ownership set on `/opt/appdata/<app-name>/*` by `setup.sh`. This is what lets the same setup script work unmodified across every app.
8. **`DB_HOST=host.docker.internal`** is the standard for reaching the host-run PostgreSQL instance. Don't containerize Postgres per-app — one engine to patch and back up beats N.

---

## 3. Standard Docker Compose Template

```yaml
version: "3.9"

services:
  nginx:
    build:
      context: .
      dockerfile: nginx/Dockerfile
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_healthy
      frontend:
        condition: service_healthy
    ports:
      - "0.0.0.0:<HOST_PORT>:80"   # see §7 port registry
    volumes:
      - media_files:/app/media:ro
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    networks:
      - app_net
    environment:
      - TZ=Africa/Cairo

  frontend:
    build:
      context: .
      dockerfile: frontend/Dockerfile
      args:
        - VITE_API_URL=/api/v1        # always relative — Rule 5
    environment:
      - TZ=Africa/Cairo
    restart: unless-stopped
    networks:
      - app_net
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:3000/ || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 10s
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file:
      - .env
    environment:
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}
      MEDIA_ROOT: ${MEDIA_ROOT}
      REPORTS_ROOT: ${REPORTS_ROOT}
      BACKEND_CORS_ORIGINS: ${BACKEND_CORS_ORIGINS}
      TZ: Africa/Cairo
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - media_files:/app/media
      - reports:/app/reports
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro
    networks:
      - app_net
    healthcheck:
      test: ["CMD-SHELL", "curl -fsS http://localhost:8000/health || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 5
      start_period: 20s

  # Optional — repeat this block per background worker/scheduler
  worker:
    build:
      context: ./workers/worker-name
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      backend:
        condition: service_healthy
    env_file:
      - .env
    environment:
      API_BASE_URL: http://backend:8000/api/v1   # service name, never host IP — Rule 2
      TZ: Africa/Cairo
    networks:
      - app_net
    volumes:
      - /etc/localtime:/etc/localtime:ro
      - /etc/timezone:/etc/timezone:ro

networks:
  app_net:
    driver: bridge

volumes:
  media_files:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /opt/appdata/<app-name>/media
  reports:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /opt/appdata/<app-name>/reports
```

Add or remove volumes/env vars per app's actual persistent-data needs — the *shape* (healthcheck-gated dependencies, service-name networking, bind-mounted volumes, non-root images) is what's standardized, not every variable name.

---

## 4. Dockerfile Templates

### Backend (Python/FastAPI)
```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends libpq-dev gcc curl && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --uid 1000 --create-home --shell /bin/bash appuser && \
    chown -R 1000:1000 /app

USER 1000:1000

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```
Requires a `.dockerignore` (Rule 4) since it uses `COPY . .`. `curl` is installed specifically so the Compose healthcheck can probe `/health` from inside the container.

### Frontend (Node/Vite → nginx)
```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ .
COPY shared/ ../shared/          # omit if the app has no shared/ directory

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:alpine

RUN rm -f /etc/nginx/conf.d/default.conf && \
    cat <<'EOF' > /etc/nginx/conf.d/default.conf
server {
    listen 3000;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires -1;
        try_files $uri =404;
    }

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    location / {
        try_files $uri /index.html;
    }
}
EOF

COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
```
The `try_files $uri /index.html` fallback here is what makes SPA routing work — it means the reverse-proxy layer (nginx-proxy Dockerfile below) never needs its own SPA-fallback logic. Cache policy (`no-cache` on `index.html`, `immutable` on fingerprinted assets) is standard for any Vite build and should not be re-derived per app.

### nginx (reverse proxy)
```dockerfile
FROM nginx:alpine

COPY nginx/nginx.conf /etc/nginx/nginx.conf
```
Deliberately minimal — this container's only job is routing. It replaces the **main** `nginx.conf`, not a `conf.d` fragment, since the template in §5 ships its own complete `http{}`/`events{}` blocks.

### Worker / Scheduler (Python)
```dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && \
    apt-get install -y --no-install-recommends tzdata && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY config.py api_client.py <other files> ./

RUN useradd --uid 1000 --create-home --shell /bin/bash appuser && \
    chown -R 1000:1000 /app

USER 1000:1000

CMD ["python", "scheduler.py"]
```
Uses explicit `COPY` (Rule 4) rather than `COPY . .` since worker services are small and their file list is short — no `.dockerignore` needed as a result, but one should still exist if this ever changes.

---

## 5. nginx.conf Template (Reverse Proxy)

```nginx
worker_processes auto;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    keepalive_timeout  65;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml+rss text/javascript;
    gzip_min_length 512;

    upstream backend_upstream {
        server backend:8000;
    }

    upstream frontend_upstream {
        server frontend:3000;
    }

    server {
        listen 80;
        server_name _;

        client_max_body_size 50m;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;

        location /api/ {
            proxy_pass http://backend_upstream;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            # CORS is handled by the backend — do not add CORS headers here (Rule 1)
        }

        location /media/ {
            alias /app/media/;
            access_log off;
            expires 7d;
            add_header Cache-Control "public, max-age=604800";
            try_files $uri =404;
        }

        location / {
            proxy_pass http://frontend_upstream;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            # No SPA-fallback logic needed here — the frontend's own nginx
            # already handles unmatched routes via try_files (see §4 Frontend).
        }
    }
}
```

Adjust `client_max_body_size` per app if it handles large uploads; everything else is a direct copy.

---

## 6. Environment Variable Standard

`.env.example` groups variables consistently:

```
# Database
DB_HOST=host.docker.internal
DB_PORT=5432
DB_NAME=
DB_USER=
DB_PASSWORD=

# Storage (bind-mounted — see §8)
MEDIA_ROOT=/app/media
REPORTS_ROOT=/app/reports

# Networking
BACKEND_CORS_ORIGINS=

# App-specific blocks (SMTP, third-party APIs, etc.) — documented inline
```

- `.env` is never committed; `setup.sh` copies `.env.example` → `.env` only if `.env` doesn't already exist.
- Every variable gets a one-line comment. No undocumented variables.
- Don't duplicate the same value under two variable names unless two separate libraries genuinely require different names — if that's the case, comment *why*, so it doesn't look like leftover cruft to the next person.

---

## 7. Networking & Port Allocation Convention

Maintain a single running registry across all apps:

| App | Host Port (external) | Notes |
|---|---|---|
| *(app 1)* | `81` | via Windows portproxy → 80 |
| *(app 2)* | `82` | |
| *(app 3)* | `83` | |

- Reserve the port before writing the compose file; record it in this table and in the app's own `DEPLOYMENT_GUIDE.md`.
- Internal container ports stay fixed regardless of app: nginx `80`, backend `8000`, frontend `3000`. Only the host-side mapping changes — this keeps every app's internal network topology identical and predictable to debug.
- **Revisit at ~5 apps:** migrate to a single shared reverse proxy (Traefik, or one shared nginx) doing host-based routing instead of a growing port table plus Windows portproxy rules. Plan this as a scheduled migration, not a reactive scramble.

---

## 8. Persistent Data Convention

```
/opt/appdata/<app-name>/media
/opt/appdata/<app-name>/reports   (or whatever categories the app needs)
```

- Ownership `1000:1000` — matches Rule 7 (non-root UID) so no per-app `setup.sh` customization is needed.
- Must survive `docker compose down`, image rebuilds, and Windows Server reboots. Confirm this on every new app before go-live.

---

## 9. First-Time Setup Script Standard (`setup.sh`)

Every app's `setup.sh` performs, in this order:

1. Create `/opt/appdata/<app-name>/*` directories
2. `chown 1000:1000` on those directories
3. Copy `.env.example` → `.env` **only if `.env` doesn't already exist**
4. Verify Docker + Compose are installed — fail loudly with install instructions if not
5. `docker compose pull` (or `build --pull` if no registry is used)

---

## 10. Operations Command Standard

Every `DEPLOYMENT_GUIDE.md` documents these, in this order:

| Task | Command |
|---|---|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Restart | `docker compose restart` |
| Rebuild one service | `docker compose build <service> && docker compose up -d <service>` |
| Validate stack | `docker compose ps` |
| Validate nginx | `curl -fsS http://127.0.0.1:<host-port>/` |
| Validate backend via proxy | `curl -fsS http://<host>/api/v1/health/` |
| Tail worker logs | `docker compose logs -f <worker-name>` |
| Manual one-off worker run | `docker compose run --rm <worker-name> python run_once.py` |

---

## 11. Documentation Requirement

Every app ships a `DEPLOYMENT_GUIDE.md`, sections in this order:

1. Prerequisites (including any host-level dependencies specific to this app — e.g. a hardware/service integration that isn't part of the general stack)
2. First-time setup (`setup.sh` walkthrough)
3. `.env` variable reference table
4. Build & start instructions
5. Validation steps (health checks)
6. Operations command table (§10)
7. Persistent data paths
8. Troubleshooting (app-specific failure modes)
9. Port assignment (cross-reference §7 registry)

---

## 12. New App Onboarding Checklist

- [ ] Repo follows §1 structure
- [ ] All eight Standing Rules (§2) verified — not assumed
- [ ] `docker-compose.yml` built from the §3 template, adjusted only where the app's actual needs differ
- [ ] Dockerfiles built from the §4 templates
- [ ] `nginx.conf` built from the §5 template
- [ ] `.env.example` complete and documented (§6)
- [ ] Host port reserved and logged in the registry (§7)
- [ ] `/opt/appdata/<app-name>/` paths defined and confirmed persistent (§8)
- [ ] `setup.sh` implements the standard 5 steps (§9)
- [ ] `DEPLOYMENT_GUIDE.md` written using the §11 template
- [ ] `docker compose ps` + all healthchecks green post-deploy
- [ ] Backup/restore path for this app's persistent data confirmed

---

## Open items to revisit as app count grows

1. **Central reverse proxy migration** (§7) — plan the trigger point rather than letting port sprawl force it.
2. **Image registry** — apps currently build locally on the VM. If deployment frequency increases, consider a private registry so builds happen in CI and the VM only pulls, giving version history for rollback.
3. **Backup automation** — `/opt/appdata/` and the host-run PostgreSQL both need a documented, scheduled backup process rather than an ad hoc one per app.
