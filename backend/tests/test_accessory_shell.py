"""Item 5: the accessory shell.

1. Every module in the warehouse-module map has a sidebar link (Sidebar.tsx)
   and a guarded route (App.tsx), so a module can't be added to the map and
   forgotten in the UI. No database.
2. The new logical location type `production_line`: the model's enum matches
   the database, a production line can be created through the API, and an
   internal receipt can send stock to it (that's how issuing will work).
"""
import itertools
import re
from pathlib import Path

from sqlalchemy import text

from backend import models
from backend.core import warehouse_modules as wm
from backend.core.config import settings

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"
_seq = itertools.count(1)


# ── 1. Every module is reachable in the UI ───────────────────────────────────

def _all_modules():
    return {m for mods in wm.WAREHOUSE_MODULES.values() for m in mods}


def test_every_module_has_a_sidebar_link():
    src = (FRONTEND / "components" / "Sidebar.tsx").read_text(encoding="utf-8")
    linked = set(re.findall(r'module:\s*"(\w+)"', src))
    assert _all_modules() <= linked, f"add a MAIN_NAV/ADMIN_NAV row for: {_all_modules() - linked}"


def test_every_module_has_a_guarded_route():
    src = (FRONTEND / "App.tsx").read_text(encoding="utf-8")
    guarded = set(re.findall(r'<RequireModule module="(\w+)"', src))
    assert _all_modules() <= guarded, f"wrap a route in RequireModule for: {_all_modules() - guarded}"


# ── 2. production_line logical locations ─────────────────────────────────────

def test_location_type_enum_matches_database(db):
    values = db.execute(text("SELECT unnest(enum_range(NULL::wms.logical_location_type))::text")).scalars().all()
    assert set(values) == {t.value for t in models.LogicalLocationType}
    assert "production_line" in values


def test_create_production_line_via_api(client, auth_headers):
    h = auth_headers(role="W_Manager")
    r = client.post(
        "/api/v1/logical-locations/",
        json={"name": f"pytest_sewing_line_{next(_seq)}", "location_type": "production_line"},
        headers=h,
    )
    assert r.status_code == 200, r.text
    assert r.json()["location_type"] == "production_line"
    got = client.get(f"/api/v1/logical-locations/{r.json()['id']}", headers=h)
    assert got.json()["location_type"] == "production_line"


def test_internal_receipt_can_target_a_production_line(client, auth_headers, db, monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", True)
    n = next(_seq)
    line = models.LogicalLocation(name=f"pytest_cutting_{n}", location_type="production_line")
    warehouses = [models.Warehouse(name=f"pytest_{t}_{n}", type=t) for t in ("Fabric", "Accessory")]
    db.add_all([line, *warehouses])
    db.flush()
    h = auth_headers(role="W_Manager")
    for warehouse in warehouses:
        r = client.post(
            "/api/v1/internal-receipts/",
            json={"source_warehouse_id": warehouse.id, "target_logical_location_id": line.id},
            headers=h,
        )
        assert r.status_code == 201, (warehouse.type, r.text)
