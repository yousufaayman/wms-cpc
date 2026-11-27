"""Database reads/writes for trim categories (core.accessory_categories).

Returnable tools (item 33): two switches decide whether a category holds
tools instead of trims. `tracked` = its items go in and out (folders, presser
feet); `individual` = one label per piece (needs `tracked`). The rules:
- a category whose items ever had trim packs can't become tracked: a trim is
  never a tool (user, 2026-11-27);
- a tracked category can't be switched back once it has tools;
- tools are counted in whole pieces, so a tracked category needs a
  whole-number default unit, and none of its items may use a decimal unit;
- `individual` can change any time: tools already added keep how they were
  made (`returnable_units.is_individual`).
"""
from typing import List

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models import AccessoryCategory, AccessoryItem, AccessoryPack, ReturnableUnit, Uom
from backend.schemas import AccessoryCategoryCreate, AccessoryCategoryUpdate


def get_categories(db: Session, active_only: bool = False) -> List[AccessoryCategory]:
    q = db.query(AccessoryCategory)
    if active_only:
        q = q.filter(AccessoryCategory.active.is_(True))
    return q.order_by(AccessoryCategory.code).all()


def get_category_or_404(db: Session, category_id: int) -> AccessoryCategory:
    cat = db.get(AccessoryCategory, category_id)
    if cat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Category not found")
    return cat


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _ensure_active_uom(db: Session, uom_id: int) -> Uom:
    uom = db.get(Uom, uom_id)
    if uom is None or not uom.active:
        raise _bad("Default unit must be an active unit")
    return uom


def _items_of(category_id: int):
    return select(AccessoryItem.id).where(AccessoryItem.category_id == category_id)


def _check_tool_switches(db: Session, cat: AccessoryCategory, tracked: bool, individual: bool, uom: Uom) -> None:
    """The item-33 rules above, for `cat` about to get these values."""
    if individual and not tracked:
        raise _bad("One barcode per piece is only for tracked (returnable) categories")
    if tracked and uom.allows_decimals:
        raise _bad(f"Returnable tools need a whole-number unit: {uom.code} allows decimals")
    if cat.id is None or tracked == bool(cat.tracked):
        return
    if tracked:
        if db.scalar(select(select(AccessoryPack.id).where(AccessoryPack.accessory_item_id.in_(_items_of(cat.id))).exists())):
            raise _bad(f"{cat.code} has trim stock: a trim category can't become returnable tools")
        decimal_item = db.scalar(
            select(AccessoryItem.code)
            .join(Uom, Uom.id == AccessoryItem.base_uom_id)
            .where(AccessoryItem.category_id == cat.id, Uom.allows_decimals.is_(True))
            .limit(1)
        )
        if decimal_item is not None:
            raise _bad(f"{decimal_item} uses a unit with decimals: returnable tools need a whole-number unit")
    elif db.scalar(select(select(ReturnableUnit.id).where(ReturnableUnit.accessory_item_id.in_(_items_of(cat.id))).exists())):
        raise _bad(f"{cat.code} already has returnable tools: it stays tracked")


def create_category(db: Session, payload: AccessoryCategoryCreate) -> AccessoryCategory:
    if db.query(AccessoryCategory).filter(AccessoryCategory.code == payload.code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Category {payload.code} already exists")
    uom = _ensure_active_uom(db, payload.default_uom_id)
    _check_tool_switches(db, AccessoryCategory(), payload.tracked, payload.individual, uom)
    cat = AccessoryCategory(**payload.model_dump())
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


def update_category(db: Session, category_id: int, payload: AccessoryCategoryUpdate) -> AccessoryCategory:
    """The code is not editable: it is part of every item code in the category."""
    cat = get_category_or_404(db, category_id)
    changes = payload.model_dump(exclude_unset=True, exclude_none=True)
    if "default_uom_id" in changes:
        uom = _ensure_active_uom(db, changes["default_uom_id"])
    else:
        uom = db.get(Uom, cat.default_uom_id)
    _check_tool_switches(
        db, cat, changes.get("tracked", bool(cat.tracked)), changes.get("individual", bool(cat.individual)), uom
    )
    for field, value in changes.items():
        setattr(cat, field, value)
    db.commit()
    db.refresh(cat)
    return cat
