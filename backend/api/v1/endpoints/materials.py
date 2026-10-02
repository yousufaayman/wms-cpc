from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from backend.core.authz import PERM_MANAGE_EXPECTED_DELIVERIES
from backend.core.deps import get_db, require_permission
from backend.crud import materials as crud_materials
from backend.schemas import Material, MaterialCreate

router = APIRouter()


@router.get("/", response_model=List[Material])
def get_materials(skip: int = 0, limit: int = 500, db: Session = Depends(get_db)):
    """Get all materials."""
    return crud_materials.get_materials(db, skip=skip, limit=limit)


@router.get("/{material_id}", response_model=Material)
def get_material(material_id: int, db: Session = Depends(get_db)):
    """Get a material by ID."""
    from fastapi import HTTPException, status
    mat = crud_materials.get_material(db, material_id)
    if not mat:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found")
    return mat


@router.post("/", response_model=Material, status_code=status.HTTP_201_CREATED)
def create_material(
    payload: MaterialCreate,
    db: Session = Depends(get_db),
    _user=Depends(require_permission(PERM_MANAGE_EXPECTED_DELIVERIES)),
):
    """Create a material (returns the existing one if the name already exists, case-insensitively)."""
    if not payload.name.strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Name is required")
    return crud_materials.get_or_create_material(db, payload.name)
