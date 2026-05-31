from sqlalchemy.orm import Session
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


# ── Fabric ───────────────────────────────────────────────────────────────────

def get_fabric_receipt_item(db: Session, item_id: int):
    return db.query(models.FabricReceiptItem).filter(models.FabricReceiptItem.id == item_id).first()


def get_fabric_items_for_receipt(
    db: Session, receipt_kind: str, receipt_id: int, skip: int = 0, limit: int = 100
):
    q = db.query(models.FabricReceiptItem)
    return _fabric_filter(q, receipt_kind, receipt_id).offset(skip).limit(limit).all()


def create_fabric_receipt_item(
    db: Session, receipt_kind: str, receipt_id: int, item: schemas.FabricReceiptItemCreate
):
    data = _set_receipt_fk(item.model_dump(), receipt_kind, receipt_id)
    db_item = models.FabricReceiptItem(**data)
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item


def delete_fabric_receipt_item(db: Session, item_id: int):
    db_item = get_fabric_receipt_item(db, item_id)
    if not db_item:
        return None
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
