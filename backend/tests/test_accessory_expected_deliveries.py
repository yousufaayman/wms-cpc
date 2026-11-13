"""Item 15: accessory lines on expected deliveries.

An accessory line = an accessory item + an expected quantity in the item's base
unit (typed in any unit that converts). What was received is never stored: it
is the sum of the `receipt` ledger rows on the packs linked to the line, so a
reversed receipt nets out and issuing from those packs later changes nothing.
The delivery's pending / partial / received status follows from those numbers,
as it does for fabric rolls.
"""
from decimal import Decimal
from itertools import count

import pytest
from sqlalchemy.exc import IntegrityError

from backend import models
from backend.crud import expected_deliveries as crud
from backend.domains.posting import accessory as ledger
from backend.domains.posting.accessory import NewPack
from backend.tests.test_accessory_invariants import check_invariants
from backend.tests.test_accessory_items import _create, accessories_on, setup  # noqa: F401  (fixtures)
from backend.tests.test_accessory_ledger import stock  # noqa: F401  (fixture)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)

DELIVERIES = "/api/v1/expected-deliveries/"
_seq = count(1)


def _delivery(db, warehouse, supplier=None):
    d = models.ExpectedDelivery(
        warehouse_id=warehouse.id, status="pending",
        supplier_type="logical_location" if supplier else None,
        client_supplier_id=supplier.id if supplier else None,
    )
    db.add(d)
    db.flush()
    return d


def _material(db):
    mat = models.Material(material_name=f"pytest_accdel_mat_{next(_seq)}")
    db.add(mat)
    db.flush()
    return mat.material_id


def _add(client, h, delivery_id, **body):
    return client.post(f"{DELIVERIES}{delivery_id}/items", json=body, headers=h)


def _receive(db, s, line_id, *qtys):
    posting, packs = ledger.receive(
        db, s["user"].id, s["wh"].id, [NewPack(s["item"], Decimal(q), expected_delivery_item_id=line_id) for q in qtys]
    )
    crud.sync_delivery_item_from_packs(db, line_id)
    db.commit()
    return posting, packs


def _get(client, h, delivery_id):
    r = client.get(f"{DELIVERIES}{delivery_id}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# ── 1. Database guards ──────────────────────────────────────────────────────

def test_db_checks_keep_accessory_lines_clean(db, stock):
    d = _delivery(db, stock["wh"])
    bad_rows = [
        {"accessory_item_id": stock["item"]},  # no quantity
        {"accessory_item_id": stock["item"], "expected_qty": 0},  # not above zero
        {"accessory_item_id": stock["item"], "expected_qty": 5, "expected_weight_kg": 1},  # fabric field
        {"material_id": None, "client_fabric_code_id": None, "expected_qty": 5},  # qty without item, no type
    ]
    for row in bad_rows:
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.add(models.ExpectedDeliveryItem(delivery_id=d.id, received_weight_kg=0, received_length_m=0, **row))
                db.flush()


def test_one_type_check_counts_accessory_lines(db, stock):
    material = _material(db)
    d = _delivery(db, stock["wh"])
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add(models.ExpectedDeliveryItem(
                delivery_id=d.id, accessory_item_id=stock["item"], expected_qty=5, material_id=material,
                received_weight_kg=0, received_length_m=0,
            ))
            db.flush()


# ── 2. Adding lines through the API ─────────────────────────────────────────

def test_add_accessory_line_shows_item_and_zero_received(client, auth_headers, db, stock, setup):
    h = auth_headers(role="W_Manager")
    d = _delivery(db, stock["wh"])
    r = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="600")
    assert r.status_code == 201, r.text
    line = r.json()
    assert Decimal(line["expected_qty"]) == 600
    assert Decimal(line["received_qty"]) == 0
    assert line["uom_code"] == setup["pcs"].code
    assert line["item_code"] and line["item_description"] == "Elastic 2 cm"


def test_quantity_typed_in_another_unit_is_saved_in_base_units(client, auth_headers, db, stock, setup):
    doz = models.Uom(code=f"QDZ{next(_seq)}", name_en="Dozen", name_ar="دستة")
    db.add(doz)
    db.flush()
    db.add(models.UomConversion(from_uom_id=doz.id, to_uom_id=setup["pcs"].id, factor=12))
    db.flush()
    h = auth_headers(role="W_Manager")

    units = client.get(f"/api/v1/accessory-items/{stock['item']}/units", headers=h).json()
    assert [u["code"] for u in units][0] == setup["pcs"].code and units[0]["is_base"]
    assert {u["code"]: Decimal(u["factor"]) for u in units}[doz.code] == 12

    d = _delivery(db, stock["wh"])
    r = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="50", uom_id=doz.id)
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["expected_qty"]) == 600

    # a unit with no conversion to the base unit is refused
    r = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="5", uom_id=setup["m"].id)
    assert r.status_code == 400 and "no conversion" in r.json()["detail"]


def test_lines_follow_the_warehouse_type(client, auth_headers, db, stock, place, setup):
    h = auth_headers(role="W_Manager")
    fabric = _delivery(db, place["fab"])
    r = _add(client, h, fabric.id, accessory_item_id=stock["item"], expected_qty="5")
    assert r.status_code == 400 and "Accessory warehouse" in r.json()["detail"]

    acc = _delivery(db, stock["wh"])
    r = _add(client, h, acc.id, material_id=_material(db), client_id=setup["client"].client_id, expected_weight_kg=10)
    assert r.status_code == 400 and "Fabric warehouse" in r.json()["detail"]


def test_quantity_rules_on_the_body(client, auth_headers, db, stock):
    h = auth_headers(role="W_Manager")
    d = _delivery(db, stock["wh"])
    assert _add(client, h, d.id, accessory_item_id=stock["item"]).status_code == 422  # no qty
    assert _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="0").status_code == 422
    assert _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="5",
                expected_weight_kg=3).status_code == 422


def test_switched_off_item_refused(client, auth_headers, db, stock):
    db.get(models.AccessoryItem, stock["item"]).active = False
    db.flush()
    h = auth_headers(role="W_Manager")
    d = _delivery(db, stock["wh"])
    r = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="5")
    assert r.status_code == 400 and "switched off" in r.json()["detail"]


def test_worker_cannot_add_lines(client, auth_headers, db, stock):
    d = _delivery(db, stock["wh"])
    r = _add(client, auth_headers(role="W_Worker"), d.id, accessory_item_id=stock["item"], expected_qty="5")
    assert r.status_code == 403


# ── 3. Received = the ledger, status follows ────────────────────────────────

def test_received_comes_from_receipts_and_drives_status(client, auth_headers, db, stock):
    h = auth_headers(role="W_Manager")
    d = _delivery(db, stock["wh"])
    line = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="600").json()

    _receive(db, stock, line["id"], "250", "250")
    got = _get(client, h, d.id)
    assert Decimal(got["items"][0]["received_qty"]) == 500
    assert got["status"] == "partial"

    _, packs = _receive(db, stock, line["id"], "100")
    got = _get(client, h, d.id)
    assert Decimal(got["items"][0]["received_qty"]) == 600
    assert got["status"] == "received"

    # issuing from a received pack doesn't change what was received
    ledger.issue(db, stock["user"].id, packs[0].id, Decimal("40"), stock["jo"])
    db.commit()
    assert Decimal(_get(client, h, d.id)["items"][0]["received_qty"]) == 600
    check_invariants(db)


def test_reversed_receipt_nets_out(client, auth_headers, db, stock):
    h = auth_headers(role="W_Manager")
    d = _delivery(db, stock["wh"])
    line = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="300").json()
    _receive(db, stock, line["id"], "100")
    posting, _ = _receive(db, stock, line["id"], "50")
    ledger.reverse_posting(db, stock["user"].id, posting.id, "wrong count")
    crud.sync_delivery_item_from_packs(db, line["id"])
    db.commit()
    got = _get(client, h, d.id)
    assert Decimal(got["items"][0]["received_qty"]) == 100
    assert got["status"] == "partial"
    check_invariants(db)


def test_raising_the_expected_quantity_reopens_a_full_line(client, auth_headers, db, stock):
    """Status only moves among pending/partial/received while the delivery is open."""
    h = auth_headers(role="W_Manager")
    d = _delivery(db, stock["wh"])
    first = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="100").json()
    second = _add(client, h, d.id, accessory_item_id=stock["other"], expected_qty="10").json()
    _receive(db, stock, first["id"], "100")
    assert _get(client, h, d.id)["status"] == "partial"  # second line still waiting

    r = client.put(f"{DELIVERIES}items/{second['id']}", json={"expected_qty": "20"}, headers=h)
    assert r.status_code == 200 and Decimal(r.json()["expected_qty"]) == 20
    assert Decimal(r.json()["received_qty"]) == 0


def test_list_carries_received_too(client, auth_headers, db, stock):
    h = auth_headers(role="W_Manager")
    d = _delivery(db, stock["wh"])
    line = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="10").json()
    _receive(db, stock, line["id"], "4")
    rows = client.get(f"{DELIVERIES}?warehouse_id={stock['wh'].id}", headers=h).json()
    mine = next(x for x in rows if x["id"] == d.id)
    assert Decimal(mine["items"][0]["received_qty"]) == 4


# ── 4. Edits and deletes ────────────────────────────────────────────────────

def test_line_with_packs_keeps_its_item_and_cannot_be_deleted(client, auth_headers, db, stock):
    h = auth_headers(role="W_Manager")
    d = _delivery(db, stock["wh"])
    line = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="10").json()
    _receive(db, stock, line["id"], "4")

    r = client.put(f"{DELIVERIES}items/{line['id']}", json={"accessory_item_id": stock["other"]}, headers=h)
    assert r.status_code == 400 and "Packs were already received" in r.json()["detail"]
    r = client.delete(f"{DELIVERIES}items/{line['id']}", headers=h)
    assert r.status_code == 400
    # the quantity can still change
    r = client.put(f"{DELIVERIES}items/{line['id']}", json={"expected_qty": "4"}, headers=h)
    assert r.status_code == 200
    assert _get(client, h, d.id)["status"] == "received"


def test_line_without_packs_can_change_item_or_be_deleted(client, auth_headers, db, stock):
    h = auth_headers(role="W_Manager")
    d = _delivery(db, stock["wh"])
    line = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="10").json()
    r = client.put(f"{DELIVERIES}items/{line['id']}", json={"accessory_item_id": stock["other"]}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["accessory_item_id"] == stock["other"] and Decimal(r.json()["expected_qty"]) == 10
    assert client.delete(f"{DELIVERIES}items/{line['id']}", headers=h).status_code == 204


def test_line_kinds_do_not_mix_on_edit(client, auth_headers, db, stock):
    h = auth_headers(role="W_Manager")
    d = _delivery(db, stock["wh"])
    line = _add(client, h, d.id, accessory_item_id=stock["item"], expected_qty="10").json()
    r = client.put(f"{DELIVERIES}items/{line['id']}", json={"expected_weight_kg": 5}, headers=h)
    assert r.status_code == 400 and "fabric fields" in r.json()["detail"]


# ── 5. Variants of one template (grouped on the page) ───────────────────────

def test_variant_lines_carry_their_template_and_values(client, auth_headers, db, stock, setup):
    from backend.tests.test_accessory_variants import _template, _variant

    h = auth_headers(role="W_Manager")
    tpl = _template(client, h, setup)
    navy = _variant(client, h, tpl["id"], {"price": "34.99"}, color="Navy", size="M").json()
    red = _variant(client, h, tpl["id"], {"price": "34.99", "po_number": "4512"}, color="Red", size="M").json()
    d = _delivery(db, stock["wh"])
    for v in (navy, red):
        assert _add(client, h, d.id, accessory_item_id=v["id"], expected_qty="10").status_code == 201
    # a template itself can't be expected (never stocked)
    assert _add(client, h, d.id, accessory_item_id=tpl["id"], expected_qty="10").status_code == 400

    lines = _get(client, h, d.id)["items"]
    assert {ln["template_id"] for ln in lines} == {tpl["id"]}
    assert {ln["template_code"] for ln in lines} == {tpl["code"]}
    assert all(ln["template_description"] == tpl["description"] for ln in lines)
    by_color = {ln["item_color"]: ln for ln in lines}
    assert by_color["Navy"]["item_size"] == "M"
    assert [(v["field_key"], v["value"]) for v in by_color["Red"]["value_lines"]] == [("price", "34.99"), ("po_number", "4512")]
