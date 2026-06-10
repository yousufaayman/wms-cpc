from typing import List, Optional
from sqlalchemy.orm import Session, joinedload

from backend.models import JobOrderMaterialRequest
from backend.schemas import JobOrderMaterialRequestCreate


def _with_relations(q):
    return q.options(
        joinedload(JobOrderMaterialRequest.fabric_code),
        joinedload(JobOrderMaterialRequest.job_order),
        joinedload(JobOrderMaterialRequest.fulfillments),
    )


def get_all(
    db: Session,
    job_order_id: Optional[int] = None,
    fulfilled: Optional[bool] = None,
    skip: int = 0,
    limit: int = 200,
) -> List[JobOrderMaterialRequest]:
    q = _with_relations(db.query(JobOrderMaterialRequest))
    if job_order_id is not None:
        q = q.filter(JobOrderMaterialRequest.job_order_id == job_order_id)
    if fulfilled is not None:
        q = q.filter(JobOrderMaterialRequest.fulfilled == fulfilled)
    return q.order_by(JobOrderMaterialRequest.id.asc()).offset(skip).limit(limit).all()


def get_by_id(db: Session, request_id: int) -> Optional[JobOrderMaterialRequest]:
    return (
        _with_relations(db.query(JobOrderMaterialRequest))
        .filter(JobOrderMaterialRequest.id == request_id)
        .first()
    )


def create(db: Session, data: JobOrderMaterialRequestCreate) -> JobOrderMaterialRequest:
    obj = JobOrderMaterialRequest(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return get_by_id(db, obj.id)


def delete(db: Session, request_id: int) -> bool:
    obj = db.query(JobOrderMaterialRequest).filter(JobOrderMaterialRequest.id == request_id).first()
    if not obj:
        return False
    db.delete(obj)
    db.commit()
    return True


def force_set_fulfilled(db: Session, request_id: int, fulfilled: bool) -> Optional[JobOrderMaterialRequest]:
    obj = db.query(JobOrderMaterialRequest).filter(JobOrderMaterialRequest.id == request_id).first()
    if not obj:
        return None
    obj.fulfilled = fulfilled
    db.commit()
    return get_by_id(db, request_id)
