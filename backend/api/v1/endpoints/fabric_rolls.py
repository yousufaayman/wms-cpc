from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from backend.core.deps import get_db
from backend.crud import fabric_rolls as crud_rolls
from backend.schemas import DyedFabricRoll, DyedFabricRollCreate, ClientInventoryGroup, FabricRollDetail

router = APIRouter()


@router.get("/inventory", response_model=List[ClientInventoryGroup])
def get_fabric_inventory(db: Session = Depends(get_db)):
    """Return current dyed fabric stock grouped by fabric code → lot/supplier → individual rolls."""
    return crud_rolls.get_fabric_inventory(db)


@router.get("/", response_model=List[DyedFabricRoll])
def get_fabric_rolls(
    skip: int = 0,
    limit: int = 200,
    client_fabric_code_id: Optional[int] = Query(None),
    lot_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """List dyed fabric rolls, optionally filtered."""
    return crud_rolls.get_fabric_rolls(
        db, skip=skip, limit=limit,
        client_fabric_code_id=client_fabric_code_id,
        lot_id=lot_id,
    )


@router.get("/{roll_id}/detail", response_model=FabricRollDetail)
def get_fabric_roll_detail(roll_id: int, db: Session = Depends(get_db)):
    detail = crud_rolls.get_fabric_roll_detail(db, roll_id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dyed fabric roll not found")
    return detail


@router.get("/{roll_id}", response_model=DyedFabricRoll)
def get_fabric_roll(roll_id: int, db: Session = Depends(get_db)):
    roll = crud_rolls.get_fabric_roll(db, roll_id)
    if not roll:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dyed fabric roll not found")
    return roll


@router.post("/", response_model=DyedFabricRoll, status_code=status.HTTP_201_CREATED)
def create_fabric_roll(roll: DyedFabricRollCreate, db: Session = Depends(get_db)):
    """Create a new dyed fabric roll."""
    return crud_rolls.create_fabric_roll(db, roll)
