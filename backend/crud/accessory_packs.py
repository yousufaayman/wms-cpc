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
- `stock_summary` (item 14): the Accessory Inventory roll-ups by item, client
  or rack, read from the `wms.accessory_stock` view (on hand per pack).
"""
from collections import defaultdict
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import case, distinct, func, literal, select
from sqlalchemy.orm import Session

from backend.core.warehouse_modules import ensure_module
from backend.crud.accessory_items import ensure_stockable, get_item_or_404, matching_item_ids
from backend.domains.accessories.pack_barcode import parse_pack_barcode
from backend.models import (
    AccessoryItem,
    AccessoryPack,
    AccessoryPackMove,
    Client,
    ExpectedDeliveryItem,
    LogicalLocation,
    Uom,
    WarehouseRack,
    accessory_stock,
)
from backend.schemas import AccessoryPackSearch, AccessoryStockSearch

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


def _item_conditions(item_id_col, search) -> list:
    """Which items (`StockItemFilters`): the Items page quick search and
    advanced fields, client or generic. No item filter given = no condition."""
    matching = matching_item_ids(search.item_search())
    return [] if matching is None else [item_id_col.in_(matching)]


def _place_conditions(warehouse_col, rack_col, search) -> list:
    """Which warehouse and rack; `unracked` = waiting for put-away."""
    conditions = []
    if search.warehouse_id is not None:
        conditions.append(warehouse_col == search.warehouse_id)
    if search.unracked:
        conditions.append(rack_col.is_(None))
    elif search.rack_id is not None:
        conditions.append(rack_col == search.rack_id)
    return conditions


def list_packs(db: Session, search: AccessoryPackSearch) -> Tuple[List[AccessoryPack], int]:
    conditions = _place_conditions(AccessoryPack.warehouse_id, AccessoryPack.rack_id, search)
    conditions += _item_conditions(AccessoryPack.accessory_item_id, search)
    if search.accessory_item_id is not None:
        conditions.append(AccessoryPack.accessory_item_id == search.accessory_item_id)
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
        raise _bad(f"Pack {pack.id} is empty")
    if rack_id == pack.rack_id:
        where = f"rack {pack.rack_code}" if rack_id is not None else "no rack"
        raise _bad(f"Pack {pack.id} is already on {where}")
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


# ── Accessory Inventory roll-ups (item 14) ──────────────────────────────────

_STOCK = accessory_stock.c
_GROUP_KEY = {"item": _STOCK.accessory_item_id, "client": _STOCK.client_id, "rack": _STOCK.rack_id}


def stock_summary(db: Session, search: AccessoryStockSearch) -> Tuple[List[dict], int]:
    """Stock grouped by item, client or rack: item count, pack count and the
    on-hand total per unit. Rows with key None = generic items (by client)
    or packs waiting for put-away (by rack); those come first.

    One query over the view groups by (key, unit); the units are then folded
    into one row per key. Sorted by item code / client name / rack code, then
    paged."""
    key = _GROUP_KEY[search.group_by]
    conditions = _place_conditions(_STOCK.warehouse_id, _STOCK.rack_id, search)
    conditions += _item_conditions(_STOCK.accessory_item_id, search)
    if not search.include_empty:
        conditions.append(_STOCK.on_hand > 0)

    # Variants folded under their template: key = the template (or the item
    # itself when it isn't a variant).
    source = accessory_stock
    variants = literal(0)
    if search.group_by == "item" and search.group_variants and search.template_id is None:
        source = accessory_stock.join(AccessoryItem, AccessoryItem.id == _STOCK.accessory_item_id)
        key = func.coalesce(AccessoryItem.parent_template_id, _STOCK.accessory_item_id)
        variants = func.count(distinct(case(
            (AccessoryItem.parent_template_id.is_not(None), _STOCK.accessory_item_id),
        )))

    grouped = db.execute(
        select(
            key.label("key"),
            _STOCK.base_uom_id,
            func.count(distinct(_STOCK.accessory_item_id)),
            func.count(),
            func.sum(_STOCK.on_hand),
            variants,
        ).select_from(source).where(*conditions).group_by(key, _STOCK.base_uom_id)
    ).all()

    rows: Dict[Optional[int], dict] = defaultdict(
        lambda: {"item_count": 0, "pack_count": 0, "totals": [], "variant_count": 0}
    )
    for k, uom_id, items, packs, qty, variant_count in grouped:
        row = rows[k]
        row["key"] = k
        row["item_count"] += items  # an item has one base unit, so no double counting
        row["pack_count"] += packs
        row["variant_count"] += variant_count
        row["totals"].append((uom_id, Decimal(qty)))

    keys = sorted(rows, key=_sort_key(db, search.group_by, [k for k in rows if k is not None]))
    page = [rows[k] for k in keys[search.offset:search.offset + search.limit]]
    _describe(db, search.group_by, page)
    return page, len(keys)


def _sort_key(db: Session, group_by: str, ids: List[int]):
    """None (generic / waiting for put-away) first, then by code or name."""
    if group_by == "item":
        names = dict(db.execute(select(AccessoryItem.id, AccessoryItem.code).where(AccessoryItem.id.in_(ids))).all())
    elif group_by == "client":
        names = dict(db.execute(select(Client.client_id, Client.client_name).where(Client.client_id.in_(ids))).all())
    else:
        names = dict(db.execute(select(WarehouseRack.id, WarehouseRack.rack_code).where(WarehouseRack.id.in_(ids))).all())
    return lambda k: (k is not None, (names.get(k) or "").lower(), k or 0)


def _describe(db: Session, group_by: str, page: List[dict]) -> None:
    """Fill code / name (and the item details) and the unit codes of one page."""
    uom_ids = {uom_id for row in page for uom_id, _ in row["totals"]}
    uoms = {u.id: u.code for u in db.scalars(select(Uom).where(Uom.id.in_(uom_ids)))} if uom_ids else {}
    for row in page:
        row["totals"] = sorted(
            ({"uom_id": u, "uom_code": uoms[u], "qty": q} for u, q in row["totals"]), key=lambda t: t["uom_code"]
        )
        k = row["key"]
        if k is None:
            continue
        if group_by == "item":
            item = db.get(AccessoryItem, k)
            row.update(code=item.code, name=item.description, color=item.color, size=item.size,
                       value_lines=item.value_lines,
                       client_name=item.client.client_name if item.client is not None else None)
        elif group_by == "client":
            client = db.get(Client, k)
            row.update(code=client.client_code, name=client.client_name)
        else:
            row.update(code=db.get(WarehouseRack, k).rack_code)
