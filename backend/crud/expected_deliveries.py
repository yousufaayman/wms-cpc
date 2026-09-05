from decimal import Decimal

from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.sql import func
from typing import Iterable, List, Optional

from backend.models import (
    Client,
    DyedFabricRoll,
    ExpectedDelivery,
    ExpectedDeliveryItem,
    LogicalLocation,
    UndyedFabricRoll,
)
from backend.schemas import (
    ExpectedDeliveryCreate,
    ExpectedDeliveryUpdate,
    ExpectedDeliveryItemCreate,
    ExpectedDeliveryItemUpdate,
)

SUPPLIER_TYPE_CLIENT = "client"
SUPPLIER_TYPE_LOCATION = "logical_location"

_OPEN_STATUSES = ("pending", "partial")


# ── Polymorphic supplier reference helpers ───────────────────────────────────
# client_supplier_id points at core.clients or wms.logical_locations depending
# on supplier_type. The DB cannot enforce this with a real FK, so every write
# path must call validate_supplier_ref, and reads resolve the display name.

def resolve_supplier_name(
    db: Session,
    client_supplier_id: Optional[int],
    supplier_type: Optional[str],
) -> Optional[str]:
    if client_supplier_id is None or supplier_type is None:
        return None
    if supplier_type == SUPPLIER_TYPE_CLIENT:
        row = db.query(Client.client_name).filter(Client.client_id == client_supplier_id).first()
    elif supplier_type == SUPPLIER_TYPE_LOCATION:
        row = db.query(LogicalLocation.name).filter(LogicalLocation.id == client_supplier_id).first()
    else:
        row = None
    return row[0] if row else None


def validate_supplier_ref(
    db: Session,
    client_supplier_id: Optional[int],
    supplier_type: Optional[str],
) -> None:
    """Raise ValueError unless the supplier pair is consistent and resolvable."""
    if (client_supplier_id is None) != (supplier_type is None):
        raise ValueError("client_supplier_id and supplier_type must both be set or both be null")
    if client_supplier_id is None:
        return
    if supplier_type not in (SUPPLIER_TYPE_CLIENT, SUPPLIER_TYPE_LOCATION):
        raise ValueError("supplier_type must be 'client' or 'logical_location'")
    if resolve_supplier_name(db, client_supplier_id, supplier_type) is None:
        raise ValueError(f"No {supplier_type} exists with id {client_supplier_id}")


def _attach_supplier_names(db: Session, deliveries: Iterable[ExpectedDelivery]) -> None:
    """Set the transient supplier_name attribute on each delivery (one query per table)."""
    deliveries = [d for d in deliveries if d is not None]
    client_ids = {d.client_supplier_id for d in deliveries if d.supplier_type == SUPPLIER_TYPE_CLIENT}
    location_ids = {d.client_supplier_id for d in deliveries if d.supplier_type == SUPPLIER_TYPE_LOCATION}
    client_names = (
        dict(db.query(Client.client_id, Client.client_name).filter(Client.client_id.in_(client_ids)).all())
        if client_ids else {}
    )
    location_names = (
        dict(db.query(LogicalLocation.id, LogicalLocation.name).filter(LogicalLocation.id.in_(location_ids)).all())
        if location_ids else {}
    )
    for d in deliveries:
        if d.supplier_type == SUPPLIER_TYPE_CLIENT:
            d.supplier_name = client_names.get(d.client_supplier_id)
        elif d.supplier_type == SUPPLIER_TYPE_LOCATION:
            d.supplier_name = location_names.get(d.client_supplier_id)
        else:
            d.supplier_name = None


# ── Delivery header CRUD ─────────────────────────────────────────────────────

def _load_delivery(db: Session, delivery_id: int) -> Optional[ExpectedDelivery]:
    # selectinload avoids the cartesian product that two separate joinedload
    # chains on the same collection would produce.
    delivery = (
        db.query(ExpectedDelivery)
        .options(
            selectinload(ExpectedDelivery.items).options(
                joinedload(ExpectedDeliveryItem.material),
                joinedload(ExpectedDeliveryItem.client),
                joinedload(ExpectedDeliveryItem.client_fabric_code),
            )
        )
        .filter(ExpectedDelivery.id == delivery_id)
        .first()
    )
    if delivery:
        _attach_supplier_names(db, [delivery])
    return delivery


def get_expected_delivery(db: Session, delivery_id: int) -> Optional[ExpectedDelivery]:
    return _load_delivery(db, delivery_id)


def get_expected_deliveries(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    warehouse_id: Optional[int] = None,
    status: Optional[str] = None,
    open_only: bool = False,
) -> List[ExpectedDelivery]:
    q = db.query(ExpectedDelivery)
    if warehouse_id is not None:
        q = q.filter(ExpectedDelivery.warehouse_id == warehouse_id)
    if status is not None:
        q = q.filter(ExpectedDelivery.status == status)
    if open_only:
        q = q.filter(ExpectedDelivery.status.in_(_OPEN_STATUSES))
    deliveries = q.order_by(ExpectedDelivery.id.desc()).offset(skip).limit(limit).all()
    _attach_supplier_names(db, deliveries)
    return deliveries


def create_expected_delivery(
    db: Session,
    delivery: ExpectedDeliveryCreate,
    created_by: Optional[int] = None,
) -> ExpectedDelivery:
    validate_supplier_ref(db, delivery.client_supplier_id, delivery.supplier_type)
    db_delivery = ExpectedDelivery(
        **delivery.model_dump(),
        created_by=created_by,
        status="pending",
    )
    db.add(db_delivery)
    db.commit()
    db.refresh(db_delivery)
    return _load_delivery(db, db_delivery.id)


def update_expected_delivery(
    db: Session,
    delivery_id: int,
    delivery: ExpectedDeliveryUpdate,
) -> Optional[ExpectedDelivery]:
    db_delivery = db.query(ExpectedDelivery).filter(ExpectedDelivery.id == delivery_id).first()
    if not db_delivery:
        return None
    updates = delivery.model_dump(exclude_unset=True)
    if "client_supplier_id" in updates or "supplier_type" in updates:
        validate_supplier_ref(
            db,
            updates.get("client_supplier_id", db_delivery.client_supplier_id),
            updates.get("supplier_type", db_delivery.supplier_type),
        )
    if "status" in updates:
        if updates["status"] in ("received", "cancelled"):
            db_delivery.closed_at = func.current_timestamp()
        else:
            # Reopening — the delivery becomes live again for roll matching
            db_delivery.closed_at = None
    for field, value in updates.items():
        setattr(db_delivery, field, value)
    db.commit()
    return _load_delivery(db, delivery_id)


def delete_expected_delivery(db: Session, delivery_id: int) -> bool:
    db_delivery = db.query(ExpectedDelivery).filter(ExpectedDelivery.id == delivery_id).first()
    if not db_delivery:
        return False
    db.delete(db_delivery)
    db.commit()
    return True


# ── Item sub-resource CRUD ───────────────────────────────────────────────────

def _load_item(db: Session, item_id: int) -> Optional[ExpectedDeliveryItem]:
    return (
        db.query(ExpectedDeliveryItem)
        .options(
            joinedload(ExpectedDeliveryItem.material),
            joinedload(ExpectedDeliveryItem.client),
            joinedload(ExpectedDeliveryItem.client_fabric_code),
        )
        .filter(ExpectedDeliveryItem.id == item_id)
        .first()
    )


def add_delivery_item(
    db: Session,
    delivery_id: int,
    item: ExpectedDeliveryItemCreate,
) -> ExpectedDeliveryItem:
    db_item = ExpectedDeliveryItem(
        **item.model_dump(),
        delivery_id=delivery_id,
        received_weight_kg=0,
        received_length_m=0,
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return _load_item(db, db_item.id)


def update_delivery_item(
    db: Session,
    item_id: int,
    item: ExpectedDeliveryItemUpdate,
) -> Optional[ExpectedDeliveryItem]:
    db_item = db.query(ExpectedDeliveryItem).filter(ExpectedDeliveryItem.id == item_id).first()
    if not db_item:
        return None
    for field, value in item.model_dump(exclude_unset=True).items():
        setattr(db_item, field, value)
    # Changing expected quantities can complete (or reopen) the delivery.
    _recompute_delivery_status(db, db_item.delivery_id)
    db.commit()
    return _load_item(db, item_id)


def delete_delivery_item(db: Session, item_id: int) -> bool:
    db_item = db.query(ExpectedDeliveryItem).filter(ExpectedDeliveryItem.id == item_id).first()
    if not db_item:
        return False
    db.delete(db_item)
    db.commit()
    return True


# ── Auto-fulfillment on roll ingestion ───────────────────────────────────────

def find_matching_expected_delivery_item(
    db: Session,
    *,
    client_fabric_code_id: Optional[int] = None,
    client_id: Optional[int] = None,
    material_id: Optional[int] = None,
) -> Optional[ExpectedDeliveryItem]:
    """Return the oldest open, not-yet-fully-received item matching a roll.

    Dyed rolls pass client_fabric_code_id; undyed rolls pass client_id +
    material_id. Items whose expected_weight_kg is null are treated as
    always open.
    """
    q = (
        db.query(ExpectedDeliveryItem)
        .join(ExpectedDelivery, ExpectedDeliveryItem.delivery_id == ExpectedDelivery.id)
        .filter(ExpectedDelivery.status.in_(_OPEN_STATUSES))
    )
    if client_fabric_code_id is not None:
        q = q.filter(ExpectedDeliveryItem.client_fabric_code_id == client_fabric_code_id)
    else:
        q = q.filter(
            ExpectedDeliveryItem.client_id == client_id,
            ExpectedDeliveryItem.material_id == material_id,
        )
    q = q.filter(
        or_(
            ExpectedDeliveryItem.expected_weight_kg.is_(None),
            ExpectedDeliveryItem.received_weight_kg < ExpectedDeliveryItem.expected_weight_kg,
        )
    )
    return q.order_by(
        ExpectedDelivery.expected_date.asc().nulls_last(),
        ExpectedDelivery.created_at.asc(),
    ).first()


# ── Roll ledger ──────────────────────────────────────────────────────────────
# The single source of truth for received quantities is the set of rolls whose
# expected_delivery_item_id points at an item. Each roll carries exactly one
# such FK, so a roll can never feed two deliveries at once, and moving or
# deleting a roll automatically reverses its contribution on the next sync.
# received_weight_kg / received_length_m are derived caches — recomputed from
# the ledger here, never incremented.

_TWO_PLACES = Decimal("0.01")


def _sum_linked_rolls(db: Session, item_ids: List[int]) -> dict:
    """Sum weight/length of every roll (dyed + undyed) linked to each item."""
    sums: dict = {}
    for model in (DyedFabricRoll, UndyedFabricRoll):
        rows = (
            db.query(
                model.expected_delivery_item_id,
                func.coalesce(func.sum(model.weight), 0),
                func.coalesce(func.sum(model.length), 0),
            )
            .filter(model.expected_delivery_item_id.in_(item_ids))
            .group_by(model.expected_delivery_item_id)
            .all()
        )
        for item_id, weight_sum, length_sum in rows:
            acc = sums.setdefault(item_id, [Decimal("0"), Decimal("0")])
            acc[0] += Decimal(weight_sum)
            acc[1] += Decimal(length_sum)
    return sums


def _sync_items_received(db: Session, items: List[ExpectedDeliveryItem]) -> bool:
    """Recompute received totals for the given items from the roll ledger.
    Returns True when any stored value changed. No commit."""
    if not items:
        return False
    sums = _sum_linked_rolls(db, [i.id for i in items])
    changed = False
    for item in items:
        weight_sum, length_sum = sums.get(item.id, (Decimal("0"), Decimal("0")))
        weight_sum = weight_sum.quantize(_TWO_PLACES)
        length_sum = length_sum.quantize(_TWO_PLACES)
        if (item.received_weight_kg or Decimal("0")) != weight_sum:
            item.received_weight_kg = weight_sum
            changed = True
        if (item.received_length_m or Decimal("0")) != length_sum:
            item.received_length_m = length_sum
            changed = True
    return changed


def sync_delivery_item_from_rolls(db: Session, item_id: int) -> None:
    """Ledger recompute for one item (and the parent delivery's status) after
    a roll insert/delete/update. No-op when the parent delivery is closed —
    closed deliveries are frozen until reopened. The caller must flush the
    pending roll change first and owns the transaction — no commit here."""
    item = db.query(ExpectedDeliveryItem).filter(ExpectedDeliveryItem.id == item_id).first()
    if not item:
        return
    delivery_status = (
        db.query(ExpectedDelivery.status)
        .filter(ExpectedDelivery.id == item.delivery_id)
        .scalar()
    )
    if delivery_status not in _OPEN_STATUSES:
        return
    _sync_items_received(db, [item])
    _recompute_delivery_status(db, item.delivery_id)


def sync_delivery_received(db: Session, delivery_id: int) -> None:
    """Full ledger sync for the delivery view path: recompute every item's
    received totals from its linked rolls and re-derive the delivery status.
    Commits only when something actually changed; closed deliveries are
    frozen and skipped."""
    delivery = (
        db.query(ExpectedDelivery)
        .options(selectinload(ExpectedDelivery.items))
        .filter(ExpectedDelivery.id == delivery_id)
        .first()
    )
    if not delivery or delivery.status not in _OPEN_STATUSES:
        return
    changed = _sync_items_received(db, delivery.items)
    status_changed = _recompute_delivery_status(db, delivery_id)
    if changed or status_changed:
        db.commit()


def _item_fully_received(item: ExpectedDeliveryItem) -> bool:
    return (
        item.expected_weight_kg is not None
        and (item.received_weight_kg or Decimal("0")) >= item.expected_weight_kg
    )


def _recompute_delivery_status(db: Session, delivery_id: int) -> bool:
    """Re-derive pending/partial/received from item totals. Returns True when
    the status changed. No commit."""
    delivery = (
        db.query(ExpectedDelivery)
        .options(selectinload(ExpectedDelivery.items))
        .filter(ExpectedDelivery.id == delivery_id)
        .first()
    )
    if not delivery or delivery.status not in _OPEN_STATUSES:
        return False
    items = delivery.items
    if items and all(_item_fully_received(i) for i in items):
        new_status = "received"
    elif any((i.received_weight_kg or 0) > 0 or (i.received_length_m or 0) > 0 for i in items):
        new_status = "partial"
    else:
        new_status = "pending"
    if new_status != delivery.status:
        delivery.status = new_status
        if new_status == "received":
            delivery.closed_at = func.current_timestamp()
        return True
    return False
