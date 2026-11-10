"""Accessory items: the list/search, create (the server makes the code), edit,
and each item's own unit conversions.

Anyone with a WMS role can read; creating and editing needs
`manage_accessory_items`. The whole router is off (404) while
FEATURE_ACCESSORIES is off (see api.py). Items are never deleted: send
`active: false` to switch one off.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from backend.core.authz import PERM_MANAGE_ACCESSORY_ITEMS
from backend.core.deps import get_db, require_permission
from backend.crud import accessory_items as crud
from backend.schemas import (
    AccessoryItem,
    AccessoryItemCreate,
    AccessoryItemPage,
    AccessoryItemUpdate,
    UomConversion,
    UomConversionCreate,
)

router = APIRouter()
_can_manage = require_permission(PERM_MANAGE_ACCESSORY_ITEMS)


@router.get("/", response_model=AccessoryItemPage)
def list_items(
    q: Optional[str] = Query(None, description="Part of the code, description, color or size"),
    category_id: Optional[int] = None,
    client_id: Optional[int] = None,
    generic_only: bool = False,
    active_only: bool = True,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    items, total = crud.list_items(
        db, q=q, category_id=category_id, client_id=client_id,
        generic_only=generic_only, active_only=active_only, limit=limit, offset=offset,
    )
    return {"items": items, "total": total}


@router.get("/{item_id}", response_model=AccessoryItem)
def get_item(item_id: int, db: Session = Depends(get_db)):
    return crud.get_item_or_404(db, item_id)


@router.post("/", response_model=AccessoryItem, status_code=status.HTTP_201_CREATED)
def create_item(payload: AccessoryItemCreate, db: Session = Depends(get_db), user=Depends(_can_manage)):
    return crud.create_item(db, payload, user_id=user.id)


@router.patch("/{item_id}", response_model=AccessoryItem)
def update_item(item_id: int, payload: AccessoryItemUpdate, db: Session = Depends(get_db), _user=Depends(_can_manage)):
    return crud.update_item(db, item_id, payload)


@router.get("/{item_id}/conversions", response_model=List[UomConversion])
def list_item_conversions(item_id: int, db: Session = Depends(get_db)):
    return crud.list_item_conversions(db, item_id)


@router.post("/{item_id}/conversions", response_model=UomConversion, status_code=status.HTTP_201_CREATED)
def create_item_conversion(
    item_id: int, payload: UomConversionCreate, db: Session = Depends(get_db), _user=Depends(_can_manage)
):
    return crud.create_item_conversion(db, item_id, payload)


@router.delete("/{item_id}/conversions/{conversion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item_conversion(
    item_id: int, conversion_id: int, db: Session = Depends(get_db), _user=Depends(_can_manage)
):
    crud.delete_item_conversion(db, item_id, conversion_id)
