"""Test setup: a throwaway database with the real schema.

pytest builds a separate database, `wms_cpc_test`, at the start of every run.
It never touches the dev database's data. Where the schema comes from:

1. **cpc-db migrations** (Atlas), when the migrations folder has files.
   This is the real source of truth, and what CI uses.
   Folder: $CPC_DB_MIGRATIONS_DIR, default ../cpc-db/migrations.
2. **Otherwise, a structure-only copy of the dev database**
   (`pg_dump --schema-only` of POSTGRES_DATABASE from .env): tables only, no rows.
   This is for local runs before the cpc-db baseline exists.

Force one with TEST_SCHEMA_SOURCE=atlas | dev-copy. If neither is available,
tests that need the database are skipped and the rest still run.

Every test that uses `db` or `client` runs in a transaction that is rolled
back afterwards, so tests never see each other's rows.
"""
from __future__ import annotations

import itertools
import os
import shutil
import subprocess
from pathlib import Path
from typing import Callable, Dict, Optional
from urllib.parse import quote

# The app's engine is built from settings when backend.database is imported,
# so point it at the test database before importing anything from backend.
from backend.core.config import settings  # noqa: E402  (reads .env only, no DB)

DEV_DB = settings.POSTGRES_DATABASE
TEST_DB = os.environ.get("TEST_POSTGRES_DATABASE", "wms_cpc_test")
if not TEST_DB.endswith("_test"):
    raise RuntimeError(f"Refusing to use {TEST_DB!r} for tests: the name must end with '_test'")
if TEST_DB == DEV_DB:
    raise RuntimeError("The test database must not be the dev database")
settings.POSTGRES_DATABASE = TEST_DB

import psycopg2  # noqa: E402
import pytest  # noqa: E402
from psycopg2 import sql  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from backend import models  # noqa: E402
from backend.core.authz import WMS_SYSTEM_ID  # noqa: E402
from backend.core.security import create_access_token  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = Path(os.environ.get("CPC_DB_MIGRATIONS_DIR", REPO.parent / "cpc-db" / "migrations")).resolve()


# ── Tools ────────────────────────────────────────────────────────────────────

def _find_tool(name: str, extra_dirs: list) -> Optional[str]:
    found = shutil.which(name)
    if found:
        return found
    for d in extra_dirs:
        for candidate in (Path(d) / name, Path(d) / f"{name}.exe"):
            if candidate.is_file():
                return str(candidate)
    return None


def _pg_tool(name: str) -> Optional[str]:
    # Windows installs aren't on PATH by default; prefer the newest version.
    win_dirs = sorted(Path("C:/Program Files/PostgreSQL").glob("*/bin"), reverse=True)
    return _find_tool(name, [os.environ.get("PG_BIN", "")] + win_dirs)


def _atlas() -> Optional[str]:
    return _find_tool("atlas", [os.environ.get("ATLAS_BIN_DIR", ""), "C:/tools/atlas"])


def _has_migrations() -> bool:
    return MIGRATIONS_DIR.is_dir() and any(MIGRATIONS_DIR.glob("*.sql"))


# ── Building the test database ───────────────────────────────────────────────

def _pg_env() -> dict:
    return {**os.environ, "PGPASSWORD": settings.POSTGRES_PASSWORD}


def _recreate_test_database() -> None:
    admin = psycopg2.connect(
        host=settings.POSTGRES_HOST, port=settings.POSTGRES_PORT,
        user=settings.POSTGRES_USER, password=settings.POSTGRES_PASSWORD, dbname="postgres",
    )
    admin.autocommit = True
    try:
        with admin.cursor() as cur:
            cur.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(TEST_DB)))
            cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(TEST_DB)))
    finally:
        admin.close()


def _load_from_atlas(atlas: str) -> None:
    url = (
        f"postgres://{quote(settings.POSTGRES_USER, safe='')}:{quote(settings.POSTGRES_PASSWORD, safe='')}"
        f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{TEST_DB}?sslmode=disable"
    )
    subprocess.run(
        # file://S:/... (not as_uri()'s file:///S:/..., which Atlas can't open on Windows)
        [atlas, "migrate", "apply", "--url", url, "--dir", f"file://{MIGRATIONS_DIR.as_posix()}"],
        check=True, capture_output=True, text=True,
    )


def _load_from_dev_copy(pg_dump: str, psql: str) -> None:
    conn = ["-h", settings.POSTGRES_HOST, "-p", str(settings.POSTGRES_PORT), "-U", settings.POSTGRES_USER]
    dump = subprocess.run(
        [pg_dump, *conn, "-d", DEV_DB, "--schema-only", "--no-owner", "--no-privileges"],
        check=True, capture_output=True, env=_pg_env(),
    ).stdout
    subprocess.run(
        [psql, *conn, "-d", TEST_DB, "-q", "-v", "ON_ERROR_STOP=1"],
        input=dump, check=True, capture_output=True, env=_pg_env(),
    )


def _build_schema() -> str:
    """Fill the test DB; return a description of the source, or raise Skip."""
    choice = os.environ.get("TEST_SCHEMA_SOURCE", "auto")
    atlas, pg_dump, psql = _atlas(), _pg_tool("pg_dump"), _pg_tool("psql")

    if choice in ("auto", "atlas") and atlas and _has_migrations():
        _recreate_test_database()
        _load_from_atlas(atlas)
        return f"cpc-db migrations ({MIGRATIONS_DIR})"
    if choice == "atlas":
        pytest.skip(f"TEST_SCHEMA_SOURCE=atlas but atlas or migrations missing ({MIGRATIONS_DIR})")

    if choice in ("auto", "dev-copy") and pg_dump and psql:
        _recreate_test_database()
        _load_from_dev_copy(pg_dump, psql)
        return f"structure-only copy of dev database {DEV_DB}"

    pytest.skip("No schema source: need cpc-db migrations + atlas, or pg_dump/psql and the dev database")


# ── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def database():
    """The app's engine, pointed at a freshly built test database."""
    try:
        source = _build_schema()
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"")
        detail = detail.decode(errors="replace") if isinstance(detail, bytes) else detail
        raise RuntimeError(f"Building the test database failed:\n{detail[-2000:]}") from exc
    print(f"\n[tests] schema source: {source}")

    from backend.database import engine

    yield engine
    engine.dispose()


@pytest.fixture
def db(database) -> Session:
    """A session inside a transaction that is rolled back after the test.
    Code under test may call commit(); it only ends a savepoint."""
    conn = database.connect()
    outer = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        conn.close()


@pytest.fixture
def client(db):
    """HTTP client for the API, using the test session."""
    from fastapi.testclient import TestClient

    from backend.database import get_db
    from backend.main import app

    app.dependency_overrides[get_db] = lambda: db
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


_user_seq = itertools.count(1)


@pytest.fixture
def make_user(db) -> Callable[..., models.User]:
    """make_user(role="W_Manager") creates a user with that WMS role (None = no role)."""
    if db.get(models.System, WMS_SYSTEM_ID) is None:
        db.add(models.System(id=WMS_SYSTEM_ID, name="WMS"))
        db.flush()

    def _make(role: Optional[str] = "W_Manager") -> models.User:
        user = models.User(username=f"pytest_user_{next(_user_seq)}", password_hash="x")
        db.add(user)
        db.flush()
        if role:
            db.add(models.UserRole(user_id=user.id, system_id=WMS_SYSTEM_ID, role=role))
            db.flush()
        return user

    return _make


@pytest.fixture
def auth_headers(make_user) -> Callable[..., Dict[str, str]]:
    """auth_headers(role="W_Manager") returns a login header for a new user with that role."""

    def _headers(role: Optional[str] = "W_Manager", user: Optional[models.User] = None) -> Dict[str, str]:
        user = user or make_user(role)
        return {"Authorization": f"Bearer {create_access_token(user.username)}"}

    return _headers
