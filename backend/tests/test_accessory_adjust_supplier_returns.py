"""Item 22: adjustments, write-offs and supplier returns.

What these tests prove:
1. supplier returns: an Accessory supplier receipt takes pack lines; scanned
   lines only hold the quantity back (an issue can't take it); closing sends
   it (one `supplier_return` row per line, W_Manager, not W_Worker); a sent
   return can't be reopened or deleted, only reversed by an admin (stock back,
   lines "reversed"); the expected delivery line shows what went back while
   "received" stays as it was
2. supplier return rules: a pack from another supplier is refused (no
   supplier recorded = allowed), the target must be a supplier, the supplier
   can't change once packs are scanned, no packs on external receipts, no
   close without lines, free quantity only, lines removable until sent;
   fabric supplier receipts close as before
3. adjustment (admin): counted quantity -> the difference is posted with the
   reason; same as on hand refused; empty pack comes back; can't count below
   what open lines hold
4. write-off (admin): quantity or everything free, free only, reason, reversible
The invariants hold after each, and the acting user comes from the login.
"""
from decimal import Decimal

from backend import models
from backend.domains.posting import accessory as ledger
from backend.domains.posting.accessory import NewPack
from backend.tests.test_accessory_invariants import check_invariants
from backend.tests.test_accessory_issuing import _issue, _scan, iss  # noqa: F401  (iss = fixture)
from backend.tests.test_accessory_items import accessories_on, setup  # noqa: F401  (fixtures)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)
from backend.tests.test_accessory_receive_packs import _delivery, _line

SUPPLIER_RECEIPTS = "/api/v1/supplier-receipts/"
DELIVERIES = "/api/v1/expected-deliveries/"
OPS = "/api/v1/accessory-pack-ops"


def _pack(db, pack_id):
    db.expire_all()
    return db.get(models.AccessoryPack, pack_id)


def _from_supplier(db, s, qty, supplier=None, delivery_line=None):
    """A pack received from `supplier` (default: the fixture supplier)."""
    worker = _pack(db, s["pack"].id).created_by
    supplier = supplier or s["setup"]["supplier"]
    _, (pack,) = ledger.receive(db, worker, s["wh"].id, [NewPack(
        s["item"], qty, supplier_type="logical_location", client_supplier_id=supplier.id,
        expected_delivery_item_id=delivery_line.id if delivery_line else None,
    )])
    db.commit()
    return pack


def _return_doc(client, s, supplier=None, headers=None):
    r = client.post(SUPPLIER_RECEIPTS, json={
        "source_warehouse_id": s["wh"].id,
        "target_logical_location_id": (supplier or s["setup"]["supplier"]).id,
        "remarks": "Wrong shade",
    }, headers=headers or s["mgr"])
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _scan_sr(client, s, rid, pack, qty, headers=None):
    return client.post(f"/api/v1/receipts/supplier/{rid}/accessory-items",
                       json={"barcode": f"{pack.id}*ACC", "qty": str(qty)}, headers=headers or s["worker"])


def _sr_lines(client, s, rid):
    r = client.get(f"/api/v1/receipts/supplier/{rid}/accessory-items", headers=s["mgr"])
    assert r.status_code == 200, r.text
    return r.json()


def _close(client, s, rid, headers=None):
    return client.post(f"{SUPPLIER_RECEIPTS}{rid}/close", headers=headers or s["mgr"])


# ── 1. Supplier returns ──────────────────────────────────────────────────────

def test_supplier_return_flow(client, db, iss, auth_headers):
    s = iss
    d = _delivery(db, s["wh"], s["setup"]["supplier"])
    dline = _line(db, d, s["item"], 100)
    db.commit()
    pack = _from_supplier(db, s, 60, delivery_line=dline)

    rid = _return_doc(client, s)
    r = _scan_sr(client, s, rid, pack, 25)
    assert r.status_code == 201, r.text
    assert r.json()["posted"] is False and r.json()["job_order_id"] is None and Decimal(r.json()["qty"]) == 25

    # Scanned, not sent: stock unchanged, but the 25 are held back
    assert ledger.pack_quantity(db, pack.id) == 60
    free = client.get(f"{OPS}/packs/{pack.id}/free", headers=s["worker"]).json()
    assert Decimal(free["held"]) == 25 and Decimal(free["free"]) == 35
    rid_issue = _issue(client, s)
    assert _scan(client, s, rid_issue, 36, pack=pack).status_code == 400

    # A worker can't send it; a manager can
    assert _close(client, s, rid, headers=s["worker"]).status_code == 403
    r = _close(client, s, rid)
    assert r.status_code == 200, r.text
    assert r.json()["closed"] is True
    assert ledger.pack_quantity(db, pack.id) == 35
    (line,) = _sr_lines(client, s, rid)
    assert line["posted"] is True and line["reversed"] is False
    posting_ids = db.scalars(models.AccessoryPosting.__table__.select().where(
        models.AccessoryPosting.supplier_receipt_id == rid)).all()
    assert len(posting_ids) == 1
    entry = db.get(models.AccessoryPosting, posting_ids[0]).entries[0]
    assert entry.entry_type == "supplier_return" and entry.qty_delta == -25 and entry.accessory_receipt_item_id == line["id"]

    # The delivery line: received unchanged, returned shown beside it
    body = client.get(f"{DELIVERIES}{d.id}", headers=s["mgr"]).json()
    (item,) = body["items"]
    assert Decimal(item["received_qty"]) == 60 and Decimal(item["returned_qty"]) == 25
    (row,) = client.get(f"{DELIVERIES}items/{dline.id}/packs", headers=s["mgr"]).json()
    assert Decimal(row["received_qty"]) == 60 and Decimal(row["returned_qty"]) == 25 and Decimal(row["quantity"]) == 35
    check_invariants(db)

    # Sent = final: no reopen, no delete, no second close; an admin reverses it
    admin = auth_headers(role="admin")
    r = client.post(f"{SUPPLIER_RECEIPTS}{rid}/open", headers=admin)
    assert r.status_code == 400 and "reverses it" in r.json()["detail"]
    assert client.delete(f"{SUPPLIER_RECEIPTS}{rid}", headers=admin).status_code == 400
    assert _close(client, s, rid).status_code == 400
    assert client.post(f"{SUPPLIER_RECEIPTS}{rid}/reverse", json={"reason": "Supplier refused"},
                       headers=s["mgr"]).status_code == 403
    r = client.post(f"{SUPPLIER_RECEIPTS}{rid}/reverse", json={"reason": "Supplier refused"}, headers=admin)
    assert r.status_code == 200, r.text
    assert ledger.pack_quantity(db, pack.id) == 60
    (line,) = _sr_lines(client, s, rid)
    assert line["posted"] is True and line["reversed"] is True
    (item,) = client.get(f"{DELIVERIES}{d.id}", headers=s["mgr"]).json()["items"]
    assert Decimal(item["returned_qty"]) == 0 and Decimal(item["received_qty"]) == 60
    assert client.post(f"{SUPPLIER_RECEIPTS}{rid}/reverse", json={"reason": "again"}, headers=admin).status_code == 400
    check_invariants(db)


def test_supplier_must_match_the_pack(client, db, iss):
    s = iss
    other = models.LogicalLocation(name=f"pytest_sr_other_{s['req'].id}", location_type="supplier")
    db.add(other)
    db.commit()
    from_other = _from_supplier(db, s, 10, supplier=other)
    rid = _return_doc(client, s)
    r = _scan_sr(client, s, rid, from_other, 1)
    assert r.status_code == 400 and f"came from {other.name}" in r.json()["detail"]
    # The fixture pack has no supplier recorded: it may go to any supplier
    assert _scan_sr(client, s, rid, s["pack"], 1).status_code == 201
    # ... and the other supplier's own return takes its pack
    rid_other = _return_doc(client, s, supplier=other)
    assert _scan_sr(client, s, rid_other, from_other, 10).status_code == 201


def test_supplier_return_header_and_line_rules(client, db, iss):
    s = iss
    # The target must be a supplier
    r = client.post(SUPPLIER_RECEIPTS, json={"source_warehouse_id": s["wh"].id,
                                             "target_logical_location_id": s["line"].id}, headers=s["mgr"])
    assert r.status_code == 400
    rid = _return_doc(client, s)
    assert _close(client, s, rid).status_code == 400  # nothing scanned
    assert _scan_sr(client, s, rid, s["pack"], 51).status_code == 400  # more than free
    assert _scan_sr(client, s, rid, s["pack"], "1.5").status_code == 400  # QPC is whole numbers
    line = _scan_sr(client, s, rid, s["pack"], 5).json()

    # The supplier can't change once packs are scanned
    other = models.LogicalLocation(name=f"pytest_sr_swap_{s['req'].id}", location_type="supplier")
    db.add(other)
    db.commit()
    r = client.put(f"{SUPPLIER_RECEIPTS}{rid}", json={"target_logical_location_id": other.id}, headers=s["mgr"])
    assert r.status_code == 400

    # Lines can be removed until the return is sent
    assert client.delete(f"/api/v1/receipts/accessory-items/{line['id']}", headers=s["worker"]).status_code == 204
    line = _scan_sr(client, s, rid, s["pack"], 5).json()
    assert _close(client, s, rid).status_code == 200
    assert client.delete(f"/api/v1/receipts/accessory-items/{line['id']}", headers=s["worker"]).status_code == 400
    assert _scan_sr(client, s, rid, s["pack"], 1).status_code == 400  # closed

    # External receipts take no packs
    r = client.post("/api/v1/external-receipts/", json={"source_warehouse_id": s["wh"].id, "receiver": "X"},
                    headers=s["mgr"])
    assert r.status_code == 201, r.text
    r = client.post(f"/api/v1/receipts/external/{r.json()['id']}/accessory-items",
                    json={"barcode": f"{s['pack'].id}*ACC", "qty": "1"}, headers=s["worker"])
    assert r.status_code == 400
    check_invariants(db)


def test_fabric_supplier_receipt_closes_as_before(client, db, iss):
    s = iss
    r = client.post(SUPPLIER_RECEIPTS, json={"source_warehouse_id": s["place"]["fab"].id,
                                             "target_logical_location_id": s["setup"]["supplier"].id},
                    headers=s["worker"])
    assert r.status_code == 201, r.text
    r = client.post(f"{SUPPLIER_RECEIPTS}{r.json()['id']}/close", headers=s["worker"])
    assert r.status_code == 200 and r.json()["closed"] is True


# ── 2. Adjustment ────────────────────────────────────────────────────────────

def _adjust(client, h, pack_id, counted, reason="Cycle count", **extra):
    return client.post(f"{OPS}/packs/{pack_id}/adjust", json={"counted": str(counted), "reason": reason, **extra},
                       headers=h)


def test_adjustment_posts_the_difference(client, db, iss, auth_headers, make_user):
    s = iss
    admin_user = make_user("admin")
    admin = auth_headers(user=admin_user)
    assert _adjust(client, s["mgr"], s["pack"].id, 47).status_code == 403
    assert client.post(f"{OPS}/packs/{s['pack'].id}/adjust", json={"counted": "47"}, headers=admin).status_code == 422

    r = _adjust(client, admin, s["pack"].id, 47)
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["pack"]["quantity"]) == 47
    posting = db.get(models.AccessoryPosting, r.json()["posting_id"])
    (entry,) = posting.entries
    assert entry.entry_type == "adjustment" and entry.qty_delta == -3
    assert posting.reason == "Cycle count" and posting.created_by == admin_user.id

    r = _adjust(client, admin, s["pack"].id, 47)
    assert r.status_code == 400 and "nothing to adjust" in r.json()["detail"]
    assert _adjust(client, admin, s["pack"].id, "47.5").status_code == 400  # whole numbers
    assert _adjust(client, admin, s["pack"].id, 52).json()["pack"]["quantity"] in ("52", "52.0000")

    # Counted 0 empties the pack; a later count can bring it back
    r = _adjust(client, admin, s["pack"].id, 0)
    assert r.status_code == 201 and r.json()["pack"]["status"] == "empty"
    r = _adjust(client, admin, s["pack"].id, 4, reason="Found behind the rack")
    assert r.status_code == 201 and r.json()["pack"]["status"] == "active"
    check_invariants(db)


def test_adjustment_cant_count_below_what_is_held(client, db, iss, auth_headers):
    s = iss
    admin = auth_headers(role="admin")
    rid = _issue(client, s)
    assert _scan(client, s, rid, 20).status_code == 201
    r = _adjust(client, admin, s["pack"].id, 19)
    assert r.status_code == 400 and "held" in r.json()["detail"]
    assert _adjust(client, admin, s["pack"].id, 20).status_code == 201


# ── 3. Write-off ─────────────────────────────────────────────────────────────

def _write_off(client, h, pack_id, qty=None, reason="Rusty"):
    body = {"reason": reason}
    if qty is not None:
        body["qty"] = str(qty)
    return client.post(f"{OPS}/packs/{pack_id}/write-off", json=body, headers=h)


def test_write_off(client, db, iss, auth_headers):
    s = iss
    admin = auth_headers(role="admin")
    assert _write_off(client, s["mgr"], s["pack"].id, 1).status_code == 403
    assert client.post(f"{OPS}/packs/{s['pack'].id}/write-off", json={"qty": "1", "reason": " "},
                       headers=admin).status_code == 400

    r = _write_off(client, admin, s["pack"].id, 10)
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["pack"]["quantity"]) == 40
    posting = db.get(models.AccessoryPosting, r.json()["posting_id"])
    assert posting.entries[0].entry_type == "write_off" and posting.entries[0].qty_delta == -10
    assert posting.reason == "Rusty"

    # Free only: an open issue holds 15, so "everything" = 25
    rid = _issue(client, s)
    assert _scan(client, s, rid, 15).status_code == 201
    assert _write_off(client, admin, s["pack"].id, 26).status_code == 400
    r = _write_off(client, admin, s["pack"].id)
    assert r.status_code == 201 and Decimal(r.json()["pack"]["quantity"]) == 15
    assert _write_off(client, admin, s["pack"].id).status_code == 400  # nothing free left

    # Reversible as one posting
    r = client.post(f"/api/v1/accessory-postings/{posting.id}/reverse", json={"reason": "Not rusty"}, headers=admin)
    assert r.status_code == 201, r.text
    assert ledger.pack_quantity(db, s["pack"].id) == 25
    check_invariants(db)
