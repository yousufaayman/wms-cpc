"""Returnable tools (item 33): folders, presser feet, machine equipment.

Reading needs any WMS role. Adding tools (and undoing an Add) needs
`receive_accessories`. Check-out / check-in and retire come in item 34. The
router is off (404) while FEATURE_ACCESSORIES is off (see api.py); every
call is for an Accessory warehouse (module `returnable_tools`).

All rules live in `domains/accessories/tools.py`.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from backend import models
from backend.core.authz import PERM_RECEIVE_ACCESSORIES
from backend.core.deps import get_db, require_permission
from backend.core.warehouse_modules import ensure_module
from backend.domains.accessories import tools
from backend.schemas import (
    ReturnableAddedRow,
    ReturnableAddIn,
    ReturnableSummaryRow,
    ReturnableTopUpIn,
    ReturnableUnit,
)

router = APIRouter()


@router.get("/summary", response_model=List[ReturnableSummaryRow])
def summary(
    warehouse_id: int = Query(...),
    q: Optional[str] = Query(None, max_length=100, description="Item code or description (contains)"),
    db: Session = Depends(get_db),
):
    """One row per tool item here: labels, owned / in / out / retired."""
    return tools.summary(db, warehouse_id, q)


@router.get("/units", response_model=List[ReturnableUnit])
def list_units(
    warehouse_id: int = Query(...),
    accessory_item_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    """The pieces and packs here (of one item with `accessory_item_id`), oldest first."""
    return tools.list_units(db, warehouse_id, accessory_item_id)


@router.get("/scan", response_model=ReturnableUnit)
def scan(barcode: str, db: Session = Depends(get_db)):
    """The tool behind a scanned label, e.g. `?barcode=57*TL`."""
    unit = tools.find_by_barcode(db, barcode)
    ensure_module(db, unit.warehouse_id, tools.MODULE)
    return tools.unit_rows(db, [unit])[0]


@router.post("/add", response_model=List[ReturnableAddedRow], status_code=status.HTTP_201_CREATED)
def add(
    payload: ReturnableAddIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_RECEIVE_ACCESSORIES)),
):
    """New pieces (one label each) or one new tracked pack."""
    made = tools.add_tools(db, current_user.id, payload)
    db.commit()
    rows = tools.unit_rows(db, [unit for unit, _ in made])
    return [{"movement_id": move.id, "unit": row} for (_, move), row in zip(made, rows)]


@router.post("/units/{unit_id}/add", response_model=ReturnableAddedRow, status_code=status.HTTP_201_CREATED)
def top_up(
    unit_id: int,
    payload: ReturnableTopUpIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_RECEIVE_ACCESSORIES)),
):
    """More identical tools into an existing tracked pack (same label)."""
    move = tools.top_up(db, current_user.id, unit_id, payload.qty)
    db.commit()
    return {"movement_id": move.id, "unit": tools.unit_rows(db, [tools.get_unit_or_404(db, unit_id)])[0]}


@router.delete("/movements/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def undo_add(
    movement_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_RECEIVE_ACCESSORIES)),
):
    """The Add page's Undo: cancel one Add while nothing happened to the tool since."""
    tools.undo_add(db, current_user, movement_id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{unit_id}", response_model=ReturnableUnit)
def get_unit(unit_id: int, db: Session = Depends(get_db)):
    unit = tools.get_unit_or_404(db, unit_id)
    ensure_module(db, unit.warehouse_id, tools.MODULE)
    return tools.unit_rows(db, [unit])[0]
