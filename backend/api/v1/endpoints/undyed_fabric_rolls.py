from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from backend import models
from backend.core.deps import get_db, require_permission
from backend.core.authz import PERM_INGEST_FABRIC, PERM_ANALYTICS
from backend.crud import undyed_fabric_rolls as crud_rolls
from backend.schemas import UndyedFabricRoll, UndyedFabricRollCreate, UndyedFabricRollUpdate, UndyedClientInventoryGroup, UndyedFabricRollDetail, UndyedRollFlowEntry

router = APIRouter()

_NOT_FOUND = "Undyed fabric roll not found"
_REQUIRE_INGEST = Depends(require_permission(PERM_INGEST_FABRIC))


@router.get("/inventory", response_model=List[UndyedClientInventoryGroup])
def get_undyed_fabric_inventory(db: Session = Depends(get_db)):
    """Return current undyed fabric stock grouped by client → material → lot/supplier → rolls."""
    return crud_rolls.get_undyed_fabric_inventory(db)


@router.get("/analytics/flow", response_model=List[UndyedRollFlowEntry])
def get_undyed_fabric_flow_analytics(db: Session = Depends(get_db), current_user: models.User = Depends(require_permission(PERM_ANALYTICS))):
    """Daily ingested vs digested rows per client + material across all
    undyed rolls (any status). Powers the Analytics page, so gated the same way."""
    return crud_rolls.get_undyed_fabric_flow_analytics(db)


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


@router.get("/{roll_id}/detail", response_model=UndyedFabricRollDetail)
def get_undyed_fabric_roll_detail(roll_id: int, db: Session = Depends(get_db)):
    detail = crud_rolls.get_undyed_fabric_roll_detail(db, roll_id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return detail


@router.get("/{roll_id}", response_model=UndyedFabricRoll)
def get_undyed_fabric_roll(roll_id: int, db: Session = Depends(get_db)):
    roll = crud_rolls.get_undyed_fabric_roll(db, roll_id)
    if not roll:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return roll


@router.post("/", response_model=UndyedFabricRoll, status_code=status.HTTP_201_CREATED)
def create_undyed_fabric_roll(roll: UndyedFabricRollCreate, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_INGEST):
    """Create a new undyed fabric roll, recording who ingested it."""
    return crud_rolls.create_undyed_fabric_roll(db, roll, ingested_by=current_user.id)


@router.patch("/{roll_id}", response_model=UndyedFabricRoll)
def update_undyed_fabric_roll(roll_id: int, roll: UndyedFabricRollUpdate, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_INGEST):
    """Update an undyed fabric roll."""
    updated = crud_rolls.update_undyed_fabric_roll(db, roll_id, roll)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return updated


@router.delete("/{roll_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_undyed_fabric_roll(roll_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_INGEST):
    """Delete an undyed fabric roll, reversing its contribution to any linked
    expected-delivery item (unless the delivery is closed)."""
    if not crud_rolls.delete_undyed_fabric_roll(db, roll_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
