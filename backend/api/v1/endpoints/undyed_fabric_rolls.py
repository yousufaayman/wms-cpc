from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from backend.core.deps import get_db
from backend.crud import undyed_fabric_rolls as crud_rolls
from backend.schemas import UndyedFabricRoll, UndyedFabricRollCreate, UndyedFabricRollUpdate, UndyedClientInventoryGroup

router = APIRouter()


@router.get("/inventory", response_model=List[UndyedClientInventoryGroup])
def get_undyed_fabric_inventory(db: Session = Depends(get_db)):
    """Return current undyed fabric stock grouped by client → material → lot/supplier → rolls."""
    return crud_rolls.get_undyed_fabric_inventory(db)


@router.get("/", response_model=List[UndyedFabricRoll])
def get_undyed_fabric_rolls(
    skip: int = 0,
    limit: int = 200,
    client_id: Optional[int] = Query(None),
    material_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """List undyed fabric rolls, optionally filtered by client or material."""
    return crud_rolls.get_undyed_fabric_rolls(
        db, skip=skip, limit=limit,
        client_id=client_id,
        material_id=material_id,
    )


@router.get("/{roll_id}", response_model=UndyedFabricRoll)
def get_undyed_fabric_roll(roll_id: int, db: Session = Depends(get_db)):
    roll = crud_rolls.get_undyed_fabric_roll(db, roll_id)
    if not roll:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Undyed fabric roll not found")
    return roll


@router.post("/", response_model=UndyedFabricRoll, status_code=status.HTTP_201_CREATED)
def create_undyed_fabric_roll(roll: UndyedFabricRollCreate, db: Session = Depends(get_db)):
    """Create a new undyed fabric roll."""
    return crud_rolls.create_undyed_fabric_roll(db, roll)


@router.patch("/{roll_id}", response_model=UndyedFabricRoll)
def update_undyed_fabric_roll(roll_id: int, roll: UndyedFabricRollUpdate, db: Session = Depends(get_db)):
    """Update an undyed fabric roll."""
    updated = crud_rolls.update_undyed_fabric_roll(db, roll_id, roll)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Undyed fabric roll not found")
    return updated
