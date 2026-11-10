"""Database reads/writes for accessory items (core.accessory_items) and their
own unit conversions (core.uom_conversions rows with accessory_item_id set).

Rules checked here, raised as HTTP errors:
- the category and base unit must be switched on; the client must exist;
- category and client are fixed after creation (they're part of the code);
- the base unit can't change once the item has stock (`has_stock`), nor while
  the item has its own conversions (they're written against the base unit);
- an item conversion must involve the item's base unit.
"""
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.domains.accessories import item_codes
from backend.models import AccessoryCategory, AccessoryItem, Client, Uom, UomConversion
from backend.schemas import AccessoryItemCreate, AccessoryItemUpdate, UomConversionCreate


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def has_stock(db: Session, item_id: int) -> bool:
    """Has this item ever held stock? Packs and the ledger don't exist yet
    (items 12/13), so nothing has: item 12 makes this check its packs."""
    return False


def list_items(
    db: Session,
    q: Optional[str] = None,
    category_id: Optional[int] = None,
    client_id: Optional[int] = None,
    generic_only: bool = False,
    active_only: bool = True,
    limit: int = 50,
    offset: int = 0,
) -> Tuple[List[AccessoryItem], int]:
    query = db.query(AccessoryItem)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                AccessoryItem.code.ilike(like),
                AccessoryItem.description.ilike(like),
                AccessoryItem.color.ilike(like),
                AccessoryItem.size.ilike(like),
            )
        )
    if category_id is not None:
        query = query.filter(AccessoryItem.category_id == category_id)
    if generic_only:
        query = query.filter(AccessoryItem.client_id.is_(None))
    elif client_id is not None:
        query = query.filter(AccessoryItem.client_id == client_id)
    if active_only:
        query = query.filter(AccessoryItem.active.is_(True))
    total = query.count()
    items = query.order_by(AccessoryItem.code).offset(offset).limit(limit).all()
    return items, total


def get_item_or_404(db: Session, item_id: int) -> AccessoryItem:
    item = db.get(AccessoryItem, item_id)
    if item is None:
        raise _bad("Item not found", status.HTTP_404_NOT_FOUND)
    return item


def _active_uom(db: Session, uom_id: int) -> Uom:
    uom = db.get(Uom, uom_id)
    if uom is None:
        raise _bad("Unit not found", status.HTTP_404_NOT_FOUND)
    if not uom.active:
        raise _bad(f"Unit {uom.code} is switched off")
    return uom


def create_item(db: Session, payload: AccessoryItemCreate, user_id: int) -> AccessoryItem:
    category = db.get(AccessoryCategory, payload.category_id)
    if category is None:
        raise _bad("Category not found", status.HTTP_404_NOT_FOUND)
    if not category.active:
        raise _bad(f"Category {category.code} is switched off")
    _active_uom(db, payload.base_uom_id)

    client_code = None
    if payload.client_id is not None:
        client = db.get(Client, payload.client_id)
        if client is None:
            raise _bad("Client not found", status.HTTP_404_NOT_FOUND)
        client_code = client.client_code
    try:
        prefix = item_codes.prefix_for(client_code, generic=payload.client_id is None)
    except item_codes.NoClientCode as exc:
        raise _bad(str(exc)) from exc

    item = AccessoryItem(
        **payload.model_dump(),
        code=item_codes.next_code(db, prefix, category.id, category.code),
        created_by=user_id,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _own_conversions(db: Session, item_id: int) -> List[UomConversion]:
    return (
        db.query(UomConversion)
        .filter(UomConversion.accessory_item_id == item_id)
        .order_by(UomConversion.id)
        .all()
    )


def update_item(db: Session, item_id: int, payload: AccessoryItemUpdate) -> AccessoryItem:
    item = get_item_or_404(db, item_id)
    changes = payload.model_dump(exclude_unset=True)
    # Only color/size may be cleared; a null for the others means "leave it".
    for field in ("description", "base_uom_id", "active"):
        if changes.get(field, ...) is None:
            changes.pop(field)

    new_uom = changes.get("base_uom_id")
    if new_uom is not None and new_uom != item.base_uom_id:
        _active_uom(db, new_uom)
        if has_stock(db, item.id):
            raise _bad("The base unit can't change once the item has stock")
        if _own_conversions(db, item.id):
            raise _bad("Delete this item's conversions before changing its base unit")

    for field, value in changes.items():
        setattr(item, field, value)
    if changes:
        item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return item


def list_item_conversions(db: Session, item_id: int) -> List[UomConversion]:
    get_item_or_404(db, item_id)
    return _own_conversions(db, item_id)


def create_item_conversion(db: Session, item_id: int, payload: UomConversionCreate) -> UomConversion:
    item = get_item_or_404(db, item_id)
    if payload.from_uom_id == payload.to_uom_id:
        raise _bad("A unit can't convert to itself")
    if item.base_uom_id not in (payload.from_uom_id, payload.to_uom_id):
        raise _bad("One side must be the item's base unit")
    _active_uom(db, payload.from_uom_id)
    _active_uom(db, payload.to_uom_id)
    pair = {payload.from_uom_id, payload.to_uom_id}
    if any({c.from_uom_id, c.to_uom_id} == pair for c in _own_conversions(db, item_id)):
        raise _bad("This item already has a conversion for these two units", status.HTTP_409_CONFLICT)
    conv = UomConversion(**payload.model_dump(), accessory_item_id=item_id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def delete_item_conversion(db: Session, item_id: int, conversion_id: int) -> None:
    conv = db.get(UomConversion, conversion_id)
    if conv is None or conv.accessory_item_id != item_id:
        raise _bad("Conversion not found", status.HTTP_404_NOT_FOUND)
    # Safe: stock is stored in base units, so no saved quantity depends on it.
    db.delete(conv)
    db.commit()
