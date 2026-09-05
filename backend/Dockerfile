FROM python:3.11-slim AS base

WORKDIR /app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r ./backend/requirements.txt

# ── Development ────────────────────────────────────────────────────────────────
FROM base AS dev
COPY backend/ ./backend/
EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ── Production ─────────────────────────────────────────────────────────────────
FROM base AS prod

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    rm -rf /var/lib/apt/lists/*

COPY backend/ ./backend/

RUN useradd --uid 1000 --create-home --shell /bin/bash appuser && \
    chown -R 1000:1000 /app

USER 1000:1000

EXPOSE 8000
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
