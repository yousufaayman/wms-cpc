"""Returning accessories to their supplier (item 22).

How a supplier return works, in plain words:
1. A **supplier return** is a supplier receipt of an Accessory warehouse: it
   goes to a supplier (a logical location of type supplier), with optional
   remarks (e.g. "wrong shade").
2. The worker scans packs onto it. Each scan is one **line**: the pack and how
   much (turned into the item's base unit). Checks when a line is added:
   - the pack is active, in this warehouse, and has enough **free** quantity
     (on hand minus what open issues / returns already hold back)
   - the pack came from this supplier. A pack from another supplier is
     refused; a pack with no supplier recorded, from a client, or made by a
     return from production can go to any supplier
3. Nothing leaves stock until the return is **closed** ("Close and send"):
   then every line becomes one `supplier_return` ledger row (-), all under
   one posting linked to the receipt.
4. A sent return is final: it can't be reopened. An admin **reverses** it
   (stock comes back, the lines show "Reversed") and the right packs go on a
   new return. Until it is sent, lines can be removed freely.

"Received" on an expected delivery doesn't change: only `receipt` rows count.
The delivery line shows what went back separately (`returned_to_supplier`).

Nothing here commits; the endpoint commits once.
"""
from decimal import Decimal
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend import models
from backend.core.warehouse_modules import ACCESSORY, ensure_receipt_line_kind
from backend.domains.accessories.issuing import list_lines, pending_by_pack
from backend.domains.accessories.pack_barcode import parse_pack_barcode
from backend.domains.accessories.receiving import qty_in_base
from backend.domains.posting import accessory as posting_service

_Line = models.AccessoryReceiptItem
_Led = models.AccessoryLedgerEntry
_show = posting_service._show


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _location_type(location: models.LogicalLocation) -> str:
    return getattr(location.location_type, "value", location.location_type)


def is_accessory_warehouse(db: Session, warehouse_id: int) -> bool:
    warehouse = db.get(models.Warehouse, warehouse_id)
    return warehouse is not None and getattr(warehouse.type, "value", warehouse.type) == ACCESSORY


def has_lines(db: Session, receipt_id: int) -> bool:
    return db.scalar(select(select(_Line.id).where(_Line.supplier_receipt_id == receipt_id).exists()))


def is_sent(db: Session, receipt_id: int) -> bool:
    """Any line of the return has a ledger row (it was closed and posted)."""
    return db.scalar(select(
        select(_Led.id).join(_Line, _Line.id == _Led.accessory_receipt_item_id)
        .where(_Line.supplier_receipt_id == receipt_id).exists()
    ))


# ── The header ───────────────────────────────────────────────────────────────

def check_header(
    db: Session, warehouse_id: int, target_location_id: Optional[int], receipt: Optional[models.SupplierReceipt] = None
) -> None:
    """Create / edit a supplier receipt of an Accessory warehouse: it goes to
    a supplier, and the supplier can't change once packs are scanned (each
    line was checked against it)."""
    if not is_accessory_warehouse(db, warehouse_id) or target_location_id is None:
        return
    location = db.get(models.LogicalLocation, target_location_id)
    if location is None:
        raise _bad("Logical location not found", status.HTTP_404_NOT_FOUND)
    if _location_type(location) != "supplier":
        raise _bad("A supplier return goes to a supplier")
    if receipt is not None and receipt.target_logical_location_id != target_location_id and has_lines(db, receipt.id):
        raise _bad("Packs are already scanned for this supplier: remove them before changing the supplier")


def _open_return(db: Session, receipt_id: int) -> models.SupplierReceipt:
    ensure_receipt_line_kind(db, "supplier", receipt_id, "accessory")
    receipt = db.get(models.SupplierReceipt, receipt_id)
    if receipt.closed:
        raise _bad("This return is already closed")
    return receipt


# ── Lines ────────────────────────────────────────────────────────────────────

def _check_supplier(db: Session, pack: models.AccessoryPack, receipt: models.SupplierReceipt) -> None:
    """A pack from a supplier only goes back to that supplier."""
    if pack.supplier_type != "logical_location" or pack.client_supplier_id is None:
        return  # no supplier recorded, or a client's trims
    source = db.get(models.LogicalLocation, pack.client_supplier_id)
    if source is None or _location_type(source) != "supplier":
        return  # made by a return from production: no supplier to compare
    if source.id != receipt.target_logical_location_id:
        target = receipt.target_logical_location
        raise _bad(f"Pack {pack.id} came from {source.name}, not {target.name if target else 'this supplier'}")


def add_line(db: Session, receipt_id: int, data, actor_id: int) -> models.AccessoryReceiptItem:
    """Scan a pack onto a supplier return (`data` = AccessoryReceiptItemCreate;
    the job order and over-issue fields don't apply here)."""
    receipt = _open_return(db, receipt_id)
    if data.pack_id is not None:
        pack_id = data.pack_id
    else:
        pack_id = parse_pack_barcode(data.barcode or "")
        if pack_id is None:
            raise _bad("That isn't a pack barcode (like 1042*ACC)")

    # Locked, so two scans of it at the same moment are checked one after the other
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
    _check_supplier(db, pack, receipt)

    item = pack.item
    qty = qty_in_base(db, item, data.qty, data.uom_id)
    free = posting_service.pack_quantity(db, pack.id) - pending_by_pack(db, [pack.id]).get(pack.id, Decimal(0))
    if qty > free:
        raise _bad(f"Pack {pack.id} has only {_show(max(free, Decimal(0)))} {item.base_uom.code} free")

    line = _Line(
        supplier_receipt_id=receipt.id,
        pack_id=pack.id,
        accessory_item_id=item.id,
        qty=qty,
        created_by=actor_id,
    )
    db.add(line)
    db.flush()
    db.refresh(line)
    line.posted = False
    return line


def check_line_removable(db: Session, line: models.AccessoryReceiptItem) -> None:
    receipt = db.get(models.SupplierReceipt, line.supplier_receipt_id)
    if receipt.closed:
        raise _bad("This return is already closed")


# ── Close = send ─────────────────────────────────────────────────────────────

def send(db: Session, receipt: models.SupplierReceipt, actor_id: int) -> models.AccessoryPosting:
    """Take every line out of stock: one `supplier_return` row per line, one
    posting. The posting service checks again that no pack goes below zero."""
    lines: List[models.AccessoryReceiptItem] = [line for line in list_lines(db, "supplier", receipt.id) if not line.posted]
    if not lines:
        raise _bad("Scan at least one pack before closing")
    return posting_service.post(
        db, actor_id,
        [posting_service.LedgerLine(pack_id=line.pack_id, entry_type="supplier_return", qty_delta=-line.qty,
                                    receipt_line_id=line.id) for line in lines],
        receipt_kind="supplier", receipt_id=receipt.id,
    )


def check_reopen(db: Session, receipt: models.SupplierReceipt) -> None:
    if is_accessory_warehouse(db, receipt.source_warehouse_id) and is_sent(db, receipt.id):
        raise _bad("This return was sent to the supplier: an admin reverses it instead of reopening it")


def check_delete(db: Session, receipt: models.SupplierReceipt) -> None:
    if is_accessory_warehouse(db, receipt.source_warehouse_id) and is_sent(db, receipt.id):
        raise _bad("This return was sent to the supplier and is in the stock history: it can't be deleted")
