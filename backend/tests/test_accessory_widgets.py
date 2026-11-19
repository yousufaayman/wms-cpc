"""Item 24: the Accessory dashboard widgets' read endpoints.

- `GET /accessory-packs/lookup` (Trim Code Lookup): finds items by **our code
  or a reference code only** (a description doesn't match), with on hand /
  packs / waiting for put-away in this warehouse; a template sums its variants
- `GET /accessory-packs/attention` (Needs Attention): four counts checked
  against a hand-built warehouse (other warehouses and old closed deliveries
  don't count)
- `GET /accessory-requirements/open-job-orders` (Job Order Balances): open
  JOs with lines still to issue, most urgent first; needs `operations`
Shortages reuses the item-20 endpoint (tested in test_accessory_issuing.py).
"""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from backend import models
from backend.domains.posting import accessory as ledger
from backend.domains.posting.accessory import NewPack
from backend.tests.test_accessory_issuing import _jo, _req
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    _create,
    accessories_on,
    setup,
)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)
from backend.tests.test_accessory_receive_packs import _delivery, _line

PACKS = "/api/v1/accessory-packs"
OPEN_JOS = "/api/v1/accessory-requirements/open-job-orders"


def _item(client, h, setup, **over):
    r = _create(client, h, setup, **over)
    assert r.status_code == 201, r.text
    return r.json()


def _lookup(client, h, wh, code):
    r = client.get(f"{PACKS}/lookup", params={"warehouse_id": wh.id, "code": code}, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


# ── Trim Code Lookup ────────────────────────────────────────────────────────

def test_lookup_by_code_or_reference_only(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    item = _item(client, h, setup, description="Zipper pull ZX",
                 refs=[{"client_id": setup["client"].id, "ref_code": "CL-00567"}])
    user = make_user("W_Worker")
    ledger.receive(db, user.id, place["acc"].id, [
        NewPack(item["id"], 30, rack_id=place["a1"].id), NewPack(item["id"], 12),  # 12 waiting for put-away
    ])
    ledger.receive(db, user.id, place["acc2"].id, [NewPack(item["id"], 99)])  # another warehouse
    db.commit()

    by_code = _lookup(client, h, place["acc"], item["code"].lower())
    assert [r["accessory_item_id"] for r in by_code] == [item["id"]]
    row = by_code[0]
    assert float(row["on_hand"]) == 42 and row["pack_count"] == 2 and float(row["unracked"]) == 12
    assert row["uom_code"] == "QPC" and row["active"] is True and row["is_template"] is False
    assert {"ref_code": "CL-00567", "party": "client", "party_name": setup["client"].client_name} in row["refs"]

    # A reference typed without its dash still finds it (normalized)
    assert [r["accessory_item_id"] for r in _lookup(client, h, place["acc"], "cl 00567")] == [item["id"]]
    # The description is not a lookup field
    assert _lookup(client, h, place["acc"], "Zipper pull") == []
    # The client code as typed finds the same item; an item with nothing here is found, with 0
    assert float(_lookup(client, h, place["acc"], "CL-00567")[0]["on_hand"]) == 42
    other = _item(client, h, setup)
    none_here = _lookup(client, h, place["acc"], other["code"])[0]
    assert float(none_here["on_hand"]) == 0 and none_here["pack_count"] == 0


def test_lookup_template_sums_its_variants(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    base = _item(client, h, setup, description="Button 4 holes",
                 refs=[{"supplier_id": setup["supplier"].id, "ref_code": "SUP-BTN-9"}])
    r = client.post(f"/api/v1/accessory-items/{base['id']}/variants", json={"color": "Black"}, headers=h)
    assert r.status_code == 201, r.text
    black = r.json()["id"]
    white = client.post(f"/api/v1/accessory-items/{base['id']}/variants", json={"color": "White"}, headers=h).json()["id"]
    user = make_user("W_Worker")
    ledger.receive(db, user.id, place["acc"].id, [NewPack(black, 10), NewPack(white, 5, rack_id=place["a1"].id)])
    db.commit()

    rows = {r["accessory_item_id"]: r for r in _lookup(client, h, place["acc"], "SUP-BTN-9")}
    # The template's supplier code finds the template and (inherited) its variants
    assert set(rows) == {base["id"], black, white}
    assert rows[base["id"]]["is_template"] is True
    assert float(rows[base["id"]]["on_hand"]) == 15 and rows[base["id"]]["pack_count"] == 2
    assert float(rows[base["id"]]["unracked"]) == 10
    assert float(rows[black]["on_hand"]) == 10 and rows[black]["refs"][0]["party"] == "supplier"
    assert rows[black]["refs"][0]["party_name"] == setup["supplier"].name


def test_lookup_rules(client, auth_headers, place, setup):
    viewer = auth_headers(role="Viewer")
    assert client.get(f"{PACKS}/lookup", params={"warehouse_id": place["acc"].id, "code": "x"},
                      headers=viewer).status_code == 200  # every WMS role may look up
    h = auth_headers(role="W_Manager")
    assert client.get(f"{PACKS}/lookup", params={"warehouse_id": place["fab"].id, "code": "x"},
                      headers=h).status_code == 400  # not an Accessory warehouse
    assert client.get(f"{PACKS}/lookup", params={"warehouse_id": place["acc"].id, "code": ""},
                      headers=h).status_code == 422


# ── Needs Attention ─────────────────────────────────────────────────────────

def test_attention_counts(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    item = _item(client, h, setup)
    wh, sup = place["acc"], setup["supplier"]
    user = make_user("W_Worker")

    over = _line(db, _delivery(db, wh, sup, status="partial"), item["id"], 10)
    short = _line(db, _delivery(db, wh, sup), item["id"], 10)
    old_short_delivery = _delivery(db, wh, sup)
    old_short = _line(db, old_short_delivery, item["id"], 10)
    other_wh = _line(db, _delivery(db, place["acc2"], sup), item["id"], 1)
    ledger.receive(db, user.id, wh.id, [
        NewPack(item["id"], 12, rack_id=place["a1"].id, expected_delivery_item_id=over.id),   # over-received
        NewPack(item["id"], 4, rack_id=place["a1"].id, expected_delivery_item_id=short.id),   # short
        NewPack(item["id"], 4, rack_id=place["a1"].id, expected_delivery_item_id=old_short.id),
        NewPack(item["id"], 7),                                                               # unracked
        NewPack(item["id"], 3),                                                               # unracked
    ])
    ledger.receive(db, user.id, place["acc2"].id, [NewPack(item["id"], 5, expected_delivery_item_id=other_wh.id)])
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    short.delivery.status, short.delivery.closed_at = "received", now                       # closed short, recent
    old_short_delivery.status, old_short_delivery.closed_at = "received", now - timedelta(days=45)  # too old
    db.commit()

    r = client.get(f"{PACKS}/attention", params={"warehouse_id": wh.id}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json() == {"unracked_packs": 2, "over_received": 1, "closed_short": 1,
                        "over_issue_receipts": 0, "days": 30}

    # An open issue with an over-issue line counts; once confirmed it doesn't
    line = models.LogicalLocation(name="pytest_widget_line", location_type="production_line")
    db.add(line)
    jo = _jo(db, None)
    _req(db, jo, item["id"], 1)
    db.commit()
    rid = client.post("/api/v1/internal-receipts/", json={
        "source_warehouse_id": wh.id, "target_logical_location_id": line.id, "job_order_id": jo.job_order_id,
    }, headers=h).json()["id"]
    pack = db.query(models.AccessoryPack).filter_by(warehouse_id=wh.id, rack_id=None).first()
    r = client.post(f"/api/v1/receipts/internal/{rid}/accessory-items",
                    json={"pack_id": pack.id, "qty": "3", "over_issue_reason": "Rework"}, headers=h)
    assert r.status_code == 201, r.text
    counts = client.get(f"{PACKS}/attention", params={"warehouse_id": wh.id}, headers=h).json()
    assert counts["over_issue_receipts"] == 1
    assert client.post(f"/api/v1/internal-receipts/{rid}/confirm", headers=h).status_code == 200
    assert client.get(f"{PACKS}/attention", params={"warehouse_id": wh.id}, headers=h).json()["over_issue_receipts"] == 0

    assert client.get(f"{PACKS}/attention", params={"warehouse_id": place["fab"].id}, headers=h).status_code == 400


# ── Job Order Balances ──────────────────────────────────────────────────────

def test_open_job_orders(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    a = _item(client, h, setup)["id"]
    b = _item(client, h, setup)["id"]
    urgent = _jo(db, setup["client"].client_id)
    urgent.priority = 1
    later = _jo(db, None)
    later.priority = 5
    done = _jo(db, None)
    archived = _jo(db, None, archived=True)
    over_line = _req(db, urgent, a, 5)
    _req(db, urgent, b, 10)
    _req(db, later, a, 2)
    done_line = _req(db, done, a, 3)
    _req(db, archived, a, 4)
    user = make_user("W_Worker")
    _, (pack,) = ledger.receive(db, user.id, place["acc"].id, [NewPack(a, 50)])
    ledger.post(db, user.id, [
        ledger.LedgerLine(pack.id, "issue", Decimal(-8), job_order_id=urgent.job_order_id, jo_requirement_id=over_line.id),
        ledger.LedgerLine(pack.id, "issue", Decimal(-3), job_order_id=done.job_order_id, jo_requirement_id=done_line.id),
    ])
    db.commit()

    r = client.get(OPEN_JOS, params={"warehouse_id": place["acc"].id}, headers=auth_headers(role="W_Worker"))
    assert r.status_code == 200, r.text
    rows = [row for row in r.json() if row["job_order_id"] in {urgent.job_order_id, later.job_order_id,
                                                                done.job_order_id, archived.job_order_id}]
    assert [row["job_order_id"] for row in rows] == [urgent.job_order_id, later.job_order_id]
    first = rows[0]
    assert first["lines"] == 2 and first["lines_to_issue"] == 1 and first["lines_over_issued"] == 1
    assert first["client_name"] == setup["client"].client_name and first["priority"] == 1

    assert client.get(OPEN_JOS, params={"warehouse_id": place["acc"].id},
                      headers=auth_headers(role="Viewer")).status_code == 403
    assert client.get(OPEN_JOS, params={"warehouse_id": place["fab"].id}, headers=h).status_code == 400


def test_widget_endpoints_off_with_the_flag(client, auth_headers, place, monkeypatch):
    from backend.core.config import settings

    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    h = auth_headers(role="W_Manager")
    for url, params in ((f"{PACKS}/lookup", {"code": "x"}), (f"{PACKS}/attention", {}), (OPEN_JOS, {})):
        assert client.get(url, params={"warehouse_id": place["acc"].id, **params}, headers=h).status_code == 404
