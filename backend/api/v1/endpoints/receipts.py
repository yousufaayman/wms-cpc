from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from backend.core.deps import get_db
from backend.crud import receipts
from backend.schemas import Receipt, ReceiptCreate, ReceiptUpdate

router = APIRouter()

@router.get("/", response_model=List[Receipt])
def get_receipts(
    skip: int = 0,
    limit: int = 100,
    closed: Optional[bool] = Query(None, description="Filter by closed status"),
    db: Session = Depends(get_db)
):
    """Get all receipts."""
    if closed is not None:
        return receipts.get_receipts_by_closed_status(db, closed=closed, skip=skip, limit=limit)
    return receipts.get_receipts(db, skip=skip, limit=limit)

@router.get("/type/{receipt_type}", response_model=List[Receipt])
def get_receipts_by_type(
    receipt_type: str,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get receipts by type."""
    return receipts.get_receipts_by_type(db, receipt_type=receipt_type, skip=skip, limit=limit)

@router.get("/status/{status}", response_model=List[Receipt])
def get_receipts_by_status(
    status: str,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get receipts by status."""
    return receipts.get_receipts_by_status(db, status=status, skip=skip, limit=limit)

@router.get("/{receipt_id}", response_model=Receipt)
def get_receipt(
    receipt_id: int,
    db: Session = Depends(get_db)
):
    """Get a receipt by ID."""
    receipt = receipts.get_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt not found"
        )
    return receipt

@router.post("/", response_model=Receipt)
def create_receipt(
    receipt: ReceiptCreate,
    issued_by: int,  # This should come from authentication
    db: Session = Depends(get_db)
):
    """Create a new receipt."""
    return receipts.create_receipt(db, receipt=receipt, issued_by=issued_by)

@router.put("/{receipt_id}", response_model=Receipt)
def update_receipt(
    receipt_id: int,
    receipt: ReceiptUpdate,
    db: Session = Depends(get_db)
):
    """Update a receipt."""
    db_receipt = receipts.get_receipt(db, receipt_id=receipt_id)
    if not db_receipt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt not found"
        )
    return receipts.update_receipt(db, receipt_id=receipt_id, receipt=receipt)

@router.post("/{receipt_id}/confirm")
def confirm_receipt(
    receipt_id: int,
    confirmed_by: int,  # This should come from authentication
    db: Session = Depends(get_db)
):
    """Confirm a receipt."""
    receipt = receipts.confirm_receipt(db, receipt_id=receipt_id, confirmed_by=confirmed_by)
    if not receipt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt not found"
        )
    return {"message": "Receipt confirmed successfully"}

@router.post("/{receipt_id}/cancel")
def cancel_receipt(
    receipt_id: int,
    db: Session = Depends(get_db)
):
    """Cancel a receipt."""
    receipt = receipts.cancel_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt not found"
        )
    return {"message": "Receipt cancelled successfully"}

@router.post("/{receipt_id}/close")
def close_receipt(
    receipt_id: int,
    db: Session = Depends(get_db)
):
    """Close a receipt."""
    receipt = receipts.close_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt not found"
        )
    return {"message": "Receipt closed successfully"}

@router.post("/{receipt_id}/open")
def open_receipt(
    receipt_id: int,
    db: Session = Depends(get_db)
):
    """Open a receipt (mark as not closed)."""
    receipt = receipts.open_receipt(db, receipt_id=receipt_id)
    if not receipt:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt not found"
        )
    return {"message": "Receipt opened successfully"}

@router.delete("/{receipt_id}")
def delete_receipt(
    receipt_id: int,
    db: Session = Depends(get_db)
):
    """Delete a receipt."""
    success = receipts.delete_receipt(db, receipt_id=receipt_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receipt not found"
        )
    return {"message": "Receipt deleted successfully"}

