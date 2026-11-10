"""Units of measure and unit conversions for accessories.

Anyone with a WMS role can read them (pickers on the items, receiving and
issuing screens); adding or editing needs `manage_accessory_items`. The whole
router is off (404) while FEATURE_ACCESSORIES is off (see api.py). Units are
never deleted, only switched off (`active`), since items keep pointing at them.
"""
from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.core.authz import PERM_MANAGE_ACCESSORY_ITEMS
from backend.core.deps import get_db, require_permission
from backend.crud import uoms as crud
from backend.schemas import (
    Uom,
    UomConversion,
    UomConversionCreate,
    UomConversionUpdate,
    UomCreate,
    UomUpdate,
)

router = APIRouter()
_can_manage = require_permission(PERM_MANAGE_ACCESSORY_ITEMS)


@router.get("/", response_model=List[Uom])
def list_uoms(active_only: bool = False, db: Session = Depends(get_db)):
    return crud.get_uoms(db, active_only=active_only)


@router.post("/", response_model=Uom, status_code=status.HTTP_201_CREATED)
def create_uom(payload: UomCreate, db: Session = Depends(get_db), _user=Depends(_can_manage)):
    return crud.create_uom(db, payload)


@router.patch("/{uom_id}", response_model=Uom)
def update_uom(uom_id: int, payload: UomUpdate, db: Session = Depends(get_db), _user=Depends(_can_manage)):
    return crud.update_uom(db, uom_id, payload)


@router.get("/conversions", response_model=List[UomConversion])
def list_conversions(db: Session = Depends(get_db)):
    return crud.get_conversions(db)


@router.post("/conversions", response_model=UomConversion, status_code=status.HTTP_201_CREATED)
def create_conversion(payload: UomConversionCreate, db: Session = Depends(get_db), _user=Depends(_can_manage)):
    return crud.create_conversion(db, payload)


@router.patch("/conversions/{conversion_id}", response_model=UomConversion)
def update_conversion(
    conversion_id: int, payload: UomConversionUpdate, db: Session = Depends(get_db), _user=Depends(_can_manage)
):
    return crud.update_conversion(db, conversion_id, payload.factor)


@router.delete("/conversions/{conversion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversion(conversion_id: int, db: Session = Depends(get_db), _user=Depends(_can_manage)):
    crud.delete_conversion(db, conversion_id)
