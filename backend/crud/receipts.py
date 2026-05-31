from sqlalchemy.orm import Session
from typing import List, Optional

from backend.crud import logical_locations as logical_locations_crud
from backend.crud import warehouses as warehouses_crud
from backend.models import Receipt
from backend.schemas import ReceiptCreate, ReceiptUpdate

# Maps logical_locations.location_type → receipts.receipt_type
_ALLOWED_RECEIPT_TYPES_BY_WAREHOUSE = {
    "Fabric": {"dyehouse", "internal"},
    "Accessory": {"internal"},
    "RMG": {"internal", "shipping"},
}


def _receipt_type_from_location_type(location_type: object) -> str:
    """client → shipping; dyehouse → dyehouse; internal → internal."""
    lt = getattr(location_type, "value", location_type)
    s = str(lt) if lt is not None else "internal"
    if s == "client":
        return "shipping"
    if s == "dyehouse":
        return "dyehouse"
    return "internal"

def get_receipt(db: Session, receipt_id: int) -> Optional[Receipt]:
    """Get a receipt by ID."""
    return db.query(Receipt).filter(Receipt.id == receipt_id).first()

def get_receipts(db: Session, skip: int = 0, limit: int = 100) -> List[Receipt]:
    """Get all receipts with pagination."""
    return db.query(Receipt).offset(skip).limit(limit).all()

def get_receipts_by_type(db: Session, receipt_type: str, skip: int = 0, limit: int = 100) -> List[Receipt]:
    """Get receipts by type."""
    return db.query(Receipt).filter(Receipt.receipt_type == receipt_type).offset(skip).limit(limit).all()

def get_receipts_by_status(db: Session, status: str, skip: int = 0, limit: int = 100) -> List[Receipt]:
    """Get receipts by status."""
    return db.query(Receipt).filter(Receipt.status == status).offset(skip).limit(limit).all()

def create_receipt(db: Session, receipt: ReceiptCreate, issued_by: int) -> Receipt:
    """Create a new receipt; receipt_type is resolved from the logical location on the non-warehouse side."""
    inbound = (
        receipt.target_warehouse_id is not None
        and receipt.target_logical_location_id is None
        and receipt.source_logical_location_id is not None
        and receipt.source_warehouse_id is None
    )
    if inbound:
        loc = logical_locations_crud.get_logical_location(db, receipt.source_logical_location_id)
        if not loc:
            raise ValueError("Source logical location not found")
        resolved_type = _receipt_type_from_location_type(loc.location_type)
        wh = warehouses_crud.get_warehouse(db, receipt.target_warehouse_id)
        wh_label = "Target warehouse"
    else:
        loc = logical_locations_crud.get_logical_location(db, receipt.target_logical_location_id)
        if not loc:
            raise ValueError("Target logical location not found")
        resolved_type = _receipt_type_from_location_type(loc.location_type)
        wh = warehouses_crud.get_warehouse(db, receipt.source_warehouse_id)
        wh_label = "Source warehouse"

    if not wh:
        raise ValueError(f"{wh_label} not found")

    wtype = wh.type if isinstance(wh.type, str) else wh.type.value
    allowed = _ALLOWED_RECEIPT_TYPES_BY_WAREHOUSE.get(wtype, set())
    if resolved_type not in allowed:
        raise ValueError(
            f"Selected location implies receipt type '{resolved_type}', which is not allowed "
            f"for a {wtype} warehouse; choose another location"
        )

    data = receipt.model_dump(exclude={"receipt_type"})
    data["receipt_type"] = resolved_type
    db_receipt = Receipt(**data, issued_by=issued_by)
    db.add(db_receipt)
    db.commit()
    db.refresh(db_receipt)
    return db_receipt

def update_receipt(db: Session, receipt_id: int, receipt: ReceiptUpdate) -> Optional[Receipt]:
    """Update a receipt."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        update_data = receipt.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_receipt, field, value)
        db.commit()
        db.refresh(db_receipt)
    return db_receipt

def confirm_receipt(db: Session, receipt_id: int, confirmed_by: int) -> Optional[Receipt]:
    """Confirm a receipt."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.status = "confirmed"
        db_receipt.confirmed_by = confirmed_by
        db_receipt.confirmed_at = db_receipt.issued_at  # Using current timestamp
        db.commit()
        db.refresh(db_receipt)
    return db_receipt

def cancel_receipt(db: Session, receipt_id: int) -> Optional[Receipt]:
    """Cancel a receipt."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.status = "cancelled"
        db.commit()
        db.refresh(db_receipt)
    return db_receipt

def close_receipt(db: Session, receipt_id: int) -> Optional[Receipt]:
    """Close a receipt."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.closed = True
        db.commit()
        db.refresh(db_receipt)
    return db_receipt

def open_receipt(db: Session, receipt_id: int) -> Optional[Receipt]:
    """Open a receipt (mark as not closed)."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        db_receipt.closed = False
        db.commit()
        db.refresh(db_receipt)
    return db_receipt

def get_receipts_by_closed_status(db: Session, closed: bool, skip: int = 0, limit: int = 100) -> List[Receipt]:
    """Get receipts by closed status."""
    return db.query(Receipt).filter(Receipt.closed == closed).offset(skip).limit(limit).all()

def get_receipts_by_reference(db: Session, reference_receipt_id: int, skip: int = 0, limit: int = 100) -> List[Receipt]:
    """Get receipts that reference a specific receipt."""
    return db.query(Receipt).filter(Receipt.reference_receipt_id == reference_receipt_id).offset(skip).limit(limit).all()

def delete_receipt(db: Session, receipt_id: int) -> bool:
    """Delete a receipt."""
    db_receipt = get_receipt(db, receipt_id)
    if db_receipt:
        db.delete(db_receipt)
        db.commit()
        return True
    return False

