from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import LogicalLocation
from backend.schemas import LogicalLocationCreate, LogicalLocationUpdate

def get_logical_location(db: Session, location_id: int) -> Optional[LogicalLocation]:
    """Get a logical location by ID."""
    return db.query(LogicalLocation).filter(LogicalLocation.id == location_id).first()

def get_logical_location_by_name(db: Session, name: str) -> Optional[LogicalLocation]:
    """Get a logical location by name."""
    return db.query(LogicalLocation).filter(LogicalLocation.name == name).first()

def get_logical_locations(db: Session, skip: int = 0, limit: int = 100) -> List[LogicalLocation]:
    """Get all logical locations with pagination."""
    return db.query(LogicalLocation).offset(skip).limit(limit).all()

def create_logical_location(db: Session, location: LogicalLocationCreate) -> LogicalLocation:
    """Create a new logical location."""
    db_location = LogicalLocation(**location.dict())
    db.add(db_location)
    db.commit()
    db.refresh(db_location)
    return db_location

def update_logical_location(db: Session, location_id: int, location: LogicalLocationUpdate) -> Optional[LogicalLocation]:
    """Update a logical location."""
    db_location = get_logical_location(db, location_id)
    if db_location:
        update_data = location.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_location, field, value)
        db.commit()
        db.refresh(db_location)
    return db_location

def delete_logical_location(db: Session, location_id: int) -> bool:
    """Delete a logical location."""
    db_location = get_logical_location(db, location_id)
    if db_location:
        db.delete(db_location)
        db.commit()
        return True
    return False

