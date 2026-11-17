"""Item 21: pack operations (returns from production, split, merge, reclassify).

What these tests prove:
1. returns: only what is still out on the requirement (issued - returned)
   comes back; into a pack of the same item in this warehouse or a new pack
   whose source is the "returned from" location; Material Requests' returned
   / remaining move; an empty pack becomes active again; the default
   "returned from" is where the issue went
2. split: N new packs with the source's item, supplier, batch and rack; free
   quantity only (open issue lines hold stock back)
3. merge: same item only, packs held by an open issue refused, emptied packs
   go `empty`
4. reclassify: admin only, reason, same base unit, a new pack of the target item
5. permissions (Viewer / gen_ops 403), every action reversible as one posting,
   the invariants hold after each, and the acting user comes from the login
"""
from decimal import Decimal

import pytest

from backend import models
from backend.domains.posting import accessory as ledger
from backend.domains.posting.accessory import NewPack
from backend.tests.test_accessory_invariants import check_invariants
from backend.tests.test_accessory_issuing import _confirm, _issue, _requirement, _scan, iss  # noqa: F401
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    _create,
    accessories_on,
    setup,
)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)

OPS = "/api/v1/accessory-pack-ops"


def _issued(client, db, s, qty, **extra):
    """Issue `qty` of the item from the fixture pack to the JO (confirmed)."""
    rid = _issue(client, s)
    assert _scan(client, s, rid, qty, **extra).status_code == 201
    assert _confirm(client, s, rid).status_code == 200
    db.expire_all()
    return rid


def _return(client, s, qty, headers=None, **over):
    body = {
        "warehouse_id": s["wh"].id, "job_order_id": s["jo"].job_order_id, "jo_requirement_id": s["req"].id,
        "qty": str(qty), "from_location_id": s["line"].id, "pack_id": s["pack"].id, **over,
    }
    return client.post(f"{OPS}/returns", json=body, headers=headers or s["worker"])


def _pack(db, pack_id):
    db.expire_all()
    return db.get(models.AccessoryPack, pack_id)


# ── 1. Returns ───────────────────────────────────────────────────────────────

def test_return_into_pack_moves_the_requirement_balance(client, db, iss):
    s = iss
    _issued(client, db, s, 30)
    r = client.get(f"{OPS}/returns", params={"warehouse_id": s["wh"].id, "job_order_id": s["jo"].job_order_id},
                   headers=s["worker"])
    assert r.status_code == 200, r.text
    (line,) = r.json()
    assert line["jo_requirement_id"] == s["req"].id and Decimal(line["out"]) == 30
    assert line["last_location_id"] == s["line"].id  # default "returned from" = where the issue went

    r = _return(client, s, 12, reason="Style change")
    assert r.status_code == 201, r.text
    assert r.json()["created"] is False and Decimal(r.json()["pack"]["quantity"]) == 32
    body = _requirement(client, s)
    assert Decimal(body["issued"]) == 30 and Decimal(body["returned"]) == 12 and Decimal(body["remaining"]) == 22

    row = db.scalars(models.AccessoryLedgerEntry.__table__.select().where(
        models.AccessoryLedgerEntry.posting_id == r.json()["posting_id"])).all()
    assert len(row) == 1
    posting = db.get(models.AccessoryPosting, r.json()["posting_id"])
    entry = posting.entries[0]
    assert entry.entry_type == "return" and entry.jo_requirement_id == s["req"].id
    assert entry.job_order_id == s["jo"].job_order_id and posting.reason == "Style change"
    check_invariants(db)


def test_return_limited_to_what_is_out(client, db, iss):
    s = iss
    _issued(client, db, s, 10)
    assert _return(client, s, 11).status_code == 400
    assert _return(client, s, 6).status_code == 201
    r = _return(client, s, 5)
    assert r.status_code == 400 and "Only 4" in r.json()["detail"]
    assert _return(client, s, "2.5").status_code == 400  # QPC is whole numbers


def test_return_nothing_out_and_other_job_order_refused(client, db, iss):
    s = iss
    assert _return(client, s, 1).status_code == 400  # nothing issued yet
    lines = client.get(f"{OPS}/returns", params={"warehouse_id": s["wh"].id, "job_order_id": s["jo"].job_order_id},
                       headers=s["worker"]).json()
    assert lines == []
    _issued(client, db, s, 10)
    assert _return(client, s, 1, job_order_id=s["jo"].job_order_id + 999999).status_code == 400


def test_return_into_new_pack_records_the_source_location(client, db, iss):
    s = iss
    _issued(client, db, s, 20)
    r = _return(client, s, 7, pack_id=None, rack_id=s["place"]["a1"].id)
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["created"] is True and out["pack"]["id"] != s["pack"].id
    assert Decimal(out["pack"]["quantity"]) == 7 and out["pack"]["rack_id"] == s["place"]["a1"].id
    assert out["pack"]["supplier_type"] == "logical_location" and out["pack"]["client_supplier_id"] == s["line"].id
    check_invariants(db)


def test_return_pack_and_location_rules(client, db, iss):
    s = iss
    _issued(client, db, s, 20)
    # another item's pack
    assert _return(client, s, 1, pack_id=s["other_pack"].id).status_code == 400
    # a supplier isn't where trims come back from
    supplier = s["setup"]["supplier"]
    assert _return(client, s, 1, from_location_id=supplier.id).status_code == 400
    # a pack of the same item in another warehouse
    worker = db.get(models.AccessoryPack, s["pack"].id).created_by
    _, (far,) = ledger.receive(db, worker, s["place"]["acc2"].id, [NewPack(s["item"], 5)])
    db.commit()
    assert _return(client, s, 1, pack_id=far.id).status_code == 400


def test_return_reactivates_an_empty_pack(client, db, iss):
    s = iss
    _issued(client, db, s, 50, over_issue_reason="Extra for samples")  # 50 > the 40 needed
    assert _pack(db, s["pack"].id).status == "empty"
    assert _return(client, s, 3).status_code == 201
    assert _pack(db, s["pack"].id).status == "active"


# ── 2. Split ─────────────────────────────────────────────────────────────────

def test_split_into_new_packs_keeps_item_rack_and_source(client, db, iss):
    s = iss
    db.get(models.AccessoryPack, s["pack"].id).rack_id = s["place"]["a1"].id
    db.commit()
    r = client.post(f"{OPS}/packs/{s['pack'].id}/split", json={"pack_count": 3, "qty": "5"}, headers=s["worker"])
    assert r.status_code == 201, r.text
    out = r.json()
    assert Decimal(out["source"]["quantity"]) == 35 and len(out["packs"]) == 3
    for p in out["packs"]:
        assert Decimal(p["quantity"]) == 5 and p["accessory_item_id"] == s["item"]
        assert p["rack_id"] == s["place"]["a1"].id and p["warehouse_id"] == s["wh"].id
    posting = db.get(models.AccessoryPosting, out["posting_id"])
    assert sorted(e.qty_delta for e in posting.entries) == [-15, 5, 5, 5]
    assert {e.entry_type for e in posting.entries} == {"transfer"}
    check_invariants(db)

    other_rack = client.post(f"{OPS}/packs/{s['pack'].id}/split",
                             json={"qty": "1", "keep_rack": False, "rack_id": None}, headers=s["worker"])
    assert other_rack.status_code == 201 and other_rack.json()["packs"][0]["rack_id"] is None


def test_split_only_free_quantity(client, db, iss):
    s = iss
    rid = _issue(client, s)
    assert _scan(client, s, rid, 30).status_code == 201  # open issue holds 30
    free = client.get(f"{OPS}/packs/{s['pack'].id}/free", headers=s["worker"]).json()
    assert Decimal(free["quantity"]) == 50 and Decimal(free["held"]) == 30 and Decimal(free["free"]) == 20
    r = client.post(f"{OPS}/packs/{s['pack'].id}/split", json={"pack_count": 3, "qty": "7"}, headers=s["worker"])
    assert r.status_code == 400 and "held by open issues" in r.json()["detail"]
    assert client.post(f"{OPS}/packs/{s['pack'].id}/split", json={"pack_count": 4, "qty": "5"},
                       headers=s["worker"]).status_code == 201
    assert _confirm(client, s, rid).status_code == 200  # the issue still confirms


# ── 3. Merge ─────────────────────────────────────────────────────────────────

def _more_packs(db, s, *qtys):
    worker = db.get(models.AccessoryPack, s["pack"].id).created_by
    _, packs = ledger.receive(db, worker, s["wh"].id, [NewPack(s["item"], q) for q in qtys])
    db.commit()
    return packs


def test_merge_empties_packs_into_the_kept_one(client, db, iss):
    s = iss
    a, b = _more_packs(db, s, 8, 4)
    r = client.post(f"{OPS}/packs/{s['pack'].id}/merge", json={"from_pack_ids": [a.id, b.id]}, headers=s["worker"])
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["pack"]["quantity"]) == 62
    assert _pack(db, a.id).status == "empty" and _pack(db, b.id).status == "empty"
    posting = db.get(models.AccessoryPosting, r.json()["posting_id"])
    assert len(posting.entries) == 4 and sum(e.qty_delta for e in posting.entries) == 0
    check_invariants(db)
    # an empty pack, itself, another item
    url = f"{OPS}/packs/{s['pack'].id}/merge"
    assert client.post(url, json={"from_pack_ids": [a.id]}, headers=s["worker"]).status_code == 400
    assert client.post(url, json={"from_pack_ids": [s["pack"].id]}, headers=s["worker"]).status_code == 400
    assert client.post(url, json={"from_pack_ids": [s["other_pack"].id]}, headers=s["worker"]).status_code == 400


def test_merge_refuses_a_pack_held_by_an_open_issue(client, db, iss):
    s = iss
    (a,) = _more_packs(db, s, 8)
    rid = _issue(client, s)
    assert _scan(client, s, rid, 2, pack=a).status_code == 201
    r = client.post(f"{OPS}/packs/{s['pack'].id}/merge", json={"from_pack_ids": [a.id]}, headers=s["worker"])
    assert r.status_code == 400 and "open issue" in r.json()["detail"]


# ── 4. Reclassify ────────────────────────────────────────────────────────────

def test_reclassify_admin_only_with_reason_and_same_unit(client, db, iss, auth_headers):
    s = iss
    admin = auth_headers(role="admin")
    target = _create(client, s["mgr"], s["setup"], client_id=s["setup"]["client"].client_id,
                     description="Elastic 2 cm for client").json()["id"]
    url = f"{OPS}/packs/{s['pack'].id}/reclassify"
    body = {"target_item_id": target, "qty": "20", "reason": "Dedicated to the client"}
    assert client.post(url, json=body, headers=s["mgr"]).status_code == 403  # W_Manager isn't admin
    assert client.post(url, json={**body, "reason": ""}, headers=admin).status_code == 422
    assert client.post(url, json={**body, "target_item_id": s["item"]}, headers=admin).status_code == 400

    other_unit = _create(client, s["mgr"], s["setup"], category_id=s["setup"]["thr"].id,
                         base_uom_id=s["setup"]["cone"].id, description="Thread").json()["id"]
    r = client.post(url, json={**body, "target_item_id": other_unit}, headers=admin)
    assert r.status_code == 400 and "same base unit" in r.json()["detail"]

    r = client.post(url, json=body, headers=admin)
    assert r.status_code == 201, r.text
    out = r.json()
    assert Decimal(out["source"]["quantity"]) == 30
    assert out["pack"]["accessory_item_id"] == target and Decimal(out["pack"]["quantity"]) == 20
    posting = db.get(models.AccessoryPosting, out["posting_id"])
    assert {e.entry_type for e in posting.entries} == {"reclassify"} and posting.reason == "Dedicated to the client"
    check_invariants(db)

    # qty omitted = everything free
    r = client.post(url, json={"target_item_id": target, "reason": "rest"}, headers=admin)
    assert r.status_code == 201 and Decimal(r.json()["pack"]["quantity"]) == 30
    assert _pack(db, s["pack"].id).status == "empty"


# ── 5. Permissions, reversal, acting user ────────────────────────────────────

def test_permissions(client, db, iss, auth_headers):
    s = iss
    for role in ("Viewer", "gen_ops"):
        h = auth_headers(role=role)
        assert client.post(f"{OPS}/packs/{s['pack'].id}/split", json={"qty": "1"}, headers=h).status_code == 403
        assert _return(client, s, 1, headers=h).status_code == 403


def test_actions_reverse_as_one_posting_and_record_the_user(client, db, iss, auth_headers, make_user):
    s = iss
    worker = make_user("W_Worker")
    h = auth_headers(user=worker)
    r = client.post(f"{OPS}/packs/{s['pack'].id}/split", json={"pack_count": 2, "qty": "10"}, headers=h)
    assert r.status_code == 201
    posting_id = r.json()["posting_id"]
    assert db.get(models.AccessoryPosting, posting_id).created_by == worker.id

    admin = auth_headers(role="admin")
    r = client.post(f"/api/v1/accessory-postings/{posting_id}/reverse", json={"reason": "mistake"}, headers=admin)
    assert r.status_code == 201, r.text
    db.expire_all()
    assert ledger.pack_quantity(db, s["pack"].id) == 50
    check_invariants(db)


def test_flag_off_hides_the_router(client, iss, monkeypatch):
    from backend.core.config import settings

    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    assert client.post(f"{OPS}/packs/{iss['pack'].id}/split", json={"qty": "1"},
                       headers=iss["worker"]).status_code == 404


@pytest.mark.parametrize("bad", [{"pack_count": 0, "qty": "1"}, {"pack_count": 101, "qty": "1"}, {"qty": "0"}])
def test_split_validation(client, iss, bad):
    assert client.post(f"{OPS}/packs/{iss['pack'].id}/split", json=bad, headers=iss["worker"]).status_code == 422
