from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from typing import List, Optional

from backend.models import ExternalReceipt
from backend.schemas import ExternalReceiptCreate, ExternalReceiptUpdate


def get_external_receipt(db: Session, receipt_id: int) -> Optional[ExternalReceipt]:
    return db.query(ExternalReceipt).filter(ExternalReceipt.id == receipt_id).first()


def get_external_receipts(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    warehouse_id: int = None,
    closed: bool = None,
) -> List[ExternalReceipt]:
    q = db.query(ExternalReceipt)
    if warehouse_id is not None:
        q = q.filter(ExternalReceipt.source_warehouse_id == warehouse_id)
    if closed is not None:
        q = q.filter(ExternalReceipt.closed == closed)
    return q.order_by(ExternalReceipt.id.asc()).offset(skip).limit(limit).all()


def get_external_receipts_by_warehouse(db: Session, warehouse_id: int, skip: int = 0, limit: int = 100) -> List[ExternalReceipt]:
    return db.query(ExternalReceipt).filter(ExternalReceipt.source_warehouse_id == warehouse_id).order_by(ExternalReceipt.id.asc()).offset(skip).limit(limit).all()


def get_external_receipts_by_closed(db: Session, closed: bool, skip: int = 0, limit: int = 100) -> List[ExternalReceipt]:
    return db.query(ExternalReceipt).filter(ExternalReceipt.closed == closed).order_by(ExternalReceipt.id.asc()).offset(skip).limit(limit).all()


def create_external_receipt(db: Session, receipt: ExternalReceiptCreate, issued_by: int) -> ExternalReceipt:
    db_receipt = ExternalReceipt(
        **receipt.model_dump(),
        issued_by=issued_by,
        status='issued',
    )
    db.add(db_receipt)
    db.commit()
    db.refresh(db_receipt)
    return db_receipt


def update_external_receipt(db: Session, receipt_id: int, receipt: ExternalReceiptUpdate) -> Optional[ExternalReceipt]:
    db_receipt = get_external_receipt(db, receipt_id)
    if db_receipt:
        for field, value in receipt.model_dump(exclude_unset=True).items():
            setattr(db_receipt, field, value)
        db.commit()
        db.refresh(db_receipt)
    return db_receipt


def close_external_receipt(db: Session, receipt_id: int, closed_by: int) -> Optional[ExternalReceipt]:
    db_receipt = get_external_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.closed = True
        db_receipt.closed_by = closed_by
        db_receipt.closed_at = func.current_timestamp()
        db.commit()
        db.refresh(db_receipt)
    return db_receipt


def open_external_receipt(db: Session, receipt_id: int) -> Optional[ExternalReceipt]:
    db_receipt = get_external_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.closed = False
        db_receipt.closed_by = None
        db_receipt.closed_at = None
        db.commit()
        db.refresh(db_receipt)
    return db_receipt


def delete_external_receipt(db: Session, receipt_id: int) -> bool:
    db_receipt = get_external_receipt(db, receipt_id)
    if db_receipt:
        db.delete(db_receipt)
        db.commit()
        return True
    return False
