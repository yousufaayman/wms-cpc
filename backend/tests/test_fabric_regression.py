"""Fabric regression suite: what fabric does today, pinned down so accessory
work (shared receipts, the posting service, expected deliveries) can't break it.

Covered, all through the real API:
- ingestion: dyed and undyed rolls link to the oldest open expected-delivery
  line and its received_* totals are recomputed from the rolls; the delivery
  goes pending -> partial -> received; deleting / editing / swapping a roll
  recomputes; closed deliveries are frozen; no match = roll still created
- remnants: only an issued ('out') roll can be the original
- scanning onto supplier, internal and external receipts flips the roll to
  'out', removing the line puts it back 'in'
- material requests: a linked receipt only takes dyed rolls of a requested code
- the posting service itself refuses lines of the wrong kind

Internal confirm (rolls stay out, adapter called once) is in
test_posting_service.py.
"""
import itertools
from datetime import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException

from backend import models, schemas
from backend.domains import posting

_seq = itertools.count(1)


# ── Setup ────────────────────────────────────────────────────────────────────

@pytest.fixture
def fab(db):
    """A Fabric warehouse with a rack, a location, a client, a material and
    one dyed fabric code. Names are unique per test."""
    n = next(_seq)
    wh = models.Warehouse(name=f"pytest_reg_wh_{n}", type="Fabric")
    loc = models.LogicalLocation(name=f"pytest_reg_loc_{n}", location_type="internal")
    cl = models.Client(client_name=f"pytest_reg_client_{n}")
    mat = models.Material(material_name=f"pytest_reg_mat_{n}")
    color = models.Color(color_name=f"pytest_reg_color_{n}")
    db.add_all([wh, loc, cl, mat, color])
    db.flush()
    rack = models.WarehouseRack(warehouse_id=wh.id, rack_code=f"R{n}")
    code = models.ClientFabricCode(client_id=cl.client_id, color_id=color.color_id, material_id=mat.material_id)
    db.add_all([rack, code])
    db.flush()

    class F:
        pass

    f = F()
    f.wh, f.loc, f.client, f.mat, f.color, f.rack, f.code = wh, loc, cl, mat, color, rack, code
    return f


@pytest.fixture
def mgr(auth_headers):
    return auth_headers("W_Manager")


def _delivery(client, headers, fab, *lines):
    """An expected delivery in the fab warehouse with the given lines; returns
    (delivery_id, [line ids])."""
    r = client.post("/api/v1/expected-deliveries/", json={"warehouse_id": fab.wh.id}, headers=headers)
    assert r.status_code == 201, r.text
    did = r.json()["id"]
    ids = []
    for line in lines:
        r = client.post(f"/api/v1/expected-deliveries/{did}/items", json=line, headers=headers)
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    return did, ids


def _get_delivery(client, headers, did):
    r = client.get(f"/api/v1/expected-deliveries/{did}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _dyed(client, headers, fab, weight=10, **extra):
    body = {"client_fabric_code_id": fab.code.id, "weight": weight, "rack_id": fab.rack.id, **extra}
    r = client.post("/api/v1/dyed-fabric-rolls/", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _undyed(client, headers, fab, weight=10, **extra):
    body = {"client_id": fab.client.client_id, "material_id": fab.mat.material_id,
            "weight": weight, "rack_id": fab.rack.id, **extra}
    r = client.post("/api/v1/undyed-fabric-rolls/", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def _receipt(client, headers, fab, kind):
    if kind == "supplier":
        url, body = "/api/v1/supplier-receipts/", {"source_warehouse_id": fab.wh.id, "target_logical_location_id": fab.loc.id}
    elif kind == "internal":
        url, body = "/api/v1/internal-receipts/", {"source_warehouse_id": fab.wh.id, "target_logical_location_id": fab.loc.id}
    else:
        url, body = "/api/v1/external-receipts/", {"source_warehouse_id": fab.wh.id, "receiver": "pytest receiver"}
    r = client.post(url, json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _scan(client, headers, kind, rid, *, dyed_id=None, undyed_id=None):
    body = ({"item_type": "FabricRoll", "dyed_roll_id": dyed_id} if dyed_id is not None
            else {"item_type": "UndyedFabricRoll", "undyed_roll_id": undyed_id})
    return client.post(f"/api/v1/receipts/{kind}/{rid}/fabric-items", json=body, headers=headers)


def _roll(db, model, roll_id):
    roll = db.get(model, roll_id)
    db.refresh(roll)
    return roll


# ── Ingestion + expected-delivery received counters ─────────────────────────

def test_dyed_ingestion_fills_the_delivery_line(client, mgr, fab):
    did, (line,) = _delivery(client, mgr, fab, {"client_fabric_code_id": fab.code.id, "expected_weight_kg": 25})
    assert _get_delivery(client, mgr, did)["status"] == "pending"

    a = _dyed(client, mgr, fab, weight=10, length=40)
    assert a["expected_delivery_item_id"] == line
    assert a["matched_delivery_id"] == did
    d = _get_delivery(client, mgr, did)
    assert d["status"] == "partial"
    assert d["items"][0]["received_weight_kg"] == 10
    assert d["items"][0]["received_length_m"] == 40

    _dyed(client, mgr, fab, weight=15)
    d = _get_delivery(client, mgr, did)
    assert d["items"][0]["received_weight_kg"] == 25
    assert d["status"] == "received"
    assert d["closed_at"] is not None


def test_deleting_a_roll_takes_it_off_the_line(client, mgr, fab):
    did, _ = _delivery(client, mgr, fab, {"client_fabric_code_id": fab.code.id, "expected_weight_kg": 100})
    a = _dyed(client, mgr, fab, weight=10)
    _dyed(client, mgr, fab, weight=5)
    assert _get_delivery(client, mgr, did)["items"][0]["received_weight_kg"] == 15

    assert client.delete(f"/api/v1/dyed-fabric-rolls/{a['id']}", headers=mgr).status_code == 204
    d = _get_delivery(client, mgr, did)
    assert d["items"][0]["received_weight_kg"] == 5
    assert d["status"] == "partial"


def test_swap_weight_length_recomputes(client, mgr, fab):
    did, _ = _delivery(client, mgr, fab, {"client_fabric_code_id": fab.code.id, "expected_weight_kg": 100})
    a = _dyed(client, mgr, fab, weight=30, length=12)
    r = client.post(f"/api/v1/dyed-fabric-rolls/{a['id']}/swap-weight-length", headers=mgr)
    assert r.status_code == 200, r.text
    assert (r.json()["weight"], r.json()["length"]) == (12, 30)
    item = _get_delivery(client, mgr, did)["items"][0]
    assert (item["received_weight_kg"], item["received_length_m"]) == (12, 30)


def test_undyed_ingestion_matches_client_and_material(client, mgr, fab):
    line = {"client_id": fab.client.client_id, "material_id": fab.mat.material_id, "expected_weight_kg": 20}
    did, (line_id,) = _delivery(client, mgr, fab, line)

    a = _undyed(client, mgr, fab, weight=8)
    assert a["expected_delivery_item_id"] == line_id
    assert _get_delivery(client, mgr, did)["items"][0]["received_weight_kg"] == 8

    # Editing the weight recomputes the line.
    r = client.patch(f"/api/v1/undyed-fabric-rolls/{a['id']}", json={"weight": 20}, headers=mgr)
    assert r.status_code == 200, r.text
    d = _get_delivery(client, mgr, did)
    assert d["items"][0]["received_weight_kg"] == 20
    assert d["status"] == "received"


def test_oldest_open_line_is_filled_first(client, mgr, fab):
    first, (first_line,) = _delivery(client, mgr, fab, {"client_fabric_code_id": fab.code.id, "expected_weight_kg": 10})
    _, (second_line,) = _delivery(client, mgr, fab, {"client_fabric_code_id": fab.code.id, "expected_weight_kg": 10})
    assert _dyed(client, mgr, fab, weight=10)["expected_delivery_item_id"] == first_line
    # The first line is now full, so the next roll goes to the second.
    assert _dyed(client, mgr, fab, weight=4)["expected_delivery_item_id"] == second_line


def test_closed_delivery_is_frozen(client, db, mgr, fab):
    did, (line_id,) = _delivery(client, mgr, fab, {"client_fabric_code_id": fab.code.id, "expected_weight_kg": 100})
    a = _dyed(client, mgr, fab, weight=10)
    r = client.put(f"/api/v1/expected-deliveries/{did}", json={"status": "cancelled"}, headers=mgr)
    assert r.status_code == 200, r.text

    # New rolls don't link to a closed delivery, and deleting a linked roll
    # doesn't change its totals.
    assert _dyed(client, mgr, fab, weight=5)["expected_delivery_item_id"] is None
    assert client.delete(f"/api/v1/dyed-fabric-rolls/{a['id']}", headers=mgr).status_code == 204
    item = db.get(models.ExpectedDeliveryItem, line_id)
    db.refresh(item)
    assert item.received_weight_kg == Decimal("10.00")


def test_ingestion_without_a_delivery_is_not_blocked(client, mgr, fab):
    a = _dyed(client, mgr, fab, weight=10)
    assert a["expected_delivery_item_id"] is None
    assert a["matched_delivery_id"] is None
    assert a["status"] == "in"
    assert a["ingested_by"] is not None


def test_remnant_needs_an_issued_original(client, mgr, fab):
    original = _dyed(client, mgr, fab, weight=10)
    body = {"client_fabric_code_id": fab.code.id, "weight": 3, "original_roll_id": original["id"]}
    r = client.post("/api/v1/dyed-fabric-rolls/", json=body, headers=mgr)
    assert r.status_code == 400
    assert "must be issued" in r.json()["detail"]

    rid = _receipt(client, mgr, fab, "internal")
    assert _scan(client, mgr, "internal", rid, dyed_id=original["id"]).status_code == 201
    r = client.post("/api/v1/dyed-fabric-rolls/", json=body, headers=mgr)
    assert r.status_code == 201, r.text


# ── Scanning onto receipts (all three kinds) ─────────────────────────────────

@pytest.mark.parametrize("kind", ["supplier", "internal", "external"])
@pytest.mark.parametrize("roll_type", ["dyed", "undyed"])
def test_scan_and_remove_on_every_receipt_kind(client, db, mgr, fab, kind, roll_type):
    if roll_type == "dyed":
        roll_id, model = _dyed(client, mgr, fab)["id"], models.DyedFabricRoll
        scan = {"dyed_id": roll_id}
    else:
        roll_id, model = _undyed(client, mgr, fab)["id"], models.UndyedFabricRoll
        scan = {"undyed_id": roll_id}
    rid = _receipt(client, mgr, fab, kind)

    r = _scan(client, mgr, kind, rid, **scan)
    assert r.status_code == 201, r.text
    line = r.json()
    assert line[f"{kind}_receipt_id"] == rid
    roll = _roll(db, model, roll_id)
    assert roll.status == "out" and roll.issued_date is not None

    r = client.get(f"/api/v1/receipts/{kind}/{rid}/fabric-items", headers=mgr)
    assert [i["id"] for i in r.json()] == [line["id"]]

    # The same roll can't go on a second receipt while it's out.
    other = _receipt(client, mgr, fab, kind)
    r = _scan(client, mgr, kind, other, **scan)
    assert r.status_code == 400 and "not in stock" in r.json()["detail"]

    assert client.delete(f"/api/v1/receipts/fabric-items/{line['id']}", headers=mgr).status_code == 204
    roll = _roll(db, model, roll_id)
    assert roll.status == "in" and roll.issued_date is None


def test_deleting_an_unknown_line_is_404(client, mgr):
    assert client.delete("/api/v1/receipts/fabric-items/987654321", headers=mgr).status_code == 404


# ── Material requests on a receipt ───────────────────────────────────────────

def test_receipt_with_material_request_only_takes_requested_codes(client, db, mgr, fab):
    style = models.Model(model_name=f"pytest_reg_model_{next(_seq)}")
    other_color = models.Color(color_name=f"pytest_reg_color_x{next(_seq)}")
    db.add_all([style, other_color])
    db.flush()
    jo = models.JobOrder(job_order_number=f"pytest-jo-{next(_seq)}", client_id=fab.client.client_id,
                         model_id=style.model_id, date_created=datetime.now())
    db.add(jo)
    db.flush()
    other_code = models.ClientFabricCode(
        client_id=fab.client.client_id, color_id=other_color.color_id, material_id=fab.mat.material_id
    )
    db.add(other_code)
    db.flush()
    mr = models.JobOrderMaterialRequest(
        job_order_id=jo.job_order_id, panel_type="body", consumption=1, fabric_code_id=fab.code.id
    )
    db.add(mr)
    db.flush()

    rid = _receipt(client, mgr, fab, "internal")
    r = client.post(
        "/api/v1/material-request-fulfillments/",
        json={"material_request_id": mr.id, "internal_receipt_id": rid},
        headers=mgr,
    )
    assert r.status_code == 201, r.text

    wrong = client.post("/api/v1/dyed-fabric-rolls/",
                        json={"client_fabric_code_id": other_code.id, "weight": 5}, headers=mgr).json()
    r = _scan(client, mgr, "internal", rid, dyed_id=wrong["id"])
    assert r.status_code == 400 and "does not match" in r.json()["detail"]

    undyed = _undyed(client, mgr, fab)
    r = _scan(client, mgr, "internal", rid, undyed_id=undyed["id"])
    assert r.status_code == 400 and "only dyed rolls" in r.json()["detail"]

    right = _dyed(client, mgr, fab)
    assert _scan(client, mgr, "internal", rid, dyed_id=right["id"]).status_code == 201

    # Refused scans changed nothing.
    assert _roll(db, models.DyedFabricRoll, wrong["id"]).status == "in"
    assert _roll(db, models.UndyedFabricRoll, undyed["id"]).status == "in"


# ── The posting service is the gate ──────────────────────────────────────────

def test_posting_service_refuses_wrong_line_kind(client, db, mgr, fab):
    """Called directly (no endpoint), add_line still checks the line fits the
    receipt's warehouse, so future callers can't skip it."""
    rid = _receipt(client, mgr, fab, "internal")
    with pytest.raises(HTTPException) as e:
        posting.add_line(db, "internal", rid, "accessory", schemas.AccessoryReceiptItemCreate())
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        posting.add_line(db, "internal", 987_654_321, "fabric",
                         schemas.FabricReceiptItemCreate(item_type="FabricRoll", dyed_roll_id=1))
    assert e.value.status_code == 404
