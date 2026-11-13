"""Item 14: the stock view, the Accessory Inventory roll-ups, and the ledger
invariants (Development flow: "stock never negative; ledger item matches pack
item; issues and returns carry a JO; reversals net to zero; stock view equals
the ledger sum", run on every pull request).

1. `check_invariants(db)` checks all of them with plain SQL over the whole
   database, so it also catches rows written around the posting service.
   Later items (issuing, returns, adjustments, opening balance) can call it
   after their own scenarios.
2. It runs after a scripted scenario and after ~200 random operations (some
   refused on purpose), whose result is also compared with a hand-kept tally.
3. Roll-ups by item / client / rack and the pack list filters, through the API.
"""
import random
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text

from backend import models
from backend.core.config import settings
from backend.domains.posting import accessory as ledger
from backend.domains.posting.accessory import NewPack
from backend.tests.test_accessory_items import _create, accessories_on, setup  # noqa: F401  (fixtures)
from backend.tests.test_accessory_ledger import stock  # noqa: F401  (fixture)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)

PACKS = "/api/v1/accessory-packs/"
STOCK = "/api/v1/accessory-packs/stock"

# Each query returns the rows that break one rule; all must come back empty.
INVARIANTS = {
    "view has one row per pack": """
        SELECT p.id FROM wms.accessory_packs p
        LEFT JOIN wms.accessory_stock s ON s.pack_id = p.id
        WHERE s.pack_id IS NULL""",
    "view on_hand = ledger sum": """
        SELECT s.pack_id FROM wms.accessory_stock s
        LEFT JOIN (SELECT pack_id, SUM(qty_delta) AS total FROM wms.accessory_ledger GROUP BY pack_id) l
               ON l.pack_id = s.pack_id
        WHERE s.on_hand <> COALESCE(l.total, 0)""",
    "a pack never below zero (running balance)": """
        SELECT pack_id, id FROM (
            SELECT pack_id, id, SUM(qty_delta) OVER (PARTITION BY pack_id ORDER BY id) AS balance
            FROM wms.accessory_ledger) x
        WHERE balance < 0""",
    "ledger item = pack item": """
        SELECT l.id FROM wms.accessory_ledger l
        JOIN wms.accessory_packs p ON p.id = l.pack_id
        WHERE l.accessory_item_id <> p.accessory_item_id""",
    "issue / return carry a job order": """
        SELECT id FROM wms.accessory_ledger
        WHERE entry_type IN ('issue', 'return') AND job_order_id IS NULL""",
    "a reversal row exactly cancels its row": """
        SELECT r.id FROM wms.accessory_ledger r
        JOIN wms.accessory_ledger o ON o.id = r.reversal_of
        WHERE r.qty_delta <> -o.qty_delta OR r.pack_id <> o.pack_id OR r.entry_type <> o.entry_type""",
    "a reversed posting + its reversal net to zero per pack": """
        SELECT rv.id, l.pack_id FROM wms.accessory_postings rv
        JOIN wms.accessory_ledger l ON l.posting_id IN (rv.id, rv.reverses_posting_id)
        WHERE rv.reverses_posting_id IS NOT NULL
        GROUP BY rv.id, l.pack_id HAVING SUM(l.qty_delta) <> 0""",
    "every row of a reversal posting points at the row it cancels": """
        SELECT l.id FROM wms.accessory_ledger l
        JOIN wms.accessory_postings p ON p.id = l.posting_id
        WHERE p.reverses_posting_id IS NOT NULL AND l.reversal_of IS NULL""",
    "status empty exactly at zero": """
        SELECT pack_id FROM wms.accessory_stock
        WHERE (status = 'empty') <> (on_hand = 0)""",
}


def check_invariants(db) -> None:
    db.flush()
    broken = {}
    for rule, sql in INVARIANTS.items():
        rows = db.execute(text(sql)).all()
        if rows:
            broken[rule] = rows[:5]
    # The ORM's AccessoryPack.quantity (what the API shows) = the view.
    view = dict(db.execute(select(models.accessory_stock.c.pack_id, models.accessory_stock.c.on_hand)).all())
    for pack in db.scalars(select(models.AccessoryPack)).all():
        db.refresh(pack)
        if pack.quantity != view[pack.id]:
            broken.setdefault("pack.quantity = view", []).append(pack.id)
    assert not broken, f"Ledger invariants broken: {broken}"


def _view_qty(db, pack_id) -> Decimal:
    c = models.accessory_stock.c
    return db.scalar(select(c.on_hand).where(c.pack_id == pack_id))


# ── 1. The view and the invariants after a scripted scenario ────────────────

def test_view_follows_the_ledger_through_every_kind_of_posting(db, stock):
    s, u = stock, stock["user"].id
    _, (a, b) = ledger.receive(db, u, s["wh"].id, [NewPack(s["item"], 100), NewPack(s["item"], "10.5")])
    db.commit()
    assert _view_qty(db, a.id) == Decimal("100") and _view_qty(db, b.id) == Decimal("10.5")

    ledger.issue(db, u, a.id, 30, s["jo"])
    ledger.return_to_pack(db, u, a.id, 5, s["jo"])
    t = ledger.transfer(db, u, a.id, b.id, 75)       # A 0 → empty, B 85.5
    db.commit()
    assert _view_qty(db, a.id) == Decimal("0")
    row = db.execute(select(models.accessory_stock).where(models.accessory_stock.c.pack_id == a.id)).one()
    assert row.status == "empty" and row.accessory_item_id == s["item"] and row.warehouse_id == s["wh"].id
    check_invariants(db)

    ledger.reverse_posting(db, u, t.id, "wrong pack")  # A 75 again, B 10.5
    db.commit()
    assert _view_qty(db, a.id) == Decimal("75") and _view_qty(db, b.id) == Decimal("10.5")
    check_invariants(db)


def test_checker_catches_a_row_written_around_the_service(db, stock):
    """A bad row inserted directly (skipping the posting service, which the
    database's own CHECKs don't forbid: an adjustment that drives the pack
    negative) is reported."""
    s, u = stock, stock["user"].id
    _, (a,) = ledger.receive(db, u, s["wh"].id, [NewPack(s["item"], 5)])
    db.commit()
    posting = models.AccessoryPosting(created_by=u, reason="pytest bypass")
    db.add(posting)
    db.flush()
    db.add(models.AccessoryLedgerEntry(posting_id=posting.id, pack_id=a.id, accessory_item_id=s["item"],
                                       entry_type="adjustment", qty_delta=Decimal("-8")))
    db.flush()
    with pytest.raises(AssertionError) as e:
        check_invariants(db)
    assert "never below zero" in str(e.value)


# ── 2. Random operations against a hand-kept tally ──────────────────────────

def test_random_operations_keep_every_invariant(db, stock):
    s, u = stock, stock["user"].id
    rng = random.Random(14)
    expected: dict = {}                     # pack id → quantity we expect
    item_of: dict = {}
    postings: list = []
    refused = 0

    def attempt(op):
        nonlocal refused
        sp = db.begin_nested()
        try:
            result = op()
        except HTTPException:
            sp.rollback()
            refused += 1
            return None
        sp.commit()
        return result

    for _ in range(200):
        kind = rng.choice(["receive", "issue", "issue", "return", "transfer", "reverse"])
        packs = list(expected)
        if kind == "receive" or not packs:
            item = rng.choice([s["item"], s["other"]])
            qty = Decimal(rng.randint(1, 400)) / 4
            made = attempt(lambda: ledger.receive(db, u, s["wh"].id, [NewPack(item, qty)]))
            if made:
                posting, (pack,) = made
                expected[pack.id], item_of[pack.id] = qty, item
                postings.append(posting.id)
        elif kind in ("issue", "return"):
            pack = rng.choice(packs)
            qty = Decimal(rng.randint(1, 200)) / 4   # sometimes more than the pack holds
            fn = ledger.issue if kind == "issue" else ledger.return_to_pack
            posting = attempt(lambda: fn(db, u, pack, qty, s["jo"]))
            if posting:
                expected[pack] += qty if kind == "return" else -qty
                postings.append(posting.id)
        elif kind == "transfer":
            src, dst = rng.choice(packs), rng.choice(packs)  # sometimes the same pack / another item
            qty = Decimal(rng.randint(1, 100)) / 4
            posting = attempt(lambda: ledger.transfer(db, u, src, dst, qty))
            if posting:
                expected[src] -= qty
                expected[dst] += qty
                postings.append(posting.id)
        elif postings:
            target = rng.choice(postings)  # sometimes already reversed, or stock used since
            rev = attempt(lambda: ledger.reverse_posting(db, u, target, "pytest random"))
            if rev:
                for entry in rev.entries:
                    expected[entry.pack_id] += entry.qty_delta
    db.commit()

    assert refused > 0, "the run should include refused operations"
    assert len(postings) > 50
    check_invariants(db)
    for pack_id, qty in expected.items():
        assert _view_qty(db, pack_id) == qty, pack_id
        assert db.get(models.AccessoryPack, pack_id).accessory_item_id == item_of[pack_id]


# ── 3. Roll-ups and filters through the API ─────────────────────────────────

@pytest.fixture
def shelves(client, auth_headers, setup, stock, db):
    """In the Accessory warehouse:
    - generic item G (pieces): 100 on rack A1, 50 waiting for put-away, one empty pack on A1
    - client item C (pieces): 30 on A2
    - client item T (cones): 12 on A2
    and 999 of G in the second Accessory warehouse (never counted)."""
    s, u, p = stock, stock["user"].id, stock["place"]
    h = auth_headers(role="W_Manager")
    c_item = _create(client, h, setup, client_id=setup["client"].id, description="Label woven").json()["id"]
    t_item = _create(client, h, setup, client_id=setup["client"].id, category_id=setup["thr"].id,
                     base_uom_id=setup["cone"].id, description="Thread 40/2").json()["id"]
    g = s["item"]
    _, (g1, g2, g3, c1, t1) = ledger.receive(db, u, s["wh"].id, [
        NewPack(g, 100, rack_id=p["a1"].id), NewPack(g, 50), NewPack(g, 7, rack_id=p["a1"].id),
        NewPack(c_item, 30, rack_id=p["a2"].id), NewPack(t_item, 12, rack_id=p["a2"].id),
    ])
    ledger.issue(db, u, g3.id, 7, s["jo"])  # empty
    ledger.receive(db, u, p["acc2"].id, [NewPack(g, 999)])
    db.commit()
    return {"g": g, "c": c_item, "t": t_item, "wh": s["wh"].id, "a1": p["a1"], "a2": p["a2"],
            "client": setup["client"], "h": h, "empty": g3.id, "packs": [g1.id, g2.id, c1.id, t1.id]}


def _get(client, h, url, **params):
    r = client.get(url, params=params, headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _totals(row) -> dict:
    return {t["uom_code"]: Decimal(t["qty"]) for t in row["totals"]}


def test_by_item(client, shelves, setup):
    f = shelves
    page = _get(client, f["h"], STOCK, warehouse_id=f["wh"], group_by="item")
    rows = {r["key"]: r for r in page["items"]}
    assert page["total"] == 3 and set(rows) == {f["g"], f["c"], f["t"]}
    assert _totals(rows[f["g"]]) == {"QPC": Decimal("150")} and rows[f["g"]]["pack_count"] == 2
    assert rows[f["g"]]["client_name"] is None and rows[f["g"]]["code"].startswith("GEN-")
    assert _totals(rows[f["t"]]) == {"QCN": Decimal("12")}
    assert rows[f["c"]]["client_name"] == setup["client"].client_name
    assert [r["code"] for r in page["items"]] == sorted(r["code"] for r in page["items"])
    # Empty packs on request: G then has 3 packs, same total.
    with_empty = _get(client, f["h"], STOCK, warehouse_id=f["wh"], group_by="item", include_empty=True)
    g_row = next(r for r in with_empty["items"] if r["key"] == f["g"])
    assert g_row["pack_count"] == 3 and _totals(g_row) == {"QPC": Decimal("150")}


def test_by_item_folds_variants_under_their_template(client, shelves, setup, stock, db):
    """group_variants: one row per template summing its variants (paged and
    counted as one row); template_id lists the variants themselves."""
    from backend.tests.test_accessory_variants import _template, _variant

    f = shelves
    tpl = _template(client, f["h"], setup)
    navy = _variant(client, f["h"], tpl["id"], {"price": "1.50"}, color="Navy").json()
    red = _variant(client, f["h"], tpl["id"], {"price": "1.50"}, color="Red").json()
    _variant(client, f["h"], tpl["id"], {"price": "1.50"}, color="Olive")  # no stock: not counted
    ledger.receive(db, stock["user"].id, f["wh"], [NewPack(navy["id"], 40), NewPack(navy["id"], 5), NewPack(red["id"], 20)])
    db.commit()

    folded = _get(client, f["h"], STOCK, warehouse_id=f["wh"], group_by="item", group_variants=True)
    rows = {r["key"]: r for r in folded["items"]}
    assert folded["total"] == 4 and set(rows) == {f["g"], f["c"], f["t"], tpl["id"]}
    t_row = rows[tpl["id"]]
    assert t_row["code"] == tpl["code"] and t_row["variant_count"] == 2 and t_row["item_count"] == 2
    assert t_row["pack_count"] == 3 and _totals(t_row) == {"QPC": Decimal("65")}
    assert rows[f["g"]]["variant_count"] == 0

    # flat (default) and a chosen template both list the variants
    flat = _get(client, f["h"], STOCK, warehouse_id=f["wh"], group_by="item")
    assert {navy["id"], red["id"]} <= {r["key"] for r in flat["items"]}
    opened = _get(client, f["h"], STOCK, warehouse_id=f["wh"], group_by="item", group_variants=True, template_id=tpl["id"])
    assert {r["key"]: _totals(r)["QPC"] for r in opened["items"]} == {navy["id"]: 45, red["id"]: 20}
    # a search that matches one variant folds to its template with only that variant
    red_only = _get(client, f["h"], STOCK, warehouse_id=f["wh"], group_by="item", group_variants=True, color="red")
    assert [(r["key"], r["variant_count"]) for r in red_only["items"]] == [(tpl["id"], 1)]


def test_by_client_keeps_units_apart(client, shelves):
    f = shelves
    rows = _get(client, f["h"], STOCK, warehouse_id=f["wh"], group_by="client")["items"]
    assert [r["key"] for r in rows] == [None, f["client"].client_id]  # generic first
    generic, own = rows
    assert _totals(generic) == {"QPC": Decimal("150")} and generic["item_count"] == 1
    assert _totals(own) == {"QCN": Decimal("12"), "QPC": Decimal("30")}
    assert own["item_count"] == 2 and own["pack_count"] == 2 and own["name"] == f["client"].client_name


def test_by_rack_with_waiting_for_putaway_first(client, shelves):
    f = shelves
    rows = _get(client, f["h"], STOCK, warehouse_id=f["wh"], group_by="rack")["items"]
    assert [r["key"] for r in rows] == [None, f["a1"].id, f["a2"].id]
    assert _totals(rows[0]) == {"QPC": Decimal("50")}
    assert rows[1]["code"] == f["a1"].rack_code and _totals(rows[1]) == {"QPC": Decimal("100")}
    assert _totals(rows[2]) == {"QCN": Decimal("12"), "QPC": Decimal("30")}


def test_filters_and_paging(client, shelves):
    f = shelves
    def keys(**p):
        return [r["key"] for r in _get(client, f["h"], STOCK, warehouse_id=f["wh"], **p)["items"]]
    assert set(keys(client_id=f["client"].client_id)) == {f["c"], f["t"]}
    assert keys(generic=True) == [f["g"]]
    assert set(keys(rack_id=f["a2"].id)) == {f["c"], f["t"]}
    assert keys(unracked=True) == [f["g"]]
    assert keys(q="thread 40") == [f["t"]]
    assert keys(q="nothing-like-this") == []
    page = _get(client, f["h"], STOCK, warehouse_id=f["wh"], limit=2, offset=2)
    assert page["total"] == 3 and len(page["items"]) == 1


def test_advanced_item_filters(client, shelves, setup, db):
    """The Items page's advanced fields narrow stock and packs the same way;
    an item switched off still shows while it has stock."""
    f = shelves
    def keys(**p):
        return {r["key"] for r in _get(client, f["h"], STOCK, warehouse_id=f["wh"], **p)["items"]}
    def packs(**p):
        return {x["id"] for x in _get(client, f["h"], PACKS, warehouse_id=f["wh"], **p)["items"]}
    assert keys(base_uom_id=setup["cone"].id) == {f["t"]}
    assert keys(category_id=setup["cat"].id) == {f["g"], f["c"]}
    assert keys(description="woven") == {f["c"]}
    assert keys(code="GEN-") == {f["g"]}
    c_ref = db.scalar(select(models.AccessoryItemRef.ref_code).where(models.AccessoryItemRef.accessory_item_id == f["c"]))
    assert keys(ref_code=c_ref) == {f["c"]}
    assert keys(ref_supplier_id=setup["supplier"].id) == {f["g"], f["c"], f["t"]}
    assert keys(ref_client_id=setup["client"].client_id) == set()
    assert keys(category_id=setup["cat"].id, client_id=f["client"].client_id) == {f["c"]}
    assert packs(base_uom_id=setup["cone"].id) == {f["packs"][3]}
    assert keys(group_by="rack", description="thread") == {f["a2"].id}

    db.get(models.AccessoryItem, f["g"]).active = False
    db.commit()
    assert f["g"] in keys(code="GEN-")


def test_pack_list_filters_and_display_fields(client, shelves):
    f = shelves
    def ids(**p):
        return {x["id"] for x in _get(client, f["h"], PACKS, warehouse_id=f["wh"], **p)["items"]}
    assert ids(client_id=f["client"].client_id) == set(f["packs"][2:])
    assert ids(generic=True, status="active") == set(f["packs"][:2])
    assert f["empty"] in ids(generic=True)
    assert ids(q="label woven") == {f["packs"][2]}
    pack = _get(client, f["h"], f"{PACKS}{f['packs'][3]}")
    assert pack["uom_code"] == "QCN" and pack["client_id"] == f["client"].client_id
    assert Decimal(pack["quantity"]) == Decimal("12")


def test_history_shows_names(client, shelves, stock):
    f = shelves
    hist = _get(client, f["h"], f"{PACKS}{f['empty']}/ledger")
    assert [e["entry_type"] for e in hist] == ["receipt", "issue"]
    assert hist[0]["created_by_name"] == stock["user"].username
    assert hist[1]["job_order_number"].startswith("pytest-ledger-jo-")


def test_any_role_reads_and_flag_off_hides(client, auth_headers, shelves, monkeypatch):
    f = shelves
    viewer = auth_headers(role="Viewer")
    assert client.get(STOCK, params={"warehouse_id": f["wh"]}, headers=viewer).status_code == 200
    assert client.get(STOCK, params={"group_by": "shelf"}, headers=viewer).status_code == 422
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    assert client.get(STOCK, headers=viewer).status_code == 404
