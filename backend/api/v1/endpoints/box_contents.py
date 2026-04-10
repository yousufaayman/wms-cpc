from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from backend.core.deps import get_db
from backend.crud import box_contents
from backend.schemas import BoxContent, BoxContentCreate, BoxContentUpdate, BoxContentWithDetails

router = APIRouter()

@router.get("/", response_model=List[BoxContentWithDetails])
def get_box_contents(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get all box contents."""
    return box_contents.get_box_contents(db, skip=skip, limit=limit)

@router.get("/box/{box_id}", response_model=List[BoxContentWithDetails])
def get_box_contents_by_box(
    box_id: int,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db)
):
    """Get all contents for a specific box."""
    return box_contents.get_box_contents_by_box(db, box_id=box_id, skip=skip, limit=limit)

@router.get("/{content_id}", response_model=BoxContentWithDetails)
def get_box_content(
    content_id: int,
    db: Session = Depends(get_db)
):
    """Get a box content by ID."""
    content = box_contents.get_box_content(db, content_id=content_id)
    if not content:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Box content not found"
        )
    return content

@router.post("/", response_model=BoxContent)
def create_box_content(
    content: BoxContentCreate,
    db: Session = Depends(get_db)
):
    """Create a new box content."""
    return box_contents.create_box_content(db, content=content)

@router.put("/{content_id}", response_model=BoxContent)
def update_box_content(
    content_id: int,
    content: BoxContentUpdate,
    db: Session = Depends(get_db)
):
    """Update a box content."""
    db_content = box_contents.get_box_content(db, content_id=content_id)
    if not db_content:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Box content not found"
        )
    return box_contents.update_box_content(db, content_id=content_id, content=content)

@router.delete("/{content_id}")
def delete_box_content(
    content_id: int,
    db: Session = Depends(get_db)
):
    """Delete a box content."""
    success = box_contents.delete_box_content(db, content_id=content_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Box content not found"
        )
    return {"message": "Box content deleted successfully"}

