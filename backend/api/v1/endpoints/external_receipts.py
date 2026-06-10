from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.core.deps import get_db, get_current_active_superuser
from backend import models
from backend.crud import external_receipts as crud
from backend.schemas import (
    ExternalReceipt,
    ExternalReceiptCreate,
    ExternalReceiptUpdate,
    ExternalReceiptClose,
)

router = APIRouter()

_NOT_FOUND = "External receipt not found"


@router.get("/", response_model=List[ExternalReceipt])
def get_external_receipts(
    skip: int = 0,
    limit: int = 100,
    warehouse_id: Optional[int] = Query(None),
    closed: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
):
    if warehouse_id is not None:
        return crud.get_external_receipts_by_warehouse(db, warehouse_id=warehouse_id, skip=skip, limit=limit)
    if closed is not None:
        return crud.get_external_receipts_by_closed(db, closed=closed, skip=skip, limit=limit)
    return crud.get_external_receipts(db, skip=skip, limit=limit)


@router.get("/{receipt_id}", response_model=ExternalReceipt)
def get_external_receipt(receipt_id: int, db: Session = Depends(get_db)):
    receipt = crud.get_external_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.post("/", response_model=ExternalReceipt, status_code=status.HTTP_201_CREATED)
def create_external_receipt(
    receipt: ExternalReceiptCreate,
    issued_by: int = Query(...),
    db: Session = Depends(get_db),
):
    return crud.create_external_receipt(db, receipt=receipt, issued_by=issued_by)


@router.put("/{receipt_id}", response_model=ExternalReceipt)
def update_external_receipt(
    receipt_id: int,
    receipt: ExternalReceiptUpdate,
    db: Session = Depends(get_db),
):
    db_receipt = crud.get_external_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return crud.update_external_receipt(db, receipt_id=receipt_id, receipt=receipt)


@router.post("/{receipt_id}/close", response_model=ExternalReceipt)
def close_external_receipt(
    receipt_id: int,
    body: ExternalReceiptClose,
    db: Session = Depends(get_db),
):
    receipt = crud.close_external_receipt(db, receipt_id=receipt_id, closed_by=body.closed_by)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.post("/{receipt_id}/open", response_model=ExternalReceipt)
def open_external_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser),
):
    receipt = crud.open_external_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.post("/{receipt_id}/approve", response_model=ExternalReceipt)
def approve_external_receipt(
    receipt_id: int,
    approved_by: int = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser),
):
    receipt = crud.approve_external_receipt(db, receipt_id=receipt_id, approved_by=approved_by)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.post("/{receipt_id}/unapprove", response_model=ExternalReceipt)
def unapprove_external_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser),
):
    receipt = crud.unapprove_external_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_external_receipt(receipt_id: int, db: Session = Depends(get_db)):
    success = crud.delete_external_receipt(db, receipt_id=receipt_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
