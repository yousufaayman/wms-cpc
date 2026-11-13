"""Accessory items: the list/search, create (the server makes the code), edit,
and each item's own unit conversions.

Anyone with a WMS role can read; creating and editing needs
`manage_accessory_items`. The whole router is off (404) while
FEATURE_ACCESSORIES is off (see api.py). Items are never deleted: send
`active: false` to switch one off.

Search (item 11): the list takes a quick search `q` (each word found
somewhere) plus advanced filters that all must match (see
`schemas.AccessoryItemSearch`), paging and sort. `/similar` lists look-alike
items for the New item warning.

References (item 9): each item carries client/supplier codes. A new item needs
at least one; `/refs/lookup` tells a form whether a code is already taken.

Templates + variants (item 10): `/{id}/fields` are a template's variable lines
(adding the first one makes the item a template); `/{id}/variants` lists and
creates its variants; `/{id}/variants/check` tells the form whether a
combination already exists. A variant is edited with the normal PATCH
(`variable_values`, color, size).
"""
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from backend.core.authz import PERM_MANAGE_ACCESSORY_ITEMS
from backend.core.deps import get_db, require_permission
from backend.crud import accessory_items as crud
from backend.domains.accessories import uom
from backend.schemas import (
    AccessoryItem,
    AccessoryItemCreate,
    AccessoryItemField,
    AccessoryItemFieldCreate,
    AccessoryItemFieldUpdate,
    AccessoryItemPage,
    AccessoryItemRef,
    AccessoryItemRefIn,
    AccessoryItemRefUpdate,
    AccessoryItemSearch,
    AccessoryItemUnit,
    AccessoryItemUpdate,
    AccessoryVariantCreate,
    UomConversion,
    UomConversionCreate,
)

router = APIRouter()
_can_manage = require_permission(PERM_MANAGE_ACCESSORY_ITEMS)


@router.get("/", response_model=AccessoryItemPage)
def list_items(search: Annotated[AccessoryItemSearch, Query()], db: Session = Depends(get_db)):
    """Quick search + advanced filters + paging; see `AccessoryItemSearch`.
    A template line filter is `?line=po_number:451` (repeat for several)."""
    items, total = crud.list_items(db, search)
    return {"items": items, "total": total}


@router.get("/similar", response_model=List[AccessoryItem])
def similar_items(
    category_id: int,
    description: str,
    client_id: Optional[int] = None,
    color: Optional[str] = None,
    size: Optional[str] = None,
    exclude_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """Items that look like the same trim (same category + client, same
    description / color / size ignoring case, spaces and - . / _). The form
    only warns: look-alikes can still be saved."""
    return crud.find_similar(db, category_id, client_id, description, color, size, exclude_id)


@router.get("/refs/lookup", response_model=Optional[AccessoryItem])
def lookup_ref(
    code: str,
    client_id: Optional[int] = None,
    supplier_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """The item that already carries this client's / supplier's code, or null.
    Codes are compared ignoring case, spaces and - . / _"""
    ref = crud.find_ref(db, code, client_id=client_id, supplier_id=supplier_id)
    return ref.item if ref else None


@router.get("/{item_id}", response_model=AccessoryItem)
def get_item(item_id: int, db: Session = Depends(get_db)):
    return crud.get_item_or_404(db, item_id)


@router.post("/", response_model=AccessoryItem, status_code=status.HTTP_201_CREATED)
def create_item(payload: AccessoryItemCreate, db: Session = Depends(get_db), user=Depends(_can_manage)):
    return crud.create_item(db, payload, user_id=user.id)


@router.patch("/{item_id}", response_model=AccessoryItem)
def update_item(item_id: int, payload: AccessoryItemUpdate, db: Session = Depends(get_db), _user=Depends(_can_manage)):
    return crud.update_item(db, item_id, payload)


@router.get("/{item_id}/units", response_model=List[AccessoryItemUnit])
def list_item_units(item_id: int, db: Session = Depends(get_db)):
    """Units a quantity of this item can be typed in (base unit first), with
    how many base units one of each is. For quantity boxes (item 15+)."""
    item = crud.get_item_or_404(db, item_id)
    return [
        AccessoryItemUnit(
            uom_id=u.id, code=u.code, name_en=u.name_en, name_ar=u.name_ar,
            allows_decimals=u.allows_decimals, factor=f, is_base=(u.id == item.base_uom_id),
        )
        for u, f in uom.item_units(db, item)
    ]


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


@router.get("/{item_id}/refs", response_model=List[AccessoryItemRef])
def list_refs(item_id: int, db: Session = Depends(get_db)):
    return crud.list_refs(db, item_id)


@router.post("/{item_id}/refs", response_model=AccessoryItemRef, status_code=status.HTTP_201_CREATED)
def add_ref(item_id: int, payload: AccessoryItemRefIn, db: Session = Depends(get_db), user=Depends(_can_manage)):
    return crud.add_ref(db, item_id, payload, user_id=user.id)


@router.patch("/{item_id}/refs/{ref_id}", response_model=AccessoryItemRef)
def update_ref(
    item_id: int, ref_id: int, payload: AccessoryItemRefUpdate, db: Session = Depends(get_db), _user=Depends(_can_manage)
):
    return crud.update_ref(db, item_id, ref_id, payload)


@router.delete("/{item_id}/refs/{ref_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ref(item_id: int, ref_id: int, db: Session = Depends(get_db), _user=Depends(_can_manage)):
    crud.delete_ref(db, item_id, ref_id)


@router.get("/{item_id}/fields", response_model=List[AccessoryItemField])
def list_fields(item_id: int, db: Session = Depends(get_db)):
    return crud.list_fields(db, item_id)


@router.post("/{item_id}/fields", response_model=AccessoryItemField, status_code=status.HTTP_201_CREATED)
def add_field(item_id: int, payload: AccessoryItemFieldCreate, db: Session = Depends(get_db), _user=Depends(_can_manage)):
    return crud.add_field(db, item_id, payload)


@router.patch("/{item_id}/fields/{field_id}", response_model=AccessoryItemField)
def update_field(
    item_id: int, field_id: int, payload: AccessoryItemFieldUpdate, db: Session = Depends(get_db), _user=Depends(_can_manage)
):
    return crud.update_field(db, item_id, field_id, payload)


@router.delete("/{item_id}/fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_field(item_id: int, field_id: int, db: Session = Depends(get_db), _user=Depends(_can_manage)):
    crud.delete_field(db, item_id, field_id)


@router.get("/{item_id}/variants", response_model=List[AccessoryItem])
def list_variants(item_id: int, active_only: bool = False, db: Session = Depends(get_db)):
    return crud.list_variants(db, item_id, active_only=active_only)


@router.post("/{item_id}/variants/check", response_model=Optional[AccessoryItem])
def check_variant(item_id: int, payload: AccessoryVariantCreate, db: Session = Depends(get_db)):
    """The variant that already has this combination, or null. Saves nothing."""
    return crud.check_variant(db, item_id, payload)


@router.post("/{item_id}/variants", response_model=AccessoryItem, status_code=status.HTTP_201_CREATED)
def create_variant(
    item_id: int, payload: AccessoryVariantCreate, db: Session = Depends(get_db), user=Depends(_can_manage)
):
    return crud.create_variant(db, item_id, payload, user_id=user.id)
