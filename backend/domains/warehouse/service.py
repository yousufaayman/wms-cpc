from typing import List, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ... import models, schemas
from ...crud import warehouse_racks, warehouses


def create_warehouse(db: Session, warehouse_in: schemas.WarehouseCreate) -> models.Warehouse:
    existing = warehouses.get_warehouse_by_name(db, name=warehouse_in.name)
    if existing:
        raise HTTPException(status_code=400, detail="A warehouse with this name already exists.")
    return warehouses.create_warehouse(db=db, obj_in=warehouse_in)


def list_warehouses(db: Session, skip: int = 0, limit: int = 100) -> List[models.Warehouse]:
    return warehouses.get_warehouses(db, skip=skip, limit=limit)


def get_warehouse(db: Session, warehouse_id: int) -> models.Warehouse:
    warehouse = warehouses.get_warehouse(db=db, id=warehouse_id)
    if not warehouse:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    return warehouse


def update_warehouse(
    db: Session, warehouse_id: int, warehouse_in: schemas.WarehouseUpdate
) -> models.Warehouse:
    warehouse = get_warehouse(db, warehouse_id)
    if warehouse_in.name and warehouse_in.name != warehouse.name:
        existing = warehouses.get_warehouse_by_name(db, name=warehouse_in.name)
        if existing:
            raise HTTPException(status_code=400, detail="A warehouse with this name already exists.")
    return warehouses.update_warehouse(db=db, db_obj=warehouse, obj_in=warehouse_in)


def delete_warehouse(db: Session, warehouse_id: int) -> models.Warehouse:
    get_warehouse(db, warehouse_id)
    return warehouses.delete_warehouse(db=db, id=warehouse_id)


def list_warehouse_racks(
    db: Session, skip: int = 0, limit: int = 100, warehouse_id: Optional[int] = None
) -> List[models.WarehouseRack]:
    if warehouse_id:
        return warehouse_racks.get_warehouse_racks_by_warehouse(
            db, warehouse_id=warehouse_id, skip=skip, limit=limit
        )
    return warehouse_racks.get_warehouse_racks(db, skip=skip, limit=limit)


def get_warehouse_rack(db: Session, rack_id: int) -> models.WarehouseRack:
    rack = warehouse_racks.get_warehouse_rack(db, id=rack_id)
    if rack is None:
        raise HTTPException(status_code=404, detail="Warehouse rack not found")
    return rack


def create_warehouse_rack(
    db: Session, rack_in: schemas.WarehouseRackCreate
) -> models.WarehouseRack:
    get_warehouse(db, rack_in.warehouse_id)
    existing = warehouse_racks.get_warehouse_rack_by_code(
        db, warehouse_id=rack_in.warehouse_id, rack_code=rack_in.rack_code
    )
    if existing:
        raise HTTPException(status_code=400, detail="Rack code already exists in this warehouse")
    return warehouse_racks.create_warehouse_rack(db=db, obj_in=rack_in)


def update_warehouse_rack(
    db: Session, rack_id: int, rack_in: schemas.WarehouseRackUpdate
) -> models.WarehouseRack:
    rack = get_warehouse_rack(db, rack_id)
    if rack_in.warehouse_id is not None:
        get_warehouse(db, rack_in.warehouse_id)
    if rack_in.rack_code is not None:
        warehouse_id = rack_in.warehouse_id if rack_in.warehouse_id is not None else rack.warehouse_id
        existing = warehouse_racks.get_warehouse_rack_by_code(
            db, warehouse_id=warehouse_id, rack_code=rack_in.rack_code
        )
        if existing and existing.id != rack_id:
            raise HTTPException(status_code=400, detail="Rack code already exists in this warehouse")
    return warehouse_racks.update_warehouse_rack(db=db, db_obj=rack, obj_in=rack_in)


def delete_warehouse_rack(db: Session, rack_id: int) -> models.WarehouseRack:
    get_warehouse_rack(db, rack_id)
    return warehouse_racks.delete_warehouse_rack(db=db, id=rack_id)
