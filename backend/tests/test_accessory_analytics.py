"""Item 26: Accessory Analytics (`/api/v1/analytics/accessories/*`).

Every report is checked against numbers worked out by hand:
- stock flow: opening + received - issued + returned - supplier returns -
  written off + adjusted = closing, a reversed receive cancels out, closing =
  what the packs hold now; other warehouses / categories don't count
- issued to job orders: issued / returned / net per JO and item, client filter
- slow-moving: idle days from the last receipt / issue / return, or from the
  first pack when there was none (opening stock only)
- expected deliveries: open lines + over-received lines of closed deliveries
- the Excel workbook (sheets, Arabic right-to-left) and the access rules
- suppliers: the Supplier filter (packs / deliveries of one supplier), the
  received-by-supplier split, supplier codes on items, the filter's choices
"""
import io
from datetime import timedelta
from decimal import Decimal

from openpyxl import load_workbook
from sqlalchemy import text

from backend import models
from backend.core.config import settings
from backend.domains.posting import accessory as ledger
from backend.domains.posting.accessory import LedgerLine, NewPack
from backend.tests.test_accessory_issuing import _jo
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    _create,
    _supplier,
    accessories_on,
    setup,
)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)
from backend.tests.test_accessory_receive_packs import _delivery, _line

BASE = "/api/v1/analytics/accessories"


def _item(client, h, setup, **over):
    r = _create(client, h, setup, **over)
    assert r.status_code == 201, r.text
    return r.json()


def _today(db):
    return db.execute(text("SELECT (now() AT TIME ZONE 'Africa/Cairo')::date")).scalar()


def _backdate(db, posting, days, packs=()):
    when = posting.created_at - timedelta(days=days)
    posting.created_at = when
    for p in packs:
        p.created_at = when
    db.flush()


def _get(client, h, path, **params):
    r = client.get(f"{BASE}{path}", params=params, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _rows_by_item(rows):
    return {r["accessory_item_id"]: r for r in rows}


# ── Stock flow ───────────────────────────────────────────────────────────────

def test_stock_flow_matches_hand_calculation(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user("W_Worker")
    wh = place["acc"]
    item = _item(client, h, setup)["id"]
    quiet = _item(client, h, setup)["id"]                       # only old stock
    other_cat = _item(client, h, setup, category_id=setup["thr"].id, base_uom_id=setup["cone"].id)["id"]
    jo = _jo(db, None)

    opening, (pack,) = ledger.receive(db, user.id, wh.id, [NewPack(item, 100, rack_id=place["a1"].id)])
    _backdate(db, opening, 10, [pack])
    old, quiet_packs = ledger.receive(db, user.id, wh.id, [NewPack(quiet, 7)])
    _backdate(db, old, 10, quiet_packs)
    ledger.receive(db, user.id, wh.id, [NewPack(other_cat, 9)])
    ledger.receive(db, user.id, place["acc2"].id, [NewPack(item, 500)])     # another warehouse

    # In range (today): +20 received, a 10 received then undone, -30 issued,
    # +5 returned, -4 to the supplier, -2 written off, +3 adjusted
    ledger.receive(db, user.id, wh.id, [NewPack(item, 20)])
    undone, _ = ledger.receive(db, user.id, wh.id, [NewPack(item, 10)])
    ledger.reverse_posting(db, user.id, undone.id, "typed twice")
    ledger.issue(db, user.id, pack.id, 30, jo.job_order_id)
    ledger.return_to_pack(db, user.id, pack.id, 5, jo.job_order_id)
    ledger.post(db, user.id, [LedgerLine(pack.id, "supplier_return", Decimal("-4"))])
    ledger.post(db, user.id, [LedgerLine(pack.id, "write_off", Decimal("-2"))], reason="torn")
    ledger.post(db, user.id, [LedgerLine(pack.id, "adjustment", Decimal("3"))], reason="count")
    db.commit()

    today = _today(db)
    rows = _rows_by_item(_get(client, h, "/flow", warehouse_id=wh.id, date_from=str(today - timedelta(days=2)),
                              date_to=str(today), category_id=setup["cat"].id))
    assert set(rows) == {item, quiet}          # other category and the other warehouse don't count
    r = rows[item]
    got = {k: float(r[k]) for k in ("opening", "received", "issued", "returned", "supplier_returns",
                                     "written_off", "adjusted", "reclassified", "closing")}
    assert got == {"opening": 100, "received": 20, "issued": 30, "returned": 5, "supplier_returns": 4,
                   "written_off": 2, "adjusted": 3, "reclassified": 0, "closing": 92}
    assert r["uom_code"] == "QPC" and r["item_code"].startswith("GEN-QEL-")
    # Closing = what the packs hold now
    on_hand = db.execute(text("SELECT sum(on_hand) FROM wms.accessory_stock WHERE warehouse_id = :w "
                              "AND accessory_item_id = :i"), {"w": wh.id, "i": item}).scalar()
    assert float(on_hand) == 92
    assert float(rows[quiet]["opening"]) == 7 and float(rows[quiet]["closing"]) == 7 and rows[quiet]["entries"] == 0

    # A range that ends before today: only the opening receive
    before = _rows_by_item(_get(client, h, "/flow", warehouse_id=wh.id, date_to=str(today - timedelta(days=3))))
    assert float(before[item]["received"]) == 100 and float(before[item]["closing"]) == 100
    # No range: everything, from zero
    everything = _rows_by_item(_get(client, h, "/flow", warehouse_id=wh.id))[item]
    assert float(everything["opening"]) == 0 and float(everything["closing"]) == 92

    # Drill-down: the rows behind today's flow, oldest first (the undone receive and its reversal included)
    entries = _get(client, h, f"/flow/{item}/entries", warehouse_id=wh.id, date_from=str(today), date_to=str(today))
    assert [e["entry_type"] for e in entries] == [
        "receipt", "receipt", "receipt", "issue", "return", "supplier_return", "write_off", "adjustment",
    ]
    assert sum(Decimal(e["qty_delta"]) for e in entries) == Decimal("-8")


def test_flow_client_filter_and_reclassify(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user("W_Worker")
    wh = place["acc"]
    generic = _item(client, h, setup)["id"]
    owned = _item(client, h, setup, client_id=setup["client"].id)["id"]
    _, (gp,) = ledger.receive(db, user.id, wh.id, [NewPack(generic, 50)])
    _, (op,) = ledger.receive(db, user.id, wh.id, [NewPack(owned, 1)])
    # 10 of the generic stock dedicated to the client (reclassify pair)
    ledger.post(db, user.id, [LedgerLine(gp.id, "reclassify", Decimal("-10")),
                              LedgerLine(op.id, "reclassify", Decimal("10"))], reason="for client")
    db.commit()

    rows = _rows_by_item(_get(client, h, "/flow", warehouse_id=wh.id))
    assert float(rows[generic]["reclassified"]) == -10 and float(rows[generic]["closing"]) == 40
    assert float(rows[owned]["reclassified"]) == 10 and float(rows[owned]["closing"]) == 11
    assert rows[owned]["client_name"] == setup["client"].client_name
    only = _get(client, h, "/flow", warehouse_id=wh.id, client_id=setup["client"].id)
    assert [r["accessory_item_id"] for r in only] == [owned]


# ── Issued to job orders ─────────────────────────────────────────────────────

def test_issued_to_job_orders(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user("W_Worker")
    wh = place["acc"]
    a = _item(client, h, setup)["id"]
    b = _item(client, h, setup, category_id=setup["thr"].id, base_uom_id=setup["cone"].id)["id"]
    jo1 = _jo(db, setup["client"].client_id)
    jo2 = _jo(db, None)
    _, (pa, pb) = ledger.receive(db, user.id, wh.id, [NewPack(a, 100), NewPack(b, 20)])
    _, (other,) = ledger.receive(db, user.id, place["acc2"].id, [NewPack(a, 100)])
    ledger.issue(db, user.id, pa.id, 40, jo1.job_order_id)
    ledger.return_to_pack(db, user.id, pa.id, 6, jo1.job_order_id)
    ledger.issue(db, user.id, pb.id, 5, jo1.job_order_id)
    wrong = ledger.issue(db, user.id, pa.id, 9, jo2.job_order_id)
    ledger.reverse_posting(db, user.id, wrong.id, "wrong JO")        # nets out: JO 2 not listed
    ledger.issue(db, user.id, other.id, 50, jo2.job_order_id)        # another warehouse
    db.commit()

    jos = _get(client, h, "/job-orders", warehouse_id=wh.id)
    assert [j["job_order_id"] for j in jos] == [jo1.job_order_id]
    j = jos[0]
    assert j["client_name"] == setup["client"].client_name
    lines = _rows_by_item(j["lines"])
    assert (float(lines[a]["issued"]), float(lines[a]["returned"]), float(lines[a]["net"])) == (40, 6, 34)
    assert (float(lines[b]["issued"]), float(lines[b]["net"])) == (5, 5)
    assert {t["uom_code"]: float(t["net"]) for t in j["totals"]} == {"QPC": 34, "QCN": 5}   # never mixed

    assert _get(client, h, "/job-orders", warehouse_id=place["acc2"].id, client_id=setup["client"].client_id) == []
    today = _today(db)
    assert _get(client, h, "/job-orders", warehouse_id=wh.id, date_to=str(today - timedelta(days=1))) == []


# ── Slow-moving ──────────────────────────────────────────────────────────────

def test_slow_moving(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user("W_Worker")
    wh = place["acc"]
    idle = _item(client, h, setup)["id"]
    opening_only = _item(client, h, setup, client_id=setup["client"].id)["id"]
    busy = _item(client, h, setup)["id"]
    gone = _item(client, h, setup)["id"]
    jo = _jo(db, None)

    p1, packs1 = ledger.receive(db, user.id, wh.id, [NewPack(idle, 30, rack_id=place["a1"].id), NewPack(idle, 4)])
    _backdate(db, p1, 120, packs1)
    p2, packs2 = ledger.receive(db, user.id, wh.id, [NewPack(opening_only, 8)], opening=True)
    _backdate(db, p2, 95, packs2)
    p3, (busy_pack,) = ledger.receive(db, user.id, wh.id, [NewPack(busy, 10)])
    _backdate(db, p3, 200, [busy_pack])
    ledger.issue(db, user.id, busy_pack.id, 1, jo.job_order_id)       # moved today
    p4, (gone_pack,) = ledger.receive(db, user.id, wh.id, [NewPack(gone, 5)])
    _backdate(db, p4, 300, [gone_pack])
    ledger.post(db, user.id, [LedgerLine(gone_pack.id, "write_off", Decimal("-5"))], reason="lost")  # no stock left
    db.commit()

    rows = _get(client, h, "/slow-moving", warehouse_id=wh.id)
    assert [r["accessory_item_id"] for r in rows] == [idle, opening_only]     # longest idle first
    r = _rows_by_item(rows)
    assert r[idle]["idle_days"] >= 119 and float(r[idle]["on_hand"]) == 34 and r[idle]["pack_count"] == 2
    assert r[idle]["racks"] == [place["a1"].rack_code] and float(r[idle]["unracked"]) == 4
    assert r[idle]["last_movement"] is not None and r[idle]["generic"] is True
    # Opening stock isn't a movement: idle since its pack was made
    assert r[opening_only]["last_movement"] is None and r[opening_only]["idle_days"] >= 94
    assert r[opening_only]["generic"] is False

    assert [x["accessory_item_id"] for x in _get(client, h, "/slow-moving", warehouse_id=wh.id, days=100)] == [idle]
    assert _get(client, h, "/slow-moving", warehouse_id=wh.id, days=200) == []


# ── Expected deliveries ──────────────────────────────────────────────────────

def test_expected_deliveries(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user("W_Worker")
    wh, sup = place["acc"], setup["supplier"]
    item = _item(client, h, setup)["id"]
    waiting = _line(db, _delivery(db, wh, sup, days=1), item, 10)
    partial = _line(db, _delivery(db, wh, sup, status="partial"), item, 10)
    over = _line(db, _delivery(db, wh, sup, status="received"), item, 10)
    complete = _line(db, _delivery(db, wh, sup, status="received"), item, 10)
    cancelled = _line(db, _delivery(db, wh, sup, status="cancelled"), item, 10)
    ledger.receive(db, user.id, wh.id, [
        NewPack(item, 4, expected_delivery_item_id=partial.id),
        NewPack(item, 13, expected_delivery_item_id=over.id),
        NewPack(item, 10, expected_delivery_item_id=complete.id),
        NewPack(item, 12, expected_delivery_item_id=cancelled.id),
    ])
    db.commit()

    rows = _get(client, h, "/deliveries", warehouse_id=wh.id)
    by_line = {r["delivery_id"]: r for r in rows}
    assert set(by_line) == {waiting.delivery_id, partial.delivery_id, over.delivery_id}
    assert by_line[waiting.delivery_id]["state"] == "waiting" and float(by_line[waiting.delivery_id]["difference"]) == -10
    assert by_line[partial.delivery_id]["state"] == "partial" and float(by_line[partial.delivery_id]["received_qty"]) == 4
    assert by_line[over.delivery_id]["state"] == "over" and float(by_line[over.delivery_id]["difference"]) == 3
    assert by_line[over.delivery_id]["supplier_name"] == sup.name


# ── Excel ────────────────────────────────────────────────────────────────────

def _workbook(client, h, **params):
    r = client.get(f"{BASE}/export", params=params, headers=h)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats")
    return load_workbook(io.BytesIO(r.content))


def test_export_workbook(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="Viewer")
    user = make_user("W_Worker")
    wh = place["acc"]
    m = make_user("W_Manager")
    item = _create(client, auth_headers(user=m), setup).json()["id"]
    ledger.receive(db, user.id, wh.id, [NewPack(item, 25, rack_id=place["a1"].id)])
    db.commit()

    wb = _workbook(client, h, warehouse_id=wh.id)
    assert wb.sheetnames == ["Stock on hand", "Stock flow", "Issued to job orders", "Slow-moving stock",
                             "Expected vs received"]
    stock = wb["Stock on hand"]
    values = [[c.value for c in row] for row in stock.iter_rows()]
    header = next(i for i, row in enumerate(values) if row[0] == "Item code")
    assert values[header + 1][values[header].index("On hand")] == 25
    assert values[header + 2][0] == "Total (QPC)"
    assert not stock.sheet_view.rightToLeft

    ar = _workbook(client, h, warehouse_id=wh.id, sheets=["flow"], lang="ar")
    assert ar.sheetnames == ["حركة المخزون"] and ar["حركة المخزون"].sheet_view.rightToLeft

    r = client.get(f"{BASE}/export", params={"warehouse_id": wh.id, "sheets": ["nope"]}, headers=h)
    assert r.status_code == 422


# ── Access ───────────────────────────────────────────────────────────────────

def test_rules(client, auth_headers, place, monkeypatch):
    acc = place["acc"].id
    assert client.get(f"{BASE}/flow", params={"warehouse_id": acc}, headers=auth_headers(role="Viewer")).status_code == 200
    assert client.get(f"{BASE}/flow", params={"warehouse_id": acc},
                      headers=auth_headers(role="W_Worker")).status_code == 403      # no analytics permission
    h = auth_headers(role="W_Manager")
    assert client.get(f"{BASE}/flow", params={"warehouse_id": place["fab"].id}, headers=h).status_code == 400
    assert client.get(f"{BASE}/flow", params={"warehouse_id": acc, "date_from": "2026-11-10",
                                              "date_to": "2026-11-01"}, headers=h).status_code == 422
    assert client.get(f"{BASE}/slow-moving", params={"warehouse_id": acc, "days": 0}, headers=h).status_code == 422
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    assert client.get(f"{BASE}/flow", params={"warehouse_id": acc}, headers=h).status_code == 404


# ── Suppliers ────────────────────────────────────────────────────────────────

def test_supplier_filter_split_and_codes(client, auth_headers, db, setup, place, make_user):
    h = auth_headers(role="W_Manager")
    user = make_user("W_Worker")
    wh = place["acc"]
    ykk, coats = setup["supplier"], _supplier(db, "pytest_analytics_coats")
    item = _item(client, h, setup, refs=[{"supplier_id": ykk.id, "ref_code": "YKK-5"}])["id"]
    by = lambda s: {"supplier_type": "logical_location", "client_supplier_id": s.id}  # noqa: E731
    ledger.receive(db, user.id, wh.id, [NewPack(item, 30, **by(ykk)), NewPack(item, 10, **by(ykk))])
    ledger.receive(db, user.id, wh.id, [NewPack(item, 7, **by(coats))])
    ledger.receive(db, user.id, wh.id, [NewPack(item, 5)])                                  # no supplier
    ledger.receive(db, user.id, wh.id, [NewPack(item, 100)], opening=True)                  # opening: not received
    _line(db, _delivery(db, wh, coats), item, 50)
    _line(db, _delivery(db, wh, ykk), item, 9)
    db.commit()

    row = _rows_by_item(_get(client, h, "/flow", warehouse_id=wh.id))[item]
    assert float(row["received"]) == 52
    assert [(x["supplier_name"], float(x["qty"])) for x in row["received_by_supplier"]] == [
        (ykk.name, 40), (coats.name, 7), (None, 5)]
    assert row["supplier_refs"] == [{"supplier_id": ykk.id, "supplier_name": ykk.name, "ref_code": "YKK-5"}]

    only = f"logical_location:{coats.id}"
    row = _rows_by_item(_get(client, h, "/flow", warehouse_id=wh.id, supplier=only))[item]
    assert (float(row["received"]), float(row["adjusted"]), float(row["closing"])) == (7, 0, 7)
    entries = _get(client, h, f"/flow/{item}/entries", warehouse_id=wh.id)
    assert {e["supplier_name"] for e in entries} == {ykk.name, coats.name, None}
    assert [e["supplier_name"] for e in _get(client, h, f"/flow/{item}/entries", warehouse_id=wh.id,
                                              supplier=only)] == [coats.name]
    assert [r["supplier_name"] for r in _get(client, h, "/deliveries", warehouse_id=wh.id, supplier=only)] == [coats.name]
    slow = _get(client, h, "/slow-moving", warehouse_id=wh.id, days=1, supplier=only)
    assert slow == []                                    # received today
    names = [s["name"] for s in _get(client, h, "/suppliers", warehouse_id=wh.id)]
    assert names == sorted([ykk.name, coats.name], key=str.lower)

    wb = _workbook(client, h, warehouse_id=wh.id, sheets=["flow"], supplier=only)
    values = [[c.value for c in r] for r in wb.active.iter_rows()]
    assert [coats.name] in [[v for v in r if v is not None][1:] for r in values if r[0] == "Supplier"]
    header = next(r for r in values if r[0] == "Item code")
    first = values[values.index(header) + 1]
    assert first[header.index("Supplier codes")] == f"{ykk.name}: YKK-5"
    assert first[header.index("Received by supplier")] == f"{coats.name}: 7"

    bad = client.get(f"{BASE}/flow", params={"warehouse_id": wh.id, "supplier": "vendor:1"}, headers=h)
    assert bad.status_code == 422
