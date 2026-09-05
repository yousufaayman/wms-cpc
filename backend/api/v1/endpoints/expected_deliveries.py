from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend import models
from backend.core.authz import ensure_admin, PERM_OPERATIONS, PERM_MANAGE_EXPECTED_DELIVERIES
from backend.core.deps import get_db, get_current_user, require_permission
from backend.crud import expected_deliveries as crud
from backend.schemas import (
    ExpectedDelivery,
    ExpectedDeliveryCreate,
    ExpectedDeliveryUpdate,
    ExpectedDeliveryItem,
    ExpectedDeliveryItemCreate,
    ExpectedDeliveryItemUpdate,
)

router = APIRouter()

_NOT_FOUND = "Expected delivery not found"
_ITEM_NOT_FOUND = "Delivery item not found"
# Viewing is open to every WMS role but Viewer; creating/altering is
# additionally restricted (Warehouse_Worker can view but not manage).
_REQUIRE_VIEW = Depends(require_permission(PERM_OPERATIONS))
_REQUIRE_MANAGE = Depends(require_permission(PERM_MANAGE_EXPECTED_DELIVERIES))


@router.get("/", response_model=List[ExpectedDelivery])
def list_expected_deliveries(
    skip: int = 0,
    limit: int = 100,
    warehouse_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    open_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_VIEW,
):
    return crud.get_expected_deliveries(
        db, skip=skip, limit=limit, warehouse_id=warehouse_id, status=status, open_only=open_only
    )


@router.get("/{delivery_id}", response_model=ExpectedDelivery)
def get_expected_delivery(delivery_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_VIEW):
    # Ledger sync: received totals are derived from the linked rolls on every
    # view, so drift (roll edits, unlink, manual DB changes) self-heals here.
    crud.sync_delivery_received(db, delivery_id)
    delivery = crud.get_expected_delivery(db, delivery_id=delivery_id)
    if not delivery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return delivery


@router.post("/", response_model=ExpectedDelivery, status_code=status.HTTP_201_CREATED)
def create_expected_delivery(
    delivery: ExpectedDeliveryCreate,
    created_by: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_MANAGE,
):
    try:
        return crud.create_expected_delivery(db, delivery=delivery, created_by=created_by)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


_CLOSED_STATUSES = ("received", "cancelled")


@router.put("/{delivery_id}", response_model=ExpectedDelivery)
def update_expected_delivery(
    delivery_id: int,
    delivery: ExpectedDeliveryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_MANAGE,
):
    # Reopening a closed delivery (received/cancelled → pending/partial) is
    # admin-only; managers/gen-ops can otherwise edit and close deliveries freely.
    if delivery.status is not None and delivery.status not in _CLOSED_STATUSES:
        existing = crud.get_expected_delivery(db, delivery_id=delivery_id)
        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
        if existing.status in _CLOSED_STATUSES:
            ensure_admin(db, current_user)
    try:
        result = crud.update_expected_delivery(db, delivery_id=delivery_id, delivery=delivery)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return result


@router.delete("/{delivery_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expected_delivery(delivery_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_MANAGE):
    if not crud.delete_expected_delivery(db, delivery_id=delivery_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)


# ── Item sub-resource ────────────────────────────────────────────────────────

@router.post("/{delivery_id}/items", response_model=ExpectedDeliveryItem, status_code=status.HTTP_201_CREATED)
def add_delivery_item(
    delivery_id: int,
    item: ExpectedDeliveryItemCreate,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_MANAGE,
):
    if not crud.get_expected_delivery(db, delivery_id=delivery_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return crud.add_delivery_item(db, delivery_id=delivery_id, item=item)


@router.put("/items/{item_id}", response_model=ExpectedDeliveryItem)
def update_delivery_item(
    item_id: int,
    item: ExpectedDeliveryItemUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_MANAGE,
):
    result = crud.update_delivery_item(db, item_id=item_id, item=item)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_ITEM_NOT_FOUND)
    return result


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_delivery_item(item_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_MANAGE):
    if not crud.delete_delivery_item(db, item_id=item_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_ITEM_NOT_FOUND)
