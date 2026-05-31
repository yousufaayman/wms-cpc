from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.core.deps import get_db, get_current_active_superuser
from backend import models
from backend.crud import internal_receipts as crud
from backend.schemas import (
    InternalReceipt,
    InternalReceiptCreate,
    InternalReceiptUpdate,
    InternalReceiptConfirm,
    InternalReceiptClose,
)

router = APIRouter()


@router.get("/", response_model=List[InternalReceipt])
def get_internal_receipts(
    skip: int = 0,
    limit: int = 100,
    warehouse_id: Optional[int] = Query(None),
    receipt_status: Optional[str] = Query(None, alias="status"),
    closed: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
):
    if warehouse_id is not None:
        return crud.get_internal_receipts_by_warehouse(db, warehouse_id=warehouse_id, skip=skip, limit=limit)
    if receipt_status is not None:
        return crud.get_internal_receipts_by_status(db, status=receipt_status, skip=skip, limit=limit)
    if closed is not None:
        return crud.get_internal_receipts_by_closed(db, closed=closed, skip=skip, limit=limit)
    return crud.get_internal_receipts(db, skip=skip, limit=limit)


@router.get("/{receipt_id}", response_model=InternalReceipt)
def get_internal_receipt(receipt_id: int, db: Session = Depends(get_db)):
    receipt = crud.get_internal_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal receipt not found")
    return receipt


@router.post("/", response_model=InternalReceipt, status_code=status.HTTP_201_CREATED)
def create_internal_receipt(
    receipt: InternalReceiptCreate,
    issued_by: int = Query(...),
    db: Session = Depends(get_db),
):
    return crud.create_internal_receipt(db, receipt=receipt, issued_by=issued_by)


@router.put("/{receipt_id}", response_model=InternalReceipt)
def update_internal_receipt(
    receipt_id: int,
    receipt: InternalReceiptUpdate,
    db: Session = Depends(get_db),
):
    db_receipt = crud.get_internal_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal receipt not found")
    return crud.update_internal_receipt(db, receipt_id=receipt_id, receipt=receipt)


@router.post("/{receipt_id}/confirm", response_model=InternalReceipt)
def confirm_internal_receipt(
    receipt_id: int,
    body: InternalReceiptConfirm,
    db: Session = Depends(get_db),
):
    receipt = crud.confirm_internal_receipt(db, receipt_id=receipt_id, confirmed_by=body.confirmed_by)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal receipt not found")
    return receipt


@router.post("/{receipt_id}/close", response_model=InternalReceipt)
def close_internal_receipt(
    receipt_id: int,
    body: InternalReceiptClose,
    db: Session = Depends(get_db),
):
    receipt = crud.close_internal_receipt(db, receipt_id=receipt_id, closed_by=body.closed_by)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal receipt not found")
    return receipt


@router.post("/{receipt_id}/open", response_model=InternalReceipt)
def open_internal_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser),
):
    receipt = crud.open_internal_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal receipt not found")
    return receipt


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_internal_receipt(receipt_id: int, db: Session = Depends(get_db)):
    success = crud.delete_internal_receipt(db, receipt_id=receipt_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal receipt not found")
