from decimal import Decimal

from sqlalchemy.orm import Session, joinedload
from sqlalchemy.sql import func
from typing import List, Optional

from backend.models import (
    DyedFabricRoll,
    ExternalReceipt,
    FabricReceiptItem,
    InternalReceipt,
    JobOrderMaterialRequest,
    MaterialRequestFulfillment,
    SupplierReceipt,
)
from backend.schemas import (
    MaterialRequestFulfillmentCreate,
    MaterialRequestFulfillmentUpdate,
)

_KG_FAMILY = ("KG", "KGS", "KILOGRAM", "KILOGRAMS")

# (fulfillment FK attr, receipt model, receipt-item FK column) per receipt type
_RECEIPT_LINKS = (
    ("internal_receipt_id", InternalReceipt, FabricReceiptItem.internal_receipt_id),
    ("supplier_receipt_id", SupplierReceipt, FabricReceiptItem.supplier_receipt_id),
    ("external_receipt_id", ExternalReceipt, FabricReceiptItem.external_receipt_id),
)


def _load_fulfillment(db: Session, fulfillment_id: int) -> Optional[MaterialRequestFulfillment]:
    return (
        db.query(MaterialRequestFulfillment)
        .options(joinedload(MaterialRequestFulfillment.internal_receipt))
        .filter(MaterialRequestFulfillment.id == fulfillment_id)
        .first()
    )


def get_fulfillment(db: Session, fulfillment_id: int) -> Optional[MaterialRequestFulfillment]:
    return _load_fulfillment(db, fulfillment_id)


def get_fulfillments(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    material_request_id: Optional[int] = None,
    internal_receipt_id: Optional[int] = None,
    supplier_receipt_id: Optional[int] = None,
    external_receipt_id: Optional[int] = None,
) -> List[MaterialRequestFulfillment]:
    q = db.query(MaterialRequestFulfillment).options(
        joinedload(MaterialRequestFulfillment.internal_receipt)
    )
    if material_request_id is not None:
        q = q.filter(MaterialRequestFulfillment.material_request_id == material_request_id)
    if internal_receipt_id is not None:
        q = q.filter(MaterialRequestFulfillment.internal_receipt_id == internal_receipt_id)
    if supplier_receipt_id is not None:
        q = q.filter(MaterialRequestFulfillment.supplier_receipt_id == supplier_receipt_id)
    if external_receipt_id is not None:
        q = q.filter(MaterialRequestFulfillment.external_receipt_id == external_receipt_id)
    return q.order_by(MaterialRequestFulfillment.id.desc()).offset(skip).limit(limit).all()


def create_fulfillment(
    db: Session,
    fulfillment: MaterialRequestFulfillmentCreate,
) -> MaterialRequestFulfillment:
    request = (
        db.query(JobOrderMaterialRequest)
        .filter(JobOrderMaterialRequest.id == fulfillment.material_request_id)
        .first()
    )
    if not request:
        raise ValueError(f"No material request exists with id {fulfillment.material_request_id}")
    for attr, receipt_model, _ in _RECEIPT_LINKS:
        receipt_id = getattr(fulfillment, attr)
        if receipt_id is not None and not db.query(receipt_model.id).filter(receipt_model.id == receipt_id).first():
            raise ValueError(f"No receipt exists for {attr}={receipt_id}")
    data = fulfillment.model_dump()
    # Default the unit to the request's own scale so progress is comparable
    if data.get("measurement_scale") is None:
        data["measurement_scale"] = request.measurement_scale
    db_fulfillment = MaterialRequestFulfillment(**data)
    db.add(db_fulfillment)
    db.flush()
    _recompute_request_fulfilled(db, fulfillment.material_request_id)
    db.commit()
    return _load_fulfillment(db, db_fulfillment.id)


def update_fulfillment(
    db: Session,
    fulfillment_id: int,
    fulfillment: MaterialRequestFulfillmentUpdate,
) -> Optional[MaterialRequestFulfillment]:
    db_fulfillment = (
        db.query(MaterialRequestFulfillment)
        .filter(MaterialRequestFulfillment.id == fulfillment_id)
        .first()
    )
    if not db_fulfillment:
        return None
    for field, value in fulfillment.model_dump(exclude_unset=True).items():
        setattr(db_fulfillment, field, value)
    db.flush()
    _recompute_request_fulfilled(db, db_fulfillment.material_request_id)
    db.commit()
    return _load_fulfillment(db, fulfillment_id)


def delete_fulfillment(db: Session, fulfillment_id: int) -> bool:
    db_fulfillment = (
        db.query(MaterialRequestFulfillment)
        .filter(MaterialRequestFulfillment.id == fulfillment_id)
        .first()
    )
    if not db_fulfillment:
        return False
    request_id = db_fulfillment.material_request_id
    db.delete(db_fulfillment)
    db.flush()
    _recompute_request_fulfilled(db, request_id)
    db.commit()
    return True


def delete_fulfillments_by_request(db: Session, material_request_id: int) -> int:
    deleted = (
        db.query(MaterialRequestFulfillment)
        .filter(MaterialRequestFulfillment.material_request_id == material_request_id)
        .delete()
    )
    if deleted:
        _recompute_request_fulfilled(db, material_request_id)
    db.commit()
    return deleted


# ── Receipt ledger sync ──────────────────────────────────────────────────────
# For receipt-linked fulfillments, quantity_issued is a derived cache: the sum
# of weight (KG scale) or length (M scale) of the linked receipt's rolls that
# match this fulfillment's own request (fabric code) — a receipt may carry
# several requests at once, so the sum must not bleed across them.
# The scan page calls sync after each roll add/remove so progress stays live.

def _sum_receipt_rolls(db: Session, item_filter, fabric_code_id: int, use_weight: bool) -> Decimal:
    """Job-order material requests always target dyed fabric (fabric_code_id
    is non-nullable), so only DyedFabricRoll can legitimately count here."""
    value_col = DyedFabricRoll.weight if use_weight else DyedFabricRoll.length
    row = (
        db.query(func.coalesce(func.sum(value_col), 0))
        .select_from(FabricReceiptItem)
        .join(DyedFabricRoll, FabricReceiptItem.dyed_roll_id == DyedFabricRoll.id)
        .filter(item_filter, DyedFabricRoll.client_fabric_code_id == fabric_code_id)
        .scalar()
    )
    return Decimal(row or 0)


def sync_fulfillment_from_receipt(
    db: Session,
    fulfillment_id: int,
) -> Optional[MaterialRequestFulfillment]:
    """Recompute quantity_issued from the linked receipt's rolls and re-derive
    the parent request's fulfilled flag. No-op for manual (unlinked) rows."""
    db_fulfillment = (
        db.query(MaterialRequestFulfillment)
        .filter(MaterialRequestFulfillment.id == fulfillment_id)
        .first()
    )
    if not db_fulfillment:
        return None
    item_filter = None
    for attr, _, item_col in _RECEIPT_LINKS:
        receipt_id = getattr(db_fulfillment, attr)
        if receipt_id is not None:
            item_filter = item_col == receipt_id
            break
    if item_filter is not None:
        fabric_code_id = (
            db.query(JobOrderMaterialRequest.fabric_code_id)
            .filter(JobOrderMaterialRequest.id == db_fulfillment.material_request_id)
            .scalar()
        )
        use_weight = (db_fulfillment.measurement_scale or "KG").upper() in _KG_FAMILY
        db_fulfillment.quantity_issued = _sum_receipt_rolls(db, item_filter, fabric_code_id, use_weight)
        print(f"[MRF-DEBUG] sync fulfillment_id={fulfillment_id} fabric_code_id={fabric_code_id} "
              f"use_weight={use_weight} -> quantity_issued={db_fulfillment.quantity_issued}", flush=True)
        db.flush()
        _recompute_request_fulfilled(db, db_fulfillment.material_request_id)
        db.commit()
    return _load_fulfillment(db, fulfillment_id)


def _recompute_request_fulfilled(db: Session, material_request_id: int) -> None:
    """Derive the request's fulfilled flag from its fulfillment ledger: total
    issued >= requested quantity. Requests without a quantity keep whatever
    flag they have (admin-managed). No commit."""
    request = (
        db.query(JobOrderMaterialRequest)
        .filter(JobOrderMaterialRequest.id == material_request_id)
        .first()
    )
    if not request or request.quantity is None:
        print(f"[MRF-DEBUG] recompute material_request_id={material_request_id} "
              f"-> SKIPPED (request={'missing' if not request else 'quantity is None'})", flush=True)
        return
    total = (
        db.query(func.coalesce(func.sum(MaterialRequestFulfillment.quantity_issued), 0))
        .filter(MaterialRequestFulfillment.material_request_id == material_request_id)
        .scalar()
    )
    new_fulfilled = Decimal(total or 0) >= request.quantity
    print(f"[MRF-DEBUG] recompute material_request_id={material_request_id} "
          f"total={total!r} quantity={request.quantity!r} "
          f"old_fulfilled={request.fulfilled} new_fulfilled={new_fulfilled}", flush=True)
    request.fulfilled = new_fulfilled
