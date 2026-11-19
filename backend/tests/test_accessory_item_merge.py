"""Item 23: merge duplicate items (admin only).

What these tests prove:
1. a merge moves every pack with stock (any warehouse) into a new pack of the
   kept item (same warehouse, rack, supplier; delivery batch only when its
   line moved) in one `reclassify` posting; the old packs go empty; the
   references, open delivery lines and missing conversions move; the
   duplicate is switched off and points at the kept item; invariants hold
2. the preview counts the same things and lists what blocks a merge: same
   item, template, other base unit, client mismatch, a held pack, a
   requirement line still to issue; a different category only warns
3. it is final: no switching back on, no reversing the merge posting, no
   second merge; a duplicate without stock merges with no posting
4. admin only (W_Manager / Viewer 403), reason required, acting user from login
"""
from decimal import Decimal

from backend import models
from backend.domains.posting import accessory as ledger
from backend.domains.posting.accessory import NewPack
from backend.tests.test_accessory_invariants import check_invariants
from backend.tests.test_accessory_issuing import _confirm, _issue, _jo, _scan, iss  # noqa: F401
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    _category,
    _create,
    accessories_on,
    setup,
)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)
from backend.tests.test_accessory_receive_packs import _delivery, _line

ITEMS = "/api/v1/accessory-items"


def _preview(client, h, dup, keep):
    return client.get(f"{ITEMS}/{dup}/merge-preview", params={"keep_item_id": keep}, headers=h)


def _merge(client, h, dup, keep, reason="Same trim registered twice"):
    return client.post(f"{ITEMS}/{dup}/merge", json={"keep_item_id": keep, "reason": reason}, headers=h)


def _qty(db, pack_id):
    db.expire_all()
    return db.get(models.AccessoryPack, pack_id).quantity


# ── 1. What a merge moves ────────────────────────────────────────────────────

def test_merge_moves_stock_refs_lines_and_conversions(client, db, iss, auth_headers, make_user):
    s = iss
    admin_user = make_user("admin")
    admin = auth_headers(user=admin_user)
    dup, keep = s["other"], s["item"]
    # A second pack of the duplicate in another warehouse, on a rack
    _, (far,) = ledger.receive(db, admin_user.id, s["place"]["acc2"].id, [NewPack(dup, 7)])
    far.rack_id = s["place"]["other"].id
    open_line = _line(db, _delivery(db, s["wh"], s["setup"]["supplier"]), dup, 100)
    closed_line = _line(db, _delivery(db, s["wh"], s["setup"]["supplier"], status="received"), dup, 5)
    s["other_pack"].expected_delivery_item_id = open_line.id
    db.commit()
    assert client.post(f"{ITEMS}/{dup}/conversions", json={
        "from_uom_id": s["setup"]["m"].id, "to_uom_id": s["setup"]["pcs"].id, "factor": 4}, headers=admin
    ).status_code == 201
    dup_refs = {r.id for r in db.get(models.AccessoryItem, dup).refs}

    p = _preview(client, admin, dup, keep)
    assert p.status_code == 200, p.text
    p = p.json()
    assert p["blockers"] == [] and p["category_differs"] is False
    assert [pk["id"] for pk in p["packs"]] == [s["other_pack"].id, far.id] and Decimal(p["total"]) == 57
    assert (p["refs"], p["delivery_lines"], p["conversions"]) == (1, 1, 1)

    r = _merge(client, admin, dup, keep)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["item"]["active"] is False and out["item"]["merged_into_id"] == keep
    assert out["item"]["merged_into_code"] == db.get(models.AccessoryItem, keep).code
    near_new, far_new = out["new_packs"]
    assert near_new["accessory_item_id"] == keep and Decimal(near_new["quantity"]) == 50
    assert near_new["warehouse_id"] == s["wh"].id and near_new["expected_delivery_item_id"] == open_line.id
    assert far_new["warehouse_id"] == s["place"]["acc2"].id and far_new["rack_id"] == s["place"]["other"].id
    assert Decimal(far_new["quantity"]) == 7
    assert _qty(db, s["other_pack"].id) == 0 and _qty(db, far.id) == 0
    assert db.get(models.AccessoryPack, far.id).status == "empty"

    posting = db.get(models.AccessoryPosting, out["posting_id"])
    assert {e.entry_type for e in posting.entries} == {"reclassify"} and len(posting.entries) == 4
    assert posting.reason.startswith("Merged ") and posting.reason.endswith("Same trim registered twice")
    assert posting.created_by == admin_user.id

    assert {r.id for r in db.get(models.AccessoryItem, keep).refs} >= dup_refs
    assert db.get(models.ExpectedDeliveryItem, open_line.id).accessory_item_id == keep
    assert db.get(models.ExpectedDeliveryItem, closed_line.id).accessory_item_id == dup  # history stays
    conv = db.query(models.UomConversion).filter_by(accessory_item_id=keep).one()
    assert (conv.from_uom_id, conv.to_uom_id, conv.factor) == (s["setup"]["m"].id, s["setup"]["pcs"].id, 4)
    check_invariants(db)


# ── 2. Preview blockers ──────────────────────────────────────────────────────

def test_blockers(client, db, iss, auth_headers):
    s = iss
    admin = auth_headers(role="admin")
    setup = s["setup"]

    assert "itself" in _preview(client, admin, s["other"], s["other"]).json()["blockers"][0]

    thread = _create(client, s["mgr"], setup, category_id=setup["thr"].id, base_uom_id=setup["cone"].id,
                     description="Thread").json()["id"]
    assert any("same base unit" in b for b in _preview(client, admin, s["other"], thread).json()["blockers"])

    for_client = _create(client, s["mgr"], setup, client_id=setup["client"].client_id,
                         description="Button 15 mm").json()["id"]
    assert any("one client only" in b for b in _preview(client, admin, s["other"], for_client).json()["blockers"])
    # The other way round (client item into a generic one) is fine
    assert _preview(client, admin, for_client, s["other"]).json()["blockers"] == []

    template = _create(client, s["mgr"], setup, description="Price ticket").json()["id"]
    assert client.post(f"{ITEMS}/{template}/fields", json={
        "label_en": "Price", "label_ar": "السعر", "field_type": "money"}, headers=s["mgr"]).status_code == 201
    assert any("template" in b for b in _preview(client, admin, template, s["other"]).json()["blockers"])

    other_cat = _category(db, "QMG", setup["pcs"])
    db.commit()
    elsewhere = _create(client, s["mgr"], setup, category_id=other_cat.id).json()["id"]
    p = _preview(client, admin, elsewhere, s["other"]).json()
    assert p["category_differs"] is True and p["blockers"] == []  # a warning only

    r = _merge(client, admin, s["other"], thread)
    assert r.status_code == 400 and "same base unit" in r.json()["detail"]


def test_open_requirement_and_held_pack_block_until_issued(client, db, iss, auth_headers):
    """The fixture item has a JO line needing 40: blocked while it is still to
    issue; an unconfirmed issue line also holds the pack. Once issued, the
    rest of the pack merges (the JO's history stays on the duplicate)."""
    s = iss
    admin = auth_headers(role="admin")
    dup, keep = s["item"], s["other"]
    blockers = _preview(client, admin, dup, keep).json()["blockers"]
    assert len(blockers) == 1 and "still to issue" in blockers[0]

    rid = _issue(client, s)
    assert _scan(client, s, rid, 40).status_code == 201
    blockers = _preview(client, admin, dup, keep).json()["blockers"]
    assert any("held by an open issue" in b for b in blockers) and any("still to issue" in b for b in blockers)

    assert _confirm(client, s, rid).status_code == 200
    archived_jo = _jo(db, s["setup"]["client"].client_id, archived=True)
    db.add(models.JobOrderAccessoryRequirement(job_order_id=archived_jo.job_order_id, accessory_item_id=dup,
                                               qty_needed=Decimal(5)))
    db.commit()  # an archived JO's line doesn't block
    assert _preview(client, admin, dup, keep).json()["blockers"] == []
    r = _merge(client, admin, dup, keep)
    assert r.status_code == 200, r.text
    assert Decimal(r.json()["new_packs"][0]["quantity"]) == 10
    assert db.get(models.JobOrderAccessoryRequirement, s["req"].id).accessory_item_id == dup
    check_invariants(db)


# ── 3. Final ─────────────────────────────────────────────────────────────────

def test_merge_is_final(client, db, iss, auth_headers):
    s = iss
    admin = auth_headers(role="admin")
    dup, keep = s["other"], s["item"]
    r = _merge(client, admin, dup, keep)
    assert r.status_code == 200, r.text
    posting_id = r.json()["posting_id"]

    r = client.patch(f"{ITEMS}/{dup}", json={"active": True}, headers=admin)
    assert r.status_code == 400 and "merged into" in r.json()["detail"]
    r = client.post(f"/api/v1/accessory-postings/{posting_id}/reverse", json={"reason": "oops"}, headers=admin)
    assert r.status_code == 400 and "merged into" in r.json()["detail"]
    r = _merge(client, admin, dup, keep)
    assert r.status_code == 400 and "already merged" in r.json()["detail"]
    # The kept item can't be the merged one either
    third = _create(client, s["mgr"], s["setup"], description="Elastic 2cm").json()["id"]
    r = _merge(client, admin, third, dup)
    assert r.status_code == 400 and "switched off" in r.json()["detail"]


def test_without_stock_no_posting(client, db, iss, auth_headers):
    s = iss
    admin = auth_headers(role="admin")
    lonely = _create(client, s["mgr"], s["setup"], description="Elastic 2 cm.").json()["id"]
    r = _merge(client, admin, lonely, s["other"])
    assert r.status_code == 200, r.text
    assert r.json()["posting_id"] is None and r.json()["new_packs"] == []
    assert r.json()["item"]["merged_into_id"] == s["other"]


# ── 4. Permissions ───────────────────────────────────────────────────────────

def test_admin_only_and_reason(client, db, iss, auth_headers):
    s = iss
    for role in ("W_Manager", "Viewer"):
        h = auth_headers(role=role)
        assert _preview(client, h, s["other"], s["item"]).status_code == 403
        assert _merge(client, h, s["other"], s["item"]).status_code == 403
    admin = auth_headers(role="admin")
    assert _merge(client, admin, s["other"], s["item"], reason="").status_code == 422
    assert _merge(client, admin, s["other"], s["item"], reason="   ").status_code == 400
    assert _preview(client, admin, 999999999, s["item"]).status_code == 404
