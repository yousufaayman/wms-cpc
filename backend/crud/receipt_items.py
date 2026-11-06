"""Receipt lines (fabric / box / accessory) on any of the 3 receipt kinds.

Reads are plain queries. Adding or removing a line goes through the posting
service (backend/domains/posting), which applies the warehouse type's stock
rules, e.g. a fabric roll goes 'out' when scanned and back 'in' when removed.
"""
from sqlalchemy.orm import Session
from .. import models, schemas
from ..domains import posting


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
    return posting.add_line(db, receipt_kind, receipt_id, "fabric", item)


def delete_fabric_receipt_item(db: Session, item_id: int):
    db_item = get_fabric_receipt_item(db, item_id)
    if not db_item:
        return None
    return posting.remove_line(db, "fabric", db_item)


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
    return posting.add_line(db, receipt_kind, receipt_id, "box", item)


def delete_box_receipt_item(db: Session, item_id: int):
    db_item = get_box_receipt_item(db, item_id)
    if not db_item:
        return None
    return posting.remove_line(db, "box", db_item)


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
    return posting.add_line(db, receipt_kind, receipt_id, "accessory", item)


def delete_accessory_receipt_item(db: Session, item_id: int):
    db_item = get_accessory_receipt_item(db, item_id)
    if not db_item:
        return None
    return posting.remove_line(db, "accessory", db_item)
