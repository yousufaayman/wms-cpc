from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from backend.core.deps import get_db
from backend.crud import lots as crud_lots
from backend.schemas import Lot, LotCreate

router = APIRouter()


@router.get("/", response_model=List[Lot])
def get_lots(
    client_fabric_code_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """Get lots, optionally filtered by client_fabric_code_id."""
    if client_fabric_code_id is not None:
        return crud_lots.get_lots_by_fabric_code(db, client_fabric_code_id)
    return []


@router.post("/", response_model=Lot, status_code=status.HTTP_201_CREATED)
def create_lot(lot: LotCreate, db: Session = Depends(get_db)):
    """Create a new lot. Returns 409 if lot_number already exists for that fabric code."""
    try:
        return crud_lots.create_lot(db, lot)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))


@router.post("/get-or-create", response_model=Lot)
def get_or_create_lot(lot: LotCreate, db: Session = Depends(get_db)):
    """Return existing lot or create it."""
    return crud_lots.get_or_create_lot(db, lot.client_fabric_code_id, lot.lot_number)
