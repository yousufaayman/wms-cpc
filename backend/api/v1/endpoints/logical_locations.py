from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from backend.core.deps import get_db
from backend.crud import logical_locations
from backend.schemas import LogicalLocation, LogicalLocationCreate, LogicalLocationUpdate

router = APIRouter()

@router.get("/", response_model=List[LogicalLocation])
def get_logical_locations(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get all logical locations."""
    return logical_locations.get_logical_locations(db, skip=skip, limit=limit)

@router.get("/{location_id}", response_model=LogicalLocation)
def get_logical_location(
    location_id: int,
    db: Session = Depends(get_db)
):
    """Get a logical location by ID."""
    location = logical_locations.get_logical_location(db, location_id=location_id)
    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Logical location not found"
        )
    return location

@router.get("/name/{name}", response_model=LogicalLocation)
def get_logical_location_by_name(
    name: str,
    db: Session = Depends(get_db)
):
    """Get a logical location by name."""
    location = logical_locations.get_logical_location_by_name(db, name=name)
    if not location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Logical location not found"
        )
    return location

@router.post("/", response_model=LogicalLocation)
def create_logical_location(
    location: LogicalLocationCreate,
    db: Session = Depends(get_db)
):
    """Create a new logical location."""
    return logical_locations.create_logical_location(db, location=location)

@router.put("/{location_id}", response_model=LogicalLocation)
def update_logical_location(
    location_id: int,
    location: LogicalLocationUpdate,
    db: Session = Depends(get_db)
):
    """Update a logical location."""
    db_location = logical_locations.get_logical_location(db, location_id=location_id)
    if not db_location:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Logical location not found"
        )
    return logical_locations.update_logical_location(db, location_id=location_id, location=location)

@router.delete("/{location_id}")
def delete_logical_location(
    location_id: int,
    db: Session = Depends(get_db)
):
    """Delete a logical location."""
    success = logical_locations.delete_logical_location(db, location_id=location_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Logical location not found"
        )
    return {"message": "Logical location deleted successfully"}

