"""Pack operations (item 21): returns from production, split, merge, reclassify.

What each one does, in plain words. Every action is one posting through the
posting service (`domains/posting/accessory.py`), so the usual rules hold (a
pack never below zero, rows on the pack's item, empty / active flips) and an
admin can reverse it as a whole.

- **Return from production**: unused trims of a job order come back. One
  `return` row (+) with the JO and its requirement line, so "returned" and
  "remaining" in Material Requests move. The quantity can't be more than what
  is still out on that requirement (issued minus returned, in this warehouse).
  The trims go into any pack of the same item in this warehouse, or into a new
  pack. "Returned from" is the internal location / production line they came
  back from: only a place this requirement's stock was issued to. The return
  posting links the latest issue receipt to that place (so the ledger's
  From / To shows it, and reversing that issue receipt undoes the return
  too); a new pack also records it as its source (supplier pair).
- **Split**: part of a pack goes into N new packs (same item, supplier and
  delivery batch; same rack unless another is given). `transfer` rows: minus
  on the source, plus on each new pack.
- **Merge**: packs of the same item are emptied into one kept pack. One
  `transfer` pair per emptied pack; the emptied packs become `empty`.
- **Reclassify** (admin): part or all of a pack becomes another item with the
  same base unit (e.g. generic stock dedicated to a client). `reclassify` rows:
  minus on the old pack, plus on a new pack of the target item. Needs a reason.

Split, merge and reclassify only move a pack's **free** quantity: what it
holds minus what open (not yet confirmed) issue lines hold back from it, so a
later confirm of that issue can't fail.

Nothing here commits; the endpoint commits once.
"""
from dataclasses import dataclass
from decimal import Decimal
from typing import List, Optional, Sequence, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend import models
from backend.core.warehouse_modules import ensure_module
from backend.crud.accessory_items import ensure_stockable, get_item_or_404
from backend.crud.accessory_packs import create_pack, get_pack_or_404
from backend.domains.accessories.issuing import ISSUE_TARGET_TYPES, pending_by_pack
from backend.domains.accessories.receiving import qty_in_base
from backend.domains.posting import accessory as posting_service
from backend.domains.posting.accessory import LedgerLine

MODULE = "pack_operations"
MAX_NEW_PACKS = 100
# A pack's source may be any logical location when it's copied from another
# pack (a split / reclassified pack keeps where the stock came from).
_ANY_LOCATION = ("supplier", "internal", "production_line")

_Led = models.AccessoryLedgerEntry
_Pack = models.AccessoryPack
_Req = models.JobOrderAccessoryRequirement
_show = posting_service._show


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def free_quantity(db: Session, pack: models.AccessoryPack) -> Decimal:
    """On hand minus what open issue lines hold back from the pack."""
    return posting_service.pack_quantity(db, pack.id) - pending_by_pack(db, [pack.id]).get(pack.id, Decimal(0))


def _ensure_free(db: Session, pack: models.AccessoryPack, qty: Decimal) -> None:
    free = free_quantity(db, pack)
    if qty > free:
        held = pending_by_pack(db, [pack.id]).get(pack.id, Decimal(0))
        extra = f" ({_show(held)} held by open issues)" if held else ""
        raise _bad(f"Pack {pack.id} has only {_show(max(free, Decimal(0)))} {pack.uom_code} free{extra}")


def _rack_or_source(pack: models.AccessoryPack, rack_id: Optional[int], keep_rack: bool) -> Optional[int]:
    return pack.rack_id if keep_rack else rack_id


# ── Return from production ───────────────────────────────────────────────────

@dataclass
class ReturnableLine:
    """One requirement line of a JO with stock still out in this warehouse."""
    requirement: models.JobOrderAccessoryRequirement
    issued: Decimal
    returned: Decimal
    # Where its stock was issued to, latest first: [(location, latest issue receipt id)].
    issued_to: List[Tuple[models.LogicalLocation, int]]

    @property
    def out(self) -> Decimal:
        return self.issued - self.returned

    @property
    def last_location_id(self) -> Optional[int]:
        """Where its latest issue went (the default "returned from")."""
        return self.issued_to[0][0].id if self.issued_to else None


def _out_totals(db: Session, warehouse_id: int, requirement_ids: Optional[Sequence[int]] = None,
                job_order_id: Optional[int] = None):
    q = (
        select(
            _Led.jo_requirement_id,
            func.coalesce(-func.sum(_Led.qty_delta).filter(_Led.entry_type == "issue"), 0),
            func.coalesce(func.sum(_Led.qty_delta).filter(_Led.entry_type == "return"), 0),
        )
        .join(_Pack, _Pack.id == _Led.pack_id)
        .where(_Pack.warehouse_id == warehouse_id, _Led.jo_requirement_id.is_not(None),
               _Led.entry_type.in_(("issue", "return")))
        .group_by(_Led.jo_requirement_id)
    )
    if requirement_ids is not None:
        q = q.where(_Led.jo_requirement_id.in_(list(requirement_ids)))
    if job_order_id is not None:
        q = q.where(_Led.job_order_id == job_order_id)
    return {req_id: (Decimal(issued), Decimal(returned)) for req_id, issued, returned in db.execute(q).all()}


def _issued_to(db: Session, warehouse_id: int, requirement_ids: Sequence[int]) -> dict:
    """Per requirement: [(location, its latest issue receipt id)], latest first,
    from this warehouse's issues that are still standing (not reversed)."""
    if not requirement_ids:
        return {}
    rows = db.execute(
        select(_Led.jo_requirement_id, models.InternalReceipt.target_logical_location_id, models.InternalReceipt.id)
        .join(_Pack, _Pack.id == _Led.pack_id)
        .join(models.AccessoryPosting, models.AccessoryPosting.id == _Led.posting_id)
        .join(models.InternalReceipt, models.InternalReceipt.id == models.AccessoryPosting.internal_receipt_id)
        .where(_Led.jo_requirement_id.in_(list(requirement_ids)), _Led.entry_type == "issue",
               _Led.reversal_of.is_(None), _Led.is_reversed.is_(False), _Pack.warehouse_id == warehouse_id)
        .order_by(_Led.id.desc())
    ).all()
    out: dict = {}
    for req_id, location_id, receipt_id in rows:
        places = out.setdefault(req_id, [])
        if all(loc.id != location_id for loc, _ in places):
            places.append((db.get(models.LogicalLocation, location_id), receipt_id))
    return out


def returnable_lines(db: Session, warehouse_id: int, job_order_id: int) -> List[ReturnableLine]:
    """The JO's requirement lines with something still out from this warehouse."""
    ensure_module(db, warehouse_id, MODULE)
    if db.get(models.JobOrder, job_order_id) is None:
        raise _bad("Job order not found", status.HTTP_404_NOT_FOUND)
    totals = _out_totals(db, warehouse_id, job_order_id=job_order_id)
    ids = [req_id for req_id, (issued, returned) in totals.items() if issued - returned > 0]
    if not ids:
        return []
    places = _issued_to(db, warehouse_id, ids)
    reqs = db.scalars(select(_Req).where(_Req.id.in_(ids)).order_by(_Req.id)).unique().all()
    return [ReturnableLine(r, *totals[r.id], places.get(r.id, [])) for r in reqs]


def _return_source(
    db: Session, warehouse_id: int, req: models.JobOrderAccessoryRequirement, location_id: int,
) -> Tuple[models.LogicalLocation, int]:
    """The place trims come back from must be one this line's stock was issued
    to. Returns (location, the latest issue receipt to it)."""
    location = db.get(models.LogicalLocation, location_id)
    if location is None:
        raise _bad("Logical location not found", status.HTTP_404_NOT_FOUND)
    for place, receipt_id in _issued_to(db, warehouse_id, [req.id]).get(req.id, []):
        if place.id == location.id:
            return location, receipt_id
    raise _bad(f"{req.accessory_item.code} of this job order wasn't issued to {location.name}")


def return_trims(db: Session, actor_id: int, data) -> Tuple[models.AccessoryPosting, models.AccessoryPack, bool]:
    """`data`: warehouse_id, job_order_id, jo_requirement_id, qty, uom_id,
    from_location_id, pack_id (None = new pack), rack_id (new pack), reason.
    Returns (posting, pack, created)."""
    ensure_module(db, data.warehouse_id, MODULE)
    # Locked so two returns at the same moment can't both bring back the last pieces.
    req = db.scalars(select(_Req).where(_Req.id == data.jo_requirement_id).with_for_update(of=_Req)).unique().first()
    if req is None:
        raise _bad("Requirement not found", status.HTTP_404_NOT_FOUND)
    if req.job_order_id != data.job_order_id:
        raise _bad("This requirement line is for another job order")
    location, issue_receipt_id = _return_source(db, data.warehouse_id, req, data.from_location_id)
    item = req.accessory_item
    qty = qty_in_base(db, item, data.qty, data.uom_id)

    issued, returned = _out_totals(db, data.warehouse_id, [req.id]).get(req.id, (Decimal(0), Decimal(0)))
    out = issued - returned
    if qty > out:
        raise _bad(f"Only {_show(max(out, Decimal(0)))} {item.base_uom.code} of {item.code} is out on this "
                   f"job order, can't return {_show(qty)}")

    created = data.pack_id is None
    if created:
        pack = create_pack(
            db, item_id=item.id, warehouse_id=data.warehouse_id, created_by=actor_id, rack_id=data.rack_id,
            supplier_type="logical_location", client_supplier_id=location.id,
            supplier_location_types=ISSUE_TARGET_TYPES,
        )
    else:
        pack = get_pack_or_404(db, data.pack_id)
        if pack.accessory_item_id != item.id:
            raise _bad(f"Pack {pack.id} holds {pack.item_code}, not {item.code}")
        if pack.warehouse_id != data.warehouse_id:
            raise _bad(f"Pack {pack.id} is in another warehouse")
    posting = posting_service.post(
        db, actor_id,
        [LedgerLine(pack.id, "return", qty, job_order_id=req.job_order_id, jo_requirement_id=req.id)],
        reason=data.reason, receipt_kind="internal", receipt_id=issue_receipt_id,
    )
    return posting, pack, created


# ── Split ────────────────────────────────────────────────────────────────────

def split(db: Session, actor_id: int, pack_id: int, data) -> Tuple[models.AccessoryPosting, List[models.AccessoryPack]]:
    """`data`: pack_count, qty (per new pack), uom_id, rack_id, keep_rack.
    Returns (posting, new packs)."""
    source = get_pack_or_404(db, pack_id)
    ensure_module(db, source.warehouse_id, MODULE)
    if not 1 <= data.pack_count <= MAX_NEW_PACKS:
        raise _bad(f"Make between 1 and {MAX_NEW_PACKS} new packs")
    each = qty_in_base(db, source.item, data.qty, data.uom_id)
    total = each * data.pack_count
    _ensure_free(db, source, total)

    rack_id = _rack_or_source(source, data.rack_id, data.keep_rack)
    new_packs = [
        create_pack(
            db, item_id=source.accessory_item_id, warehouse_id=source.warehouse_id, created_by=actor_id,
            rack_id=rack_id, expected_delivery_item_id=source.expected_delivery_item_id,
            supplier_type=source.supplier_type, client_supplier_id=source.client_supplier_id,
            supplier_location_types=_ANY_LOCATION,
        )
        for _ in range(data.pack_count)
    ]
    posting = posting_service.post(db, actor_id, [
        LedgerLine(source.id, "transfer", -total),
        *(LedgerLine(p.id, "transfer", each) for p in new_packs),
    ])
    return posting, new_packs


# ── Merge ────────────────────────────────────────────────────────────────────

def merge(db: Session, actor_id: int, keep_pack_id: int, from_pack_ids: Sequence[int]) -> models.AccessoryPosting:
    """Empty every pack of `from_pack_ids` into the kept pack."""
    keep = get_pack_or_404(db, keep_pack_id)
    ensure_module(db, keep.warehouse_id, MODULE)
    ids = list(dict.fromkeys(from_pack_ids))
    if not ids:
        raise _bad("Scan at least one pack to empty into it")
    if keep.id in ids:
        raise _bad("The kept pack can't be emptied into itself")
    lines: List[LedgerLine] = []
    for pack_id in ids:
        pack = get_pack_or_404(db, pack_id)
        if pack.accessory_item_id != keep.accessory_item_id:
            raise _bad(f"Pack {pack.id} holds {pack.item_code}: only packs of {keep.item_code} can be merged")
        if pack.warehouse_id != keep.warehouse_id:
            raise _bad(f"Pack {pack.id} is in another warehouse")
        held = pending_by_pack(db, [pack.id]).get(pack.id, Decimal(0))
        if held:
            raise _bad(f"Pack {pack.id} has {_show(held)} held by an open issue: confirm or remove that line first")
        qty = posting_service.pack_quantity(db, pack.id)
        if qty <= 0:
            raise _bad(f"Pack {pack.id} is empty")
        lines += [LedgerLine(pack.id, "transfer", -qty), LedgerLine(keep.id, "transfer", qty)]
    return posting_service.post(db, actor_id, lines)


# ── Reclassify (admin) ───────────────────────────────────────────────────────

def reclassify(db: Session, actor_id: int, pack_id: int, data) -> Tuple[models.AccessoryPosting, models.AccessoryPack]:
    """`data`: target_item_id, qty (None = everything free), uom_id, reason,
    rack_id, keep_rack. Returns (posting, the new pack)."""
    source = get_pack_or_404(db, pack_id)
    ensure_module(db, source.warehouse_id, MODULE)
    if not (data.reason or "").strip():
        raise _bad("A reclassify needs a reason")
    target = get_item_or_404(db, data.target_item_id)
    if target.id == source.accessory_item_id:
        raise _bad("Pick another item than the pack's own")
    ensure_stockable(target)
    if target.base_uom_id != source.item.base_uom_id:
        raise _bad(f"{target.code} is counted in {target.base_uom.code}, the pack in {source.uom_code}: "
                   "only items with the same base unit")
    if data.qty is None:
        qty = free_quantity(db, source)
        if qty <= 0:
            raise _bad(f"Pack {source.id} has nothing free to reclassify")
    else:
        qty = qty_in_base(db, source.item, data.qty, data.uom_id)
    _ensure_free(db, source, qty)

    # The source pair stays (where the stock came from); the delivery batch
    # doesn't: that delivery line is for the old item.
    new_pack = create_pack(
        db, item_id=target.id, warehouse_id=source.warehouse_id, created_by=actor_id,
        rack_id=_rack_or_source(source, data.rack_id, data.keep_rack),
        supplier_type=source.supplier_type, client_supplier_id=source.client_supplier_id,
        supplier_location_types=_ANY_LOCATION,
    )
    posting = posting_service.post(db, actor_id, [
        LedgerLine(source.id, "reclassify", -qty),
        LedgerLine(new_pack.id, "reclassify", qty),
    ], reason=data.reason)
    return posting, new_pack
