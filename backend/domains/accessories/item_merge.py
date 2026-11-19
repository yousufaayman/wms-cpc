"""Merge duplicate items (item 23, admin only).

A duplicate = the same trim registered twice under two codes. The admin picks
the duplicate and the item to keep; one merge moves everything that can move
and switches the duplicate off for good:

- **stock**: every pack of the duplicate that holds something (any warehouse)
  gets a new pack of the kept item, same warehouse, rack and supplier pair.
  One posting of `reclassify` rows (minus on the old pack, plus on the new),
  so the old packs become empty and need new labels;
- **references**: the client / supplier codes move to the kept item (unique
  per party, so nothing can clash);
- **expected delivery lines** on open deliveries (pending / partial) move to
  the kept item, so the next shipment matches it. Closed deliveries keep the
  duplicate as history. A new pack keeps its delivery line only when that
  line moved;
- **unit conversions**: the duplicate's own conversions the kept item lacks
  are copied (a variant kept item uses its template's, so nothing is copied);
- **the duplicate**: `active = false`, `merged_into_id` = the kept item.
  Final: it can't be switched on again and the posting service refuses any
  later row on its packs, so the merge posting can't be reversed either.

JO requirement lines stay on the duplicate (WMS only reads them and the
ledger ties issues to their line's item), so the merge waits while one of
them still has something to issue: the other system moves it first.

`preview` lists what would happen and what blocks it; `merge` refuses with
the same reasons. Nothing here commits; the endpoint does.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend import models
from backend.crud.accessory_items import get_item_or_404
from backend.crud.accessory_packs import create_pack
from backend.domains.accessories.issuing import pending_by_pack
from backend.domains.posting import accessory as posting_service
from backend.domains.posting.accessory import LedgerLine

_Item = models.AccessoryItem
_Pack = models.AccessoryPack
_Led = models.AccessoryLedgerEntry
_Req = models.JobOrderAccessoryRequirement
_Line = models.ExpectedDeliveryItem
_OPEN_DELIVERY = ("pending", "partial")
_ANY_LOCATION = ("supplier", "internal", "production_line")
_show = posting_service._show


@dataclass
class MergePreview:
    duplicate: models.AccessoryItem
    keep: models.AccessoryItem
    packs: List[models.AccessoryPack] = field(default_factory=list)  # with stock, to move
    quantities: dict = field(default_factory=dict)  # pack id -> on hand
    refs: int = 0
    delivery_lines: List[models.ExpectedDeliveryItem] = field(default_factory=list)
    conversions: List[models.UomConversion] = field(default_factory=list)  # to copy
    category_differs: bool = False
    blockers: List[str] = field(default_factory=list)

    @property
    def total(self) -> Decimal:
        return sum(self.quantities.values(), Decimal(0))


def _open_requirements(db: Session, item_id: int) -> List[str]:
    """Requirement lines of the item, on JOs not archived, still to issue."""
    issued = func.coalesce(
        select(-func.sum(_Led.qty_delta)).where(_Led.jo_requirement_id == _Req.id, _Led.entry_type == "issue")
        .scalar_subquery(), 0)
    returned = func.coalesce(
        select(func.sum(_Led.qty_delta)).where(_Led.jo_requirement_id == _Req.id, _Led.entry_type == "return")
        .scalar_subquery(), 0)
    rows = db.execute(
        select(models.JobOrder.job_order_number, _Req.qty_needed - (issued - returned))
        .join(models.JobOrder, models.JobOrder.job_order_id == _Req.job_order_id)
        .where(_Req.accessory_item_id == item_id, models.JobOrder.archived_at.is_(None),
               _Req.qty_needed - (issued - returned) > 0)
        .order_by(_Req.id)
    ).all()
    return [f"{number} ({_show(Decimal(left))} still to issue)" for number, left in rows]


def _item_rules(duplicate: models.AccessoryItem, keep: models.AccessoryItem) -> List[str]:
    out = []
    if duplicate.id == keep.id:
        return ["Pick another item to keep than the duplicate itself"]
    if duplicate.merged_into_id is not None:
        out.append(f"{duplicate.code} was already merged into {duplicate.merged_into_code}")
    if not keep.active:
        out.append(f"{keep.code} is switched off: keep an active item")
    if keep.parent_template is not None and not keep.parent_template.active:
        out.append(f"The template {keep.parent_template.code} is switched off")
    for item in (duplicate, keep):
        if item.is_template:
            out.append(f"{item.code} is a template: merge its variants one by one")
    if duplicate.base_uom_id != keep.base_uom_id:
        out.append(f"{duplicate.code} is counted in {duplicate.base_uom.code}, {keep.code} in "
                   f"{keep.base_uom.code}: only items with the same base unit")
    if keep.client_id is not None and keep.client_id != duplicate.client_id:
        out.append(f"{keep.code} is for one client only: it can't take "
                   f"{'generic' if duplicate.client_id is None else 'another client'}'s stock and codes")
    return out


def preview(db: Session, duplicate_id: int, keep_id: int) -> MergePreview:
    duplicate = get_item_or_404(db, duplicate_id)
    keep = get_item_or_404(db, keep_id)
    p = MergePreview(duplicate, keep, category_differs=duplicate.category_id != keep.category_id)
    p.blockers = _item_rules(duplicate, keep)
    if duplicate.id == keep.id:
        return p

    packs = db.scalars(select(_Pack).where(_Pack.accessory_item_id == duplicate.id).order_by(_Pack.id)).all()
    held = pending_by_pack(db, [pk.id for pk in packs])
    for pack in packs:
        if held.get(pack.id):
            p.blockers.append(f"Pack {pack.id} has {_show(held[pack.id])} {pack.uom_code} held by an open issue "
                              "or supplier return: confirm, send or remove that line first")
        qty = posting_service.pack_quantity(db, pack.id)
        if qty > 0:
            p.packs.append(pack)
            p.quantities[pack.id] = qty
    for jo in _open_requirements(db, duplicate.id):
        p.blockers.append(f"Job order {jo} needs {duplicate.code}: the requirement line must move to "
                          f"{keep.code} in the other system first")

    p.refs = len(duplicate.refs)
    p.delivery_lines = db.scalars(
        select(_Line).join(models.ExpectedDelivery, models.ExpectedDelivery.id == _Line.delivery_id)
        .where(_Line.accessory_item_id == duplicate.id, models.ExpectedDelivery.status.in_(_OPEN_DELIVERY))
        .order_by(_Line.id)
    ).all()
    if keep.parent_template is None:
        have = {frozenset((c.from_uom_id, c.to_uom_id)) for c in _own_conversions(db, keep.id)}
        p.conversions = [c for c in _own_conversions(db, duplicate.id)
                         if frozenset((c.from_uom_id, c.to_uom_id)) not in have]
    return p


def _own_conversions(db: Session, item_id: int) -> List[models.UomConversion]:
    return db.scalars(
        select(models.UomConversion).where(models.UomConversion.accessory_item_id == item_id)
        .order_by(models.UomConversion.id)
    ).all()


def merge(db: Session, actor_id: int, duplicate_id: int, keep_id: int, reason: Optional[str]):
    """Returns (preview as it was, posting or None when there was no stock,
    new packs in the order of `preview.packs`)."""
    text = (reason or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A merge needs a reason")
    # Locked so two admins can't merge the same duplicate at once.
    db.scalars(select(_Item).where(_Item.id == duplicate_id).with_for_update(of=_Item)).first()
    p = preview(db, duplicate_id, keep_id)
    if p.blockers:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "; ".join(p.blockers))
    duplicate, keep = p.duplicate, p.keep
    moved_lines = {line.id for line in p.delivery_lines}

    new_packs: List[models.AccessoryPack] = []
    lines: List[LedgerLine] = []
    for pack in p.packs:
        new = create_pack(
            db, item_id=keep.id, warehouse_id=pack.warehouse_id, created_by=actor_id, rack_id=pack.rack_id,
            expected_delivery_item_id=pack.expected_delivery_item_id if pack.expected_delivery_item_id in moved_lines else None,
            supplier_type=pack.supplier_type, client_supplier_id=pack.client_supplier_id,
            supplier_location_types=_ANY_LOCATION,
        )
        new_packs.append(new)
        qty = p.quantities[pack.id]
        lines += [LedgerLine(pack.id, "reclassify", -qty), LedgerLine(new.id, "reclassify", qty)]
    posting = None
    if lines:
        posting = posting_service.post(
            db, actor_id, lines, reason=f"Merged {duplicate.code} into {keep.code}: {text}"[:500],
        )

    for ref in list(duplicate.refs):
        ref.item = keep
    for line in p.delivery_lines:
        line.accessory_item_id = keep.id
    for conv in p.conversions:
        db.add(models.UomConversion(
            from_uom_id=conv.from_uom_id, to_uom_id=conv.to_uom_id, factor=conv.factor, accessory_item_id=keep.id,
        ))
    duplicate.active = False
    duplicate.merged_into_id = keep.id
    duplicate.updated_at = datetime.now(timezone.utc)
    db.flush()
    db.expire(duplicate)
    db.expire(keep)
    return p, posting, new_packs
