"""Accessory packs (item 12): the rules for making a pack and moving it
between racks. No quantities here: what a pack holds comes from the ledger
(item 13).

- `create_pack` is for receiving (item 17) and the opening balance (item 25),
  which save the pack and its first ledger row in one transaction. So it only
  flushes, and there's no API endpoint that makes an empty pack.
- `move_pack` puts a pack on a rack (or takes it off) and writes the history
  row. The pack page's move endpoint and, later, the item-31 Assign to Rack
  page both use it.
- Lookups: by id, by scanned barcode (`<id>*ACC`), and a filtered list.
"""
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.core.warehouse_modules import ensure_module
from backend.crud.accessory_items import ensure_stockable, get_item_or_404
from backend.domains.accessories.pack_barcode import parse_pack_barcode
from backend.models import (
    AccessoryPack,
    AccessoryPackMove,
    Client,
    ExpectedDeliveryItem,
    LogicalLocation,
    WarehouseRack,
)
from backend.schemas import AccessoryPackSearch

# Packs are accessory stock: only warehouses with Accessory Inventory hold them.
MODULE = "accessory_inventory"


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _rack_in_warehouse(db: Session, rack_id: int, warehouse_id: int) -> WarehouseRack:
    rack = db.get(WarehouseRack, rack_id)
    if rack is None:
        raise _bad("Rack not found", status.HTTP_404_NOT_FOUND)
    if rack.warehouse_id != warehouse_id:
        raise _bad(f"Rack {rack.rack_code} belongs to another warehouse")
    return rack


def _check_supplier(db: Session, supplier_type: Optional[str], supplier_id: Optional[int]) -> None:
    """Same pair as expected deliveries: both or neither. A client, or a
    supplier-type logical location."""
    if (supplier_type is None) != (supplier_id is None):
        raise _bad("Give both the supplier type and the supplier, or neither")
    if supplier_type is None:
        return
    if supplier_type == "client":
        if db.get(Client, supplier_id) is None:
            raise _bad("Client not found", status.HTTP_404_NOT_FOUND)
    elif supplier_type == "logical_location":
        location = db.get(LogicalLocation, supplier_id)
        if location is None:
            raise _bad("Supplier not found", status.HTTP_404_NOT_FOUND)
        if getattr(location.location_type, "value", location.location_type) != "supplier":
            raise _bad(f"{location.name} is not a supplier")
    else:
        raise _bad("Supplier type must be 'client' or 'logical_location'")


def create_pack(
    db: Session,
    *,
    item_id: int,
    warehouse_id: int,
    created_by: int,
    rack_id: Optional[int] = None,
    expected_delivery_item_id: Optional[int] = None,
    supplier_type: Optional[str] = None,
    client_supplier_id: Optional[int] = None,
) -> AccessoryPack:
    """A new, active pack. Only flushes: the caller adds the pack's ledger row
    and commits both together. `created_by` = the logged-in user."""
    item = get_item_or_404(db, item_id)
    ensure_stockable(item)
    ensure_module(db, warehouse_id, MODULE)
    if rack_id is not None:
        _rack_in_warehouse(db, rack_id, warehouse_id)
    if expected_delivery_item_id is not None and db.get(ExpectedDeliveryItem, expected_delivery_item_id) is None:
        raise _bad("Expected delivery line not found", status.HTTP_404_NOT_FOUND)
    _check_supplier(db, supplier_type, client_supplier_id)

    pack = AccessoryPack(
        accessory_item_id=item.id,
        warehouse_id=warehouse_id,
        rack_id=rack_id,
        expected_delivery_item_id=expected_delivery_item_id,
        supplier_type=supplier_type,
        client_supplier_id=client_supplier_id,
        status="active",
        created_by=created_by,
    )
    db.add(pack)
    db.flush()
    db.refresh(pack)
    return pack


def get_pack_or_404(db: Session, pack_id: int) -> AccessoryPack:
    pack = db.get(AccessoryPack, pack_id)
    if pack is None:
        raise _bad("Pack not found", status.HTTP_404_NOT_FOUND)
    return pack


def find_by_barcode(db: Session, barcode: str) -> AccessoryPack:
    """A scanned label → its pack. 400 for anything that isn't a pack label
    (a roll, a rack, a bare number), 404 for an unknown pack."""
    pack_id = parse_pack_barcode(barcode)
    if pack_id is None:
        raise _bad("Not a pack label")
    return get_pack_or_404(db, pack_id)


def list_packs(db: Session, search: AccessoryPackSearch) -> Tuple[List[AccessoryPack], int]:
    conditions = []
    if search.warehouse_id is not None:
        conditions.append(AccessoryPack.warehouse_id == search.warehouse_id)
    if search.accessory_item_id is not None:
        conditions.append(AccessoryPack.accessory_item_id == search.accessory_item_id)
    if search.unracked:
        conditions.append(AccessoryPack.rack_id.is_(None))
    elif search.rack_id is not None:
        conditions.append(AccessoryPack.rack_id == search.rack_id)
    if search.status is not None:
        conditions.append(AccessoryPack.status == search.status)

    total = db.scalar(select(func.count()).select_from(AccessoryPack).where(*conditions))
    packs = db.scalars(
        select(AccessoryPack).where(*conditions)
        .order_by(AccessoryPack.id.desc())
        .limit(search.limit).offset(search.offset)
    ).all()
    return list(packs), total


def move_pack(db: Session, pack: AccessoryPack, rack_id: Optional[int], moved_by: int) -> AccessoryPackMove:
    """Put `pack` on rack `rack_id` (None = take it off its rack) and record
    the move. The rack must be in the pack's warehouse; an empty pack isn't
    moved (nothing is left in it); moving to the rack it's already on is
    refused so the history only holds real moves. Commits."""
    if pack.status == "empty":
        raise _bad(f"Pack {pack.barcode} is empty")
    if rack_id == pack.rack_id:
        where = f"rack {pack.rack_code}" if rack_id is not None else "no rack"
        raise _bad(f"Pack {pack.barcode} is already on {where}")
    ensure_module(db, pack.warehouse_id, MODULE)
    if rack_id is not None:
        _rack_in_warehouse(db, rack_id, pack.warehouse_id)

    move = AccessoryPackMove(pack_id=pack.id, from_rack_id=pack.rack_id, to_rack_id=rack_id, moved_by=moved_by)
    pack.rack_id = rack_id
    db.add(move)
    db.commit()
    db.refresh(pack)
    db.refresh(move)
    return move


def list_moves(db: Session, pack_id: int) -> List[AccessoryPackMove]:
    get_pack_or_404(db, pack_id)
    return list(db.scalars(
        select(AccessoryPackMove).where(AccessoryPackMove.pack_id == pack_id).order_by(AccessoryPackMove.id)
    ).all())
