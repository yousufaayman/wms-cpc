"""The posting service: the one place that changes stock because of a receipt.

Endpoints and crud call these functions instead of touching stock themselves:
- add_line     a line is scanned/added onto a receipt
- remove_line  a line is removed from a receipt
- post_confirm a receipt is confirmed
- reverse      a confirmed receipt is undone (item 13; not available yet)

Each looks up the adapter of the warehouse type (registry.py), lets it check
and act, then commits once. For accessories the adapter will be the only
writer of wms.accessory_ledger (item 13), posting on confirm.
"""
from typing import Any

from sqlalchemy.orm import Session

from ... import models
from ...core.warehouse_modules import ensure_receipt_line_kind
from .registry import adapter_for_line_kind, adapter_for_warehouse_type

LINE_MODELS = {
    "fabric": models.FabricReceiptItem,
    "box": models.BoxReceiptItem,
    "accessory": models.AccessoryReceiptItem,
}


def _receipt_fks(receipt_kind: str, receipt_id: int) -> dict:
    return {
        "supplier_receipt_id": receipt_id if receipt_kind == "supplier" else None,
        "internal_receipt_id": receipt_id if receipt_kind == "internal" else None,
        "external_receipt_id": receipt_id if receipt_kind == "external" else None,
    }


def _adapter_for_receipt(db: Session, receipt: Any):
    warehouse = db.get(models.Warehouse, receipt.source_warehouse_id)
    wtype = getattr(warehouse.type, "value", warehouse.type)  # enum or plain str
    return adapter_for_warehouse_type(wtype)


def add_line(db: Session, receipt_kind: str, receipt_id: int, line_kind: str, line_in: Any):
    """Validate, insert and post one receipt line.

    Checks, in order:
    1. shared by every type: the receipt exists, its warehouse has receipts,
       and the line is of that warehouse's kind (HTTPException 404/400)
    2. the warehouse type's own rules, adapter.validate_line (ValueError)
    """
    ensure_receipt_line_kind(db, receipt_kind, receipt_id, line_kind)
    adapter = adapter_for_line_kind(line_kind)
    adapter.validate_line(db, receipt_kind, receipt_id, line_in)
    line = LINE_MODELS[line_kind](**line_in.model_dump(), **_receipt_fks(receipt_kind, receipt_id))
    db.add(line)
    adapter.on_line_added(db, line)
    db.commit()
    db.refresh(line)
    return line


def remove_line(db: Session, line_kind: str, line: Any):
    """Undo the line's stock effect, then delete it."""
    adapter_for_line_kind(line_kind).on_line_removed(db, line)
    db.delete(line)
    db.commit()
    return line


def post_confirm(db: Session, receipt_kind: str, receipt: Any, actor_id: int) -> None:
    """Called by the confirm action after it set the receipt's status, before
    its commit. Does not commit (the caller does)."""
    _adapter_for_receipt(db, receipt).post_confirm(db, receipt_kind, receipt, actor_id)


def reverse(db: Session, receipt_kind: str, receipt: Any, actor_id: int, reason: str) -> None:
    _adapter_for_receipt(db, receipt).reverse(db, receipt_kind, receipt, actor_id, reason)
    db.commit()
