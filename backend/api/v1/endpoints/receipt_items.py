from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from backend.core.deps import get_db
from backend.crud import receipt_items
from backend.schemas import ReceiptItem, ReceiptItemCreate, ReceiptItemUpdate

router = APIRouter()

@router.get("/", response_model=List[ReceiptItem])
def get_receipt_items(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get all receipt items."""
    return receipt_items.get_receipt_items(db, skip=skip, limit=limit)

@router.get("/receipt/{receipt_id}", response_model=List[ReceiptItem])
def get_receipt_items_by_receipt(
    receipt_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get all items for a specific receipt."""
    return receipt_items.get_receipt_items_by_receipt(db, receipt_id=receipt_id, skip=skip, limit=limit)

@router.get("/{item_id}", response_model=ReceiptItem)
def get_receipt_item(
    item_id: int,
    db: Session = Depends(get_db)
):
    """Get a receipt item by ID."""
    item = receipt_items.get_receipt_item(db, item_id=item_id)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt item not found"
        )
    return item

@router.post("/", response_model=ReceiptItem)
def create_receipt_item(
    item: ReceiptItemCreate,
    db: Session = Depends(get_db)
):
    """Create a new receipt item."""
    return receipt_items.create_receipt_item(db, item=item)

@router.put("/{item_id}", response_model=ReceiptItem)
def update_receipt_item(
    item_id: int,
    item: ReceiptItemUpdate,
    db: Session = Depends(get_db)
):
    """Update a receipt item."""
    db_item = receipt_items.get_receipt_item(db, item_id=item_id)
    if not db_item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt item not found"
        )
    return receipt_items.update_receipt_item(db, item_id=item_id, item=item)

@router.delete("/{item_id}")
def delete_receipt_item(
    item_id: int,
    db: Session = Depends(get_db)
):
    """Delete a receipt item."""
    success = receipt_items.delete_receipt_item(db, item_id=item_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt item not found"
        )
    return {"message": "Receipt item deleted successfully"}

