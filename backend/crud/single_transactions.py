from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import SingleTransaction
from backend.schemas import SingleTransactionCreate, SingleTransactionUpdate

def get_single_transaction(db: Session, transaction_id: int) -> Optional[SingleTransaction]:
    """Get a single transaction by ID."""
    return db.query(SingleTransaction).filter(SingleTransaction.id == transaction_id).first()

def get_single_transactions(db: Session, skip: int = 0, limit: int = 100) -> List[SingleTransaction]:
    """Get all single transactions with pagination."""
    return db.query(SingleTransaction).offset(skip).limit(limit).all()

def get_single_transactions_by_user(db: Session, user_id: int, skip: int = 0, limit: int = 100) -> List[SingleTransaction]:
    """Get single transactions by user."""
    return db.query(SingleTransaction).filter(SingleTransaction.user_id == user_id).offset(skip).limit(limit).all()

def get_single_transactions_by_type(db: Session, transaction_type: str, skip: int = 0, limit: int = 100) -> List[SingleTransaction]:
    """Get single transactions by type."""
    return db.query(SingleTransaction).filter(SingleTransaction.transaction_type == transaction_type).offset(skip).limit(limit).all()

def create_single_transaction(db: Session, transaction: SingleTransactionCreate) -> SingleTransaction:
    """Create a new single transaction."""
    db_transaction = SingleTransaction(**transaction.dict())
    db.add(db_transaction)
    db.commit()
    db.refresh(db_transaction)
    return db_transaction

def update_single_transaction(db: Session, transaction_id: int, transaction: SingleTransactionUpdate) -> Optional[SingleTransaction]:
    """Update a single transaction."""
    db_transaction = get_single_transaction(db, transaction_id)
    if db_transaction:
        update_data = transaction.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_transaction, field, value)
        db.commit()
        db.refresh(db_transaction)
    return db_transaction

def delete_single_transaction(db: Session, transaction_id: int) -> bool:
    """Delete a single transaction."""
    db_transaction = get_single_transaction(db, transaction_id)
    if db_transaction:
        db.delete(db_transaction)
        db.commit()
        return True
    return False

