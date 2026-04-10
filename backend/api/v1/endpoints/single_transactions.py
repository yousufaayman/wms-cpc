from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from backend.core.deps import get_db
from backend.crud import single_transactions
from backend.schemas import SingleTransaction, SingleTransactionCreate, SingleTransactionUpdate

router = APIRouter()

@router.get("/", response_model=List[SingleTransaction])
def get_single_transactions(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get all single transactions."""
    return single_transactions.get_single_transactions(db, skip=skip, limit=limit)

@router.get("/user/{user_id}", response_model=List[SingleTransaction])
def get_single_transactions_by_user(
    user_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get single transactions by user."""
    return single_transactions.get_single_transactions_by_user(db, user_id=user_id, skip=skip, limit=limit)

@router.get("/type/{transaction_type}", response_model=List[SingleTransaction])
def get_single_transactions_by_type(
    transaction_type: str,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get single transactions by type."""
    return single_transactions.get_single_transactions_by_type(db, transaction_type=transaction_type, skip=skip, limit=limit)

@router.get("/{transaction_id}", response_model=SingleTransaction)
def get_single_transaction(
    transaction_id: int,
    db: Session = Depends(get_db)
):
    """Get a single transaction by ID."""
    transaction = single_transactions.get_single_transaction(db, transaction_id=transaction_id)
    if not transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Single transaction not found"
        )
    return transaction

@router.post("/", response_model=SingleTransaction)
def create_single_transaction(
    transaction: SingleTransactionCreate,
    db: Session = Depends(get_db)
):
    """Create a new single transaction."""
    return single_transactions.create_single_transaction(db, transaction=transaction)

@router.put("/{transaction_id}", response_model=SingleTransaction)
def update_single_transaction(
    transaction_id: int,
    transaction: SingleTransactionUpdate,
    db: Session = Depends(get_db)
):
    """Update a single transaction."""
    db_transaction = single_transactions.get_single_transaction(db, transaction_id=transaction_id)
    if not db_transaction:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Single transaction not found"
        )
    return single_transactions.update_single_transaction(db, transaction_id=transaction_id, transaction=transaction)

@router.delete("/{transaction_id}")
def delete_single_transaction(
    transaction_id: int,
    db: Session = Depends(get_db)
):
    """Delete a single transaction."""
    success = single_transactions.delete_single_transaction(db, transaction_id=transaction_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Single transaction not found"
        )
    return {"message": "Single transaction deleted successfully"}

