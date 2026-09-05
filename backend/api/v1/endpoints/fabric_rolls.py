from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from backend import models
from backend.core.deps import get_db, require_permission
from backend.core.authz import PERM_INGEST_FABRIC, PERM_ANALYTICS
from backend.crud import fabric_rolls as crud_rolls
from backend.schemas import DyedFabricRoll, DyedFabricRollCreate, ClientInventoryGroup, FabricRollDetail, DyedRollFlowEntry

router = APIRouter()

_NOT_FOUND = "Dyed fabric roll not found"
_REQUIRE_INGEST = Depends(require_permission(PERM_INGEST_FABRIC))


@router.get("/inventory", response_model=List[ClientInventoryGroup])
def get_fabric_inventory(db: Session = Depends(get_db)):
    """Return current dyed fabric stock grouped by fabric code → lot/supplier → individual rolls."""
    return crud_rolls.get_fabric_inventory(db)


@router.get("/analytics/flow", response_model=List[DyedRollFlowEntry])
def get_fabric_flow_analytics(db: Session = Depends(get_db), current_user: models.User = Depends(require_permission(PERM_ANALYTICS))):
    """Daily ingested vs digested rows per fabric-code identity across all
    dyed rolls (any status). Powers the Analytics page, so gated the same way."""
    return crud_rolls.get_fabric_flow_analytics(db)


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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return detail


@router.get("/{roll_id}", response_model=DyedFabricRoll)
def get_fabric_roll(roll_id: int, db: Session = Depends(get_db)):
    roll = crud_rolls.get_fabric_roll(db, roll_id)
    if not roll:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return roll


@router.post("/", response_model=DyedFabricRoll, status_code=status.HTTP_201_CREATED)
def create_fabric_roll(roll: DyedFabricRollCreate, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_INGEST):
    """Create a new dyed fabric roll, recording who ingested it."""
    try:
        return crud_rolls.create_fabric_roll(db, roll, ingested_by=current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/{roll_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fabric_roll(roll_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_INGEST):
    """Delete a dyed fabric roll, reversing its contribution to any linked
    expected-delivery item (unless the delivery is closed)."""
    if not crud_rolls.delete_fabric_roll(db, roll_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
