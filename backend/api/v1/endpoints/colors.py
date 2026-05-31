from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from backend.core.deps import get_db
from backend.crud import colors as crud_colors
from backend.schemas import Color

router = APIRouter()


@router.get("/", response_model=List[Color])
def get_colors(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    """Get all colors."""
    return crud_colors.get_colors(db, skip=skip, limit=limit)


@router.get("/{color_id}", response_model=Color)
def get_color(color_id: int, db: Session = Depends(get_db)):
    """Get a color by ID."""
    color = crud_colors.get_color(db, color_id)
    if not color:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Color not found")
    return color
