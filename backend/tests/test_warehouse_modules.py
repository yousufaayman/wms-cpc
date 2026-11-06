"""Each warehouse type only sees and uses its own modules.

1. The backend map (core/warehouse_modules.py) and the frontend copy
   (frontend/src/lib/warehouseModules.ts) must be identical. No database.
2. The API refuses actions that don't belong to a warehouse's type: receipts
   in RMG, fabric lines on accessory receipts (and the reverse), fabric
   material requests outside the Fabric warehouse, fabric rolls on accessory
   racks, and so on.
"""
import itertools
import re
from pathlib import Path

import pytest
from fastapi import HTTPException

from backend import models
from backend.core import warehouse_modules as wm
from backend.core.config import settings

TS_FILE = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "warehouseModules.ts"
_seq = itertools.count(1)


# ── 1. Backend and frontend agree ────────────────────────────────────────────

def _parse_ts():
    src = TS_FILE.read_text(encoding="utf-8")
    union = re.search(r"export type WarehouseModule\s*=(.*?);", src, re.S)
    declared = set(re.findall(r'"([a-z_]+)"', union.group(1)))
    body = re.search(r"WAREHOUSE_MODULES[^=]*=\s*\{(.*?)\n\};", src, re.S).group(1)
    types = {}
    for wtype, entries in re.findall(r"^\s*(\w+):\s*\{(.*?)\}", body, re.S | re.M):
        types[wtype] = {
            mod: (None if val == "null" else val.strip('"'))
            for mod, val in re.findall(r'(\w+):\s*(null|"\w+")', entries)
        }
    return declared, types


def test_frontend_map_matches_backend():
    _, ts_types = _parse_ts()
    assert ts_types == wm.WAREHOUSE_MODULES


def test_every_module_used_is_declared_in_frontend_type():
    declared, _ = _parse_ts()
    used = {m for mods in wm.WAREHOUSE_MODULES.values() for m in mods}
    assert used <= declared, f"declare in WarehouseModule: {used - declared}"


def test_every_warehouse_type_is_mapped():
    assert set(wm.WAREHOUSE_MODULES) == {t.value for t in models.WarehouseType}
    assert set(wm.RECEIPT_LINE_KIND) == set(wm.WAREHOUSE_MODULES)


@pytest.mark.parametrize("acc,needles,module,expected", [
    (False, False, "receipts", False),
    (True, False, "receipts", True),
    (True, False, "needle_exchange", False),
    (True, True, "needle_exchange", True),
    (False, False, "warehouse_racks", True),   # set-up pages work with the flag off
])
def test_accessory_modules_follow_flags(monkeypatch, acc, needles, module, expected):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", acc)
    monkeypatch.setattr(settings, "FEATURE_NEEDLES", needles)
    assert wm.module_enabled("Accessory", module) is expected


def test_fabric_only_modules():
    for module in ("fabric_inventory", "fabric_rolls", "analytics"):
        assert wm.module_enabled("Fabric", module)
        assert not wm.module_enabled("Accessory", module)
        assert not wm.module_enabled("RMG", module)


# ── 2. The API enforces it ───────────────────────────────────────────────────

@pytest.fixture
def accessories_on(monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", True)


@pytest.fixture
def wh(db):
    """One warehouse of each type, plus a logical location."""
    n = next(_seq)
    out = {t: models.Warehouse(name=f"pytest_{t}_{n}", type=t) for t in ("Fabric", "Accessory", "RMG")}
    out["loc"] = models.LogicalLocation(name=f"pytest_loc_{n}", location_type="internal")
    db.add_all(out.values())
    db.flush()
    return out


def _internal(client, headers, warehouse, loc):
    return client.post(
        "/api/v1/internal-receipts/",
        json={"source_warehouse_id": warehouse.id, "target_logical_location_id": loc.id},
        headers=headers,
    )


def test_receipts_per_warehouse_type(client, auth_headers, wh, monkeypatch):
    h = auth_headers(role="W_Manager")
    assert _internal(client, h, wh["Fabric"], wh["loc"]).status_code == 201
    assert _internal(client, h, wh["RMG"], wh["loc"]).status_code == 400
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    assert _internal(client, h, wh["Accessory"], wh["loc"]).status_code == 400
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", True)
    assert _internal(client, h, wh["Accessory"], wh["loc"]).status_code == 201


def test_receipt_cannot_move_to_another_warehouse_type(client, auth_headers, wh, accessories_on):
    h = auth_headers(role="W_Manager")
    rid = _internal(client, h, wh["Fabric"], wh["loc"]).json()["id"]
    r = client.put(f"/api/v1/internal-receipts/{rid}", json={"source_warehouse_id": wh["Accessory"].id}, headers=h)
    assert r.status_code == 400, r.text


def test_receipt_lines_match_warehouse_type(client, auth_headers, wh, accessories_on):
    h = auth_headers(role="W_Manager")
    fabric_rid = _internal(client, h, wh["Fabric"], wh["loc"]).json()["id"]
    acc_rid = _internal(client, h, wh["Accessory"], wh["loc"]).json()["id"]

    fabric_line = {"item_type": "FabricRoll", "dyed_roll_id": 1}
    r = client.post(f"/api/v1/receipts/internal/{acc_rid}/fabric-items", json=fabric_line, headers=h)
    assert r.status_code == 400 and "cannot hold fabric" in r.text

    r = client.post(f"/api/v1/receipts/internal/{fabric_rid}/accessory-items", json={}, headers=h)
    assert r.status_code == 400 and "cannot hold accessory" in r.text

    r = client.post(f"/api/v1/receipts/internal/{acc_rid}/accessory-items", json={}, headers=h)
    assert r.status_code == 201, r.text


def test_material_requests_filter_by_warehouse(client, auth_headers, wh, accessories_on):
    h = auth_headers(role="W_Manager")
    url = "/api/v1/job-order-material-requests/"
    assert client.get(url, params={"warehouse_id": wh["Fabric"].id}, headers=h).status_code == 200
    r = client.get(url, params={"warehouse_id": wh["Accessory"].id}, headers=h)
    assert r.status_code == 200 and r.json() == []
    assert client.get(url, params={"warehouse_id": wh["RMG"].id}, headers=h).status_code == 400


def test_fulfillment_needs_a_fabric_receipt(client, auth_headers, wh, accessories_on):
    h = auth_headers(role="W_Manager")
    acc_rid = _internal(client, h, wh["Accessory"], wh["loc"]).json()["id"]
    r = client.post(
        "/api/v1/material-request-fulfillments/",
        json={"material_request_id": 1, "internal_receipt_id": acc_rid},
        headers=h,
    )
    assert r.status_code == 400 and "cannot hold fabric" in r.text


def test_expected_deliveries_per_warehouse_type(client, auth_headers, wh, accessories_on):
    h = auth_headers(role="W_Manager")
    url = "/api/v1/expected-deliveries/"
    assert client.post(url, json={"warehouse_id": wh["RMG"].id}, headers=h).status_code == 400
    r = client.post(url, json={"warehouse_id": wh["Accessory"].id}, headers=h)
    assert r.status_code == 201, r.text
    # today's delivery lines are fabric lines: not allowed on an accessory delivery
    r = client.post(f"{url}{r.json()['id']}/items", json={"client_fabric_code_id": 1}, headers=h)
    assert r.status_code == 400 and "Fabric lines" in r.text


def test_fabric_rolls_only_on_fabric_racks(db, wh):
    racks = {}
    for t in ("Fabric", "Accessory"):
        racks[t] = models.WarehouseRack(warehouse_id=wh[t].id, rack_code=f"PYT-{t[:3]}-{next(_seq)}")
    db.add_all(racks.values())
    db.flush()
    wm.ensure_rack_module(db, racks["Fabric"].id, "fabric_rolls")
    wm.ensure_rack_module(db, None, "fabric_rolls")  # no rack: nothing to check
    with pytest.raises(HTTPException) as e:
        wm.ensure_rack_module(db, racks["Accessory"].id, "fabric_rolls")
    assert e.value.status_code == 400
