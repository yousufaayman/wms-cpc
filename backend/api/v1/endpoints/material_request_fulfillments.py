from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.core.deps import get_db
from backend.crud import material_request_fulfillments as crud
from backend.schemas import MaterialRequestFulfillment, MaterialRequestFulfillmentCreate, MaterialRequestFulfillmentUpdate

router = APIRouter()

_NOT_FOUND = "Fulfillment record not found"


@router.get("/", response_model=List[MaterialRequestFulfillment])
def list_fulfillments(
    material_request_id: Optional[int] = Query(None),
    internal_receipt_id: Optional[int] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    return crud.get_all(
        db,
        material_request_id=material_request_id,
        internal_receipt_id=internal_receipt_id,
        skip=skip,
        limit=limit,
    )


@router.get("/{fulfillment_id}", response_model=MaterialRequestFulfillment)
def get_fulfillment(fulfillment_id: int, db: Session = Depends(get_db)):
    obj = crud.get_by_id(db, fulfillment_id)
    if not obj:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return obj


@router.post("/", response_model=MaterialRequestFulfillment, status_code=201)
def create_fulfillment(data: MaterialRequestFulfillmentCreate, db: Session = Depends(get_db)):
    return crud.create(db, data)


@router.patch("/{fulfillment_id}", response_model=MaterialRequestFulfillment)
def update_fulfillment(fulfillment_id: int, data: MaterialRequestFulfillmentUpdate, db: Session = Depends(get_db)):
    obj = crud.update(db, fulfillment_id, data)
    if not obj:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return obj


@router.delete("/by-request/{material_request_id}", status_code=204)
def delete_fulfillments_by_request(material_request_id: int, db: Session = Depends(get_db)):
    crud.delete_by_request(db, material_request_id)


@router.delete("/{fulfillment_id}", status_code=204)
def delete_fulfillment(fulfillment_id: int, db: Session = Depends(get_db)):
    if not crud.delete(db, fulfillment_id):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
