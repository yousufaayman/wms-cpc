"""Accessory stock: the only code that writes wms.accessory_ledger (item 13).

How accessory stock works, in plain words:
- A pack (wms.accessory_packs) holds one item. How much is in it is never
  stored on the pack: it's the sum of the pack's ledger rows.
- Every change of quantity is one ledger row (+ in, - out) in the item's base
  unit. Rows are never edited or deleted.
- Rows made by one action (a receive session, a split, an issue receipt's
  confirm, the opening balance...) hang under one **posting**, which says who
  did it, when, why, and which receipt it came from.
- A mistake is undone by `reverse_posting`: a new posting with the opposite
  rows, each pointing at the row it cancels (`reversal_of`).

`post` is the single entry point; `receive`, `issue`, `return_to_pack` and
`transfer` are short forms of it for the items that build the screens (17
Receive Packs, 20 issuing, 21 returns / split / merge, 22 adjustments, 25
opening balance). The rules it enforces (Tab 1, Phase 2):
1. a pack never goes below zero (packs are locked while posting, so two
   scans at the same moment can't both take the last pieces)
2. the row's item is the pack's item (also a database FK)
3. issue and return rows carry a job order (also a database CHECK)
4. a pack at zero becomes `empty`, and `active` again when stock comes back
5. every row belongs to a posting; receipt-driven rows name the receipt and
   its line
Signs per type (also a CHECK): receipt / return in (+); issue /
supplier_return / write_off out (-); transfer / adjustment / reclassify either.

Nothing here commits: the caller commits once, so a pack and its first row,
or both halves of a split, are saved together or not at all.

The receipt hooks (`AccessoryAdapter`) plug this into the shared posting
service (service.py): a posted receipt line can't be deleted, and reversing a
receipt reverses its postings. Posting accessory lines on confirm is item 20
(the lines don't carry a pack and quantity yet).
"""
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ... import models
from ...core.warehouse_modules import ACCESSORY, ensure_module
from .registry import PostingAdapter, register

MODULE = "accessory_inventory"
ENTRY_TYPES = models.ACCESSORY_ENTRY_TYPES
STOCK_IN = {"receipt", "return"}
STOCK_OUT = {"issue", "supplier_return", "write_off"}
NEEDS_JOB_ORDER = {"issue", "return"}
NEEDS_REASON = {"adjustment", "write_off"}

_RECEIPT_MODELS = {
    "supplier": models.SupplierReceipt,
    "internal": models.InternalReceipt,
    "external": models.ExternalReceipt,
}
_RECEIPT_FK = {
    "supplier": "supplier_receipt_id",
    "internal": "internal_receipt_id",
    "external": "external_receipt_id",
}
_PLACES = Decimal("0.0001")  # NUMERIC(14,4)


@dataclass
class LedgerLine:
    """One row to post. `qty_delta` is signed: + into the pack, - out of it."""
    pack_id: int
    entry_type: str
    qty_delta: Decimal
    job_order_id: Optional[int] = None
    receipt_line_id: Optional[int] = None  # wms.accessory_receipt_items.id


@dataclass
class NewPack:
    """One pack to receive (item 17): what, how much (base unit), where from."""
    item_id: int
    qty: Decimal
    rack_id: Optional[int] = None
    expected_delivery_item_id: Optional[int] = None
    supplier_type: Optional[str] = None
    client_supplier_id: Optional[int] = None


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _qty(value) -> Decimal:
    return Decimal(str(value)).quantize(_PLACES, rounding=ROUND_HALF_UP)


def _show(q: Decimal) -> str:
    """12.5000 → '12.5', 3.0000 → '3' (for messages)."""
    text = format(q.normalize(), "f")
    return "0" if text in ("-0", "") else text


def pack_quantity(db: Session, pack_id: int) -> Decimal:
    total = db.scalar(
        select(func.coalesce(func.sum(models.AccessoryLedgerEntry.qty_delta), 0))
        .where(models.AccessoryLedgerEntry.pack_id == pack_id)
    )
    return _qty(total)


def _lock_packs(db: Session, pack_ids: Iterable[int]) -> Dict[int, models.AccessoryPack]:
    """Lock the packs (in id order, so two postings never wait on each other
    crosswise) and load them fresh."""
    ids = sorted(set(pack_ids))
    packs = db.scalars(
        select(models.AccessoryPack).where(models.AccessoryPack.id.in_(ids))
        .order_by(models.AccessoryPack.id).with_for_update().execution_options(populate_existing=True)
    ).all()
    found = {p.id: p for p in packs}
    missing = [i for i in ids if i not in found]
    if missing:
        raise _bad(f"Pack {missing[0]} not found", status.HTTP_404_NOT_FOUND)
    return found


def _check_line_rules(line: LedgerLine, is_reversal: bool, reason: Optional[str]) -> None:
    if line.entry_type not in ENTRY_TYPES:
        raise _bad(f"Unknown entry type '{line.entry_type}'")
    if line.qty_delta == 0:
        raise _bad("A quantity of 0 changes nothing")
    if not is_reversal:
        if line.entry_type in STOCK_IN and line.qty_delta < 0:
            raise _bad(f"A {line.entry_type} adds stock: its quantity must be positive")
        if line.entry_type in STOCK_OUT and line.qty_delta > 0:
            raise _bad(f"A {line.entry_type.replace('_', ' ')} takes stock out: its quantity must be negative")
        if line.entry_type in NEEDS_REASON and not reason:
            raise _bad(f"A {line.entry_type.replace('_', ' ')} needs a reason")
    if line.entry_type in NEEDS_JOB_ORDER and line.job_order_id is None:
        raise _bad(f"A {line.entry_type} needs a job order")


def _check_receipt(
    db: Session, receipt_kind: Optional[str], receipt_id: Optional[int], lines: Sequence[LedgerLine],
    packs: Dict[int, models.AccessoryPack],
) -> None:
    """A receipt named on the posting must exist and be from the packs'
    warehouse; a line named on a row must be an accessory line of that receipt."""
    if receipt_kind is None:
        if any(line.receipt_line_id is not None for line in lines):
            raise _bad("A receipt line needs its receipt")
        return
    if receipt_kind not in _RECEIPT_MODELS:
        raise _bad("Receipt kind must be supplier, internal or external")
    receipt = db.get(_RECEIPT_MODELS[receipt_kind], receipt_id)
    if receipt is None:
        raise _bad("Receipt not found", status.HTTP_404_NOT_FOUND)
    if any(p.warehouse_id != receipt.source_warehouse_id for p in packs.values()):
        raise _bad("The packs must be in the receipt's warehouse")
    fk = _RECEIPT_FK[receipt_kind]
    for line in lines:
        if line.receipt_line_id is None:
            continue
        receipt_line = db.get(models.AccessoryReceiptItem, line.receipt_line_id)
        if receipt_line is None or getattr(receipt_line, fk) != receipt_id:
            raise _bad(f"Line {line.receipt_line_id} is not an accessory line of this receipt")


def post(
    db: Session,
    actor_id: int,
    lines: Sequence[LedgerLine],
    *,
    reason: Optional[str] = None,
    receipt_kind: Optional[str] = None,
    receipt_id: Optional[int] = None,
    _reverses: Optional[models.AccessoryPosting] = None,
    _reversal_of: Optional[Sequence[int]] = None,
) -> models.AccessoryPosting:
    """Write one posting with `lines`, applying every rule above. Lines are
    applied in order, so a pack may go down and up within one posting but
    never below zero at any step. `actor_id` = the logged-in user. Flushes,
    doesn't commit."""
    if not lines:
        raise _bad("Nothing to post")
    reason = (reason or "").strip() or None
    if reason is not None and len(reason) > 500:
        raise _bad("The reason is longer than 500 characters")
    is_reversal = _reverses is not None
    lines = [LedgerLine(**{**line.__dict__, "qty_delta": _qty(line.qty_delta)}) for line in lines]
    for line in lines:
        _check_line_rules(line, is_reversal, reason)

    packs = _lock_packs(db, (line.pack_id for line in lines))
    checked_warehouses = set()
    for pack in packs.values():
        if pack.warehouse_id not in checked_warehouses:
            ensure_module(db, pack.warehouse_id, MODULE)
            checked_warehouses.add(pack.warehouse_id)
    for job_order_id in {line.job_order_id for line in lines if line.job_order_id is not None}:
        if db.get(models.JobOrder, job_order_id) is None:
            raise _bad(f"Job order {job_order_id} not found", status.HTTP_404_NOT_FOUND)
    _check_receipt(db, receipt_kind, receipt_id, lines, packs)

    balance = {pack_id: pack_quantity(db, pack_id) for pack_id in packs}
    for line in lines:
        balance[line.pack_id] += line.qty_delta
        if balance[line.pack_id] < 0:
            pack = packs[line.pack_id]
            have = balance[line.pack_id] - line.qty_delta
            raise _bad(f"Pack {pack.barcode} has only {_show(have)} left, can't take {_show(-line.qty_delta)}")

    posting = models.AccessoryPosting(
        reason=reason,
        reverses_posting_id=_reverses.id if is_reversal else None,
        created_by=actor_id,
        **({_RECEIPT_FK[receipt_kind]: receipt_id} if receipt_kind else {}),
    )
    db.add(posting)
    db.flush()
    for i, line in enumerate(lines):
        db.add(models.AccessoryLedgerEntry(
            posting_id=posting.id,
            pack_id=line.pack_id,
            accessory_item_id=packs[line.pack_id].accessory_item_id,
            entry_type=line.entry_type,
            qty_delta=line.qty_delta,
            job_order_id=line.job_order_id,
            accessory_receipt_item_id=line.receipt_line_id,
            reversal_of=_reversal_of[i] if _reversal_of else None,
        ))
    for pack_id, pack in packs.items():
        pack.status = "empty" if balance[pack_id] == 0 else "active"
    db.flush()
    db.refresh(posting)
    for pack in packs.values():
        db.refresh(pack)
    return posting


# ── Short forms for the screens of later items ──────────────────────────────

def receive(
    db: Session, actor_id: int, warehouse_id: int, new_packs: Sequence[NewPack]
) -> Tuple[models.AccessoryPosting, List[models.AccessoryPack]]:
    """Receive Packs (item 17): make each pack and its `receipt` row, all
    under one posting. Quantities are in the item's base unit and > 0."""
    from ...crud.accessory_packs import create_pack  # crud imports this module's neighbours

    if not new_packs:
        raise _bad("Nothing to receive")
    packs = []
    for new in new_packs:
        if _qty(new.qty) <= 0:
            raise _bad("A received quantity must be more than 0")
        packs.append(create_pack(
            db, item_id=new.item_id, warehouse_id=warehouse_id, created_by=actor_id, rack_id=new.rack_id,
            expected_delivery_item_id=new.expected_delivery_item_id, supplier_type=new.supplier_type,
            client_supplier_id=new.client_supplier_id,
        ))
    posting = post(db, actor_id, [
        LedgerLine(pack_id=p.id, entry_type="receipt", qty_delta=new.qty) for p, new in zip(packs, new_packs)
    ])
    return posting, packs


def issue(
    db: Session, actor_id: int, pack_id: int, qty, job_order_id: int, *,
    receipt_kind: Optional[str] = None, receipt_id: Optional[int] = None, receipt_line_id: Optional[int] = None,
) -> models.AccessoryPosting:
    """Take `qty` (> 0) out of a pack for a job order (item 20)."""
    if _qty(qty) <= 0:
        raise _bad("An issued quantity must be more than 0")
    return post(
        db, actor_id,
        [LedgerLine(pack_id, "issue", -_qty(qty), job_order_id=job_order_id, receipt_line_id=receipt_line_id)],
        receipt_kind=receipt_kind, receipt_id=receipt_id,
    )


def return_to_pack(db: Session, actor_id: int, pack_id: int, qty, job_order_id: int) -> models.AccessoryPosting:
    """Unused trims back from a job order into a pack (item 21); an empty
    pack becomes active again."""
    if _qty(qty) <= 0:
        raise _bad("A returned quantity must be more than 0")
    return post(db, actor_id, [LedgerLine(pack_id, "return", _qty(qty), job_order_id=job_order_id)])


def transfer(db: Session, actor_id: int, from_pack_id: int, to_pack_id: int, qty) -> models.AccessoryPosting:
    """Move `qty` between two packs of the same item in one warehouse (split /
    merge, item 21): a - row and a + row under one posting."""
    if from_pack_id == to_pack_id:
        raise _bad("Pick two different packs")
    if _qty(qty) <= 0:
        raise _bad("A transferred quantity must be more than 0")
    src, dst = db.get(models.AccessoryPack, from_pack_id), db.get(models.AccessoryPack, to_pack_id)
    if src is None or dst is None:
        raise _bad("Pack not found", status.HTTP_404_NOT_FOUND)
    if src.accessory_item_id != dst.accessory_item_id:
        raise _bad("Both packs must hold the same item (a different item is a reclassify)")
    if src.warehouse_id != dst.warehouse_id:
        raise _bad("Both packs must be in the same warehouse")
    return post(db, actor_id, [
        LedgerLine(from_pack_id, "transfer", -_qty(qty)),
        LedgerLine(to_pack_id, "transfer", _qty(qty)),
    ])


# ── Reversal ─────────────────────────────────────────────────────────────────

def get_posting_or_404(db: Session, posting_id: int) -> models.AccessoryPosting:
    posting = db.get(models.AccessoryPosting, posting_id)
    if posting is None:
        raise _bad("Posting not found", status.HTTP_404_NOT_FOUND)
    return posting


def reverse_posting(db: Session, actor_id: int, posting_id: int, reason: str) -> models.AccessoryPosting:
    """Cancel a whole posting with the opposite rows, each linked to the row it
    cancels. Refused if it was reversed already (409), if it is itself a
    reversal (post the action again instead), or if the stock it added has
    since been used (a pack would go below zero). Admin only (endpoint)."""
    original = get_posting_or_404(db, posting_id)
    if original.reverses_posting_id is not None:
        raise _bad("This posting is a reversal; post the action again instead of reversing it")
    if original.reversed_by_posting_id is not None:
        raise _bad(f"Already reversed by posting {original.reversed_by_posting_id}", status.HTTP_409_CONFLICT)
    if not (reason or "").strip():
        raise _bad("A reversal needs a reason")
    receipt_kind = next((kind for kind, fk in _RECEIPT_FK.items() if getattr(original, fk) is not None), None)
    rows = list(original.entries)
    return post(
        db, actor_id,
        [LedgerLine(r.pack_id, r.entry_type, -r.qty_delta, r.job_order_id, r.accessory_receipt_item_id) for r in rows],
        reason=reason,
        receipt_kind=receipt_kind,
        receipt_id=getattr(original, _RECEIPT_FK[receipt_kind]) if receipt_kind else None,
        _reverses=original,
        _reversal_of=[r.id for r in rows],
    )


# ── Reading ──────────────────────────────────────────────────────────────────

def pack_history(db: Session, pack_id: int) -> List[models.AccessoryLedgerEntry]:
    """The pack's rows, oldest first, each with `balance` = quantity after it."""
    rows = db.scalars(
        select(models.AccessoryLedgerEntry).where(models.AccessoryLedgerEntry.pack_id == pack_id)
        .order_by(models.AccessoryLedgerEntry.id)
    ).all()
    running = Decimal(0)
    for row in rows:
        running += row.qty_delta
        row.balance = running
    return list(rows)


# ── Receipt hooks ────────────────────────────────────────────────────────────

class AccessoryAdapter(PostingAdapter):
    """Accessory receipts: a posted line can't be deleted, and reversing a
    receipt reverses its postings. Line checks and posting on confirm come
    with issuing (item 20: pack active with enough quantity, item matches the
    JO's client, the line names a JO requirement; one `issue` row per line)."""

    def on_line_removed(self, db: Session, line) -> None:
        posted = db.scalar(select(
            select(models.AccessoryLedgerEntry.id)
            .where(models.AccessoryLedgerEntry.accessory_receipt_item_id == line.id).exists()
        ))
        if posted:
            raise _bad("This line is already posted to stock: reverse it instead of deleting it")

    def reverse(self, db: Session, receipt_kind: str, receipt, actor_id: int, reason: str) -> None:
        fk = getattr(models.AccessoryPosting, _RECEIPT_FK[receipt_kind])
        postings = db.scalars(
            select(models.AccessoryPosting)
            .where(fk == receipt.id, models.AccessoryPosting.reverses_posting_id.is_(None))
            .order_by(models.AccessoryPosting.id)
        ).all()
        open_postings = [p for p in postings if p.reversed_by_posting_id is None]
        if not open_postings:
            raise _bad("Nothing of this receipt is posted to stock")
        for p in open_postings:
            reverse_posting(db, actor_id, p.id, reason)


register(ACCESSORY, AccessoryAdapter())
