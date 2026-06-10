from typing import List, Optional
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from backend.models import MaterialRequestFulfillment, FabricReceiptItem, JobOrderMaterialRequest
from backend.schemas import MaterialRequestFulfillmentCreate, MaterialRequestFulfillmentUpdate, MaterialRequestMetrics, RequestBulkMetrics


def _with_relations(q):
    return q.options(joinedload(MaterialRequestFulfillment.internal_receipt))


def get_all(
    db: Session,
    material_request_id: Optional[int] = None,
    internal_receipt_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 200,
) -> List[MaterialRequestFulfillment]:
    q = _with_relations(db.query(MaterialRequestFulfillment))
    if material_request_id is not None:
        q = q.filter(MaterialRequestFulfillment.material_request_id == material_request_id)
    if internal_receipt_id is not None:
        q = q.filter(MaterialRequestFulfillment.internal_receipt_id == internal_receipt_id)
    return q.order_by(MaterialRequestFulfillment.id.asc()).offset(skip).limit(limit).all()


def get_by_id(db: Session, fulfillment_id: int) -> Optional[MaterialRequestFulfillment]:
    return (
        _with_relations(db.query(MaterialRequestFulfillment))
        .filter(MaterialRequestFulfillment.id == fulfillment_id)
        .first()
    )


def create(db: Session, data: MaterialRequestFulfillmentCreate) -> MaterialRequestFulfillment:
    # Resolve measurement_scale from the material request when not supplied by the caller
    scale = data.measurement_scale
    if scale is None:
        req = db.query(JobOrderMaterialRequest).filter(JobOrderMaterialRequest.id == data.material_request_id).first()
        if req:
            scale = req.measurement_scale
    if scale is not None:
        data = data.model_copy(update={"measurement_scale": scale})
        _maybe_migrate_unit(db, data.material_request_id, scale)

    obj = MaterialRequestFulfillment(**data.model_dump())
    db.add(obj)
    db.commit()
    db.refresh(obj)
    _sync_fulfilled_status(db, obj.material_request_id)
    return get_by_id(db, obj.id)


def update(db: Session, fulfillment_id: int, data: MaterialRequestFulfillmentUpdate) -> Optional[MaterialRequestFulfillment]:
    obj = db.query(MaterialRequestFulfillment).filter(MaterialRequestFulfillment.id == fulfillment_id).first()
    if not obj:
        return None
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(obj, field, value)
    db.commit()
    _sync_fulfilled_status(db, obj.material_request_id)
    return get_by_id(db, fulfillment_id)


def delete(db: Session, fulfillment_id: int) -> bool:
    obj = db.query(MaterialRequestFulfillment).filter(MaterialRequestFulfillment.id == fulfillment_id).first()
    if not obj:
        return False
    material_request_id = obj.material_request_id
    db.delete(obj)
    db.commit()
    _sync_fulfilled_status(db, material_request_id)
    return True


def _is_kg(measurement_scale: str) -> bool:
    return measurement_scale.upper() in ("KG", "KGS", "KILOGRAM", "KILOGRAMS")


def _roll_value(roll, use_weight: bool) -> float:
    if roll is None:
        return 0.0
    return float(roll.weight or 0) if use_weight else float(roll.length or 0)


def _receipt_issued(db: Session, internal_receipt_id: int, use_weight: bool) -> float:
    items = (
        db.query(FabricReceiptItem)
        .filter(FabricReceiptItem.internal_receipt_id == internal_receipt_id)
        .options(joinedload(FabricReceiptItem.dyed_roll), joinedload(FabricReceiptItem.undyed_roll))
        .all()
    )
    return sum(_roll_value(item.dyed_roll or item.undyed_roll, use_weight) for item in items)


def _split_issued(db: Session, material_request_id: int, use_weight: bool) -> tuple[float, float]:
    fulfillments = (
        db.query(MaterialRequestFulfillment)
        .filter(MaterialRequestFulfillment.material_request_id == material_request_id)
        .all()
    )
    receipt_fulfillments = [f for f in fulfillments if f.internal_receipt_id is not None]
    manual_fulfillments  = [f for f in fulfillments if f.internal_receipt_id is None]
    issued_from_rolls = sum(_receipt_issued(db, f.internal_receipt_id, use_weight) for f in receipt_fulfillments)
    issued_manually   = sum(float(f.quantity_issued or 0) for f in manual_fulfillments)
    return issued_from_rolls, issued_manually


def compute_metrics(
    db: Session,
    material_request_id: int,
    measurement_scale: str,
    requested_quantity: Optional[float],
) -> MaterialRequestMetrics:
    use_weight = _is_kg(measurement_scale)
    issued_from_rolls, issued_manually = _split_issued(db, material_request_id, use_weight)
    total_issued = issued_from_rolls + issued_manually
    remaining    = (requested_quantity - total_issued) if requested_quantity is not None else None

    return MaterialRequestMetrics(
        measurement_scale=measurement_scale,
        requested_quantity=requested_quantity,
        issued_from_rolls=round(issued_from_rolls, 4),
        issued_manually=round(issued_manually, 4),
        total_issued=round(total_issued, 4),
        remaining=round(remaining, 4) if remaining is not None else None,
    )


def _maybe_migrate_unit(db: Session, material_request_id: int, new_scale: str) -> None:
    """If any existing fulfillment was stored with a different unit family, re-compute or clear quantity_issued."""
    existing = (
        db.query(MaterialRequestFulfillment)
        .filter(
            MaterialRequestFulfillment.material_request_id == material_request_id,
            MaterialRequestFulfillment.measurement_scale.isnot(None),
        )
        .all()
    )
    new_is_weight = _is_kg(new_scale)
    changed = [f for f in existing if _is_kg(f.measurement_scale) != new_is_weight]
    if not changed:
        return
    for f in changed:
        if f.internal_receipt_id is not None:
            # Re-derive quantity from the actual rolls already in the receipt using the new unit
            f.quantity_issued = _receipt_issued(db, f.internal_receipt_id, new_is_weight)
        else:
            # Manual entry — no roll data to convert from; clear it so history stays honest
            f.quantity_issued = None
        f.measurement_scale = new_scale
    db.commit()


def _sync_fulfilled_status(db: Session, material_request_id: int) -> None:
    """Recompute fulfilled in both directions — promotes to True when met, reverts to False when not."""
    req = (
        db.query(JobOrderMaterialRequest)
        .filter(JobOrderMaterialRequest.id == material_request_id)
        .first()
    )
    if not req:
        return
    if req.quantity is None:
        has_any = bool(
            db.query(MaterialRequestFulfillment.id)
            .filter(MaterialRequestFulfillment.material_request_id == material_request_id)
            .first()
        )
        new_fulfilled = has_any
    else:
        use_weight = _is_kg(req.measurement_scale)
        issued_from_rolls, issued_manually = _split_issued(db, material_request_id, use_weight)
        new_fulfilled = (issued_from_rolls + issued_manually) >= float(req.quantity)
    if req.fulfilled != new_fulfilled:
        req.fulfilled = new_fulfilled
        db.commit()


def compute_bulk_metrics(db: Session, request_ids: list[int]) -> list[RequestBulkMetrics]:
    """Sum quantity_issued per request in two queries — one aggregation + one lookup."""
    issued_rows = (
        db.query(
            MaterialRequestFulfillment.material_request_id,
            func.coalesce(func.sum(MaterialRequestFulfillment.quantity_issued), 0).label("total_issued"),
        )
        .filter(MaterialRequestFulfillment.material_request_id.in_(request_ids))
        .group_by(MaterialRequestFulfillment.material_request_id)
        .all()
    )
    issued_map = {row.material_request_id: float(row.total_issued) for row in issued_rows}

    requests = (
        db.query(JobOrderMaterialRequest)
        .filter(JobOrderMaterialRequest.id.in_(request_ids))
        .all()
    )
    result = []
    for req in requests:
        total_issued = issued_map.get(req.id, 0.0)
        remaining = (float(req.quantity) - total_issued) if req.quantity is not None else None
        result.append(RequestBulkMetrics(
            id=req.id,
            total_issued=round(total_issued, 4),
            remaining=round(remaining, 4) if remaining is not None else None,
        ))
    return result


def delete_by_request(db: Session, material_request_id: int) -> int:
    """Delete all fulfillment records for a request. Returns count deleted."""
    deleted = (
        db.query(MaterialRequestFulfillment)
        .filter(MaterialRequestFulfillment.material_request_id == material_request_id)
        .all()
    )
    count = len(deleted)
    for obj in deleted:
        db.delete(obj)
    db.commit()
    return count
