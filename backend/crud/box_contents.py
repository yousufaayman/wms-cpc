from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from ..models import BoxContent, Model, Color, Size, JobOrderItem
from ..schemas import BoxContentCreate, BoxContentUpdate

def get_box_content(db: Session, content_id: int) -> Optional[BoxContent]:
    """Get a box content by ID."""
    return db.query(BoxContent).options(
        joinedload(BoxContent.model),
        joinedload(BoxContent.color),
        joinedload(BoxContent.size),
        joinedload(BoxContent.job_order_item)
    ).filter(BoxContent.id == content_id).first()

def get_box_contents_by_box(db: Session, box_id: int, skip: int = 0, limit: int = 100) -> List[BoxContent]:
    """Get all contents for a specific box."""
    return db.query(BoxContent).options(
        joinedload(BoxContent.model),
        joinedload(BoxContent.color),
        joinedload(BoxContent.size),
        joinedload(BoxContent.job_order_item)
    ).filter(BoxContent.box_id == box_id).offset(skip).limit(limit).all()

def get_box_contents(db: Session, skip: int = 0, limit: int = 100) -> List[BoxContent]:
    """Get all box contents with pagination."""
    return db.query(BoxContent).options(
        joinedload(BoxContent.model),
        joinedload(BoxContent.color),
        joinedload(BoxContent.size),
        joinedload(BoxContent.job_order_item)
    ).offset(skip).limit(limit).all()

def create_box_content(db: Session, content: BoxContentCreate) -> BoxContent:
    """Create a new box content."""
    db_content = BoxContent(**content.dict())
    db.add(db_content)
    db.commit()
    db.refresh(db_content)
    return db_content

def update_box_content(db: Session, content_id: int, content: BoxContentUpdate) -> Optional[BoxContent]:
    """Update a box content."""
    db_content = get_box_content(db, content_id)
    if db_content:
        update_data = content.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_content, field, value)
        db.commit()
        db.refresh(db_content)
    return db_content

def delete_box_content(db: Session, content_id: int) -> bool:
    """Delete a box content."""
    db_content = get_box_content(db, content_id)
    if db_content:
        db.delete(db_content)
        db.commit()
        return True
    return False

