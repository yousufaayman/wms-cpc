"""Item 13: the accessory ledger and its posting service.

What these tests prove (Tab 1 Phase 2 exit criteria + Development flow
"ledger invariants"):
1. Receive, issue, return, transfer and reversal, with every pack total
   checked against a hand calculation.
2. The rules: a pack never goes below zero (and a refused posting writes
   nothing); issue / return need a job order; adjustments / write-offs need a
   reason; signs per entry type; a pack goes empty at 0 and active again.
3. Reversals: opposite rows linked to the rows they cancel, net to zero,
   only once, not of a reversal, not when the stock was used since.
4. The database guards on their own (direct inserts that skip the service):
   ledger item = pack item, JO on issue, sign, one reversal per row.
5. The API: pack quantity + history, read a posting, reversal admin-only,
   everything 404 while accessories are switched off.
6. Receipts: a posted accessory line can't be deleted; reversing the
   receipt reverses its postings.
"""
import itertools
from datetime import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from backend import models
from backend.core.config import settings
from backend.crud import receipt_items
from backend.domains.posting import accessory as ledger
from backend.domains.posting import service as posting_service
from backend.domains.posting.accessory import LedgerLine, NewPack
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    _create,
    accessories_on,
    setup,
)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)

PACKS = "/api/v1/accessory-packs/"
POSTINGS = "/api/v1/accessory-postings/"
_seq = itertools.count(1)


# ── Helpers ──────────────────────────────────────────────────────────────────

@pytest.fixture
def stock(client, auth_headers, setup, place, db, make_user):
    """One plain item, a second item, a job order of the item's (generic)
    client, a worker, and the Accessory warehouse."""
    h = auth_headers(role="W_Manager")
    item = _create(client, h, setup).json()
    other = _create(client, h, setup, description="Button 15 mm").json()
    style = models.Model(model_name=f"pytest_ledger_model_{next(_seq)}")
    db.add(style)
    db.flush()
    jo = models.JobOrder(job_order_number=f"pytest-ledger-jo-{next(_seq)}", client_id=setup["client"].client_id,
                         model_id=style.model_id, date_created=datetime.now())
    db.add(jo)
    db.flush()
    return {"item": item["id"], "other": other["id"], "jo": jo.job_order_id, "user": make_user("W_Worker"),
            "wh": place["acc"], "place": place}


def _receive(db, s, *qtys, item=None):
    posting, made = ledger.receive(db, s["user"].id, s["wh"].id, [NewPack(item or s["item"], q) for q in qtys])
    db.commit()
    return posting, made


def _qty(db, pack_id) -> Decimal:
    return ledger.pack_quantity(db, pack_id)


def _refused(fn, code=400, text=None):
    with pytest.raises(HTTPException) as e:
        fn()
    assert e.value.status_code == code, e.value.detail
    if text:
        assert text in e.value.detail, e.value.detail
    return e.value.detail


def _ledger_count(db) -> int:
    return db.scalar(select(func.count()).select_from(models.AccessoryLedgerEntry))


# ── 1. The full cycle against a hand calculation ────────────────────────────

def test_receive_issue_return_transfer_match_hand_calculation(db, stock):
    s, u = stock, stock["user"].id
    posting, (a, b) = _receive(db, s, 100, "10.5")
    assert [e.entry_type for e in posting.entries] == ["receipt", "receipt"]
    assert posting.created_by == u and posting.reason is None

    ledger.issue(db, u, a.id, 30, s["jo"])                # A 70
    ledger.issue(db, u, a.id, "20.25", s["jo"])           # A 49.75
    ledger.return_to_pack(db, u, a.id, 5, s["jo"])        # A 54.75
    t = ledger.transfer(db, u, a.id, b.id, "24.75")       # A 30, B 35.25
    db.commit()

    assert _qty(db, a.id) == Decimal("30")
    assert _qty(db, b.id) == Decimal("35.25")
    assert [(e.pack_id, e.qty_delta) for e in t.entries] == [(a.id, Decimal("-24.75")), (b.id, Decimal("24.75"))]
    # Every row is on its pack's item; ledger sum = sum of pack quantities.
    rows = db.scalars(select(models.AccessoryLedgerEntry).where(models.AccessoryLedgerEntry.pack_id.in_([a.id, b.id]))).all()
    assert all(r.accessory_item_id == s["item"] for r in rows)
    assert sum(r.qty_delta for r in rows) == Decimal("65.25")
    # Issue and return rows carry the JO.
    assert {r.job_order_id for r in rows if r.entry_type in ("issue", "return")} == {s["jo"]}


def test_pack_history_has_running_balance(db, stock):
    s, u = stock, stock["user"].id
    _, (a,) = _receive(db, s, 12)
    ledger.issue(db, u, a.id, 5, s["jo"])
    ledger.return_to_pack(db, u, a.id, 1, s["jo"])
    db.commit()
    hist = ledger.pack_history(db, a.id)
    assert [(h.entry_type, h.qty_delta, h.balance) for h in hist] == [
        ("receipt", Decimal("12"), Decimal("12")), ("issue", Decimal("-5"), Decimal("7")),
        ("return", Decimal("1"), Decimal("8")),
    ]


# ── 2. Rules ─────────────────────────────────────────────────────────────────

def test_pack_never_goes_below_zero_and_refusal_writes_nothing(db, stock):
    s, u = stock, stock["user"].id
    _, (a, b) = _receive(db, s, 10, 10)
    before = _ledger_count(db)
    _refused(lambda: ledger.issue(db, u, a.id, 11, s["jo"]), text="has only 10 left")
    db.rollback()
    # A transfer that would overdraw its source writes neither half.
    _refused(lambda: ledger.transfer(db, u, a.id, b.id, "10.0001"))
    db.rollback()
    assert _ledger_count(db) == before
    assert _qty(db, a.id) == 10 and _qty(db, b.id) == 10


def test_pack_goes_empty_at_zero_and_active_again(db, stock):
    s, u = stock, stock["user"].id
    _, (a,) = _receive(db, s, 4)
    ledger.issue(db, u, a.id, 4, s["jo"])
    db.commit()
    assert db.get(models.AccessoryPack, a.id).status == "empty"
    _refused(lambda: ledger.issue(db, u, a.id, 1, s["jo"]), text="has only 0 left")
    db.rollback()
    ledger.return_to_pack(db, u, a.id, 2, s["jo"])
    db.commit()
    pack = db.get(models.AccessoryPack, a.id)
    assert pack.status == "active" and pack.quantity == 2


def test_job_order_reason_and_sign_rules(db, stock):
    s, u = stock, stock["user"].id
    _, (a,) = _receive(db, s, 10)
    _refused(lambda: ledger.post(db, u, [LedgerLine(a.id, "issue", -1)]), text="needs a job order")
    _refused(lambda: ledger.post(db, u, [LedgerLine(a.id, "return", 1)]), text="needs a job order")
    _refused(lambda: ledger.post(db, u, [LedgerLine(a.id, "issue", -1, job_order_id=999999999)]), 404)
    _refused(lambda: ledger.post(db, u, [LedgerLine(a.id, "adjustment", -1)]), text="needs a reason")
    _refused(lambda: ledger.post(db, u, [LedgerLine(a.id, "write_off", -1)], reason="  "), text="needs a reason")
    _refused(lambda: ledger.post(db, u, [LedgerLine(a.id, "receipt", -1)]), text="must be positive")
    _refused(lambda: ledger.post(db, u, [LedgerLine(a.id, "write_off", 1)], reason="x"), text="must be negative")
    _refused(lambda: ledger.post(db, u, [LedgerLine(a.id, "adjustment", 0)], reason="x"), text="0 changes nothing")
    _refused(lambda: ledger.post(db, u, [LedgerLine(a.id, "magic", 1)]), text="Unknown entry type")
    _refused(lambda: ledger.post(db, u, []), text="Nothing to post")
    _refused(lambda: ledger.post(db, u, [LedgerLine(999999999, "adjustment", 1)], reason="x"), 404)
    _refused(lambda: ledger.issue(db, u, a.id, 0, s["jo"]), text="more than 0")
    db.rollback()

    # Adjustments go either way with a reason; write-off takes stock out.
    ledger.post(db, u, [LedgerLine(a.id, "adjustment", -3)], reason="Count found 7")
    p = ledger.post(db, u, [LedgerLine(a.id, "write_off", -2)], reason="Water damage")
    db.commit()
    assert p.reason == "Water damage" and _qty(db, a.id) == 5


def test_transfer_needs_two_packs_of_one_item(db, stock):
    s, u = stock, stock["user"].id
    _, (a, b) = _receive(db, s, 5, 5)
    _, (c,) = _receive(db, s, 5, item=s["other"])
    _refused(lambda: ledger.transfer(db, u, a.id, a.id, 1), text="two different packs")
    _refused(lambda: ledger.transfer(db, u, a.id, c.id, 1), text="same item")
    _refused(lambda: ledger.transfer(db, u, a.id, b.id, -1), text="more than 0")


def test_quantities_round_to_four_places(db, stock):
    _, (a,) = _receive(db, stock, "1.00005")
    assert _qty(db, a.id) == Decimal("1.0001")


def test_receive_refuses_zero_and_saves_nothing(db, stock):
    before = db.scalar(select(func.count()).select_from(models.AccessoryPack))
    _refused(lambda: _receive(db, stock, 5, 0), text="more than 0")
    db.rollback()
    assert db.scalar(select(func.count()).select_from(models.AccessoryPack)) == before


# ── 3. Reversals ─────────────────────────────────────────────────────────────

def test_reversing_a_receipt_nets_to_zero_and_links_rows(db, stock):
    s, admin = stock, stock["user"].id
    posting, (a, b) = _receive(db, s, 8, 3)
    rev = ledger.reverse_posting(db, admin, posting.id, "Wrong item received")
    db.commit()
    db.refresh(posting)

    assert rev.reverses_posting_id == posting.id and posting.reversed_by_posting_id == rev.id
    assert rev.reason == "Wrong item received"
    assert [e.reversal_of for e in rev.entries] == [e.id for e in posting.entries]
    assert all(e.is_reversed for e in posting.entries)
    assert [e.entry_type for e in rev.entries] == ["receipt", "receipt"]
    assert sum(e.qty_delta for e in posting.entries + rev.entries) == 0
    for p in (a, b):
        pack = db.get(models.AccessoryPack, p.id)
        assert pack.quantity == 0 and pack.status == "empty"


def test_reversing_a_transfer_and_an_issue(db, stock):
    s, u = stock, stock["user"].id
    _, (a, b) = _receive(db, s, 10, 0.5)
    t = ledger.transfer(db, u, a.id, b.id, 4)
    i = ledger.issue(db, u, a.id, 6, s["jo"])
    db.commit()
    assert _qty(db, a.id) == 0
    ledger.reverse_posting(db, u, i.id, "Scanned the wrong pack")
    ledger.reverse_posting(db, u, t.id, "Split by mistake")
    db.commit()
    assert _qty(db, a.id) == 10 and _qty(db, b.id) == Decimal("0.5")
    issue_rev = db.get(models.AccessoryPosting, i.id).reversed_by_posting_id
    assert db.get(models.AccessoryPosting, issue_rev).entries[0].job_order_id == s["jo"]


def test_reversal_only_once_never_of_a_reversal_needs_a_reason(db, stock):
    s, u = stock, stock["user"].id
    posting, _ = _receive(db, s, 5)
    _refused(lambda: ledger.reverse_posting(db, u, posting.id, " "), text="needs a reason")
    rev = ledger.reverse_posting(db, u, posting.id, "Duplicate")
    db.commit()
    _refused(lambda: ledger.reverse_posting(db, u, posting.id, "again"), 409)
    _refused(lambda: ledger.reverse_posting(db, u, rev.id, "undo"), text="is a reversal")
    _refused(lambda: ledger.reverse_posting(db, u, 999999999, "x"), 404)


def test_reversal_refused_when_stock_was_used_since(db, stock):
    s, u = stock, stock["user"].id
    posting, (a,) = _receive(db, s, 10)
    ledger.issue(db, u, a.id, 4, s["jo"])
    db.commit()
    _refused(lambda: ledger.reverse_posting(db, u, posting.id, "Wrong qty"), text="has only 6 left")
    db.rollback()
    assert _qty(db, a.id) == 6


# ── 4. Database guards on their own ─────────────────────────────────────────

def _raw_insert(db, **row):
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add(models.AccessoryLedgerEntry(**row))
            db.flush()


def test_database_refuses_bad_rows_written_around_the_service(db, stock):
    s, u = stock, stock["user"].id
    posting, (a,) = _receive(db, s, 10)
    base = {"posting_id": posting.id, "pack_id": a.id, "accessory_item_id": s["item"]}
    _raw_insert(db, **{**base, "accessory_item_id": s["other"]}, entry_type="adjustment", qty_delta=1)  # item ≠ pack item
    _raw_insert(db, **base, entry_type="issue", qty_delta=-1)                                          # no JO
    _raw_insert(db, **base, entry_type="receipt", qty_delta=-1)                                        # wrong sign
    _raw_insert(db, **base, entry_type="adjustment", qty_delta=0)                                      # zero
    _raw_insert(db, **base, entry_type="gift", qty_delta=1)                                            # unknown type
    first = posting.entries[0].id
    rev = ledger.reverse_posting(db, u, posting.id, "x")
    db.commit()
    _raw_insert(db, **{**base, "posting_id": rev.id}, entry_type="receipt", qty_delta=-1, reversal_of=first)  # 2nd reversal


def test_posting_names_at_most_one_receipt(db, stock, place):
    loc = models.LogicalLocation(name=f"pytest_ledger_line_{next(_seq)}", location_type="production_line")
    db.add(loc)
    db.flush()
    r1 = models.InternalReceipt(source_warehouse_id=place["acc"].id, target_logical_location_id=loc.id)
    db.add(r1)
    db.flush()
    with pytest.raises(IntegrityError):
        with db.begin_nested():
            db.add(models.AccessoryPosting(internal_receipt_id=r1.id, supplier_receipt_id=_supplier_receipt(db, place, loc),
                                           created_by=stock["user"].id))
            db.flush()


def _supplier_receipt(db, place, loc):
    sup = models.LogicalLocation(name=f"pytest_ledger_sup_{next(_seq)}", location_type="supplier")
    db.add(sup)
    db.flush()
    r = models.SupplierReceipt(source_warehouse_id=place["acc"].id, target_logical_location_id=sup.id)
    db.add(r)
    db.flush()
    return r.id


# ── 5. API ───────────────────────────────────────────────────────────────────

def test_api_pack_quantity_history_posting_and_admin_only_reversal(client, auth_headers, db, stock, make_user):
    s = stock
    posting, (a,) = _receive(db, s, 9)
    ledger.issue(db, s["user"].id, a.id, 2, s["jo"])
    db.commit()
    viewer = auth_headers(role="Viewer")

    r = client.get(f"{PACKS}{a.id}", headers=viewer)
    assert r.status_code == 200 and Decimal(r.json()["quantity"]) == 7
    r = client.get(f"{PACKS}{a.id}/ledger", headers=viewer)
    assert [(e["entry_type"], Decimal(e["balance"])) for e in r.json()] == [("receipt", 9), ("issue", 7)]
    assert r.json()[0]["created_by"] == s["user"].id
    r = client.get(f"{POSTINGS}{posting.id}", headers=viewer)
    assert r.status_code == 200 and len(r.json()["entries"]) == 1 and r.json()["reversed_by_posting_id"] is None
    assert client.get(f"{POSTINGS}999999999", headers=viewer).status_code == 404

    body = {"reason": "Wrong delivery"}
    assert client.post(f"{POSTINGS}{posting.id}/reverse", json=body, headers=auth_headers(role="W_Manager")).status_code == 403
    assert client.post(f"{POSTINGS}{posting.id}/reverse", json={"reason": ""}, headers=auth_headers(role="admin")).status_code == 422
    # Stock was issued since: refused with the reason in plain words.
    r = client.post(f"{POSTINGS}{posting.id}/reverse", json=body, headers=auth_headers(role="admin"))
    assert r.status_code == 400 and "has only 7 left" in r.json()["detail"]

    admin = make_user("admin")
    issue_posting = db.scalars(select(models.AccessoryPosting).where(models.AccessoryPosting.id > posting.id)).first()
    r = client.post(f"{POSTINGS}{issue_posting.id}/reverse", json=body, headers=auth_headers(user=admin))
    assert r.status_code == 201, r.text
    assert r.json()["created_by"] == admin.id and r.json()["reverses_posting_id"] == issue_posting.id
    assert Decimal(client.get(f"{PACKS}{a.id}", headers=viewer).json()["quantity"]) == 9


def test_api_off_when_accessories_switched_off(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    h = auth_headers(role="admin")
    assert client.get(f"{POSTINGS}1", headers=h).status_code == 404
    assert client.post(f"{POSTINGS}1/reverse", json={"reason": "x"}, headers=h).status_code == 404


# ── 6. Receipts ──────────────────────────────────────────────────────────────

@pytest.fixture
def issue_receipt(db, stock, place):
    loc = models.LogicalLocation(name=f"pytest_ledger_sew_{next(_seq)}", location_type="production_line")
    db.add(loc)
    db.flush()
    receipt = models.InternalReceipt(source_warehouse_id=place["acc"].id, target_logical_location_id=loc.id)
    db.add(receipt)
    db.flush()
    line = models.AccessoryReceiptItem(internal_receipt_id=receipt.id, accessory_item_id=stock["item"])
    db.add(line)
    db.flush()
    return receipt, line


def test_posted_receipt_line_cant_be_deleted_and_receipt_reversal(db, stock, issue_receipt):
    s, u = stock, stock["user"].id
    receipt, line = issue_receipt
    _, (a,) = _receive(db, s, 20)
    p = ledger.issue(db, u, a.id, 6, s["jo"], receipt_kind="internal", receipt_id=receipt.id, receipt_line_id=line.id)
    db.commit()
    assert p.internal_receipt_id == receipt.id and p.entries[0].accessory_receipt_item_id == line.id

    _refused(lambda: receipt_items.delete_accessory_receipt_item(db, line.id), text="reverse it instead")
    db.rollback()

    posting_service.reverse(db, "internal", receipt, u, "Line sent back")
    assert _qty(db, a.id) == 20
    rev = db.get(models.AccessoryPosting, db.get(models.AccessoryPosting, p.id).reversed_by_posting_id)
    assert rev.internal_receipt_id == receipt.id
    _refused(lambda: posting_service.reverse(db, "internal", receipt, u, "again"), text="Nothing of this receipt")


def test_receipt_reference_rules(db, stock, issue_receipt, place):
    s, u = stock, stock["user"].id
    receipt, line = issue_receipt
    _, (a,) = _receive(db, s, 5)
    _refused(lambda: ledger.issue(db, u, a.id, 1, s["jo"], receipt_line_id=line.id), text="needs its receipt")
    _refused(lambda: ledger.issue(db, u, a.id, 1, s["jo"], receipt_kind="internal", receipt_id=999999999), 404)
    other = models.InternalReceipt(source_warehouse_id=place["acc2"].id, target_logical_location_id=receipt.target_logical_location_id)
    db.add(other)
    db.flush()
    _refused(lambda: ledger.issue(db, u, a.id, 1, s["jo"], receipt_kind="internal", receipt_id=other.id),
             text="receipt's warehouse")
    other_line = models.AccessoryReceiptItem(internal_receipt_id=other.id, accessory_item_id=s["item"])
    db.add(other_line)
    db.flush()
    _refused(lambda: ledger.issue(db, u, a.id, 1, s["jo"], receipt_kind="internal", receipt_id=receipt.id,
                                  receipt_line_id=other_line.id), text="not an accessory line of this receipt")


def test_unposted_receipt_line_still_deletes(db, stock, issue_receipt):
    _, line = issue_receipt
    assert receipt_items.delete_accessory_receipt_item(db, line.id) is not None
