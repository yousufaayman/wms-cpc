"""Item 12: accessory packs and their rack moves.

1. Making a pack (`crud.accessory_packs.create_pack`, used by receiving later):
   only stockable items, only in Accessory warehouses, the rack must be in the
   pack's warehouse, the supplier pair is both-or-neither and must exist.
2. Moving: unracked → rack → other rack → off, each move one history row with
   the login as `moved_by`; no-op moves, racks of another warehouse (incl. a
   Fabric rack), empty packs refused; who may move.
3. Scanning a label and listing (unracked = waiting for put-away).
4. `has_stock` is real now: a pack locks the item's base unit, stops a plain
   item from becoming a base, and freezes a variant's color / values.
Reuses the item set-up helpers of test_accessory_items.py / test_accessory_variants.py.
"""
import itertools

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from backend import models
from backend.core.config import settings
from backend.crud import accessory_packs as packs
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    ITEMS,
    _create,
    accessories_on,
    setup,
)
from backend.tests.test_accessory_variants import _template, _variant

PACKS = "/api/v1/accessory-packs/"
_seq = itertools.count(1)


@pytest.fixture
def place(db):
    """Two Accessory warehouses and one Fabric warehouse, racks in each."""
    n = next(_seq)
    acc = models.Warehouse(name=f"pytest_pack_acc_{n}", type="Accessory")
    acc2 = models.Warehouse(name=f"pytest_pack_acc2_{n}", type="Accessory")
    fab = models.Warehouse(name=f"pytest_pack_fab_{n}", type="Fabric")
    db.add_all([acc, acc2, fab])
    db.flush()
    racks = {
        "a1": models.WarehouseRack(warehouse_id=acc.id, rack_code=f"PK-A1-{n}"),
        "a2": models.WarehouseRack(warehouse_id=acc.id, rack_code=f"PK-A2-{n}"),
        "other": models.WarehouseRack(warehouse_id=acc2.id, rack_code=f"PK-B1-{n}"),
        "fabric": models.WarehouseRack(warehouse_id=fab.id, rack_code=f"PK-F1-{n}"),
    }
    db.add_all(racks.values())
    db.flush()
    return {"acc": acc, "acc2": acc2, "fab": fab, **racks}


def _item(client, h, setup, **over):
    r = _create(client, h, setup, **over)
    assert r.status_code == 201, r.text
    return r.json()


def _pack(db, user, item_id, warehouse, **over):
    p = packs.create_pack(db, item_id=item_id, warehouse_id=warehouse.id, created_by=user.id, **over)
    db.commit()
    return p


def _refused(fn, code=400, text=None):
    with pytest.raises(HTTPException) as e:
        fn()
    assert e.value.status_code == code, e.value.detail
    if text:
        assert text in e.value.detail
    return e.value.detail


# ── 1. Making a pack ────────────────────────────────────────────────────────

def test_new_pack_is_active_unracked_and_labelled(client, auth_headers, setup, place, db, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user("W_Worker")
    item = _item(client, h, setup)
    p = _pack(db, user, item["id"], place["acc"])
    assert p.status == "active" and p.rack_id is None and p.created_by == user.id
    body = client.get(f"{PACKS}{p.id}", headers=h).json()
    assert "barcode" not in body  # *ACC is only the scan terminator
    assert body["item_code"] == item["code"] and body["rack_code"] is None
    assert client.get(f"{PACKS}{p.id}/moves", headers=h).json() == []  # creating writes no move

    on_rack = _pack(db, user, item["id"], place["acc"], rack_id=place["a1"].id,
                    supplier_type="logical_location", client_supplier_id=setup["supplier"].id)
    assert on_rack.rack_code == place["a1"].rack_code
    assert on_rack.supplier_type == "logical_location"
    client_supplied = _pack(db, user, item["id"], place["acc"],
                            supplier_type="client", client_supplier_id=setup["client"].id)
    assert client_supplied.client_supplier_id == setup["client"].id


def test_only_stockable_items_get_packs(client, auth_headers, setup, place, db, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user()
    template = _template(client, h, setup)
    _refused(lambda: packs.create_pack(db, item_id=template["id"], warehouse_id=place["acc"].id,
                                       created_by=user.id), text="template")

    variant = _variant(client, h, template["id"], {"price": "34.99"}).json()
    packs.create_pack(db, item_id=variant["id"], warehouse_id=place["acc"].id, created_by=user.id)

    client.patch(f"{ITEMS}{template['id']}", json={"active": False}, headers=h)
    db.expire_all()
    _refused(lambda: packs.create_pack(db, item_id=variant["id"], warehouse_id=place["acc"].id,
                                       created_by=user.id), text="switched off")

    off = _item(client, h, setup)
    client.patch(f"{ITEMS}{off['id']}", json={"active": False}, headers=h)
    db.expire_all()
    _refused(lambda: packs.create_pack(db, item_id=off["id"], warehouse_id=place["acc"].id,
                                       created_by=user.id), text="switched off")
    _refused(lambda: packs.create_pack(db, item_id=10**12, warehouse_id=place["acc"].id,
                                       created_by=user.id), code=404)


def test_pack_place_and_supplier_rules(client, auth_headers, setup, place, db, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user()
    item_id = _item(client, h, setup)["id"]

    def make(**over):
        return lambda: packs.create_pack(db, item_id=item_id, created_by=user.id,
                                         **{"warehouse_id": place["acc"].id, **over})

    _refused(make(warehouse_id=place["fab"].id), text="Fabric")
    _refused(make(rack_id=place["other"].id), text="another warehouse")
    _refused(make(rack_id=place["fabric"].id), text="another warehouse")
    _refused(make(supplier_type="client"), text="both")
    _refused(make(client_supplier_id=setup["client"].id), text="both")
    _refused(make(supplier_type="client", client_supplier_id=10**8), code=404)
    internal = models.LogicalLocation(name=f"pytest_pack_line_{next(_seq)}", location_type="internal")
    db.add(internal)
    db.flush()
    _refused(make(supplier_type="logical_location", client_supplier_id=internal.id), text="not a supplier")
    _refused(make(expected_delivery_item_id=10**8), code=404)


def test_db_refuses_half_a_supplier_and_unknown_status(client, auth_headers, setup, place, db, make_user):
    """The CHECKs hold even for code that skips the service."""
    h = auth_headers(role="W_Manager")
    user = make_user()
    item_id = _item(client, h, setup)["id"]
    for bad in ({"supplier_type": "client"}, {"status": "lost"}, {"supplier_type": "x", "client_supplier_id": 1}):
        nested = db.begin_nested()
        db.add(models.AccessoryPack(accessory_item_id=item_id, warehouse_id=place["acc"].id,
                                    created_by=user.id, **bad))
        with pytest.raises(IntegrityError):
            db.flush()
        nested.rollback()


# ── 2. Moving ───────────────────────────────────────────────────────────────

def _move(client, h, pack_id, rack_id):
    return client.post(f"{PACKS}{pack_id}/move", json={"rack_id": rack_id}, headers=h)


def test_moves_are_recorded_with_the_login(client, auth_headers, setup, place, db, make_user):
    h = auth_headers(role="W_Manager")
    worker = make_user("W_Worker")
    wh = auth_headers(user=worker)
    p = _pack(db, worker, _item(client, h, setup)["id"], place["acc"])

    first = _move(client, wh, p.id, place["a1"].id)
    assert first.status_code == 200, first.text
    assert first.json()["from_rack_id"] is None and first.json()["to_rack_code"] == place["a1"].rack_code
    assert first.json()["moved_by"] == worker.id
    assert _move(client, wh, p.id, place["a2"].id).status_code == 200
    assert _move(client, wh, p.id, None).status_code == 200  # taken off the rack

    history = client.get(f"{PACKS}{p.id}/moves", headers=h).json()
    assert [(m["from_rack_id"], m["to_rack_id"]) for m in history] == [
        (None, place["a1"].id), (place["a1"].id, place["a2"].id), (place["a2"].id, None),
    ]
    assert client.get(f"{PACKS}{p.id}", headers=h).json()["rack_id"] is None


def test_bad_moves_are_refused(client, auth_headers, setup, place, db, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user()
    p = _pack(db, user, _item(client, h, setup)["id"], place["acc"], rack_id=place["a1"].id)

    same = _move(client, h, p.id, place["a1"].id)
    assert same.status_code == 400 and "already on" in same.json()["detail"]
    assert _move(client, h, p.id, place["other"].id).status_code == 400
    assert _move(client, h, p.id, place["fabric"].id).status_code == 400
    assert _move(client, h, p.id, 10**8).status_code == 404
    assert _move(client, h, 10**12, place["a2"].id).status_code == 404

    p.status = "empty"
    db.commit()
    empty = _move(client, h, p.id, place["a2"].id)
    assert empty.status_code == 400 and "empty" in empty.json()["detail"]
    assert client.get(f"{PACKS}{p.id}/moves", headers=h).json() == []


def test_who_may_move(client, auth_headers, setup, place, db, make_user):
    h = auth_headers(role="W_Manager")
    p = _pack(db, make_user(), _item(client, h, setup)["id"], place["acc"])
    viewer = auth_headers(role="Viewer")
    assert client.get(f"{PACKS}{p.id}", headers=viewer).status_code == 200
    assert _move(client, viewer, p.id, place["a1"].id).status_code == 403
    assert _move(client, auth_headers(role="gen_ops"), p.id, place["a1"].id).status_code == 403
    assert _move(client, auth_headers(role="W_Worker"), p.id, place["a1"].id).status_code == 200


def test_flag_off_hides_packs(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    assert client.get(PACKS, headers=auth_headers(role="W_Manager")).status_code == 404


# ── 3. Scanning and listing ─────────────────────────────────────────────────

def test_scan_a_label(client, auth_headers, setup, place, db, make_user):
    p = _pack(db, make_user(), _item(client, auth_headers(role="W_Manager"), setup)["id"], place["acc"])
    h = auth_headers(role="W_Worker")
    for scan in (f"{p.id}*ACC", f" {p.id}*acc "):
        r = client.get(f"{PACKS}scan", params={"barcode": scan}, headers=h)
        assert r.status_code == 200 and r.json()["id"] == p.id
    for not_a_pack in (f"{p.id}*F", f"{p.id}*K", str(p.id), place["a1"].rack_code):
        assert client.get(f"{PACKS}scan", params={"barcode": not_a_pack}, headers=h).status_code == 400
    assert client.get(f"{PACKS}scan", params={"barcode": f"{10**12}*ACC"}, headers=h).status_code == 404


def test_list_filters(client, auth_headers, setup, place, db, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user()
    a = _item(client, h, setup)["id"]
    b = _item(client, h, setup)["id"]
    unracked = _pack(db, user, a, place["acc"])
    racked = _pack(db, user, a, place["acc"], rack_id=place["a1"].id)
    other_item = _pack(db, user, b, place["acc"], rack_id=place["a1"].id)
    elsewhere = _pack(db, user, a, place["acc2"])
    racked.status = "empty"
    db.commit()

    def ids(**params):
        r = client.get(PACKS, params={"warehouse_id": place["acc"].id, **params}, headers=h).json()
        if "limit" not in params:
            assert r["total"] == len(r["items"])
        return [p["id"] for p in r["items"]]

    assert ids() == [other_item.id, racked.id, unracked.id]  # newest first, this warehouse only
    assert ids(unracked=True) == [unracked.id]
    assert ids(unracked=True, rack_id=place["a1"].id) == [unracked.id]  # unracked wins
    assert ids(rack_id=place["a1"].id) == [other_item.id, racked.id]
    assert ids(accessory_item_id=a) == [racked.id, unracked.id]
    assert ids(status="active") == [other_item.id, unracked.id]
    assert ids(limit=1, offset=1) == [racked.id]
    page = client.get(PACKS, params={"warehouse_id": place["acc"].id, "limit": 1}, headers=h).json()
    assert page["total"] == 3
    assert elsewhere.id not in ids()


# ── 4. A pack means the item has stock ──────────────────────────────────────

def test_a_pack_locks_the_item(client, auth_headers, setup, place, db, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user()
    item = _item(client, h, setup)
    unit = client.patch(f"{ITEMS}{item['id']}", json={"base_uom_id": setup["m"].id}, headers=h)
    assert unit.status_code == 200  # no stock yet: the unit may still change
    client.patch(f"{ITEMS}{item['id']}", json={"base_uom_id": setup["pcs"].id}, headers=h)

    _pack(db, user, item["id"], place["acc"])
    unit = client.patch(f"{ITEMS}{item['id']}", json={"base_uom_id": setup["m"].id}, headers=h)
    assert unit.status_code == 400 and "stock" in unit.json()["detail"]
    becomes_base = _variant(client, h, item["id"], {}, color="Black")
    assert becomes_base.status_code == 400 and "stock" in becomes_base.json()["detail"]
    line = client.post(f"{ITEMS}{item['id']}/fields", headers=h,
                       json={"label_en": "Price", "label_ar": "عربي", "field_type": "money", "required": True})
    assert line.status_code == 400 and "stock" in line.json()["detail"]


def test_a_pack_freezes_a_variant(client, auth_headers, setup, place, db, make_user):
    h = auth_headers(role="W_Manager")
    base = _item(client, h, setup, client_id=setup["client"].id,
                 refs=[{"client_id": setup["client"].id, "ref_code": f"PK-{next(_seq)}"}])
    black = _variant(client, h, base["id"], {}, color="Black").json()
    white = _variant(client, h, base["id"], {}, color="White").json()
    _pack(db, make_user(), black["id"], place["acc"])

    recolor = client.patch(f"{ITEMS}{black['id']}", json={"color": "Navy"}, headers=h)
    assert recolor.status_code == 400 and "stock" in recolor.json()["detail"]
    assert client.patch(f"{ITEMS}{white['id']}", json={"color": "Ivory"}, headers=h).status_code == 200
    push = client.patch(f"{ITEMS}{base['id']}", json={"color": "Olive"}, headers=h)  # would recolor black
    assert push.status_code == 400 and black["code"] in push.json()["detail"]
