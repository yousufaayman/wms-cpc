"""Fabric's stock rules, moved here unchanged from crud/receipt_items.py.

Fabric has no ledger. A roll's stock state is its `status` column:
- scanning a roll onto a receipt issues it: status 'out', issued_date = now
- removing that line puts it back: status 'in', issued_date = NULL
- confirming an internal receipt changes nothing on the rolls

Before a scan is accepted the roll must be in stock, and if the receipt is
linked to material requests, the roll must be a dyed roll of a requested
fabric code.
"""
from sqlalchemy.orm import Session
from sqlalchemy.sql import func

from ... import models, schemas
from ...core.warehouse_modules import FABRIC
from .registry import PostingAdapter, register


def _fulfillment_receipt_filter(receipt_kind: str, receipt_id: int):
    if receipt_kind == "supplier":
        return models.MaterialRequestFulfillment.supplier_receipt_id == receipt_id
    if receipt_kind == "internal":
        return models.MaterialRequestFulfillment.internal_receipt_id == receipt_id
    return models.MaterialRequestFulfillment.external_receipt_id == receipt_id


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
    """Flip the linked roll's in/out status. No commit."""
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


class FabricAdapter(PostingAdapter):
    def validate_line(self, db, receipt_kind, receipt_id, line_in):
        _ensure_roll_is_in(db, line_in)
        _ensure_roll_matches_material_requests(db, receipt_kind, receipt_id, line_in)

    def on_line_added(self, db, line):
        _set_item_roll_status(db, line.dyed_roll_id, line.undyed_roll_id, "out")

    def on_line_removed(self, db, line):
        _set_item_roll_status(db, line.dyed_roll_id, line.undyed_roll_id, "in")

    # post_confirm: nothing; fabric stock already moved at scan time.
    # reverse: not offered; fabric undoes a scan by removing the line.


register(FABRIC, FabricAdapter())
