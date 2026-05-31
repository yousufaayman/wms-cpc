from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional

from ....core.deps import get_db
from ....domains.warehouse import schemas
from ....domains.warehouse import service as warehouse_service
from ....crud.warehouse_racks import search_racks_by_code

router = APIRouter()

@router.get("/search", response_model=List[schemas.WarehouseRack])
def search_warehouse_racks_by_code(
    rack_code: str = Query(..., description="Rack code to search for"),
    warehouse_id: Optional[int] = Query(None, description="Optionally restrict to a warehouse"),
    db: Session = Depends(get_db),
):
    """Look up racks by code (exact match). Optionally scoped to a warehouse."""
    results = search_racks_by_code(db, rack_code=rack_code, warehouse_id=warehouse_id)
    if not results:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No rack found with code '{rack_code}'")
    return results

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
    return warehouse_service.list_warehouse_racks(
        db, skip=skip, limit=limit, warehouse_id=warehouse_id
    )

@router.get("/{rack_id}", response_model=schemas.WarehouseRackWithWarehouse)
def read_warehouse_rack(rack_id: int, db: Session = Depends(get_db)):
    """
    Get a specific warehouse rack by ID.
    """
    return warehouse_service.get_warehouse_rack(db, rack_id)

@router.post("/", response_model=schemas.WarehouseRack)
def create_warehouse_rack(
    *,
    db: Session = Depends(get_db),
    rack_in: schemas.WarehouseRackCreate
):
    """
    Create new warehouse rack.
    """
    return warehouse_service.create_warehouse_rack(db, rack_in)

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
    return warehouse_service.update_warehouse_rack(db, rack_id, rack_in)

@router.delete("/{rack_id}", response_model=schemas.WarehouseRack)
def delete_warehouse_rack(
    *,
    db: Session = Depends(get_db),
    rack_id: int
):
    """
    Delete a warehouse rack.
    """
    return warehouse_service.delete_warehouse_rack(db, rack_id)
