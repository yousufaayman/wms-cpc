from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.core.deps import get_db, get_current_active_superuser, get_current_active_user, require_permission
from backend.core.authz import (
    PERM_CONFIRM_ACCESSORY_RECEIPTS,
    PERM_CONFIRM_RECEIPTS,
    PERM_CREATE_RECEIPTS,
    PERM_DELETE_RECEIPTS,
    ensure_permission,
)
from backend.domains.accessories import issuing
from backend import models
from backend.crud import internal_receipts as crud
from backend.schemas import (
    InternalReceipt,
    InternalReceiptCreate,
    InternalReceiptUpdate,
)

from backend.core.warehouse_modules import ACCESSORY, ensure_module, ensure_same_warehouse_type
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
    # Filters combine (previously mutually exclusive — warehouse_id silently
    # discarded status/closed).
    receipts = crud.get_internal_receipts(
        db, skip=skip, limit=limit,
        warehouse_id=warehouse_id, status=receipt_status, closed=closed,
    )
    issuing.fill_over_issue_counts(db, receipts)
    return receipts


@router.get("/{receipt_id}", response_model=InternalReceipt)
def get_internal_receipt(receipt_id: int, db: Session = Depends(get_db)):
    receipt = crud.get_internal_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal receipt not found")
    issuing.fill_over_issue_counts(db, [receipt])
    return receipt


@router.post("/", response_model=InternalReceipt, status_code=status.HTTP_201_CREATED)
def create_internal_receipt(
    receipt: InternalReceiptCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_CREATE_RECEIPTS)),
):
    ensure_module(db, receipt.source_warehouse_id, "receipts")
    # Accessory: an issue to a job order (item 20)
    issuing.check_issue_header(db, receipt.source_warehouse_id, receipt.target_logical_location_id, receipt.job_order_id)
    return crud.create_internal_receipt(db, receipt=receipt, issued_by=current_user.id)


@router.put("/{receipt_id}", response_model=InternalReceipt)
def update_internal_receipt(
    receipt_id: int,
    receipt: InternalReceiptUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_CREATE_RECEIPTS)),
):
    db_receipt = crud.get_internal_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal receipt not found")
    if receipt.source_warehouse_id is not None:
        ensure_same_warehouse_type(db, db_receipt.source_warehouse_id, receipt.source_warehouse_id, "receipts")
    changes = receipt.model_dump(exclude_unset=True)
    if {"job_order_id", "target_logical_location_id", "source_warehouse_id"} & changes.keys():
        job_order_id = changes.get("job_order_id", db_receipt.job_order_id)
        if job_order_id != db_receipt.job_order_id and issuing.list_lines(db, "internal", receipt_id):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Remove the scanned packs before changing the job order")
        issuing.check_issue_header(
            db, changes.get("source_warehouse_id") or db_receipt.source_warehouse_id,
            changes.get("target_logical_location_id") or db_receipt.target_logical_location_id, job_order_id,
        )
    return crud.update_internal_receipt(db, receipt_id=receipt_id, receipt=receipt)


@router.post("/{receipt_id}/confirm", response_model=InternalReceipt)
def confirm_internal_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_active_user),
):
    # Fabric: admin only (confirm_receipts). Accessory issues post stock and
    # W_Manager may confirm them (confirm_accessory_receipts, item 3).
    db_receipt = crud.get_internal_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal receipt not found")
    warehouse = db.get(models.Warehouse, db_receipt.source_warehouse_id)
    is_accessory = getattr(warehouse.type, "value", warehouse.type) == ACCESSORY
    ensure_permission(db, current_user, PERM_CONFIRM_ACCESSORY_RECEIPTS if is_accessory else PERM_CONFIRM_RECEIPTS)
    receipt = crud.confirm_internal_receipt(db, receipt_id=receipt_id, confirmed_by=current_user.id)
    issuing.fill_over_issue_counts(db, [receipt])
    return receipt


@router.post("/{receipt_id}/close", response_model=InternalReceipt)
def close_internal_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_CREATE_RECEIPTS)),
):
    receipt = crud.close_internal_receipt(db, receipt_id=receipt_id, closed_by=current_user.id)
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
def delete_internal_receipt(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_DELETE_RECEIPTS)),
):
    success = crud.delete_internal_receipt(db, receipt_id=receipt_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Internal receipt not found")
