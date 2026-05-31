from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.sql import func
from typing import List, Optional

from backend.models import ExpectedDelivery, ExpectedDeliveryItem
from backend.schemas import (
    ExpectedDeliveryCreate,
    ExpectedDeliveryUpdate,
    ExpectedDeliveryItemCreate,
    ExpectedDeliveryItemUpdate,
)


def _load_delivery(db: Session, delivery_id: int) -> Optional[ExpectedDelivery]:
    # selectinload avoids the cartesian product that two separate joinedload
    # chains on the same collection would produce.
    return (
        db.query(ExpectedDelivery)
        .options(
            selectinload(ExpectedDelivery.items).options(
                joinedload(ExpectedDeliveryItem.material),
                joinedload(ExpectedDeliveryItem.client_fabric_code),
            )
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
