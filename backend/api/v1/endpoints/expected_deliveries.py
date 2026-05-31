from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, Field

from backend.core.deps import get_db
from backend.crud import expected_deliveries as crud
from backend.crud.expected_deliveries import RollAlreadyLinkedError
from backend.schemas import (
    ExpectedDelivery,
    ExpectedDeliveryCreate,
    ExpectedDeliveryUpdate,
    ExpectedDeliveryItem,
    ExpectedDeliveryItemCreate,
    ExpectedDeliveryItemUpdate,
)


class ReceiveQty(BaseModel):
    weight_kg: float = Field(0, ge=0)
    length_m: float = Field(0, ge=0)
    roll_id: Optional[int] = None

router = APIRouter()

_NOT_FOUND = "Expected delivery not found"
_ITEM_NOT_FOUND = "Delivery item not found"


@router.get("/", response_model=List[ExpectedDelivery])
def list_expected_deliveries(
    skip: int = 0,
    limit: int = 100,
    warehouse_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    return crud.get_expected_deliveries(db, skip=skip, limit=limit, warehouse_id=warehouse_id, status=status)


@router.get("/{delivery_id}", response_model=ExpectedDelivery)
def get_expected_delivery(delivery_id: int, db: Session = Depends(get_db)):
    delivery = crud.get_expected_delivery(db, delivery_id=delivery_id)
    if not delivery:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return delivery


@router.post("/", response_model=ExpectedDelivery, status_code=status.HTTP_201_CREATED)
def create_expected_delivery(
    delivery: ExpectedDeliveryCreate,
    created_by: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    return crud.create_expected_delivery(db, delivery=delivery, created_by=created_by)


@router.put("/{delivery_id}", response_model=ExpectedDelivery)
def update_expected_delivery(
    delivery_id: int,
    delivery: ExpectedDeliveryUpdate,
    db: Session = Depends(get_db),
):
    result = crud.update_expected_delivery(db, delivery_id=delivery_id, delivery=delivery)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return result


@router.delete("/{delivery_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_expected_delivery(delivery_id: int, db: Session = Depends(get_db)):
    if not crud.delete_expected_delivery(db, delivery_id=delivery_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)


# ── Item sub-resource ────────────────────────────────────────────────────────

@router.post("/{delivery_id}/items", response_model=ExpectedDeliveryItem, status_code=status.HTTP_201_CREATED)
def add_delivery_item(
    delivery_id: int,
    item: ExpectedDeliveryItemCreate,
    db: Session = Depends(get_db),
):
    if not crud.get_expected_delivery(db, delivery_id=delivery_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return crud.add_delivery_item(db, delivery_id=delivery_id, item=item)


@router.put("/items/{item_id}", response_model=ExpectedDeliveryItem)
def update_delivery_item(
    item_id: int,
    item: ExpectedDeliveryItemUpdate,
    db: Session = Depends(get_db),
):
    result = crud.update_delivery_item(db, item_id=item_id, item=item)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_ITEM_NOT_FOUND)
    return result


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_delivery_item(item_id: int, db: Session = Depends(get_db)):
    if not crud.delete_delivery_item(db, item_id=item_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_ITEM_NOT_FOUND)


@router.patch("/items/{item_id}/receive", response_model=ExpectedDeliveryItem)
def receive_delivery_item(item_id: int, body: ReceiveQty, db: Session = Depends(get_db)):
    try:
        result = crud.receive_delivery_item(db, item_id=item_id, weight_kg=body.weight_kg, length_m=body.length_m, roll_id=body.roll_id)
    except RollAlreadyLinkedError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_ITEM_NOT_FOUND)
    return result
