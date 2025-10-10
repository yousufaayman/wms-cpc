from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from backend import schemas
from backend.crud import warehouses
from backend.core.deps import get_db

router = APIRouter()

@router.post("/", response_model=schemas.Warehouse, status_code=status.HTTP_201_CREATED)
def create_warehouse(
    *,
    db: Session = Depends(get_db),
    warehouse_in: schemas.WarehouseCreate,
) -> schemas.Warehouse:
    """
    Create a new warehouse.
    """
    # Check if warehouse with this name already exists
    warehouse = warehouses.get_warehouse_by_name(db, name=warehouse_in.name)
    if warehouse:
        raise HTTPException(
            status_code=400,
            detail="A warehouse with this name already exists.",
        )
    
    warehouse = warehouses.create_warehouse(db=db, obj_in=warehouse_in)
    return warehouse

@router.get("/", response_model=List[schemas.Warehouse])
def read_warehouses(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
) -> List[schemas.Warehouse]:
    """
    Retrieve warehouses.
    """
    warehouse_list = warehouses.get_warehouses(db, skip=skip, limit=limit)
    return warehouse_list

@router.get("/{warehouse_id}", response_model=schemas.Warehouse)
def read_warehouse(
    *,
    db: Session = Depends(get_db),
    warehouse_id: int,
) -> schemas.Warehouse:
    """
    Get a specific warehouse by id.
    """
    warehouse = warehouses.get_warehouse(db=db, id=warehouse_id)
    if not warehouse:
        raise HTTPException(
            status_code=404,
            detail="Warehouse not found",
        )
    return warehouse

@router.put("/{warehouse_id}", response_model=schemas.Warehouse)
def update_warehouse(
    *,
    db: Session = Depends(get_db),
    warehouse_id: int,
    warehouse_in: schemas.WarehouseUpdate,
) -> schemas.Warehouse:
    """
    Update a warehouse.
    """
    warehouse = warehouses.get_warehouse(db=db, id=warehouse_id)
    if not warehouse:
        raise HTTPException(
            status_code=404,
            detail="Warehouse not found",
        )
    
    # Check if new name already exists (if name is being updated)
    if warehouse_in.name and warehouse_in.name != warehouse.name:
        existing_warehouse = warehouses.get_warehouse_by_name(db, name=warehouse_in.name)
        if existing_warehouse:
            raise HTTPException(
                status_code=400,
                detail="A warehouse with this name already exists.",
            )
    
    warehouse = warehouses.update_warehouse(db=db, db_obj=warehouse, obj_in=warehouse_in)
    return warehouse

@router.delete("/{warehouse_id}", response_model=schemas.Warehouse)
def delete_warehouse(
    *,
    db: Session = Depends(get_db),
    warehouse_id: int,
) -> schemas.Warehouse:
    """
    Delete a warehouse.
    """
    warehouse = warehouses.get_warehouse(db=db, id=warehouse_id)
    if not warehouse:
        raise HTTPException(
            status_code=404,
            detail="Warehouse not found",
        )
    
    warehouse = warehouses.delete_warehouse(db=db, id=warehouse_id)
    return warehouse
