from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend import models
from backend.core.deps import get_db, require_permission
from backend.core.authz import PERM_CREATE_RECEIPTS
from backend.crud import material_request_fulfillments as crud
from backend.schemas import (
    MaterialRequestFulfillment,
    MaterialRequestFulfillmentCreate,
    MaterialRequestFulfillmentUpdate,
)

router = APIRouter()

_NOT_FOUND = "Fulfillment not found"
# Creating a fulfillment links a material request to a receipt (creating one
# where needed), so it — and every other write here — is gated the same as
# creating a receipt directly.
_REQUIRE_CREATE_RECEIPTS = Depends(require_permission(PERM_CREATE_RECEIPTS))


@router.get("/", response_model=List[MaterialRequestFulfillment])
def list_fulfillments(
    skip: int = 0,
    limit: int = 100,
    material_request_id: Optional[int] = Query(None),
    internal_receipt_id: Optional[int] = Query(None),
    supplier_receipt_id: Optional[int] = Query(None),
    external_receipt_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    return crud.get_fulfillments(
        db,
        skip=skip,
        limit=limit,
        material_request_id=material_request_id,
        internal_receipt_id=internal_receipt_id,
        supplier_receipt_id=supplier_receipt_id,
        external_receipt_id=external_receipt_id,
    )


@router.post("/", response_model=MaterialRequestFulfillment, status_code=status.HTTP_201_CREATED)
def create_fulfillment(
    fulfillment: MaterialRequestFulfillmentCreate,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_CREATE_RECEIPTS,
):
    try:
        return crud.create_fulfillment(db, fulfillment=fulfillment)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


# Declared before /{fulfillment_id} so "by-request" is not parsed as an id.
@router.delete("/by-request/{material_request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fulfillments_by_request(material_request_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_CREATE_RECEIPTS):
    crud.delete_fulfillments_by_request(db, material_request_id=material_request_id)


@router.get("/{fulfillment_id}", response_model=MaterialRequestFulfillment)
def get_fulfillment(fulfillment_id: int, db: Session = Depends(get_db)):
    fulfillment = crud.get_fulfillment(db, fulfillment_id=fulfillment_id)
    if not fulfillment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return fulfillment


@router.patch("/{fulfillment_id}", response_model=MaterialRequestFulfillment)
def update_fulfillment(
    fulfillment_id: int,
    fulfillment: MaterialRequestFulfillmentUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_CREATE_RECEIPTS,
):
    result = crud.update_fulfillment(db, fulfillment_id=fulfillment_id, fulfillment=fulfillment)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return result


@router.post("/{fulfillment_id}/sync", response_model=MaterialRequestFulfillment)
def sync_fulfillment(fulfillment_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_CREATE_RECEIPTS):
    """Recompute quantity_issued from the linked receipt's rolls. Called by the
    scan page after every roll add/remove to keep progress live."""
    result = crud.sync_fulfillment_from_receipt(db, fulfillment_id=fulfillment_id)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return result


@router.delete("/{fulfillment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fulfillment(fulfillment_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_CREATE_RECEIPTS):
    if not crud.delete_fulfillment(db, fulfillment_id=fulfillment_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
