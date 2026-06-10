from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.core.deps import get_db, get_current_active_superuser
from backend.crud import job_order_material_requests as crud
from backend.crud import material_request_fulfillments as fulfillment_crud
from backend import models
from backend.schemas import JobOrderMaterialRequest, JobOrderMaterialRequestCreate, MaterialRequestMetrics, RequestBulkMetrics

router = APIRouter()


class ForceFulfilledPayload(BaseModel):
    fulfilled: bool

_NOT_FOUND = "Material request not found"


@router.get("/", response_model=List[JobOrderMaterialRequest])
def list_material_requests(
    job_order_id: Optional[int] = Query(None),
    fulfilled: Optional[bool] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    return crud.get_all(db, job_order_id=job_order_id, fulfilled=fulfilled, skip=skip, limit=limit)


@router.get("/bulk-metrics", response_model=List[RequestBulkMetrics])
def get_bulk_metrics(
    ids: str = Query(..., description="Comma-separated request IDs"),
    db: Session = Depends(get_db),
):
    request_ids = [int(i.strip()) for i in ids.split(",") if i.strip().isdigit()]
    if not request_ids:
        return []
    return fulfillment_crud.compute_bulk_metrics(db, request_ids)


@router.get("/{request_id}", response_model=JobOrderMaterialRequest)
def get_material_request(request_id: int, db: Session = Depends(get_db)):
    obj = crud.get_by_id(db, request_id)
    if not obj:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return obj


@router.post("/", response_model=JobOrderMaterialRequest, status_code=201)
def create_material_request(data: JobOrderMaterialRequestCreate, db: Session = Depends(get_db)):
    return crud.create(db, data)


@router.get("/{request_id}/metrics", response_model=MaterialRequestMetrics)
def get_metrics(request_id: int, db: Session = Depends(get_db)):
    obj = crud.get_by_id(db, request_id)
    if not obj:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return fulfillment_crud.compute_metrics(
        db,
        request_id,
        obj.measurement_scale,
        float(obj.quantity) if obj.quantity is not None else None,
    )


@router.patch("/{request_id}/force-fulfilled", response_model=JobOrderMaterialRequest)
def force_set_fulfilled(
    request_id: int,
    payload: ForceFulfilledPayload,
    db: Session = Depends(get_db),
    _admin: models.User = Depends(get_current_active_superuser),
):
    obj = crud.force_set_fulfilled(db, request_id, payload.fulfilled)
    if not obj:
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
    return obj


@router.delete("/{request_id}", status_code=204)
def delete_material_request(request_id: int, db: Session = Depends(get_db)):
    if not crud.delete(db, request_id):
        raise HTTPException(status_code=404, detail=_NOT_FOUND)
