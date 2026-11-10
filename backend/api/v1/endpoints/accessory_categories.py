"""Trim categories (BTN, ZIP, LBL...) for accessory items.

Read: any WMS role. Add/edit: `manage_accessory_items`. Off (404) while
FEATURE_ACCESSORIES is off. Categories are switched off, never deleted, and
their code can't change (it is part of item codes like `UA-ELS-0007`).
"""
from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.core.authz import PERM_MANAGE_ACCESSORY_ITEMS
from backend.core.deps import get_db, require_permission
from backend.crud import accessory_categories as crud
from backend.schemas import AccessoryCategory, AccessoryCategoryCreate, AccessoryCategoryUpdate

router = APIRouter()
_can_manage = require_permission(PERM_MANAGE_ACCESSORY_ITEMS)


@router.get("/", response_model=List[AccessoryCategory])
def list_categories(active_only: bool = False, db: Session = Depends(get_db)):
    return crud.get_categories(db, active_only=active_only)


@router.post("/", response_model=AccessoryCategory, status_code=status.HTTP_201_CREATED)
def create_category(payload: AccessoryCategoryCreate, db: Session = Depends(get_db), _user=Depends(_can_manage)):
    return crud.create_category(db, payload)


@router.patch("/{category_id}", response_model=AccessoryCategory)
def update_category(
    category_id: int, payload: AccessoryCategoryUpdate, db: Session = Depends(get_db), _user=Depends(_can_manage)
):
    return crud.update_category(db, category_id, payload)
