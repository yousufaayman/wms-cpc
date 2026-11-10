"""Database reads/writes for trim categories (core.accessory_categories)."""
from typing import List

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.models import AccessoryCategory, Uom
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


def _ensure_active_uom(db: Session, uom_id: int) -> None:
    uom = db.get(Uom, uom_id)
    if uom is None or not uom.active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Default unit must be an active unit")


def create_category(db: Session, payload: AccessoryCategoryCreate) -> AccessoryCategory:
    if db.query(AccessoryCategory).filter(AccessoryCategory.code == payload.code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Category {payload.code} already exists")
    _ensure_active_uom(db, payload.default_uom_id)
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
        _ensure_active_uom(db, changes["default_uom_id"])
    for field, value in changes.items():
        setattr(cat, field, value)
    db.commit()
    db.refresh(cat)
    return cat
