from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.core.deps import get_db, get_current_active_superuser
from backend import models
from backend.crud import vendor_receipts as crud
from backend.schemas import SupplierReceipt, SupplierReceiptCreate, SupplierReceiptUpdate, SupplierReceiptClose

router = APIRouter()

_NOT_FOUND = "Supplier receipt not found"


@router.get("/", response_model=List[SupplierReceipt])
def get_vendor_receipts(
    skip: int = 0,
    limit: int = 100,
    warehouse_id: Optional[int] = Query(None),
    closed: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
):
    if warehouse_id is not None:
        return crud.get_vendor_receipts_by_warehouse(db, warehouse_id=warehouse_id, skip=skip, limit=limit)
    if closed is not None:
        return crud.get_vendor_receipts_by_closed(db, closed=closed, skip=skip, limit=limit)
    return crud.get_vendor_receipts(db, skip=skip, limit=limit)


@router.get("/{receipt_id}", response_model=SupplierReceipt)
def get_vendor_receipt(receipt_id: int, db: Session = Depends(get_db)):
    receipt = crud.get_vendor_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.post("/", response_model=SupplierReceipt, status_code=status.HTTP_201_CREATED)
def create_vendor_receipt(
    receipt: SupplierReceiptCreate,
    issued_by: int = Query(...),
    db: Session = Depends(get_db),
):
    return crud.create_vendor_receipt(db, receipt=receipt, issued_by=issued_by)


@router.put("/{receipt_id}", response_model=SupplierReceipt)
def update_vendor_receipt(
    receipt_id: int,
    receipt: SupplierReceiptUpdate,
    db: Session = Depends(get_db),
):
    db_receipt = crud.get_vendor_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return crud.update_vendor_receipt(db, receipt_id=receipt_id, receipt=receipt)


@router.post("/{receipt_id}/close", response_model=SupplierReceipt)
def close_vendor_receipt(
    receipt_id: int,
    body: SupplierReceiptClose,
    db: Session = Depends(get_db),
):
    receipt = crud.close_vendor_receipt(db, receipt_id=receipt_id, closed_by=body.closed_by)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.post("/{receipt_id}/open", response_model=SupplierReceipt)
def open_vendor_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser),
):
    receipt = crud.open_vendor_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vendor_receipt(receipt_id: int, db: Session = Depends(get_db)):
    success = crud.delete_vendor_receipt(db, receipt_id=receipt_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
