"""What each warehouse type can see and use.

The app has three warehouse types (Fabric, Accessory, RMG) that share one
codebase. This file is the single list of which **modules** (pages + their
API actions) each type has, and which feature flag a module needs. The
frontend has an identical copy in frontend/src/lib/warehouseModules.ts (the
sidebar and route guards use it); backend/tests/test_warehouse_modules.py
fails if the two drift.

Permissions (authz.py) answer "may this *person* do X?". This file answers
"does X exist in this *warehouse*?". A request must pass both.

To give a warehouse type a new module: add it here and in the .ts copy.
"""
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models
from .config import settings

FABRIC = "Fabric"
ACCESSORY = "Accessory"
RMG = "RMG"

# module -> feature flag it needs in that warehouse type (None = always on).
# A module missing from a type's dict does not exist in that type.
WAREHOUSE_MODULES = {
    FABRIC: {
        "dashboard": None,
        "fabric_inventory": None,
        "receipts": None,
        "expected_deliveries": None,
        "material_requests": None,
        "fabric_rolls": None,
        "warehouse_racks": None,
        "logical_locations": None,
        "analytics": None,
    },
    # The whole accessory warehouse is behind FEATURE_ACCESSORIES, except the
    # set-up pages (racks, logical locations) so it can be prepared in advance.
    # Accessory analytics arrives in item 26.
    ACCESSORY: {
        "dashboard": None,
        "accessory_inventory": "accessories",
        "receive_packs": "accessories",
        "accessory_items": "accessories",
        "needle_exchange": "needles",
        "receipts": "accessories",
        "expected_deliveries": "accessories",
        "material_requests": "accessories",
        "warehouse_racks": None,
        "logical_locations": None,
    },
    # RMG is out of scope for now: set-up pages only.
    RMG: {
        "dashboard": None,
        "warehouse_racks": None,
        "logical_locations": None,
    },
}

# Which receipt line table a warehouse's receipts may use.
RECEIPT_LINE_KIND = {
    FABRIC: "fabric",
    ACCESSORY: "accessory",
    RMG: "box",
}

_RECEIPT_MODELS = {
    "supplier": models.SupplierReceipt,
    "internal": models.InternalReceipt,
    "external": models.ExternalReceipt,
}


def _type_name(warehouse: models.Warehouse) -> str:
    t = warehouse.type
    return getattr(t, "value", t)


def module_enabled(warehouse_type: str, module: str) -> bool:
    modules = WAREHOUSE_MODULES.get(warehouse_type, {})
    if module not in modules:
        return False
    feature = modules[module]
    return feature is None or settings.features_enabled()[feature]


def ensure_module(db: Session, warehouse_id: int, module: str) -> models.Warehouse:
    """400 unless warehouse `warehouse_id` exists and has `module` switched on."""
    warehouse = db.get(models.Warehouse, warehouse_id)
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    wtype = _type_name(warehouse)
    if not module_enabled(wtype, module):
        raise HTTPException(
            status_code=400,
            detail=f"'{module}' is not available in {wtype} warehouses",
        )
    return warehouse


def ensure_same_warehouse_type(db: Session, current_id: Optional[int], new_id: int, module: str) -> None:
    """Moving a document to another warehouse: allowed only within the same
    warehouse type (its lines belong to that type)."""
    new = ensure_module(db, new_id, module)
    current = db.get(models.Warehouse, current_id) if current_id is not None else None
    if current is not None and _type_name(current) != _type_name(new):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot move a {_type_name(current)} document to a {_type_name(new)} warehouse",
        )


def ensure_rack_module(db: Session, rack_id: Optional[int], module: str) -> None:
    """For things placed on a rack (rolls, packs): the rack's warehouse must
    have `module`. No rack = nothing to check."""
    if rack_id is None:
        return
    rack = db.get(models.WarehouseRack, rack_id)
    if rack is None:
        raise HTTPException(status_code=404, detail="Rack not found")
    ensure_module(db, rack.warehouse_id, module)


def ensure_receipt_line_kind(db: Session, receipt_kind: str, receipt_id: int, line_kind: str) -> None:
    """A receipt only takes lines of its warehouse's kind: fabric rolls on
    Fabric receipts, accessory lines on Accessory receipts, boxes on RMG."""
    receipt = db.get(_RECEIPT_MODELS[receipt_kind], receipt_id)
    if receipt is None:
        raise HTTPException(status_code=404, detail="Receipt not found")
    warehouse = ensure_module(db, receipt.source_warehouse_id, "receipts")
    wtype = _type_name(warehouse)
    if RECEIPT_LINE_KIND.get(wtype) != line_kind:
        raise HTTPException(
            status_code=400,
            detail=f"{wtype} warehouse receipts cannot hold {line_kind} lines",
        )
