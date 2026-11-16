"""Accessory requirements of job orders (item 19): read-only API.

The planning system (POMS) writes the requirement lines; WMS has no create,
edit or delete here on purpose. Two reads:
- GET /accessory-requirements/            the lines with needed / issued /
  returned / used / remaining (Material Requests page, accessory mode)
- GET /accessory-requirements/{id}/entries  the ledger rows counted against
  one line (its issue history)

Same permission as the Material Requests page (`operations`; Viewer has
none). The router is off (404) while FEATURE_ACCESSORIES is off (api.py).
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend import models
from backend.core.authz import PERM_OPERATIONS
from backend.core.deps import get_db, require_permission
from backend.core.warehouse_modules import ACCESSORY, ensure_module
from backend.crud import accessory_requirements as crud
from backend.schemas import AccessoryLedgerEntry, AccessoryRequirement, AccessoryRequirementPage

router = APIRouter()

_REQUIRE_OPERATIONS = Depends(require_permission(PERM_OPERATIONS))


@router.get("/", response_model=AccessoryRequirementPage)
def list_requirements(
    warehouse_id: Optional[int] = Query(None, description="The Accessory warehouse the page is in (checked, not a filter)"),
    job_order_id: Optional[int] = Query(None),
    search: Optional[str] = Query(None, max_length=100),
    status_filter: Optional[str] = Query(None, alias="status"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_OPERATIONS,
):
    # Requirements belong to job orders, not to a warehouse. A warehouse given
    # must be one where accessory material requests are shown.
    if warehouse_id is not None:
        wh = ensure_module(db, warehouse_id, "material_requests")
        if getattr(wh.type, "value", wh.type) != ACCESSORY:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Accessory requirements are shown in Accessory warehouses")
    items, total = crud.list_requirements(
        db, job_order_id=job_order_id, search=search, status_filter=status_filter, limit=limit, offset=offset,
    )
    return {"items": items, "total": total}


@router.get("/{requirement_id}", response_model=AccessoryRequirement)
def get_requirement(requirement_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_OPERATIONS):
    return crud.get_requirement(db, requirement_id)


@router.get("/{requirement_id}/entries", response_model=List[AccessoryLedgerEntry])
def requirement_entries(
    requirement_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_OPERATIONS,
):
    return crud.requirement_entries(db, requirement_id)
