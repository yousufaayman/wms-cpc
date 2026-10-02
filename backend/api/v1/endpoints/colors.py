from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from backend.core.authz import PERM_MANAGE_EXPECTED_DELIVERIES
from backend.core.deps import get_db, require_permission
from backend.crud import colors as crud_colors
from backend.schemas import Color, ColorCreate

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


@router.post("/", response_model=Color, status_code=status.HTTP_201_CREATED)
def create_color(
    payload: ColorCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission(PERM_MANAGE_EXPECTED_DELIVERIES)),
):
    """Create a color (returns the existing one if the name already exists, case-insensitively)."""
    if not payload.name.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name is required")
    return crud_colors.get_or_create_color(db, payload.name)
