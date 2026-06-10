from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.sql import func
from typing import List, Optional, Tuple

from backend.models import ExpectedDelivery, ExpectedDeliveryItem, DeliveryItemRoll
from backend.schemas import (
    ExpectedDeliveryCreate,
    ExpectedDeliveryUpdate,
    ExpectedDeliveryItemCreate,
    ExpectedDeliveryItemUpdate,
)


def _load_delivery(db: Session, delivery_id: int) -> Optional[ExpectedDelivery]:
    return (
        db.query(ExpectedDelivery)
        .options(
            joinedload(ExpectedDelivery.supplier_client),
            joinedload(ExpectedDelivery.supplier_location),
            selectinload(ExpectedDelivery.items).options(
                joinedload(ExpectedDeliveryItem.material),
                joinedload(ExpectedDeliveryItem.client_fabric_code),
                joinedload(ExpectedDeliveryItem.lot),
            ),
        )
        .filter(ExpectedDelivery.id == delivery_id)
        .first()
    )


def get_expected_delivery(db: Session, delivery_id: int) -> Optional[ExpectedDelivery]:
    return _load_delivery(db, delivery_id)


def get_expected_deliveries(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    warehouse_id: Optional[int] = None,
    status: Optional[str] = None,
) -> List[ExpectedDelivery]:
    q = db.query(ExpectedDelivery)
    if warehouse_id is not None:
        q = q.filter(ExpectedDelivery.warehouse_id == warehouse_id)
    if status is not None:
        q = q.filter(ExpectedDelivery.status == status)
    return q.order_by(ExpectedDelivery.id.desc()).offset(skip).limit(limit).all()


def create_expected_delivery(
    db: Session,
    delivery: ExpectedDeliveryCreate,
    created_by: Optional[int] = None,
) -> ExpectedDelivery:
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
    if "status" in updates and updates["status"] in ("received", "cancelled"):
        db_delivery.closed_at = func.current_timestamp()
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


def _load_item(db: Session, item_id: int) -> Optional[ExpectedDeliveryItem]:
    return (
        db.query(ExpectedDeliveryItem)
        .options(
            joinedload(ExpectedDeliveryItem.material),
            joinedload(ExpectedDeliveryItem.client_fabric_code),
            joinedload(ExpectedDeliveryItem.lot),
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
    db.commit()
    return _load_item(db, item_id)


def delete_delivery_item(db: Session, item_id: int) -> bool:
    db_item = db.query(ExpectedDeliveryItem).filter(ExpectedDeliveryItem.id == item_id).first()
    if not db_item:
        return False
    db.delete(db_item)
    db.commit()
    return True


class RollAlreadyLinkedError(Exception):
    """Raised when a roll is already linked to a different delivery."""


def receive_delivery_item(
    db: Session,
    item_id: int,
    weight_kg: float,
    length_m: float,
    roll_id: Optional[int] = None,
) -> Optional[ExpectedDeliveryItem]:
    db_item = db.query(ExpectedDeliveryItem).filter(ExpectedDeliveryItem.id == item_id).first()
    if not db_item:
        return None
    if roll_id is not None:
        existing = (
            db.query(DeliveryItemRoll)
            .filter(DeliveryItemRoll.roll_id == roll_id)
            .first()
        )
        if existing:
            if existing.delivery_item_id == item_id:
                # Same roll, same item — idempotent, no-op
                return _load_item(db, item_id)
            # Roll already counted in a different delivery item
            raise RollAlreadyLinkedError(f"Roll {roll_id} is already linked to delivery item {existing.delivery_item_id}")
        db.add(DeliveryItemRoll(delivery_item_id=item_id, roll_id=roll_id, weight_kg=weight_kg, length_m=length_m))
    db_item.received_weight_kg = (db_item.received_weight_kg or 0) + weight_kg
    db_item.received_length_m = (db_item.received_length_m or 0) + length_m
    db.commit()
    return _load_item(db, item_id)


def reconcile_roll(
    db: Session,
    delivery_id: int,
    roll_id: int,
    roll_type: str,
    weight_kg: float,
    length_m: float = 0.0,
    client_fabric_code_id: Optional[int] = None,
    lot_id: Optional[int] = None,
    expected_gsm: Optional[float] = None,
    expected_weight_kg: Optional[float] = None,
    expected_length_m: Optional[float] = None,
    material_id: Optional[int] = None,
    lot_reference: Optional[str] = None,
) -> Tuple[ExpectedDeliveryItem, bool]:
    """Find the best-matching delivery item for the roll, or create an unplanned one.

    Priority for dyed:
      1. client_fabric_code_id + lot_id + gsm (all match)
      2. client_fabric_code_id + null lot + gsm
      3. create new item with fabric_code_planned=False

    Priority for undyed:
      1. material_id + lot_reference + gsm
      2. material_id + null lot_reference + gsm
      3. create new item with fabric_code_planned=False

    Returns (item_orm, was_created).
    """

    def _gsm_ok(item_gsm, roll_gsm) -> bool:
        if item_gsm is None or roll_gsm is None:
            return True
        return abs(float(item_gsm) - float(roll_gsm)) < 0.5

    all_items = (
        db.query(ExpectedDeliveryItem)
        .filter(ExpectedDeliveryItem.delivery_id == delivery_id)
        .all()
    )

    matched: Optional[ExpectedDeliveryItem] = None
    was_created = False

    if roll_type == "dyed" and client_fabric_code_id is not None:
        cfc_items = [i for i in all_items if i.client_fabric_code_id == client_fabric_code_id]

        # Priority 1 — lot + gsm + fabric code
        if lot_id is not None:
            for item in cfc_items:
                if item.lot_id == lot_id and _gsm_ok(item.expected_gsm, expected_gsm):
                    matched = item
                    break

        # Priority 2 — fabric code + gsm, no lot
        if matched is None:
            for item in cfc_items:
                if item.lot_id is None and _gsm_ok(item.expected_gsm, expected_gsm):
                    matched = item
                    break

        # Priority 3 — auto-create unplanned item
        if matched is None:
            matched = ExpectedDeliveryItem(
                delivery_id=delivery_id,
                client_fabric_code_id=client_fabric_code_id,
                lot_id=lot_id,
                expected_gsm=expected_gsm,
                expected_weight_kg=expected_weight_kg,
                expected_length_m=expected_length_m,
                received_weight_kg=0,
                received_length_m=0,
                fabric_code_planned=False,
            )
            db.add(matched)
            db.flush()
            was_created = True

        # Link roll → delivery item (unique constraint prevents double-counting)
        existing_link = (
            db.query(DeliveryItemRoll)
            .filter(DeliveryItemRoll.roll_id == roll_id)
            .first()
        )
        if existing_link:
            if existing_link.delivery_item_id != matched.id:
                raise RollAlreadyLinkedError(
                    f"Roll {roll_id} is already linked to delivery item {existing_link.delivery_item_id}"
                )
            # same roll + same item → idempotent, don't double-count quantities
            return _load_item(db, matched.id), was_created
        db.add(DeliveryItemRoll(
            delivery_item_id=matched.id,
            roll_id=roll_id,
            weight_kg=weight_kg,
            length_m=length_m,
        ))

    elif roll_type == "undyed" and material_id is not None:
        mat_items = [i for i in all_items if i.material_id == material_id]

        def _lot_ref_ok(item_ref, roll_ref) -> bool:
            if not item_ref and not roll_ref:
                return True
            if item_ref and roll_ref:
                return item_ref.strip().lower() == roll_ref.strip().lower()
            return False

        # Priority 1 — material + lot_reference + gsm
        if lot_reference:
            for item in mat_items:
                if _lot_ref_ok(item.lot_reference, lot_reference) and _gsm_ok(item.expected_gsm, expected_gsm):
                    matched = item
                    break

        # Priority 2 — material + null lot + gsm
        if matched is None:
            for item in mat_items:
                if not item.lot_reference and _gsm_ok(item.expected_gsm, expected_gsm):
                    matched = item
                    break

        # Priority 3 — auto-create unplanned item
        if matched is None:
            matched = ExpectedDeliveryItem(
                delivery_id=delivery_id,
                material_id=material_id,
                lot_reference=lot_reference,
                expected_gsm=expected_gsm,
                expected_weight_kg=expected_weight_kg,
                expected_length_m=expected_length_m,
                received_weight_kg=0,
                received_length_m=0,
                fabric_code_planned=False,
            )
            db.add(matched)
            db.flush()
            was_created = True

        # Undyed rolls have no FK table — just accumulate quantities
    else:
        raise ValueError(f"Invalid roll_type '{roll_type}' or missing required identifier field")

    matched.received_weight_kg = float(matched.received_weight_kg or 0) + weight_kg
    matched.received_length_m = float(matched.received_length_m or 0) + length_m
    db.commit()
    return _load_item(db, matched.id), was_created


def reverse_roll_delivery_contributions(db: Session, roll_id: int) -> None:
    """Called before deleting a roll — subtracts its contributions from delivery items."""
    links = db.query(DeliveryItemRoll).filter(DeliveryItemRoll.roll_id == roll_id).all()
    for link in links:
        db_item = db.query(ExpectedDeliveryItem).filter(ExpectedDeliveryItem.id == link.delivery_item_id).first()
        if db_item:
            db_item.received_weight_kg = max(0, (db_item.received_weight_kg or 0) - float(link.weight_kg))
            db_item.received_length_m = max(0, (db_item.received_length_m or 0) - float(link.length_m))
        db.delete(link)
    db.flush()
