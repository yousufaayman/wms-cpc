from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import ReceiptItem
from backend.schemas import ReceiptItemCreate, ReceiptItemUpdate

def get_receipt_item(db: Session, item_id: int) -> Optional[ReceiptItem]:
    """Get a receipt item by ID."""
    return db.query(ReceiptItem).filter(ReceiptItem.id == item_id).first()

def get_receipt_items_by_receipt(db: Session, receipt_id: int, skip: int = 0, limit: int = 100) -> List[ReceiptItem]:
    """Get all items for a specific receipt."""
    return db.query(ReceiptItem).filter(ReceiptItem.receipt_id == receipt_id).offset(skip).limit(limit).all()

def get_receipt_items(db: Session, skip: int = 0, limit: int = 100) -> List[ReceiptItem]:
    """Get all receipt items with pagination."""
    return db.query(ReceiptItem).offset(skip).limit(limit).all()

def create_receipt_item(db: Session, item: ReceiptItemCreate) -> ReceiptItem:
    """Create a new receipt item."""
    db_item = ReceiptItem(**item.dict())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

def update_receipt_item(db: Session, item_id: int, item: ReceiptItemUpdate) -> Optional[ReceiptItem]:
    """Update a receipt item."""
    db_item = get_receipt_item(db, item_id)
    if db_item:
        update_data = item.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_item, field, value)
        db.commit()
        db.refresh(db_item)
    return db_item

def delete_receipt_item(db: Session, item_id: int) -> bool:
    """Delete a receipt item."""
    db_item = get_receipt_item(db, item_id)
    if db_item:
        db.delete(db_item)
        db.commit()
        return True
    return False

