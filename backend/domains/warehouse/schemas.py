"""
Domain schema entrypoint for warehouse-related DTOs.

These aliases allow incremental migration away from the monolithic backend.schemas.
"""

from ...schemas import (
    Warehouse,
    WarehouseCreate,
    WarehouseRack,
    WarehouseRackCreate,
    WarehouseRackUpdate,
    WarehouseRackWithWarehouse,
    WarehouseUpdate,
)

__all__ = [
    "Warehouse",
    "WarehouseCreate",
    "WarehouseUpdate",
    "WarehouseRack",
    "WarehouseRackCreate",
    "WarehouseRackUpdate",
    "WarehouseRackWithWarehouse",
]
