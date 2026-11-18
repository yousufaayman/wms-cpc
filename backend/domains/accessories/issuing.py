"""Issuing accessories to job orders (item 20).

How an issue works, in plain words:
1. An **issue receipt** is an internal receipt of an Accessory warehouse with
   a job order (JO) and a destination (a production line or an internal
   location). One receipt = one JO.
2. The worker scans packs onto it. Each scan is one **line**: the pack, how
   much (turned into the item's base unit) and the JO's requirement line for
   the pack's item (found automatically: a JO has one line per item).
   Checks when a line is added:
   - the item is on the JO's requirement list (POMS wrote a line for it)
   - client-match: a client's item only goes to that client's JOs; generic
     items go anywhere
   - the pack is active, in this warehouse, and has enough **free** quantity.
     Free = on hand minus what other not-yet-confirmed lines already hold
     back, so two open issues can't promise the same pieces
   - D-2: more than the requirement's remaining is allowed only with a
     reason; the line is then flagged as an over-issue
3. Nothing leaves stock until someone **confirms** the receipt: then every
   line becomes one `issue` ledger row (with the JO, the requirement line and
   the receipt line), all under one posting. The posting service checks
   again that no pack goes below zero.
4. A confirmed line can't be deleted; an admin reverses the receipt instead.

Nothing here commits; the endpoint (or the confirm action) commits once.
"""
from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Sequence

from fastapi import HTTPException, status
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from backend import models
from backend.core.warehouse_modules import ACCESSORY, ensure_receipt_line_kind
from backend.domains.accessories.pack_barcode import parse_pack_barcode
from backend.domains.accessories.receiving import qty_in_base
from backend.domains.posting import accessory as posting_service

ISSUE_TARGET_TYPES = ("internal", "production_line")

_Line = models.AccessoryReceiptItem
_Led = models.AccessoryLedgerEntry
_Req = models.JobOrderAccessoryRequirement
_show = posting_service._show


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _unposted():
    """Lines with no ledger row yet (their receipt isn't confirmed)."""
    return ~exists().where(_Led.accessory_receipt_item_id == _Line.id)


def _warehouse_type(db: Session, warehouse_id: int) -> Optional[str]:
    warehouse = db.get(models.Warehouse, warehouse_id)
    return getattr(warehouse.type, "value", warehouse.type) if warehouse is not None else None


# ── Reading ──────────────────────────────────────────────────────────────────

def pending_by_pack(db: Session, pack_ids: Iterable[int]) -> Dict[int, Decimal]:
    """Per pack: the quantity on lines not confirmed yet (held back)."""
    ids = list(set(pack_ids))
    if not ids:
        return {}
    rows = db.execute(
        select(_Line.pack_id, func.sum(_Line.qty)).where(_Line.pack_id.in_(ids), _unposted()).group_by(_Line.pack_id)
    ).all()
    return {pack_id: Decimal(total) for pack_id, total in rows}


def pending_by_requirement(db: Session, requirement_ids: Iterable[int]) -> Dict[int, Decimal]:
    """Per requirement line: the quantity on issue lines not confirmed yet."""
    ids = list(set(requirement_ids))
    if not ids:
        return {}
    rows = db.execute(
        select(_Line.jo_requirement_id, func.sum(_Line.qty))
        .where(_Line.jo_requirement_id.in_(ids), _unposted()).group_by(_Line.jo_requirement_id)
    ).all()
    return {req_id: Decimal(total) for req_id, total in rows}


def _mark_posted(db: Session, lines: Sequence[models.AccessoryReceiptItem]) -> None:
    ids = [line.id for line in lines]
    if not ids:
        return
    rows = db.execute(
        select(_Led.accessory_receipt_item_id, _Led.is_reversed)
        .where(_Led.accessory_receipt_item_id.in_(ids), _Led.reversal_of.is_(None))
    ).all()
    posted = {line_id for line_id, _ in rows}
    reversed_ = {line_id for line_id, is_reversed in rows if is_reversed}
    for line in lines:
        line.posted = line.id in posted
        line.reversed = line.id in reversed_


def list_lines(db: Session, receipt_kind: str, receipt_id: int) -> List[models.AccessoryReceiptItem]:
    """A receipt's accessory lines, oldest first, each with `posted`."""
    fk = getattr(_Line, f"{receipt_kind}_receipt_id")
    lines = list(db.scalars(select(_Line).where(fk == receipt_id).order_by(_Line.id)).unique().all())
    _mark_posted(db, lines)
    return lines


def over_issue_counts(db: Session, receipt_ids: Iterable[int]) -> Dict[int, int]:
    """Per internal receipt: how many of its lines are flagged over-issues."""
    ids = list(set(receipt_ids))
    if not ids:
        return {}
    rows = db.execute(
        select(_Line.internal_receipt_id, func.count())
        .where(_Line.internal_receipt_id.in_(ids), _Line.over_issue_reason.is_not(None))
        .group_by(_Line.internal_receipt_id)
    ).all()
    return dict(rows)


def fill_over_issue_counts(db: Session, receipts: Sequence[models.InternalReceipt]) -> None:
    counts = over_issue_counts(db, (r.id for r in receipts))
    for receipt in receipts:
        receipt.over_issue_count = counts.get(receipt.id, 0)


def _used(db: Session, requirement_id: int) -> Decimal:
    """Issued minus returned so far (confirmed rows only)."""
    return -Decimal(db.scalar(
        select(func.coalesce(func.sum(_Led.qty_delta), 0))
        .where(_Led.jo_requirement_id == requirement_id, _Led.entry_type.in_(("issue", "return")))
    ))


# ── The issue receipt header ─────────────────────────────────────────────────

def check_issue_header(
    db: Session, warehouse_id: int, target_location_id: Optional[int], job_order_id: Optional[int]
) -> None:
    """Create / edit an internal receipt. Accessory warehouse: it's an issue,
    so it needs a JO and goes to an internal location or a production line.
    Other warehouses: no JO here (fabric links requests through fulfillments)."""
    if _warehouse_type(db, warehouse_id) != ACCESSORY:
        if job_order_id is not None:
            raise _bad("Only accessory issues carry a job order")
        return
    if job_order_id is None:
        raise _bad("An accessory issue needs a job order")
    if db.get(models.JobOrder, job_order_id) is None:
        raise _bad("Job order not found", status.HTTP_404_NOT_FOUND)
    if target_location_id is not None:
        location = db.get(models.LogicalLocation, target_location_id)
        if location is None:
            raise _bad("Logical location not found", status.HTTP_404_NOT_FOUND)
        if getattr(location.location_type, "value", location.location_type) not in ISSUE_TARGET_TYPES:
            raise _bad("Accessories are issued to a production line or an internal location")


def _open_issue_receipt(db: Session, receipt_kind: str, receipt_id: int) -> models.InternalReceipt:
    ensure_receipt_line_kind(db, receipt_kind, receipt_id, "accessory")
    if receipt_kind != "internal":
        raise _bad("Accessory packs go on issues (internal receipts) or supplier returns")
    receipt = db.get(models.InternalReceipt, receipt_id)
    if receipt.status != "issued" or receipt.closed:
        raise _bad("This issue is already confirmed or closed")
    if receipt.job_order_id is None:
        raise _bad("This issue has no job order")
    return receipt


# ── Lines ────────────────────────────────────────────────────────────────────

def _client_ok(item: models.AccessoryItem, job_order: models.JobOrder) -> bool:
    return item.client_id is None or item.client_id == job_order.client_id


def add_line(
    db: Session, receipt_kind: str, receipt_id: int, data, actor_id: int
) -> models.AccessoryReceiptItem:
    """Scan a pack onto an issue receipt (`data` = AccessoryReceiptItemCreate)."""
    receipt = _open_issue_receipt(db, receipt_kind, receipt_id)
    if data.pack_id is not None:
        pack_id = data.pack_id
    else:
        pack_id = parse_pack_barcode(data.barcode or "")
        if pack_id is None:
            raise _bad("That isn't a pack barcode (like 1042*ACC)")

    # Lock the pack, so two scans of it at the same moment are checked one after the other
    pack = db.scalar(
        select(models.AccessoryPack).where(models.AccessoryPack.id == pack_id)
        .with_for_update().execution_options(populate_existing=True)
    )
    if pack is None:
        raise _bad(f"Pack {pack_id} not found", status.HTTP_404_NOT_FOUND)
    if pack.warehouse_id != receipt.source_warehouse_id:
        raise _bad(f"Pack {pack.id} is in another warehouse")
    if pack.status != "active":
        raise _bad(f"Pack {pack.id} is empty")

    item = pack.item
    job_order = receipt.job_order
    if not _client_ok(item, job_order):
        raise _bad(f"{item.code} belongs to another client and can't go to job order {job_order.job_order_number}")
    requirement = db.scalar(
        select(_Req).where(_Req.job_order_id == job_order.job_order_id, _Req.accessory_item_id == item.id)
    )
    if requirement is None:
        raise _bad(f"{item.code} is not on job order {job_order.job_order_number}'s requirement list")

    qty = qty_in_base(db, item, data.qty, data.uom_id)
    uom = item.base_uom.code
    free = posting_service.pack_quantity(db, pack.id) - pending_by_pack(db, [pack.id]).get(pack.id, Decimal(0))
    if qty > free:
        raise _bad(f"Pack {pack.id} has only {_show(max(free, Decimal(0)))} {uom} free")

    remaining = (requirement.qty_needed - _used(db, requirement.id)
                 - pending_by_requirement(db, [requirement.id]).get(requirement.id, Decimal(0)))
    reason = (data.over_issue_reason or "").strip() or None
    if qty > remaining:
        if reason is None:
            over = qty - max(remaining, Decimal(0))
            raise _bad(f"This is {_show(over)} {uom} more than remaining: an over-issue needs a reason")
    else:
        reason = None  # not an over-issue: nothing to flag

    line = _Line(
        internal_receipt_id=receipt.id,
        pack_id=pack.id,
        accessory_item_id=item.id,
        qty=qty,
        job_order_id=job_order.job_order_id,
        jo_requirement_id=requirement.id,
        over_issue_reason=reason,
        created_by=actor_id,
    )
    db.add(line)
    db.flush()
    db.refresh(line)
    line.posted = False
    return line


def get_line_or_404(db: Session, line_id: int) -> models.AccessoryReceiptItem:
    line = db.get(_Line, line_id)
    if line is None:
        raise _bad("Accessory receipt item not found", status.HTTP_404_NOT_FOUND)
    return line


def check_line_removable(db: Session, line: models.AccessoryReceiptItem) -> None:
    """Only while the issue is open; a posted line is refused by the adapter
    (reverse the receipt instead)."""
    if line.internal_receipt_id is not None:
        receipt = db.get(models.InternalReceipt, line.internal_receipt_id)
        if receipt.status != "issued" or receipt.closed:
            raise _bad("This issue is already confirmed or closed")


# ── Confirm ──────────────────────────────────────────────────────────────────

def confirm(db: Session, receipt: models.InternalReceipt, actor_id: int) -> Optional[models.AccessoryPosting]:
    """Take every line out of stock: one `issue` row per line, one posting.
    Re-checks what may have changed since the scan (another issue confirmed
    first: a line may now go past remaining without a reason, or a pack may
    not have enough left)."""
    lines = list_lines(db, "internal", receipt.id)
    if not lines:
        raise _bad("Scan at least one pack before confirming")
    if receipt.job_order_id is None:
        raise _bad("This issue has no job order")
    job_order = receipt.job_order

    left: Dict[int, Decimal] = {}
    for line in lines:
        if line.posted:
            continue
        if not _client_ok(line.pack.item, job_order):
            raise _bad(f"{line.item_code} belongs to another client and can't go to job order {job_order.job_order_number}")
        req = db.get(_Req, line.jo_requirement_id)
        if line.jo_requirement_id not in left:
            left[line.jo_requirement_id] = req.qty_needed - _used(db, req.id)
        left[line.jo_requirement_id] -= line.qty
        if left[line.jo_requirement_id] < 0 and line.over_issue_reason is None:
            raise _bad(
                f"Pack {line.pack_id} ({line.item_code}) now goes past the remaining quantity: "
                "remove the line and scan it again with an over-issue reason"
            )

    to_post = [line for line in lines if not line.posted]
    if not to_post:
        return None
    return posting_service.post(
        db, actor_id,
        [posting_service.LedgerLine(
            pack_id=line.pack_id, entry_type="issue", qty_delta=-line.qty, job_order_id=line.job_order_id,
            receipt_line_id=line.id, jo_requirement_id=line.jo_requirement_id,
        ) for line in to_post],
        receipt_kind="internal", receipt_id=receipt.id,
    )
