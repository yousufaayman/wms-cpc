"""Database reads/writes for units (core.uoms) and unit conversions
(core.uom_conversions). The rules people can break (duplicate code, a pair
defined twice) are checked here and raised as HTTP errors."""
from typing import List

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.models import Uom, UomConversion
from backend.schemas import UomConversionCreate, UomCreate, UomUpdate


def get_uoms(db: Session, active_only: bool = False) -> List[Uom]:
    q = db.query(Uom)
    if active_only:
        q = q.filter(Uom.active.is_(True))
    return q.order_by(Uom.code).all()


def get_uom_or_404(db: Session, uom_id: int) -> Uom:
    uom = db.get(Uom, uom_id)
    if uom is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unit not found")
    return uom


def create_uom(db: Session, payload: UomCreate) -> Uom:
    if db.query(Uom).filter(Uom.code == payload.code).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Unit {payload.code} already exists")
    uom = Uom(**payload.model_dump())
    db.add(uom)
    db.commit()
    db.refresh(uom)
    return uom


def update_uom(db: Session, uom_id: int, payload: UomUpdate) -> Uom:
    uom = get_uom_or_404(db, uom_id)
    for field, value in payload.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(uom, field, value)
    db.commit()
    db.refresh(uom)
    return uom


def get_conversions(db: Session) -> List[UomConversion]:
    """Global conversions only; an item's own ones are listed on the item."""
    return (
        db.query(UomConversion)
        .filter(UomConversion.accessory_item_id.is_(None))
        .order_by(UomConversion.id)
        .all()
    )


def create_conversion(db: Session, payload: UomConversionCreate) -> UomConversion:
    if payload.from_uom_id == payload.to_uom_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A unit can't convert to itself")
    get_uom_or_404(db, payload.from_uom_id)
    get_uom_or_404(db, payload.to_uom_id)
    # One row per pair: 1 DOZ = 12 PCS already answers PCS -> DOZ.
    existing = (
        db.query(UomConversion)
        .filter(
            ((UomConversion.from_uom_id == payload.from_uom_id) & (UomConversion.to_uom_id == payload.to_uom_id))
            | ((UomConversion.from_uom_id == payload.to_uom_id) & (UomConversion.to_uom_id == payload.from_uom_id))
        )
        .filter(UomConversion.accessory_item_id.is_(None))
        .first()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="These two units already have a conversion")
    conv = UomConversion(**payload.model_dump())
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def _get_conversion_or_404(db: Session, conversion_id: int) -> UomConversion:
    conv = db.get(UomConversion, conversion_id)
    # Item conversions are edited from their item (/accessory-items/{id}/conversions).
    if conv is None or conv.accessory_item_id is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversion not found")
    return conv


def update_conversion(db: Session, conversion_id: int, factor: float) -> UomConversion:
    conv = _get_conversion_or_404(db, conversion_id)
    conv.factor = factor
    db.commit()
    db.refresh(conv)
    return conv


def delete_conversion(db: Session, conversion_id: int) -> None:
    # Safe: stock is stored in base units, so no saved quantity depends on it.
    db.delete(_get_conversion_or_404(db, conversion_id))
    db.commit()
