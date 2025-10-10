from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import List

from ....core.deps import get_db
from .... import schemas
from ....crud import warehouse_racks, warehouses

router = APIRouter()

@router.get("/", response_model=List[schemas.WarehouseRackWithWarehouse])
def read_warehouse_racks(
    skip: int = 0,
    limit: int = Query(default=100, le=100),
    warehouse_id: int = Query(None),
    db: Session = Depends(get_db)
):
    """
    Retrieve warehouse racks. If warehouse_id is provided, filter by warehouse.
    """
    if warehouse_id:
        racks = warehouse_racks.get_warehouse_racks_by_warehouse(db, warehouse_id=warehouse_id, skip=skip, limit=limit)
    else:
        racks = warehouse_racks.get_warehouse_racks(db, skip=skip, limit=limit)
    return racks

@router.get("/{rack_id}", response_model=schemas.WarehouseRackWithWarehouse)
def read_warehouse_rack(rack_id: int, db: Session = Depends(get_db)):
    """
    Get a specific warehouse rack by ID.
    """
    rack = warehouse_racks.get_warehouse_rack(db, id=rack_id)
    if rack is None:
        raise HTTPException(status_code=404, detail="Warehouse rack not found")
    return rack

@router.post("/", response_model=schemas.WarehouseRack)
def create_warehouse_rack(
    *,
    db: Session = Depends(get_db),
    rack_in: schemas.WarehouseRackCreate
):
    """
    Create new warehouse rack.
    """
    # Check if warehouse exists
    warehouse = warehouses.get_warehouse(db, id=rack_in.warehouse_id)
    if warehouse is None:
        raise HTTPException(status_code=404, detail="Warehouse not found")
    
    # Check if rack code already exists in this warehouse
    existing_rack = warehouse_racks.get_warehouse_rack_by_code(db, warehouse_id=rack_in.warehouse_id, rack_code=rack_in.rack_code)
    if existing_rack:
        raise HTTPException(status_code=400, detail="Rack code already exists in this warehouse")
    
    rack = warehouse_racks.create_warehouse_rack(db=db, obj_in=rack_in)
    return rack

@router.put("/{rack_id}", response_model=schemas.WarehouseRack)
def update_warehouse_rack(
    *,
    db: Session = Depends(get_db),
    rack_id: int,
    rack_in: schemas.WarehouseRackUpdate
):
    """
    Update a warehouse rack.
    """
    rack = warehouse_racks.get_warehouse_rack(db, id=rack_id)
    if rack is None:
        raise HTTPException(status_code=404, detail="Warehouse rack not found")
    
    # If updating warehouse_id, check if warehouse exists
    if rack_in.warehouse_id is not None:
        warehouse = warehouses.get_warehouse(db, id=rack_in.warehouse_id)
        if warehouse is None:
            raise HTTPException(status_code=404, detail="Warehouse not found")
    
    # If updating rack_code, check if it already exists in the warehouse
    if rack_in.rack_code is not None:
        warehouse_id_to_check = rack_in.warehouse_id if rack_in.warehouse_id is not None else rack.warehouse_id
        existing_rack = warehouse_racks.get_warehouse_rack_by_code(db, warehouse_id=warehouse_id_to_check, rack_code=rack_in.rack_code)
        if existing_rack and existing_rack.id != rack_id:
            raise HTTPException(status_code=400, detail="Rack code already exists in this warehouse")
    
    rack = warehouse_racks.update_warehouse_rack(db=db, db_obj=rack, obj_in=rack_in)
    return rack

@router.delete("/{rack_id}", response_model=schemas.WarehouseRack)
def delete_warehouse_rack(
    *,
    db: Session = Depends(get_db),
    rack_id: int
):
    """
    Delete a warehouse rack.
    """
    rack = warehouse_racks.get_warehouse_rack(db, id=rack_id)
    if rack is None:
        raise HTTPException(status_code=404, detail="Warehouse rack not found")
    
    rack = warehouse_racks.delete_warehouse_rack(db=db, id=rack_id)
    return rack
