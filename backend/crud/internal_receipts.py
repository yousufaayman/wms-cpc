from sqlalchemy.orm import Session
from typing import List, Optional

from backend.models import InternalReceipt
from backend.schemas import InternalReceiptCreate, InternalReceiptUpdate


def get_internal_receipt(db: Session, receipt_id: int) -> Optional[InternalReceipt]:
    return db.query(InternalReceipt).filter(InternalReceipt.id == receipt_id).first()


def get_internal_receipts(db: Session, skip: int = 0, limit: int = 100) -> List[InternalReceipt]:
    return db.query(InternalReceipt).order_by(InternalReceipt.id.asc()).offset(skip).limit(limit).all()


def get_internal_receipts_by_warehouse(db: Session, warehouse_id: int, skip: int = 0, limit: int = 100) -> List[InternalReceipt]:
    return db.query(InternalReceipt).filter(InternalReceipt.source_warehouse_id == warehouse_id).order_by(InternalReceipt.id.asc()).offset(skip).limit(limit).all()


def get_internal_receipts_by_status(db: Session, status: str, skip: int = 0, limit: int = 100) -> List[InternalReceipt]:
    return db.query(InternalReceipt).filter(InternalReceipt.status == status).order_by(InternalReceipt.id.asc()).offset(skip).limit(limit).all()


def get_internal_receipts_by_closed(db: Session, closed: bool, skip: int = 0, limit: int = 100) -> List[InternalReceipt]:
    return db.query(InternalReceipt).filter(InternalReceipt.closed == closed).order_by(InternalReceipt.id.asc()).offset(skip).limit(limit).all()


def create_internal_receipt(db: Session, receipt: InternalReceiptCreate, issued_by: int) -> InternalReceipt:
    db_receipt = InternalReceipt(
        **receipt.model_dump(),
        issued_by=issued_by,
        status='issued',
    )
    db.add(db_receipt)
    db.commit()
    db.refresh(db_receipt)
    return db_receipt


def update_internal_receipt(db: Session, receipt_id: int, receipt: InternalReceiptUpdate) -> Optional[InternalReceipt]:
    db_receipt = get_internal_receipt(db, receipt_id)
    if db_receipt:
        for field, value in receipt.model_dump(exclude_unset=True).items():
            setattr(db_receipt, field, value)
        db.commit()
        db.refresh(db_receipt)
    return db_receipt


def confirm_internal_receipt(db: Session, receipt_id: int, confirmed_by: int) -> Optional[InternalReceipt]:
    db_receipt = get_internal_receipt(db, receipt_id)
    if db_receipt and db_receipt.status == 'issued':
        db_receipt.status = 'confirmed'
        db_receipt.confirmed_by = confirmed_by
        db.commit()
        db.refresh(db_receipt)
    return db_receipt


def close_internal_receipt(db: Session, receipt_id: int, closed_by: int) -> Optional[InternalReceipt]:
    db_receipt = get_internal_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.closed = True
        db_receipt.closed_by = closed_by
        db.commit()
        db.refresh(db_receipt)
    return db_receipt


def open_internal_receipt(db: Session, receipt_id: int) -> Optional[InternalReceipt]:
    db_receipt = get_internal_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.closed = False
        db_receipt.closed_by = None
        db.commit()
        db.refresh(db_receipt)
    return db_receipt


def delete_internal_receipt(db: Session, receipt_id: int) -> bool:
    db_receipt = get_internal_receipt(db, receipt_id)
    if db_receipt:
        db.delete(db_receipt)
        db.commit()
        return True
    return False
