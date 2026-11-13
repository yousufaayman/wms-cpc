"""Item 17: Receive Packs.

`POST /accessory-packs/receive` makes N packs of one item with their `receipt`
ledger rows and links each to an expected delivery line: the line the worker
picked ("load a delivery" mode), or else the oldest open line for the item on
a delivery in this warehouse from this supplier (matched pack by pack, never
blocking). `POST /accessory-packs/receive/{posting}/undo` cancels one Add.
"""
from datetime import datetime, timedelta
from decimal import Decimal
from itertools import count

import pytest

from backend import models
from backend.tests.test_accessory_invariants import check_invariants
from backend.tests.test_accessory_items import accessories_on, setup  # noqa: F401  (fixtures)
from backend.tests.test_accessory_ledger import stock  # noqa: F401  (fixture)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)

RECEIVE = "/api/v1/accessory-packs/receive"
DELIVERIES = "/api/v1/expected-deliveries/"
_seq = count(1)
_day = datetime(2026, 1, 1)


@pytest.fixture
def s(stock, setup):
    return {**stock, "supplier": setup["supplier"], "setup": setup}


def _delivery(db, warehouse, supplier, days=0, status="pending"):
    d = models.ExpectedDelivery(
        warehouse_id=warehouse.id, status=status, expected_date=_day + timedelta(days=days),
        supplier_type="logical_location" if supplier else None,
        client_supplier_id=supplier.id if supplier else None,
    )
    db.add(d)
    db.flush()
    return d


def _line(db, delivery, item_id, qty):
    line = models.ExpectedDeliveryItem(
        delivery_id=delivery.id, accessory_item_id=item_id, expected_qty=qty, received_weight_kg=0, received_length_m=0,
    )
    db.add(line)
    db.flush()
    return line


def _body(s, **over):
    body = {
        "warehouse_id": s["wh"].id, "accessory_item_id": s["item"],
        "supplier_type": "logical_location", "client_supplier_id": s["supplier"].id,
        "pack_count": 1, "qty_per_pack": "10",
    }
    body.update(over)
    return body


def _post(client, h, body):
    return client.post(RECEIVE, json=body, headers=h)


def _ok(client, h, body):
    r = _post(client, h, body)
    assert r.status_code == 201, r.text
    return r.json()


def _received(client, h, delivery_id):
    d = client.get(f"{DELIVERIES}{delivery_id}", headers=h).json()
    return d["status"], [Decimal(i["received_qty"]) for i in sorted(d["items"], key=lambda i: i["id"])]


# ── 1. Matching in "search item" mode ───────────────────────────────────────

def test_packs_fill_the_oldest_line_then_spill_into_the_next(client, auth_headers, db, s):
    h = auth_headers(role="W_Worker")
    newer = _delivery(db, s["wh"], s["supplier"], days=5)
    older = _delivery(db, s["wh"], s["supplier"], days=1)
    _line(db, newer, s["item"], 50)
    _line(db, older, s["item"], 25)

    out = _ok(client, h, _body(s, pack_count=4, qty_per_pack="10"))
    # 25 on the older one: packs 1-3 (the 3rd overfills it; a pack is never split), pack 4 → newer
    assert [p["delivery_id"] for p in out["packs"]] == [older.id] * 3 + [newer.id]
    assert [p["batch_no"] for p in out["packs"]] == [f"B-{older.id}"] * 3 + [f"B-{newer.id}"]
    assert all(Decimal(p["quantity"]) == 10 for p in out["packs"])
    assert all(p["supplier_type"] == "logical_location" and p["client_supplier_id"] == s["supplier"].id
               for p in out["packs"])

    assert _received(client, h, older.id) == ("received", [Decimal(30)])
    assert _received(client, h, newer.id) == ("partial", [Decimal(10)])
    check_invariants(db)


def test_only_this_supplier_warehouse_item_and_open_deliveries_match(client, auth_headers, db, s, place, setup):
    h = auth_headers(role="W_Worker")
    other_supplier = models.LogicalLocation(name=f"pytest_rp_sup_{next(_seq)}", location_type="supplier")
    db.add(other_supplier)
    db.flush()
    _line(db, _delivery(db, s["wh"], other_supplier), s["item"], 100)          # another supplier
    _line(db, _delivery(db, place["acc2"], s["supplier"]), s["item"], 100)      # another warehouse
    _line(db, _delivery(db, s["wh"], s["supplier"]), s["other"], 100)           # another item
    _line(db, _delivery(db, s["wh"], None), s["item"], 100)                     # no supplier recorded
    _line(db, _delivery(db, s["wh"], s["supplier"], status="cancelled"), s["item"], 100)
    full = _delivery(db, s["wh"], s["supplier"])
    _line(db, full, s["item"], 10)
    _ok(client, h, _body(s, qty_per_pack="10"))  # fills `full`

    out = _ok(client, h, _body(s))
    assert out["packs"][0]["delivery_id"] is None and out["packs"][0]["batch_no"] is None
    assert out["packs"][0]["expected_delivery_item_id"] is None


def test_no_supplier_means_no_match_but_still_received(client, auth_headers, db, s):
    h = auth_headers(role="W_Worker")
    _line(db, _delivery(db, s["wh"], s["supplier"]), s["item"], 100)
    out = _ok(client, h, _body(s, supplier_type=None, client_supplier_id=None))
    assert out["packs"][0]["delivery_id"] is None
    assert out["packs"][0]["supplier_type"] is None


# ── 2. "Load a delivery" mode: the picked line ─────────────────────────────

def test_picked_line_takes_every_pack_even_past_expected(client, auth_headers, db, s):
    h = auth_headers(role="W_Worker")
    older = _delivery(db, s["wh"], s["supplier"], days=1)
    _line(db, older, s["item"], 100)
    picked_delivery = _delivery(db, s["wh"], s["supplier"], days=9)
    picked = _line(db, picked_delivery, s["item"], 15)

    out = _ok(client, h, _body(s, expected_delivery_item_id=picked.id, pack_count=2,
                               supplier_type=None, client_supplier_id=None))
    assert [p["expected_delivery_item_id"] for p in out["packs"]] == [picked.id, picked.id]
    # the supplier comes from the delivery
    assert out["packs"][0]["client_supplier_id"] == s["supplier"].id
    assert _received(client, h, picked_delivery.id) == ("received", [Decimal(20)])
    assert _received(client, h, older.id) == ("pending", [Decimal(0)])


def test_picked_line_must_fit(client, auth_headers, db, s, place):
    h = auth_headers(role="W_Worker")
    d = _delivery(db, s["wh"], s["supplier"])
    line = _line(db, d, s["item"], 10)
    r = _post(client, h, _body(s, expected_delivery_item_id=line.id, accessory_item_id=s["other"]))
    assert r.status_code == 400 and "another item" in r.json()["detail"]

    r = _post(client, h, _body(s, expected_delivery_item_id=line.id, warehouse_id=place["acc2"].id))
    assert r.status_code == 400 and "another warehouse" in r.json()["detail"]

    other = models.LogicalLocation(name=f"pytest_rp_sup_{next(_seq)}", location_type="supplier")
    db.add(other)
    db.flush()
    r = _post(client, h, _body(s, expected_delivery_item_id=line.id, client_supplier_id=other.id))
    assert r.status_code == 400 and "supplier" in r.json()["detail"]

    d.status = "cancelled"
    db.flush()
    r = _post(client, h, _body(s, expected_delivery_item_id=line.id))
    assert r.status_code == 400 and "cancelled" in r.json()["detail"]

    r = _post(client, h, _body(s, expected_delivery_item_id=999999999))
    assert r.status_code == 404


# ── 3. Quantities, units, rack ──────────────────────────────────────────────

def test_quantity_in_another_unit_and_whole_numbers(client, auth_headers, db, s, setup):
    h = auth_headers(role="W_Worker")
    doz = models.Uom(code=f"RDZ{next(_seq)}", name_en="Dozen", name_ar="دستة")
    db.add(doz)
    db.flush()
    db.add(models.UomConversion(from_uom_id=doz.id, to_uom_id=setup["pcs"].id, factor=12))
    db.flush()

    out = _ok(client, h, _body(s, qty_per_pack="2.5", uom_id=doz.id))
    assert Decimal(out["packs"][0]["quantity"]) == 30

    r = _post(client, h, _body(s, qty_per_pack="2.5"))  # PCS has no decimals
    assert r.status_code == 400 and "whole" in r.json()["detail"]
    r = _post(client, h, _body(s, uom_id=setup["m"].id))
    assert r.status_code == 400 and "no conversion" in r.json()["detail"]
    for bad in ({"qty_per_pack": "0"}, {"pack_count": 0}, {"pack_count": 201}):
        assert _post(client, h, _body(s, **bad)).status_code == 422


def test_rack_is_optional_and_must_be_in_the_warehouse(client, auth_headers, s, place):
    h = auth_headers(role="W_Worker")
    out = _ok(client, h, _body(s, rack_id=place["a1"].id, pack_count=2))
    assert [p["rack_code"] for p in out["packs"]] == [place["a1"].rack_code] * 2
    assert _ok(client, h, _body(s))["packs"][0]["rack_id"] is None  # waiting for put-away
    r = _post(client, h, _body(s, rack_id=place["other"].id))
    assert r.status_code == 400 and "another warehouse" in r.json()["detail"]


def test_one_posting_per_add(client, auth_headers, db, s):
    h = auth_headers(role="W_Worker")
    out = _ok(client, h, _body(s, pack_count=3))
    posting = db.get(models.AccessoryPosting, out["posting_id"])
    assert len(posting.entries) == 3 and {e.entry_type for e in posting.entries} == {"receipt"}
    assert posting.created_by != 0


# ── 4. Undo ─────────────────────────────────────────────────────────────────

def test_undo_brings_packs_to_zero_and_off_the_delivery(client, auth_headers, db, s, make_user):
    worker = make_user("W_Worker")
    h = auth_headers(user=worker)
    d = _delivery(db, s["wh"], s["supplier"])
    _line(db, d, s["item"], 100)
    out = _ok(client, h, _body(s, pack_count=2))
    assert _received(client, h, d.id) == ("partial", [Decimal(20)])

    # someone else (not admin) can't
    r = client.post(f"{RECEIVE}/{out['posting_id']}/undo", headers=auth_headers(role="W_Worker"))
    assert r.status_code == 403

    r = client.post(f"{RECEIVE}/{out['posting_id']}/undo", headers=h)
    assert r.status_code == 201, r.text
    for p in out["packs"]:
        pack = client.get(f"/api/v1/accessory-packs/{p['id']}", headers=h).json()
        assert Decimal(pack["quantity"]) == 0 and pack["status"] == "empty"
    assert _received(client, h, d.id) == ("pending", [Decimal(0)])

    r = client.post(f"{RECEIVE}/{out['posting_id']}/undo", headers=h)
    assert r.status_code == 409
    check_invariants(db)


def test_undo_refused_once_packs_are_used_or_not_a_receive(client, auth_headers, db, s):
    from backend.domains.posting import accessory as ledger

    h = auth_headers(user=s["user"])
    out = _ok(client, h, _body(s))
    issued = ledger.issue(db, s["user"].id, out["packs"][0]["id"], 3, s["jo"])
    db.commit()
    r = client.post(f"{RECEIVE}/{out['posting_id']}/undo", headers=h)
    assert r.status_code == 400 and "used since" in r.json()["detail"]

    r = client.post(f"{RECEIVE}/{issued.id}/undo", headers=h)
    assert r.status_code == 400 and "isn't a Receive Packs" in r.json()["detail"]

    # an admin may undo someone else's, while unused
    other = _ok(client, h, _body(s))
    r = client.post(f"{RECEIVE}/{other['posting_id']}/undo", headers=auth_headers(role="admin"))
    assert r.status_code == 201, r.text


# ── 5. Access ───────────────────────────────────────────────────────────────

def test_viewer_cannot_receive_and_flag_off_hides_it(client, auth_headers, s, monkeypatch):
    assert _post(client, auth_headers(role="Viewer"), _body(s)).status_code == 403
    from backend.core.config import settings
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    assert _post(client, auth_headers(role="W_Worker"), _body(s)).status_code == 404


def test_template_cannot_be_received(client, auth_headers, s, setup):
    from backend.tests.test_accessory_variants import _template

    tpl = _template(client, auth_headers(role="W_Manager"), setup)
    r = _post(client, auth_headers(role="W_Worker"), _body(s, accessory_item_id=tpl["id"]))
    assert r.status_code == 400 and "template" in r.json()["detail"]
