from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.core.deps import get_db, get_current_active_superuser, require_permission
from backend.core.authz import PERM_CREATE_RECEIPTS, PERM_DELETE_RECEIPTS
from backend import models
from backend.crud import external_receipts as crud
from backend.schemas import (
    ExternalReceipt,
    ExternalReceiptCreate,
    ExternalReceiptUpdate,
)

from backend.core.warehouse_modules import ensure_module, ensure_same_warehouse_type
router = APIRouter()


@router.get("/", response_model=List[ExternalReceipt])
def get_external_receipts(
    skip: int = 0,
    limit: int = 100,
    warehouse_id: Optional[int] = Query(None),
    closed: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
):
    # Filters combine (previously mutually exclusive)
    return crud.get_external_receipts(db, skip=skip, limit=limit, warehouse_id=warehouse_id, closed=closed)


@router.get("/{receipt_id}", response_model=ExternalReceipt)
def get_external_receipt(receipt_id: int, db: Session = Depends(get_db)):
    receipt = crud.get_external_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External receipt not found")
    return receipt


@router.post("/", response_model=ExternalReceipt, status_code=status.HTTP_201_CREATED)
def create_external_receipt(
    receipt: ExternalReceiptCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_CREATE_RECEIPTS)),
):
    ensure_module(db, receipt.source_warehouse_id, "receipts")
    return crud.create_external_receipt(db, receipt=receipt, issued_by=current_user.id)


@router.put("/{receipt_id}", response_model=ExternalReceipt)
def update_external_receipt(
    receipt_id: int,
    receipt: ExternalReceiptUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_CREATE_RECEIPTS)),
):
    db_receipt = crud.get_external_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External receipt not found")
    if receipt.source_warehouse_id is not None:
        ensure_same_warehouse_type(db, db_receipt.source_warehouse_id, receipt.source_warehouse_id, "receipts")
    return crud.update_external_receipt(db, receipt_id=receipt_id, receipt=receipt)


@router.post("/{receipt_id}/close", response_model=ExternalReceipt)
def close_external_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_CREATE_RECEIPTS)),
):
    receipt = crud.close_external_receipt(db, receipt_id=receipt_id, closed_by=current_user.id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External receipt not found")
    return receipt


@router.post("/{receipt_id}/open", response_model=ExternalReceipt)
def open_external_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser),
):
    receipt = crud.open_external_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External receipt not found")
    return receipt


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_external_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_DELETE_RECEIPTS)),
):
    success = crud.delete_external_receipt(db, receipt_id=receipt_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="External receipt not found")
