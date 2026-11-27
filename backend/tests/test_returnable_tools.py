"""Item 33: returnable tools, part 1 (category switches, Add, Returnable Tools page).

A category marked `tracked` holds tools, not trims; `individual` = one label
per piece. Tools live in `wms.returnable_units` + `wms.returnable_movements`
(never packs / ledger). owned = added − retired, out = out − in,
in = owned − out. Rules: `domains/accessories/tools.py`,
`crud/accessory_categories.py`.
"""
from decimal import Decimal
from itertools import count

import pytest
from sqlalchemy.exc import IntegrityError

from backend import models
from backend.core.config import settings
from backend.domains.accessories import tools
from backend.domains.posting import accessory as ledger
from backend.domains.posting.accessory import NewPack
from backend.tests.test_accessory_items import _category, _create, _uom, accessories_on, setup  # noqa: F401
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)

CATS = "/api/v1/accessory-categories/"
TOOLS = "/api/v1/returnable-tools"
_seq = count(1)


def _tool_category(db, setup, individual=True):
    code = "QF" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[next(_seq) % 26]
    cat = _category(db, code, setup["pcs"])
    cat.tracked = True
    cat.individual = individual
    db.flush()
    return cat


def _tool_item(client, h, setup, cat, **over):
    r = _create(client, h, setup, **{"category_id": cat.id, "description": "Folder 2 cm", **over})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def t(client, auth_headers, db, setup, place, make_user):
    """A pieces category + item, a packs category + item, the warehouse, a worker."""
    h = auth_headers(role="W_Manager")
    pieces_cat = _tool_category(db, setup, individual=True)
    packs_cat = _tool_category(db, setup, individual=False)
    piece = _tool_item(client, h, setup, pieces_cat)
    pack = _tool_item(client, h, setup, packs_cat, description="Presser foot")
    worker = models.Worker(worker_name=f"pytest worker {next(_seq)}")
    db.add(worker)
    db.flush()
    return {"h": h, "piece": piece["id"], "pack": pack["id"], "pieces_cat": pieces_cat, "packs_cat": packs_cat,
            "wh": place["acc"], "place": place, "worker": worker, "setup": setup}


def _add(client, h, t, **body):
    body = {"warehouse_id": t["wh"].id, **body}
    return client.post(f"{TOOLS}/add", json=body, headers=h)


def _added(client, h, t, **body):
    r = _add(client, h, t, **body)
    assert r.status_code == 201, r.text
    return r.json()


def _summary(client, h, t):
    rows = client.get(f"{TOOLS}/summary", params={"warehouse_id": t["wh"].id}, headers=h).json()
    return {r["accessory_item_id"]: r for r in rows}


def _move(db, unit_id, kind, qty, worker=None, user=None, reason=None):
    db.add(models.ReturnableMovement(
        unit_id=unit_id, movement_type=kind, qty=qty, worker_id=worker.worker_id if worker else None,
        reason=reason, created_by=user.id,
    ))
    db.flush()


# ── 1. Category switches ────────────────────────────────────────────────────

def test_individual_needs_tracked(client, auth_headers, db, setup):
    h = auth_headers(role="W_Manager")
    body = {"code": "QZI", "name_en": "Feet", "name_ar": "دواسات", "default_uom_id": setup["pcs"].id,
            "individual": True}
    assert client.post(CATS, json=body, headers=h).status_code == 400
    r = client.post(CATS, json={**body, "tracked": True}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["tracked"] and r.json()["individual"]
    assert client.patch(f"{CATS}{r.json()['id']}", json={"tracked": False}, headers=h).status_code == 400

    cat = db.get(models.AccessoryCategory, r.json()["id"])
    with db.begin_nested():
        cat.tracked = False
        with pytest.raises(IntegrityError):  # the database CHECK too
            db.flush()


def test_trim_category_with_packs_cannot_become_tracked(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    item = _create(client, h, setup).json()  # category QEL
    ledger.receive(db, make_user("W_Worker").id, place["acc"].id, [NewPack(item["id"], Decimal(5))])
    db.flush()
    r = client.patch(f"{CATS}{setup['cat'].id}", json={"tracked": True}, headers=h)
    assert r.status_code == 400 and "trim" in r.json()["detail"]


def test_tracked_needs_whole_number_units(client, auth_headers, db, setup):
    h = auth_headers(role="W_Manager")
    setup["m"].allows_decimals = True
    db.flush()
    body = {"code": "QZD", "name_en": "Tools", "name_ar": "أدوات", "default_uom_id": setup["m"].id, "tracked": True}
    assert client.post(CATS, json=body, headers=h).status_code == 400
    # A trim category whose item uses a decimal unit (but has no packs) can't become tracked either
    cat = _category(db, "QZE", setup["pcs"])
    assert _create(client, h, setup, category_id=cat.id, base_uom_id=setup["m"].id).status_code == 201
    assert client.patch(f"{CATS}{cat.id}", json={"tracked": True}, headers=h).status_code == 400
    # An item of a tracked category can't take a decimal unit
    tool_cat = _tool_category(db, setup)
    assert _create(client, h, setup, category_id=tool_cat.id, base_uom_id=setup["m"].id).status_code == 400


def test_tracked_category_with_tools_stays_tracked_but_individual_can_change(client, db, t):
    h = t["h"]
    old = _added(client, h, t, accessory_item_id=t["piece"], count=1)[0]["unit"]
    cat = t["pieces_cat"]
    assert client.patch(f"{CATS}{cat.id}", json={"tracked": False}, headers=h).status_code == 400
    r = client.patch(f"{CATS}{cat.id}", json={"individual": False}, headers=h)
    assert r.status_code == 200, r.text
    new = _added(client, h, t, accessory_item_id=t["piece"], qty="4")[0]["unit"]
    assert old["is_individual"] is True and new["is_individual"] is False  # old tools keep how they were made
    assert client.get(f"{TOOLS}/{old['id']}", headers=h).json()["is_individual"] is True


# ── 2. Tools are never trims ────────────────────────────────────────────────

def test_tool_items_refused_by_trim_screens(client, db, t, make_user):
    h = t["h"]
    body = {"warehouse_id": t["wh"].id, "accessory_item_id": t["piece"], "opening_stock": True,
            "pack_count": 1, "qty_per_pack": "1"}
    r = client.post("/api/v1/accessory-packs/receive", json=body, headers=h)
    assert r.status_code == 400 and "returnable tool" in r.json()["detail"]
    with pytest.raises(Exception):
        ledger.receive(db, make_user("W_Worker").id, t["wh"].id, [NewPack(t["pack"], Decimal(1))])


def test_item_search_splits_tools_and_trims(client, t):
    h, setup = t["h"], t["setup"]
    trim = _create(client, h, setup, description="Folder-like trim").json()
    only_tools = client.get("/api/v1/accessory-items/", params={"q": "Folder", "tracked": True}, headers=h).json()
    only_trims = client.get("/api/v1/accessory-items/", params={"q": "Folder", "tracked": False}, headers=h).json()
    assert {i["id"] for i in only_tools["items"]} == {t["piece"]}
    assert all(i["is_tool"] for i in only_tools["items"])
    assert only_tools["items"][0]["is_individual_tool"] is True
    assert {i["id"] for i in only_trims["items"]} == {trim["id"]}


def test_tools_cannot_be_merged(client, auth_headers, t):
    h = auth_headers(role="admin")
    other = _tool_item(client, t["h"], t["setup"], t["pieces_cat"], description="Folder 3 cm")
    r = client.get(f"/api/v1/accessory-items/{other['id']}/merge-preview",
                   params={"keep_item_id": t["piece"]}, headers=h)
    assert any("returnable tool" in b for b in r.json()["blockers"])


# ── 3. Add ──────────────────────────────────────────────────────────────────

def test_add_pieces_one_label_each(client, auth_headers, db, t, make_user):
    user = make_user("W_Worker")
    h = auth_headers(user=user)
    out = _added(client, h, t, accessory_item_id=t["piece"], count=3, serial_nos=["F-1", "", "F-3"],
                 rack_id=t["place"]["a1"].id, supplier_type="logical_location",
                 client_supplier_id=t["setup"]["supplier"].id)
    units = [o["unit"] for o in out]
    assert len(units) == 3
    assert [u["serial_no"] for u in units] == ["F-1", None, "F-3"]
    assert all(u["barcode"] == f"{u['id']}*TL" and u["is_individual"] for u in units)
    assert all(Decimal(u["owned"]) == 1 and Decimal(u["in_stock"]) == 1 and Decimal(u["out"]) == 0 for u in units)
    assert all(u["created_by"] == user.id and u["rack_code"] == t["place"]["a1"].rack_code for u in units)
    assert units[0]["supplier_name"] == t["setup"]["supplier"].name
    moves = db.query(models.ReturnableMovement).filter(
        models.ReturnableMovement.unit_id.in_([u["id"] for u in units])).all()
    assert {(m.movement_type, Decimal(m.qty), m.created_by) for m in moves} == {("added", Decimal(1), user.id)}

    row = _summary(client, h, t)[t["piece"]]
    assert (row["labels"], Decimal(row["owned"]), Decimal(row["in_stock"]), Decimal(row["out"])) == (3, 3, 3, 0)


def test_add_pieces_refusals(client, t):
    h = t["h"]
    _added(client, h, t, accessory_item_id=t["piece"], count=1, serial_nos=["S-9"])
    for body, text in [
        ({"count": 2, "serial_nos": ["S-9"]}, "already has a piece"),
        ({"count": 2, "serial_nos": ["A", "a"]}, "twice"),
        ({"count": 1, "serial_nos": ["A", "B"]}, "More serial numbers"),
        ({"qty": "3"}, "by count"),
        ({}, "How many"),
    ]:
        r = _add(client, h, t, accessory_item_id=t["piece"], **body)
        assert r.status_code == 400 and text in r.json()["detail"], (body, r.text)


def test_add_pack_and_top_up(client, t):
    h = t["h"]
    pack = _added(client, h, t, accessory_item_id=t["pack"], qty="20")[0]["unit"]
    assert pack["is_individual"] is False and Decimal(pack["owned"]) == 20
    r = client.post(f"{TOOLS}/units/{pack['id']}/add", json={"qty": "5"}, headers=h)
    assert r.status_code == 201, r.text
    assert Decimal(r.json()["unit"]["owned"]) == 25
    assert _summary(client, h, t)[t["pack"]]["labels"] == 1

    assert _add(client, h, t, accessory_item_id=t["pack"], qty="2.5").status_code == 400
    assert _add(client, h, t, accessory_item_id=t["pack"], count=2).status_code == 400
    assert client.post(f"{TOOLS}/units/{pack['id']}/add", json={"qty": "0.5"}, headers=h).status_code == 400
    piece = _added(client, h, t, accessory_item_id=t["piece"], count=1)[0]["unit"]
    r = client.post(f"{TOOLS}/units/{piece['id']}/add", json={"qty": "1"}, headers=h)
    assert r.status_code == 400 and "piece" in r.json()["detail"]


def test_add_refuses_trims_other_warehouses_and_racks(client, t):
    h, setup = t["h"], t["setup"]
    trim = _create(client, h, setup).json()
    assert "not a returnable tool" in _add(client, h, t, accessory_item_id=trim["id"], count=1).json()["detail"]
    assert _add(client, h, t, accessory_item_id=t["piece"], count=1,
                rack_id=t["place"]["other"].id).status_code == 400
    r = client.post(f"{TOOLS}/add", json={"warehouse_id": t["place"]["fab"].id, "accessory_item_id": t["piece"],
                                          "count": 1}, headers=h)
    assert r.status_code == 400


# ── 4. Numbers ──────────────────────────────────────────────────────────────

def test_owned_in_out_retired_from_movements(client, db, t, make_user):
    """By hand: pack of 20 + 5; 6 out to A, 2 back, 3 out to B; 1 retired."""
    h, user = t["h"], make_user("W_Manager")
    other_worker = models.Worker(worker_name=f"pytest worker {next(_seq)}")
    db.add(other_worker)
    db.flush()
    pack = _added(client, h, t, accessory_item_id=t["pack"], qty="20")[0]["unit"]
    client.post(f"{TOOLS}/units/{pack['id']}/add", json={"qty": "5"}, headers=h)
    _move(db, pack["id"], "out", 6, t["worker"], user)
    _move(db, pack["id"], "in", 2, t["worker"], user)
    _move(db, pack["id"], "out", 3, other_worker, user)
    _move(db, pack["id"], "retired", 1, user=user, reason="broken")

    unit = client.get(f"{TOOLS}/{pack['id']}", headers=h).json()
    assert [Decimal(unit[k]) for k in ("owned", "out", "in_stock", "retired")] == [24, 7, 17, 1]
    row = _summary(client, h, t)[t["pack"]]
    assert [Decimal(row[k]) for k in ("owned", "out", "in_stock", "retired")] == [24, 7, 17, 1]


def test_movement_checks_in_the_database(db, t, make_user):
    unit = models.ReturnableUnit(accessory_item_id=t["pack"], is_individual=False, warehouse_id=t["wh"].id,
                                 created_by=make_user().id)
    db.add(unit)
    db.flush()
    for kind, qty, reason in [("out", 1, None), ("retired", 1, None), ("added", 0, None), ("lent", 1, None)]:
        with db.begin_nested():
            db.add(models.ReturnableMovement(unit_id=unit.id, movement_type=kind, qty=qty, reason=reason,
                                             created_by=unit.created_by))
            with pytest.raises(IntegrityError):
                db.flush()
    with db.begin_nested():
        unit.serial_no = "X1"  # serial numbers only on pieces
        with pytest.raises(IntegrityError):
            db.flush()


# ── 5. Undo during the Add session ──────────────────────────────────────────

def test_undo_add(client, auth_headers, db, t, make_user):
    adder = make_user("W_Worker")
    h = auth_headers(user=adder)
    out = _added(client, h, t, accessory_item_id=t["piece"], count=2)
    first, second = out[0], out[1]

    assert client.delete(f"{TOOLS}/movements/{first['movement_id']}",
                         headers=auth_headers(role="W_Worker")).status_code == 403  # someone else
    assert client.delete(f"{TOOLS}/movements/{first['movement_id']}", headers=h).status_code == 204
    assert db.get(models.ReturnableUnit, first["unit"]["id"]) is None  # gone, not "retired"
    assert client.get(f"{TOOLS}/{first['unit']['id']}", headers=h).status_code == 404
    assert _summary(client, h, t)[t["piece"]]["labels"] == 1

    _move(db, second["unit"]["id"], "out", 1, t["worker"], adder)
    r = client.delete(f"{TOOLS}/movements/{second['movement_id']}", headers=auth_headers(role="admin"))
    assert r.status_code == 400 and "used since" in r.json()["detail"]


def test_undo_top_up_keeps_the_pack(client, db, t):
    h = t["h"]
    pack = _added(client, h, t, accessory_item_id=t["pack"], qty="10")[0]["unit"]
    top = client.post(f"{TOOLS}/units/{pack['id']}/add", json={"qty": "4"}, headers=h).json()
    assert client.delete(f"{TOOLS}/movements/{top['movement_id']}", headers=h).status_code == 204
    assert Decimal(client.get(f"{TOOLS}/{pack['id']}", headers=h).json()["owned"]) == 10


# ── 6. Labels, access ───────────────────────────────────────────────────────

def test_scan_tool_labels(client, t):
    h = t["h"]
    unit = _added(client, h, t, accessory_item_id=t["piece"], count=1)[0]["unit"]
    assert tools.parse_tool_barcode(f" {unit['id']}*tl ") == unit["id"]
    assert tools.parse_tool_barcode(f"{unit['id']}*ACC") is None
    assert client.get(f"{TOOLS}/scan", params={"barcode": unit["barcode"]}, headers=h).json()["id"] == unit["id"]
    assert client.get(f"{TOOLS}/scan", params={"barcode": "12*ACC"}, headers=h).status_code == 400
    r = client.get("/api/v1/accessory-packs/scan", params={"barcode": unit["barcode"]}, headers=h)
    assert r.status_code == 400 and "returnable tool label" in r.json()["detail"]


def test_access_rules(client, auth_headers, t, monkeypatch):
    viewer = auth_headers(role="Viewer")
    assert client.get(f"{TOOLS}/summary", params={"warehouse_id": t["wh"].id}, headers=viewer).status_code == 200
    assert _add(client, viewer, t, accessory_item_id=t["piece"], count=1).status_code == 403
    assert _add(client, auth_headers(role="W_Worker"), t, accessory_item_id=t["piece"], count=1).status_code == 201
    assert client.get(f"{TOOLS}/summary", params={"warehouse_id": t["place"]["fab"].id},
                      headers=viewer).status_code == 400
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    assert client.get(f"{TOOLS}/summary", params={"warehouse_id": t["wh"].id}, headers=viewer).status_code == 404
