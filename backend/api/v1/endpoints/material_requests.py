from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional

from backend import models
from backend.core.authz import ensure_admin, PERM_OPERATIONS
from backend.core.deps import get_db, get_current_user, require_permission
from backend.crud import material_requests as crud
from backend.schemas import (
    JobOrderMaterialRequest,
    JobOrderMaterialRequestCreate,
    MaterialRequestForceFulfill,
)

router = APIRouter()

_NOT_FOUND = "Material request not found"
# Viewer is the only WMS role without material-request access.
_REQUIRE_OPERATIONS = Depends(require_permission(PERM_OPERATIONS))


@router.get("/", response_model=List[JobOrderMaterialRequest])
def list_material_requests(
    skip: int = 0,
    limit: int = 100,
    job_order_id: Optional[int] = Query(None),
    fulfilled: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_OPERATIONS,
):
    return crud.get_material_requests(
        db, skip=skip, limit=limit, job_order_id=job_order_id, fulfilled=fulfilled
    )


@router.get("/{request_id}", response_model=JobOrderMaterialRequest)
def get_material_request(request_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_OPERATIONS):
    request = crud.get_material_request(db, request_id=request_id)
    if not request:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return request


@router.post("/", response_model=JobOrderMaterialRequest, status_code=status.HTTP_201_CREATED)
def create_material_request(
    request: JobOrderMaterialRequestCreate,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_OPERATIONS,
):
    try:
        return crud.create_material_request(db, request=request)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/{request_id}/force-fulfilled", response_model=JobOrderMaterialRequest)
def force_set_fulfilled(
    request_id: int,
    body: MaterialRequestForceFulfill,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    # Overriding the fulfillment flag bypasses the fulfillment ledger, so it
    # stays admin-only.
    ensure_admin(db, current_user)
    result = crud.set_material_request_fulfilled(db, request_id=request_id, fulfilled=body.fulfilled)
    if not result:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return result


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_material_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    ensure_admin(db, current_user)
    if not crud.delete_material_request(db, request_id=request_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
