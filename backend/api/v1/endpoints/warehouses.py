from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from typing import List
from backend import schemas
from backend.core.deps import get_db
from backend.domains.warehouse import service as warehouse_service

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
    return warehouse_service.create_warehouse(db, warehouse_in)

@router.get("/", response_model=List[schemas.Warehouse])
def read_warehouses(
    db: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 100,
) -> List[schemas.Warehouse]:
    """
    Retrieve warehouses.
    """
    return warehouse_service.list_warehouses(db, skip=skip, limit=limit)

@router.get("/{warehouse_id}", response_model=schemas.Warehouse)
def read_warehouse(
    *,
    db: Session = Depends(get_db),
    warehouse_id: int,
) -> schemas.Warehouse:
    """
    Get a specific warehouse by id.
    """
    return warehouse_service.get_warehouse(db, warehouse_id)

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
    return warehouse_service.update_warehouse(db, warehouse_id, warehouse_in)

@router.delete("/{warehouse_id}", response_model=schemas.Warehouse)
def delete_warehouse(
    *,
    db: Session = Depends(get_db),
    warehouse_id: int,
) -> schemas.Warehouse:
    """
    Delete a warehouse.
    """
    return warehouse_service.delete_warehouse(db, warehouse_id)
