from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.core.deps import get_db, get_current_active_superuser, get_current_active_user, require_permission
from backend.core.authz import (
    PERM_CONFIRM_ACCESSORY_RECEIPTS, PERM_CREATE_RECEIPTS, PERM_DELETE_RECEIPTS, ensure_admin, ensure_permission,
)
from backend import models
from backend.crud import vendor_receipts as crud
from backend.domains.accessories import supplier_returns
from backend.domains.posting import service as posting
from backend.schemas import AccessoryReverseIn, SupplierReceipt, SupplierReceiptCreate, SupplierReceiptUpdate

from backend.core.warehouse_modules import ensure_module, ensure_same_warehouse_type
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
    # Filters combine (previously mutually exclusive)
    return crud.get_vendor_receipts(db, skip=skip, limit=limit, warehouse_id=warehouse_id, closed=closed)


@router.get("/{receipt_id}", response_model=SupplierReceipt)
def get_vendor_receipt(receipt_id: int, db: Session = Depends(get_db)):
    receipt = crud.get_vendor_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.post("/", response_model=SupplierReceipt, status_code=status.HTTP_201_CREATED)
def create_vendor_receipt(
    receipt: SupplierReceiptCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_CREATE_RECEIPTS)),
):
    ensure_module(db, receipt.source_warehouse_id, "receipts")
    supplier_returns.check_header(db, receipt.source_warehouse_id, receipt.target_logical_location_id)
    return crud.create_vendor_receipt(db, receipt=receipt, issued_by=current_user.id)


@router.put("/{receipt_id}", response_model=SupplierReceipt)
def update_vendor_receipt(
    receipt_id: int,
    receipt: SupplierReceiptUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_CREATE_RECEIPTS)),
):
    db_receipt = crud.get_vendor_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    if receipt.source_warehouse_id is not None:
        ensure_same_warehouse_type(db, db_receipt.source_warehouse_id, receipt.source_warehouse_id, "receipts")
    supplier_returns.check_header(
        db, receipt.source_warehouse_id or db_receipt.source_warehouse_id,
        receipt.target_logical_location_id or db_receipt.target_logical_location_id, db_receipt,
    )
    return crud.update_vendor_receipt(db, receipt_id=receipt_id, receipt=receipt)


@router.post("/{receipt_id}/close", response_model=SupplierReceipt)
def close_vendor_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_CREATE_RECEIPTS)),
):
    # Accessory (item 22): closing = sending the return, its packs leave stock
    # (W_Manager may do it, like confirming an issue). Posted before the close,
    # and both are saved together.
    db_receipt = crud.get_vendor_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    if supplier_returns.is_accessory_warehouse(db, db_receipt.source_warehouse_id):
        ensure_permission(db, current_user, PERM_CONFIRM_ACCESSORY_RECEIPTS)
        if db_receipt.closed:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This return is already closed")
        supplier_returns.send(db, db_receipt, current_user.id)
    receipt = crud.close_vendor_receipt(db, receipt_id=receipt_id, closed_by=current_user.id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.post("/{receipt_id}/open", response_model=SupplierReceipt)
def open_vendor_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_superuser),
):
    db_receipt = crud.get_vendor_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    supplier_returns.check_reopen(db, db_receipt)
    receipt = crud.open_vendor_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return receipt


@router.delete("/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vendor_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_DELETE_RECEIPTS)),
):
    db_receipt = crud.get_vendor_receipt(db, receipt_id=receipt_id)
    if db_receipt:
        supplier_returns.check_delete(db, db_receipt)
    success = crud.delete_vendor_receipt(db, receipt_id=receipt_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)


@router.post("/{receipt_id}/reverse", response_model=SupplierReceipt)
def reverse_vendor_receipt(
    receipt_id: int,
    payload: AccessoryReverseIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    """Admin (item 22): undo a sent accessory supplier return. Its packs get
    their quantities back (opposite rows); the receipt stays closed and its
    lines show "Reversed". Send the right packs on a new return."""
    ensure_admin(db, current_user)
    db_receipt = crud.get_vendor_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    if not supplier_returns.is_accessory_warehouse(db, db_receipt.source_warehouse_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only accessory supplier returns can be reversed")
    posting.reverse(db, "supplier", db_receipt, current_user.id, payload.reason)
    db.refresh(db_receipt)
    return db_receipt
