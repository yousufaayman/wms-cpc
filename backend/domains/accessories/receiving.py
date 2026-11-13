"""Receive Packs (item 17): accessories arriving at the warehouse.

What happens when a worker presses Add on the Receive Packs page, in plain words:
1. The quantity per pack is turned into the item's base unit (5 DOZ → 60 PCS).
   A base unit without decimals (PCS) only takes whole numbers.
2. Each pack is given an expected delivery line:
   - "load a delivery" mode: the worker picked the line, so every pack goes
     to it, even past what was expected (the delivery page shows the extra).
   - "search item" mode: like fabric rolls, each pack goes to the oldest open
     line (earliest expected date, then oldest delivery) for this item, on a
     delivery in this warehouse **from this supplier**, that still has
     something to come. Packs are matched one after the other, so a session
     can fill one line and spill into the next. A pack is never split. No
     line left (or no supplier given) = the pack is received on no delivery;
     receiving is never blocked.
3. The packs and their `receipt` ledger rows are saved as one posting
   (`domains/posting/accessory.receive`), then each touched delivery
   re-works out its status (pending / partial / received).

The batch of a pack is the delivery it was received on (`AccessoryPack.batch_no`).

Undo: the person who pressed Add (or an admin) can cancel it while the packs
haven't been used for anything else: a reversal posting brings them back to
0 and they stop counting toward the delivery. `undo_receive_pack` (the page's
Undo, one pack at a time) reverses just that pack's row; `undo_receive`
cancels a whole Add at once.

Nothing here commits; the endpoint commits once.
"""
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend import models
from backend.core.authz import user_has_admin_role
from backend.crud.accessory_items import ensure_stockable, get_item_or_404
from backend.crud.expected_deliveries import accessory_received, sync_delivery_item_from_packs
from backend.domains.accessories import uom
from backend.domains.posting import accessory as posting_service
from backend.schemas import AccessoryReceiveIn

UNDO_REASON = "Receive undone"
_OPEN_STATUSES = ("pending", "partial")


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _qty_in_base(db: Session, item: models.AccessoryItem, qty, uom_id: Optional[int]) -> Decimal:
    """`qty` typed in `uom_id` (None = base) → base units, checked for whole numbers."""
    base = item.base_uom
    if uom_id is None or uom_id == item.base_uom_id:
        base_qty = Decimal(str(qty)).quantize(uom.QTY_PLACES)
    else:
        try:
            base_qty = uom.to_base(db, qty, uom_id, item.base_uom_id, item.id)
        except uom.NoConversion:
            raise _bad(f"{item.code}: no conversion from that unit to its base unit {base.code}")
    if base_qty <= 0:
        raise _bad("The quantity is too small for the base unit")
    if not base.allows_decimals and base_qty != base_qty.to_integral_value():
        raise _bad(f"{item.code} is counted in whole {base.code}: {posting_service._show(base_qty)} isn't a whole number")
    return base_qty


def _picked_line(
    db: Session, line_id: int, item: models.AccessoryItem, warehouse_id: int
) -> models.ExpectedDeliveryItem:
    line = db.get(models.ExpectedDeliveryItem, line_id)
    if line is None:
        raise _bad("Expected delivery line not found", status.HTTP_404_NOT_FOUND)
    if line.accessory_item_id != item.id:
        raise _bad("This delivery line is for another item")
    if line.delivery.warehouse_id != warehouse_id:
        raise _bad("This delivery is for another warehouse")
    if line.delivery.status == "cancelled":
        raise _bad("This delivery is cancelled")
    return line


def open_lines(
    db: Session, warehouse_id: int, item_id: int, supplier_type: Optional[str], supplier_id: Optional[int]
) -> List[models.ExpectedDeliveryItem]:
    """The lines a pack can be matched to, oldest first. No supplier = none
    (and deliveries with no supplier recorded never match)."""
    if supplier_type is None or supplier_id is None:
        return []
    return (
        db.query(models.ExpectedDeliveryItem)
        .join(models.ExpectedDelivery, models.ExpectedDeliveryItem.delivery_id == models.ExpectedDelivery.id)
        .filter(
            models.ExpectedDelivery.status.in_(_OPEN_STATUSES),
            models.ExpectedDelivery.warehouse_id == warehouse_id,
            models.ExpectedDelivery.supplier_type == supplier_type,
            models.ExpectedDelivery.client_supplier_id == supplier_id,
            models.ExpectedDeliveryItem.accessory_item_id == item_id,
        )
        .order_by(
            models.ExpectedDelivery.expected_date.asc().nulls_last(),
            models.ExpectedDelivery.created_at.asc(),
            models.ExpectedDelivery.id.asc(),
            models.ExpectedDeliveryItem.id.asc(),
        )
        .all()
    )


def _match(db: Session, lines: List[models.ExpectedDeliveryItem], count: int, qty: Decimal) -> List[Optional[int]]:
    """One line id (or None) per pack: the first line still short, counting
    the packs matched before it in this same Add."""
    received = accessory_received(db, [line.id for line in lines])
    left: Dict[int, Decimal] = {
        line.id: Decimal(line.expected_qty) - received.get(line.id, Decimal(0)) for line in lines
    }
    targets: List[Optional[int]] = []
    for _ in range(count):
        line_id = next((lid for lid in left if left[lid] > 0), None)
        if line_id is not None:
            left[line_id] -= qty
        targets.append(line_id)
    return targets


def receive_packs(
    db: Session, actor_id: int, payload: AccessoryReceiveIn
) -> Tuple[models.AccessoryPosting, List[models.AccessoryPack]]:
    item = get_item_or_404(db, payload.accessory_item_id)
    ensure_stockable(item)
    qty = _qty_in_base(db, item, payload.qty_per_pack, payload.uom_id)
    supplier = (payload.supplier_type, payload.client_supplier_id)

    if payload.expected_delivery_item_id is not None:
        line = _picked_line(db, payload.expected_delivery_item_id, item, payload.warehouse_id)
        delivery_supplier = (line.delivery.supplier_type, line.delivery.client_supplier_id)
        if supplier != (None, None) and supplier != delivery_supplier:
            raise _bad("The supplier isn't the one on this delivery")
        supplier = delivery_supplier
        targets: List[Optional[int]] = [line.id] * payload.pack_count
    else:
        lines = open_lines(db, payload.warehouse_id, item.id, *supplier)
        targets = _match(db, lines, payload.pack_count, qty)

    posting, packs = posting_service.receive(db, actor_id, payload.warehouse_id, [
        posting_service.NewPack(
            item_id=item.id, qty=qty, rack_id=payload.rack_id, expected_delivery_item_id=line_id,
            supplier_type=supplier[0], client_supplier_id=supplier[1],
        )
        for line_id in targets
    ])
    db.flush()
    for line_id in {t for t in targets if t is not None}:
        sync_delivery_item_from_packs(db, line_id)
    return posting, packs


def undo_receive(db: Session, user: models.User, posting_id: int) -> models.AccessoryPosting:
    """Cancel one Add. Refused for anything that isn't a Receive Packs
    posting, for someone else's (unless admin), once reversed, and once any of
    its packs has another ledger row (issued, split, adjusted...)."""
    posting = posting_service.get_posting_or_404(db, posting_id)
    entries = list(posting.entries)
    is_receive = (
        entries
        and posting.reverses_posting_id is None
        and posting.supplier_receipt_id is None
        and posting.internal_receipt_id is None
        and posting.external_receipt_id is None
        and all(e.entry_type == "receipt" and e.reversal_of is None for e in entries)
    )
    if not is_receive:
        raise _bad("This isn't a Receive Packs entry")
    if posting.created_by != user.id and not user_has_admin_role(db, user):
        raise _bad("Only the person who received these packs can undo it", status.HTTP_403_FORBIDDEN)
    if posting.reversed_by_posting_id is not None or any(e.is_reversed for e in entries):
        raise _bad("Already undone", status.HTTP_409_CONFLICT)
    pack_ids = {e.pack_id for e in entries}
    used = (
        db.query(models.AccessoryLedgerEntry.id)
        .filter(
            models.AccessoryLedgerEntry.pack_id.in_(pack_ids),
            models.AccessoryLedgerEntry.posting_id != posting.id,
        )
        .first()
    )
    if used is not None:
        raise _bad("These packs were used since, so this can't be undone here. Ask an admin to correct it")
    line_ids = {
        line_id for (line_id,) in db.query(models.AccessoryPack.expected_delivery_item_id)
        .filter(models.AccessoryPack.id.in_(pack_ids)).all() if line_id is not None
    }
    reversal = posting_service.reverse_posting(db, user.id, posting.id, UNDO_REASON)
    db.flush()
    for line_id in line_ids:
        sync_delivery_item_from_packs(db, line_id)
    return reversal


def _is_receive_packs_posting(posting: models.AccessoryPosting) -> bool:
    return (
        posting.reverses_posting_id is None
        and posting.supplier_receipt_id is None
        and posting.internal_receipt_id is None
        and posting.external_receipt_id is None
    )


def undo_receive_pack(db: Session, user: models.User, pack_id: int) -> models.AccessoryPosting:
    """Cancel one pack of an Add: its `receipt` row is reversed, so the pack
    is back to 0 (empty) and stops counting toward its delivery line. Refused
    for a pack not made by Receive Packs, for someone else's (unless admin),
    once undone, and once the pack has any other row (issued, split...)."""
    from backend.crud.accessory_packs import get_pack_or_404

    pack = get_pack_or_404(db, pack_id)
    rows = list(db.query(models.AccessoryLedgerEntry)
                .filter(models.AccessoryLedgerEntry.pack_id == pack.id)
                .order_by(models.AccessoryLedgerEntry.id).all())
    first = rows[0] if rows else None
    if (
        first is None
        or first.entry_type != "receipt"
        or first.reversal_of is not None
        or not _is_receive_packs_posting(first.posting)
    ):
        raise _bad("This pack wasn't made by Receive Packs")
    if first.posting.created_by != user.id and not user_has_admin_role(db, user):
        raise _bad("Only the person who received this pack can undo it", status.HTTP_403_FORBIDDEN)
    if first.is_reversed:
        raise _bad("Already undone", status.HTTP_409_CONFLICT)
    if len(rows) > 1:
        raise _bad("This pack was used since, so it can't be undone here. Ask an admin to correct it")
    reversal = posting_service.reverse_entries(db, user.id, [first], UNDO_REASON)
    db.flush()
    if pack.expected_delivery_item_id is not None:
        sync_delivery_item_from_packs(db, pack.expected_delivery_item_id)
    return reversal
