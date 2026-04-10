from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import Receipt
from backend.schemas import ReceiptCreate, ReceiptUpdate

def get_receipt(db: Session, receipt_id: int) -> Optional[Receipt]:
    """Get a receipt by ID."""
    return db.query(Receipt).filter(Receipt.id == receipt_id).first()

def get_receipts(db: Session, skip: int = 0, limit: int = 100) -> List[Receipt]:
    """Get all receipts with pagination."""
    return db.query(Receipt).offset(skip).limit(limit).all()

def get_receipts_by_type(db: Session, receipt_type: str, skip: int = 0, limit: int = 100) -> List[Receipt]:
    """Get receipts by type."""
    return db.query(Receipt).filter(Receipt.receipt_type == receipt_type).offset(skip).limit(limit).all()

def get_receipts_by_status(db: Session, status: str, skip: int = 0, limit: int = 100) -> List[Receipt]:
    """Get receipts by status."""
    return db.query(Receipt).filter(Receipt.status == status).offset(skip).limit(limit).all()

def create_receipt(db: Session, receipt: ReceiptCreate, issued_by: int) -> Receipt:
    """Create a new receipt."""
    db_receipt = Receipt(**receipt.dict(), issued_by=issued_by)
    db.add(db_receipt)
    db.commit()
    db.refresh(db_receipt)
    return db_receipt

def update_receipt(db: Session, receipt_id: int, receipt: ReceiptUpdate) -> Optional[Receipt]:
    """Update a receipt."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        update_data = receipt.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_receipt, field, value)
        db.commit()
        db.refresh(db_receipt)
    return db_receipt

def confirm_receipt(db: Session, receipt_id: int, confirmed_by: int) -> Optional[Receipt]:
    """Confirm a receipt."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.status = "confirmed"
        db_receipt.confirmed_by = confirmed_by
        db_receipt.confirmed_at = db_receipt.issued_at  # Using current timestamp
        db.commit()
        db.refresh(db_receipt)
    return db_receipt

def cancel_receipt(db: Session, receipt_id: int) -> Optional[Receipt]:
    """Cancel a receipt."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.status = "cancelled"
        db.commit()
        db.refresh(db_receipt)
    return db_receipt

def close_receipt(db: Session, receipt_id: int) -> Optional[Receipt]:
    """Close a receipt."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.closed = True
        db.commit()
        db.refresh(db_receipt)
    return db_receipt

def open_receipt(db: Session, receipt_id: int) -> Optional[Receipt]:
    """Open a receipt (mark as not closed)."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.closed = False
        db.commit()
        db.refresh(db_receipt)
    return db_receipt

def get_receipts_by_closed_status(db: Session, closed: bool, skip: int = 0, limit: int = 100) -> List[Receipt]:
    """Get receipts by closed status."""
    return db.query(Receipt).filter(Receipt.closed == closed).offset(skip).limit(limit).all()

def get_receipts_by_reference(db: Session, reference_receipt_id: int, skip: int = 0, limit: int = 100) -> List[Receipt]:
    """Get receipts that reference a specific receipt."""
    return db.query(Receipt).filter(Receipt.reference_receipt_id == reference_receipt_id).offset(skip).limit(limit).all()

def delete_receipt(db: Session, receipt_id: int) -> bool:
    """Delete a receipt."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        db.delete(db_receipt)
        db.commit()
        return True
    return False

