from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from typing import List, Optional

from backend.models import SupplierReceipt
from backend.schemas import SupplierReceiptCreate, SupplierReceiptUpdate


def get_vendor_receipt(db: Session, receipt_id: int) -> Optional[SupplierReceipt]:
    return db.query(SupplierReceipt).filter(SupplierReceipt.id == receipt_id).first()


def get_vendor_receipts(db: Session, skip: int = 0, limit: int = 100) -> List[SupplierReceipt]:
    return db.query(SupplierReceipt).order_by(SupplierReceipt.id.asc()).offset(skip).limit(limit).all()


def get_vendor_receipts_by_warehouse(db: Session, warehouse_id: int, skip: int = 0, limit: int = 100) -> List[SupplierReceipt]:
    return db.query(SupplierReceipt).filter(SupplierReceipt.source_warehouse_id == warehouse_id).order_by(SupplierReceipt.id.asc()).offset(skip).limit(limit).all()


def get_vendor_receipts_by_closed(db: Session, closed: bool, skip: int = 0, limit: int = 100) -> List[SupplierReceipt]:
    return db.query(SupplierReceipt).filter(SupplierReceipt.closed == closed).order_by(SupplierReceipt.id.asc()).offset(skip).limit(limit).all()


def create_vendor_receipt(db: Session, receipt: SupplierReceiptCreate, issued_by: int) -> SupplierReceipt:
    db_receipt = SupplierReceipt(
        **receipt.model_dump(),
        issued_by=issued_by,
        status='issued',
    )
    db.add(db_receipt)
    db.commit()
    db.refresh(db_receipt)
    return db_receipt


def update_vendor_receipt(db: Session, receipt_id: int, receipt: SupplierReceiptUpdate) -> Optional[SupplierReceipt]:
    db_receipt = get_vendor_receipt(db, receipt_id)
    if db_receipt:
        for field, value in receipt.model_dump(exclude_unset=True).items():
            setattr(db_receipt, field, value)
        db.commit()
        db.refresh(db_receipt)
    return db_receipt


def close_vendor_receipt(db: Session, receipt_id: int, closed_by: int) -> Optional[SupplierReceipt]:
    db_receipt = get_vendor_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.closed = True
        db_receipt.closed_by = closed_by
        db_receipt.closed_at = func.current_timestamp()
        db.commit()
        db.refresh(db_receipt)
    return db_receipt


def open_vendor_receipt(db: Session, receipt_id: int) -> Optional[SupplierReceipt]:
    db_receipt = get_vendor_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.closed = False
        db_receipt.closed_by = None
        db_receipt.closed_at = None
        db.commit()
        db.refresh(db_receipt)
    return db_receipt


def delete_vendor_receipt(db: Session, receipt_id: int) -> bool:
    db_receipt = get_vendor_receipt(db, receipt_id)
    if db_receipt:
        db.delete(db_receipt)
        db.commit()
        return True
    return False
