"""Item 20: issuing accessories to job orders.

An issue = an internal receipt of an Accessory warehouse with a job order and
a destination; packs are scanned onto it (lines) and confirming posts one
`issue` ledger row per line. What these tests prove:
1. the full flow (create → scan → confirm) against a hand calculation:
   stock, requirement balance, the posting's links, the invariants
2. the header rules: an accessory issue needs a JO and an internal /
   production-line destination; fabric receipts can't carry a JO
3. the scan rules: barcode or id, the item must be on the JO's list,
   client-match, pack active / in this warehouse / enough free (unconfirmed
   lines hold quantity back), units convert, whole numbers for PCS
4. D-2 over-issue: refused without a reason, allowed and flagged with one,
   counted on the receipt; re-checked on confirm
5. lines: removable until confirmed, not after; no scanning after confirm
6. permissions: scanning needs issue_accessories, W_Manager confirms
   accessory issues but not fabric ones
7. the job-order picker, `pending`, issue history links, the shortage report
"""
import itertools
from datetime import datetime, timezone
from decimal import Decimal

import pytest

from backend import models
from backend.domains.posting import accessory as ledger
from backend.domains.posting.accessory import NewPack
from backend.tests.test_accessory_invariants import check_invariants
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    _client,
    _create,
    accessories_on,
    setup,
)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)

RECEIPTS = "/api/v1/internal-receipts/"
REQS = "/api/v1/accessory-requirements/"
_seq = itertools.count(1)


def _jo(db, client_id, archived=False):
    style = models.Model(model_name=f"pytest_iss_model_{next(_seq)}")
    db.add(style)
    db.flush()
    jo = models.JobOrder(job_order_number=f"pytest-iss-jo-{next(_seq)}", client_id=client_id,
                         model_id=style.model_id, date_created=datetime.now(),
                         archived_at=datetime.now(timezone.utc) if archived else None)
    db.add(jo)
    db.flush()
    return jo


def _req(db, jo, item_id, qty):
    r = models.JobOrderAccessoryRequirement(job_order_id=jo.job_order_id, accessory_item_id=item_id,
                                            qty_needed=Decimal(str(qty)))
    db.add(r)
    db.flush()
    return r


@pytest.fixture
def iss(client, auth_headers, setup, place, db, make_user):
    """Two generic items with a pack of 50 each, a JO needing 40 of the first,
    a production line, and headers for a worker and a manager."""
    mgr = auth_headers(role="W_Manager")
    item = _create(client, mgr, setup).json()["id"]
    other = _create(client, mgr, setup, description="Button 15 mm").json()["id"]
    jo = _jo(db, setup["client"].client_id)
    req = _req(db, jo, item, 40)
    line = models.LogicalLocation(name=f"pytest_sew_{next(_seq)}", location_type="production_line")
    db.add(line)
    user = make_user("W_Worker")
    _, (pack, other_pack) = ledger.receive(db, user.id, place["acc"].id, [NewPack(item, 50), NewPack(other, 50)])
    db.commit()
    return {"item": item, "other": other, "jo": jo, "req": req, "line": line, "pack": pack,
            "other_pack": other_pack, "mgr": mgr, "worker": auth_headers(role="W_Worker"),
            "wh": place["acc"], "place": place, "setup": setup}


def _issue(client, s, jo=None, location=None, headers=None):
    r = client.post(RECEIPTS, json={
        "source_warehouse_id": s["wh"].id,
        "target_logical_location_id": (location or s["line"]).id,
        "job_order_id": (jo or s["jo"]).job_order_id,
    }, headers=headers or s["mgr"])
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _scan(client, s, rid, qty, pack=None, headers=None, **extra):
    body = {"barcode": f"{(pack or s['pack']).id}*ACC", "qty": str(qty), **extra}
    return client.post(f"/api/v1/receipts/internal/{rid}/accessory-items", json=body, headers=headers or s["worker"])


def _lines(client, s, rid):
    return client.get(f"/api/v1/receipts/internal/{rid}/accessory-items", headers=s["mgr"]).json()


def _confirm(client, s, rid, headers=None):
    return client.post(f"{RECEIPTS}{rid}/confirm", headers=headers or s["mgr"])


def _requirement(client, s, req=None):
    return client.get(f"{REQS}{(req or s['req']).id}", headers=s["mgr"]).json()


# ── 1. The full flow ─────────────────────────────────────────────────────────

def test_issue_flow_matches_hand_calculation(client, db, iss):
    s = iss
    rid = _issue(client, s)
    r = _scan(client, s, rid, 15)
    assert r.status_code == 201, r.text
    first = r.json()
    assert first["jo_requirement_id"] == s["req"].id and first["job_order_id"] == s["jo"].job_order_id
    assert first["posted"] is False and first["over_issue"] is False and Decimal(first["qty"]) == 15
    assert first["item_code"].startswith("GEN-") and first["uom_code"] == "QPC"
    assert _scan(client, s, rid, "10").status_code == 201

    # Scanned, not confirmed: stock unchanged, the requirement shows it as pending
    assert ledger.pack_quantity(db, s["pack"].id) == 50
    body = _requirement(client, s)
    assert Decimal(body["issued"]) == 0 and Decimal(body["pending"]) == 25 and Decimal(body["remaining"]) == 40

    r = _confirm(client, s, rid)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed" and r.json()["job_order_number"] == s["jo"].job_order_number
    db.expire_all()
    assert ledger.pack_quantity(db, s["pack"].id) == 25
    body = _requirement(client, s)
    assert Decimal(body["issued"]) == 25 and Decimal(body["pending"]) == 0 and Decimal(body["remaining"]) == 15
    assert body["status"] == "partly_issued"
    assert all(line["posted"] for line in _lines(client, s, rid))

    posting = db.scalars(
        models.AccessoryPosting.__table__.select().where(models.AccessoryPosting.internal_receipt_id == rid)
    ).all()
    assert len(posting) == 1  # one posting per confirm
    entries = client.get(f"{REQS}{s['req'].id}/entries", headers=s["mgr"]).json()
    assert [Decimal(e["qty_delta"]) for e in entries] == [-15, -10]
    assert {e["internal_receipt_id"] for e in entries} == {rid}
    assert {e["accessory_receipt_item_id"] for e in entries} == {line["id"] for line in _lines(client, s, rid)}
    check_invariants(db)


# ── 2. Header ────────────────────────────────────────────────────────────────

def test_issue_header_rules(client, db, iss):
    s = iss
    body = {"source_warehouse_id": s["wh"].id, "target_logical_location_id": s["line"].id}
    r = client.post(RECEIPTS, json=body, headers=s["mgr"])
    assert r.status_code == 400 and "needs a job order" in r.text
    r = client.post(RECEIPTS, json={**body, "job_order_id": 999_999_999}, headers=s["mgr"])
    assert r.status_code == 404
    supplier = models.LogicalLocation(name=f"pytest_iss_sup_{next(_seq)}", location_type="supplier")
    db.add(supplier)
    db.commit()
    r = client.post(RECEIPTS, json={**body, "target_logical_location_id": supplier.id,
                                    "job_order_id": s["jo"].job_order_id}, headers=s["mgr"])
    assert r.status_code == 400 and "production line" in r.text
    # Fabric internal receipts carry no job order
    r = client.post(RECEIPTS, json={"source_warehouse_id": s["place"]["fab"].id, "target_logical_location_id": s["line"].id,
                                    "job_order_id": s["jo"].job_order_id}, headers=s["mgr"])
    assert r.status_code == 400 and "Only accessory issues" in r.text

    # The JO can change while nothing is scanned, not after
    rid = _issue(client, s)
    other_jo = _jo(db, s["setup"]["client"].client_id)
    db.commit()
    assert client.put(f"{RECEIPTS}{rid}", json={"job_order_id": other_jo.job_order_id}, headers=s["mgr"]).status_code == 200
    assert client.put(f"{RECEIPTS}{rid}", json={"job_order_id": s["jo"].job_order_id}, headers=s["mgr"]).status_code == 200
    assert _scan(client, s, rid, 1).status_code == 201
    r = client.put(f"{RECEIPTS}{rid}", json={"job_order_id": other_jo.job_order_id}, headers=s["mgr"])
    assert r.status_code == 400 and "Remove the scanned packs" in r.text


# ── 3. Scan rules ────────────────────────────────────────────────────────────

def test_scan_rules(client, db, iss):
    s = iss
    rid = _issue(client, s)
    r = client.post(f"/api/v1/receipts/internal/{rid}/accessory-items", json={"barcode": "12*F", "qty": 1}, headers=s["worker"])
    assert r.status_code == 400 and "isn't a pack barcode" in r.text
    r = client.post(f"/api/v1/receipts/internal/{rid}/accessory-items", json={"qty": 1}, headers=s["worker"])
    assert r.status_code == 422
    r = client.post(f"/api/v1/receipts/internal/{rid}/accessory-items",
                    json={"pack_id": s["pack"].id, "qty": 2}, headers=s["worker"])
    assert r.status_code == 201, r.text  # the id works too

    # Not on the JO's requirement list
    r = _scan(client, s, rid, 1, pack=s["other_pack"])
    assert r.status_code == 400 and "not on job order" in r.text

    # Pack in another warehouse / empty
    _, (far,) = ledger.receive(db, s["pack"].created_by, s["place"]["acc2"].id, [NewPack(s["item"], 5)])
    _, (gone,) = ledger.receive(db, s["pack"].created_by, s["wh"].id, [NewPack(s["item"], 3)])
    ledger.issue(db, s["pack"].created_by, gone.id, 3, s["jo"].job_order_id)
    db.commit()
    assert "another warehouse" in _scan(client, s, rid, 1, pack=far).text
    assert "is empty" in _scan(client, s, rid, 1, pack=gone).text
    assert _scan(client, s, rid, 1, pack=type(far)(id=999_999_999)).status_code == 404

    # Free = on hand - unconfirmed lines (2 already held on this receipt)
    r = _scan(client, s, rid, 49, over_issue_reason="big order")
    assert r.status_code == 400 and "has only 48 QPC free" in r.text
    other_rid = _issue(client, s)  # another open issue holds back too
    assert _scan(client, s, other_rid, 30).status_code == 201
    r = _scan(client, s, rid, 19)
    assert r.status_code == 400 and "has only 18 QPC free" in r.text

    # Whole numbers for a PCS-like base unit
    r = _scan(client, s, rid, "1.5")
    assert r.status_code == 400 and "whole" in r.text


def test_client_match(client, db, iss):
    s = iss
    mgr = s["mgr"]
    own = _client(db, f"Other Client {next(_seq)}", f"q{next(_seq)}")
    db.commit()
    theirs = _create(client, mgr, s["setup"], client_id=own.client_id, description="Their label").json()["id"]
    req = _req(db, s["jo"], theirs, 10)  # POMS wrote it anyway: WMS still refuses
    _, (pack,) = ledger.receive(db, s["pack"].created_by, s["wh"].id, [NewPack(theirs, 10)])
    db.commit()
    assert _requirement(client, s, req)["other_client"] is True
    rid = _issue(client, s)
    r = _scan(client, s, rid, 1, pack=pack)
    assert r.status_code == 400 and "belongs to another client" in r.text
    # The JO of that client may take it
    their_jo = _jo(db, own.client_id)
    _req(db, their_jo, theirs, 10)
    db.commit()
    assert _scan(client, s, _issue(client, s, jo=their_jo), 1, pack=pack).status_code == 201


def test_units_convert_to_base(client, db, iss):
    s = iss
    doz = models.Uom(code=f"QDZ{next(_seq)}", name_en="Dozen", name_ar="دستة")
    db.add(doz)
    db.flush()
    db.add(models.UomConversion(from_uom_id=doz.id, to_uom_id=s["setup"]["pcs"].id, factor=12))
    db.commit()
    r = _scan(client, s, _issue(client, s), 2, uom_id=doz.id)
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["qty"]) == 24


# ── 4. Over-issue (D-2) ──────────────────────────────────────────────────────

def test_over_issue_needs_a_reason_and_is_flagged(client, db, iss):
    s = iss
    rid = _issue(client, s)
    assert _scan(client, s, rid, 30).status_code == 201
    r = _scan(client, s, rid, 15)  # 30 + 15 > 40 needed
    assert r.status_code == 400 and "5 QPC more than remaining" in r.text
    r = _scan(client, s, rid, 15, over_issue_reason="  ")
    assert r.status_code == 400
    r = _scan(client, s, rid, 15, over_issue_reason="Damaged pieces replaced")
    assert r.status_code == 201 and r.json()["over_issue"] is True
    assert r.json()["over_issue_reason"] == "Damaged pieces replaced"
    # A reason on a line that isn't over is dropped (nothing to flag)
    rid2 = _issue(client, s, jo=s["jo"])
    other_req_jo = _jo(db, s["setup"]["client"].client_id)
    _req(db, other_req_jo, s["item"], 100)
    db.commit()
    r = _scan(client, s, _issue(client, s, jo=other_req_jo), 1, over_issue_reason="why not")
    assert r.json()["over_issue"] is False and r.json()["over_issue_reason"] is None
    del rid2

    # Highlighted on the receipt (list and detail)
    assert client.get(f"{RECEIPTS}{rid}", headers=s["mgr"]).json()["over_issue_count"] == 1
    listed = {x["id"]: x for x in client.get(RECEIPTS, params={"warehouse_id": s["wh"].id}, headers=s["mgr"]).json()}
    assert listed[rid]["over_issue_count"] == 1

    assert _confirm(client, s, rid).status_code == 200
    body = _requirement(client, s)
    assert Decimal(body["remaining"]) == -5 and body["status"] == "over_issued"
    reasons = {e["over_issue_reason"] for e in client.get(f"{REQS}{s['req'].id}/entries", headers=s["mgr"]).json()}
    assert reasons == {None, "Damaged pieces replaced"}
    check_invariants(db)


def test_confirm_rechecks_remaining_and_stock(client, db, iss):
    s = iss
    first, second = _issue(client, s), _issue(client, s)
    assert _scan(client, s, first, 25).status_code == 201
    assert _scan(client, s, second, 15).status_code == 201  # 25 + 15 = 40: not over yet
    # The first issue grows past what was left when the second was scanned
    assert _scan(client, s, first, 5, over_issue_reason="extra").status_code == 201
    assert _confirm(client, s, first).status_code == 200
    # Now 30 used of 40: the second (15) goes 5 past, without a reason → refused
    r = _confirm(client, s, second)
    assert r.status_code == 400 and "scan it again with an over-issue reason" in r.text
    assert client.get(f"{RECEIPTS}{second}", headers=s["mgr"]).json()["status"] == "issued"


# ── 5. Lines ─────────────────────────────────────────────────────────────────

def test_lines_removable_until_confirmed(client, db, iss):
    s = iss
    rid = _issue(client, s)
    r = client.post(f"{RECEIPTS}{rid}/confirm", headers=s["mgr"])
    assert r.status_code == 400 and "Scan at least one pack" in r.text
    keep = _scan(client, s, rid, 4).json()
    drop = _scan(client, s, rid, 3).json()
    assert client.delete(f"/api/v1/receipts/accessory-items/{drop['id']}", headers=s["worker"]).status_code == 204
    assert [line["id"] for line in _lines(client, s, rid)] == [keep["id"]]
    assert _confirm(client, s, rid).status_code == 200
    r = client.delete(f"/api/v1/receipts/accessory-items/{keep['id']}", headers=s["mgr"])
    assert r.status_code == 400 and "confirmed" in r.text
    r = _scan(client, s, rid, 1)
    assert r.status_code == 400 and "already confirmed" in r.text
    assert client.delete("/api/v1/receipts/accessory-items/999999999", headers=s["mgr"]).status_code == 404
    db.expire_all()
    assert ledger.pack_quantity(db, s["pack"].id) == 46


# ── 6. Permissions ───────────────────────────────────────────────────────────

def test_permissions(client, auth_headers, db, iss):
    s = iss
    rid = _issue(client, s)
    viewer = auth_headers(role="Viewer")
    assert _scan(client, s, rid, 1, headers=viewer).status_code == 403
    gen_ops = auth_headers(role="gen_ops")  # no issue_accessories
    assert _scan(client, s, rid, 1, headers=gen_ops).status_code == 403
    assert _scan(client, s, rid, 1).status_code == 201
    assert _confirm(client, s, rid, headers=s["worker"]).status_code == 403
    assert _confirm(client, s, rid, headers=s["mgr"]).status_code == 200  # W_Manager confirms accessory issues

    # ...but fabric confirm stays admin-only
    r = client.post(RECEIPTS, json={"source_warehouse_id": s["place"]["fab"].id,
                                    "target_logical_location_id": s["line"].id}, headers=s["mgr"])
    assert _confirm(client, s, r.json()["id"], headers=s["mgr"]).status_code == 403


# ── 7. Picker, shortages ─────────────────────────────────────────────────────

def test_job_order_picker(client, db, iss):
    s = iss
    _jo(db, None)  # no requirement lines: not offered
    db.commit()
    rows = client.get(f"{REQS}job-orders", params={"search": s["jo"].job_order_number}, headers=s["mgr"]).json()
    assert rows == [{"job_order_id": s["jo"].job_order_id, "job_order_number": s["jo"].job_order_number,
                     "client_name": s["setup"]["client"].client_name, "lines": 1}]


def test_shortage_report(client, db, iss):
    s = iss
    jo2 = _jo(db, s["setup"]["client"].client_id)
    _req(db, jo2, s["item"], 30)                     # open: 40 + 30 needed of item
    old = _jo(db, s["setup"]["client"].client_id, archived=True)
    _req(db, old, s["item"], 999)                    # archived JO: not counted
    _req(db, jo2, s["other"], 10)                    # other: 10 needed, 50 on hand → not short
    db.commit()
    url = f"{REQS}shortages"
    rows = client.get(url, params={"warehouse_id": s["wh"].id}, headers=s["mgr"]).json()
    assert [(r["accessory_item_id"], Decimal(r["remaining"]), Decimal(r["on_hand"]), Decimal(r["short"]), r["job_orders"])
            for r in rows] == [(s["item"], 70, 50, 20, 2)]

    # Issuing 10 to the first JO: remaining 60, on hand 40 → still 20 short
    rid = _issue(client, s)
    _scan(client, s, rid, 10)
    _confirm(client, s, rid)
    rows = client.get(url, params={"warehouse_id": s["wh"].id}, headers=s["mgr"]).json()
    assert Decimal(rows[0]["remaining"]) == 60 and Decimal(rows[0]["short"]) == 20

    assert client.get(url, params={"warehouse_id": s["place"]["fab"].id}, headers=s["mgr"]).status_code == 400
