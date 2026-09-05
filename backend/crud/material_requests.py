from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from backend.models import ClientFabricCode, JobOrder, JobOrderMaterialRequest
from backend.schemas import JobOrderMaterialRequestCreate


def _details_options():
    return (
        joinedload(JobOrderMaterialRequest.fabric_code).options(
            joinedload(ClientFabricCode.material),
            joinedload(ClientFabricCode.color),
            joinedload(ClientFabricCode.client),
        ),
        joinedload(JobOrderMaterialRequest.job_order).options(
            joinedload(JobOrder.client),
        ),
    )


def get_material_request(db: Session, request_id: int) -> Optional[JobOrderMaterialRequest]:
    return (
        db.query(JobOrderMaterialRequest)
        .options(*_details_options())
        .filter(JobOrderMaterialRequest.id == request_id)
        .first()
    )


def get_material_requests(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    job_order_id: Optional[int] = None,
    fulfilled: Optional[bool] = None,
) -> List[JobOrderMaterialRequest]:
    """List requests ordered by job order priority (lowest number first,
    unprioritized last), so the warehouse works the most urgent orders first."""
    q = (
        db.query(JobOrderMaterialRequest)
        .join(JobOrder, JobOrderMaterialRequest.job_order_id == JobOrder.job_order_id)
        .options(*_details_options())
    )
    if job_order_id is not None:
        q = q.filter(JobOrderMaterialRequest.job_order_id == job_order_id)
    if fulfilled is not None:
        q = q.filter(JobOrderMaterialRequest.fulfilled == fulfilled)
    return (
        q.order_by(
            JobOrder.priority.asc().nulls_last(),
            JobOrder.job_order_id.asc(),
            JobOrderMaterialRequest.id.asc(),
        )
        .offset(skip)
        .limit(limit)
        .all()
    )


def create_material_request(
    db: Session,
    request: JobOrderMaterialRequestCreate,
) -> JobOrderMaterialRequest:
    if not db.query(JobOrder.job_order_id).filter(JobOrder.job_order_id == request.job_order_id).first():
        raise ValueError(f"No job order exists with id {request.job_order_id}")
    if not db.query(ClientFabricCode.id).filter(ClientFabricCode.id == request.fabric_code_id).first():
        raise ValueError(f"No fabric code exists with id {request.fabric_code_id}")
    duplicate = (
        db.query(JobOrderMaterialRequest.id)
        .filter(
            JobOrderMaterialRequest.job_order_id == request.job_order_id,
            JobOrderMaterialRequest.fabric_code_id == request.fabric_code_id,
            JobOrderMaterialRequest.panel_type == request.panel_type,
        )
        .first()
    )
    if duplicate:
        raise ValueError("A material request for this job order, fabric code and panel type already exists")
    db_request = JobOrderMaterialRequest(**request.model_dump())
    db.add(db_request)
    db.commit()
    db.refresh(db_request)
    return get_material_request(db, db_request.id)


def set_material_request_fulfilled(
    db: Session,
    request_id: int,
    fulfilled: bool,
) -> Optional[JobOrderMaterialRequest]:
    db_request = (
        db.query(JobOrderMaterialRequest)
        .filter(JobOrderMaterialRequest.id == request_id)
        .first()
    )
    if not db_request:
        return None
    db_request.fulfilled = fulfilled
    db.commit()
    return get_material_request(db, request_id)


def delete_material_request(db: Session, request_id: int) -> bool:
    db_request = (
        db.query(JobOrderMaterialRequest)
        .filter(JobOrderMaterialRequest.id == request_id)
        .first()
    )
    if not db_request:
        return False
    db.delete(db_request)
    db.commit()
    return True
