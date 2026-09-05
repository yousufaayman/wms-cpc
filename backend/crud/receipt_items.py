from sqlalchemy.orm import Session
from sqlalchemy.sql import func
from .. import models, schemas


def _fabric_filter(query, receipt_kind: str, receipt_id: int):
    if receipt_kind == "supplier":
        return query.filter(models.FabricReceiptItem.supplier_receipt_id == receipt_id)
    if receipt_kind == "internal":
        return query.filter(models.FabricReceiptItem.internal_receipt_id == receipt_id)
    return query.filter(models.FabricReceiptItem.external_receipt_id == receipt_id)


def _box_filter(query, receipt_kind: str, receipt_id: int):
    if receipt_kind == "supplier":
        return query.filter(models.BoxReceiptItem.supplier_receipt_id == receipt_id)
    if receipt_kind == "internal":
        return query.filter(models.BoxReceiptItem.internal_receipt_id == receipt_id)
    return query.filter(models.BoxReceiptItem.external_receipt_id == receipt_id)


def _accessory_filter(query, receipt_kind: str, receipt_id: int):
    if receipt_kind == "supplier":
        return query.filter(models.AccessoryReceiptItem.supplier_receipt_id == receipt_id)
    if receipt_kind == "internal":
        return query.filter(models.AccessoryReceiptItem.internal_receipt_id == receipt_id)
    return query.filter(models.AccessoryReceiptItem.external_receipt_id == receipt_id)


def _set_receipt_fk(data: dict, receipt_kind: str, receipt_id: int) -> dict:
    data["supplier_receipt_id"] = receipt_id if receipt_kind == "supplier" else None
    data["internal_receipt_id"] = receipt_id if receipt_kind == "internal" else None
    data["external_receipt_id"] = receipt_id if receipt_kind == "external" else None
    return data


def _fulfillment_receipt_filter(receipt_kind: str, receipt_id: int):
    if receipt_kind == "supplier":
        return models.MaterialRequestFulfillment.supplier_receipt_id == receipt_id
    if receipt_kind == "internal":
        return models.MaterialRequestFulfillment.internal_receipt_id == receipt_id
    return models.MaterialRequestFulfillment.external_receipt_id == receipt_id


def _ensure_roll_matches_material_requests(
    db: Session, receipt_kind: str, receipt_id: int, item: schemas.FabricReceiptItemCreate
) -> None:
    """A receipt linked to material requests only accepts rolls whose fabric
    code matches one of those requests. Raises ValueError on mismatch."""
    allowed_codes = {
        code
        for (code,) in (
            db.query(models.JobOrderMaterialRequest.fabric_code_id)
            .join(
                models.MaterialRequestFulfillment,
                models.MaterialRequestFulfillment.material_request_id == models.JobOrderMaterialRequest.id,
            )
            .filter(_fulfillment_receipt_filter(receipt_kind, receipt_id))
            .all()
        )
    }
    if not allowed_codes:
        return  # receipt has no assigned material request — anything goes
    if item.dyed_roll_id is None:
        raise ValueError(
            "This receipt is linked to a material request — only dyed rolls "
            "matching the request's fabric code can be scanned"
        )
    roll_code = (
        db.query(models.DyedFabricRoll.client_fabric_code_id)
        .filter(models.DyedFabricRoll.id == item.dyed_roll_id)
        .scalar()
    )
    if roll_code not in allowed_codes:
        raise ValueError(
            "Roll fabric code does not match the material request assigned to this receipt"
        )


def _set_item_roll_status(db: Session, dyed_roll_id, undyed_roll_id, new_status: str) -> None:
    """Flip the linked roll's in/out status. Scanning a roll onto a receipt
    issues it (out); removing the item reverses it (in). No commit."""
    if dyed_roll_id is not None:
        roll = db.query(models.DyedFabricRoll).filter(models.DyedFabricRoll.id == dyed_roll_id).first()
    elif undyed_roll_id is not None:
        roll = db.query(models.UndyedFabricRoll).filter(models.UndyedFabricRoll.id == undyed_roll_id).first()
    else:
        roll = None
    if roll is None:
        return
    roll.status = new_status
    roll.issued_date = func.current_timestamp() if new_status == "out" else None


# ── Fabric ───────────────────────────────────────────────────────────────────

def get_fabric_receipt_item(db: Session, item_id: int):
    return db.query(models.FabricReceiptItem).filter(models.FabricReceiptItem.id == item_id).first()


def get_fabric_items_for_receipt(
    db: Session, receipt_kind: str, receipt_id: int, skip: int = 0, limit: int = 100
):
    q = db.query(models.FabricReceiptItem)
    return _fabric_filter(q, receipt_kind, receipt_id).offset(skip).limit(limit).all()


def _ensure_roll_is_in(db: Session, item: schemas.FabricReceiptItemCreate) -> None:
    """Only rolls currently in stock (status 'in') can be scanned onto a
    receipt — a roll already issued out can't be issued again."""
    if item.dyed_roll_id is not None:
        roll = db.query(models.DyedFabricRoll).filter(models.DyedFabricRoll.id == item.dyed_roll_id).first()
    elif item.undyed_roll_id is not None:
        roll = db.query(models.UndyedFabricRoll).filter(models.UndyedFabricRoll.id == item.undyed_roll_id).first()
    else:
        roll = None
    if roll is None:
        raise ValueError("Roll not found")
    if roll.status != "in":
        raise ValueError(f"Roll is not in stock (status: {roll.status}) and cannot be scanned")


def create_fabric_receipt_item(
    db: Session, receipt_kind: str, receipt_id: int, item: schemas.FabricReceiptItemCreate
):
    _ensure_roll_is_in(db, item)
    _ensure_roll_matches_material_requests(db, receipt_kind, receipt_id, item)
    data = _set_receipt_fk(item.model_dump(), receipt_kind, receipt_id)
    db_item = models.FabricReceiptItem(**data)
    db.add(db_item)
    _set_item_roll_status(db, db_item.dyed_roll_id, db_item.undyed_roll_id, "out")
    db.commit()
    db.refresh(db_item)
    return db_item


def delete_fabric_receipt_item(db: Session, item_id: int):
    db_item = get_fabric_receipt_item(db, item_id)
    if not db_item:
        return None
    _set_item_roll_status(db, db_item.dyed_roll_id, db_item.undyed_roll_id, "in")
    db.delete(db_item)
    db.commit()
    return db_item


# ── Box ──────────────────────────────────────────────────────────────────────

def get_box_receipt_item(db: Session, item_id: int):
    return db.query(models.BoxReceiptItem).filter(models.BoxReceiptItem.id == item_id).first()


def get_box_items_for_receipt(
    db: Session, receipt_kind: str, receipt_id: int, skip: int = 0, limit: int = 100
):
    q = db.query(models.BoxReceiptItem)
    return _box_filter(q, receipt_kind, receipt_id).offset(skip).limit(limit).all()


def create_box_receipt_item(
    db: Session, receipt_kind: str, receipt_id: int, item: schemas.BoxReceiptItemCreate
):
    data = _set_receipt_fk(item.model_dump(), receipt_kind, receipt_id)
    db_item = models.BoxReceiptItem(**data)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


def delete_box_receipt_item(db: Session, item_id: int):
    db_item = get_box_receipt_item(db, item_id)
    if not db_item:
        return None
    db.delete(db_item)
    db.commit()
    return db_item


# ── Accessory ────────────────────────────────────────────────────────────────

def get_accessory_receipt_item(db: Session, item_id: int):
    return db.query(models.AccessoryReceiptItem).filter(models.AccessoryReceiptItem.id == item_id).first()


def get_accessory_items_for_receipt(
    db: Session, receipt_kind: str, receipt_id: int, skip: int = 0, limit: int = 100
):
    q = db.query(models.AccessoryReceiptItem)
    return _accessory_filter(q, receipt_kind, receipt_id).offset(skip).limit(limit).all()


def create_accessory_receipt_item(
    db: Session, receipt_kind: str, receipt_id: int, item: schemas.AccessoryReceiptItemCreate
):
    data = _set_receipt_fk(item.model_dump(), receipt_kind, receipt_id)
    db_item = models.AccessoryReceiptItem(**data)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


def delete_accessory_receipt_item(db: Session, item_id: int):
    db_item = get_accessory_receipt_item(db, item_id)
    if not db_item:
        return None
    db.delete(db_item)
    db.commit()
    return db_item
