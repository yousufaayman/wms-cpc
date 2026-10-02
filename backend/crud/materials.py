from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import Material


def get_materials(db: Session, skip: int = 0, limit: int = 500) -> List[Material]:
    return db.query(Material).offset(skip).limit(limit).all()


def get_material(db: Session, material_id: int) -> Optional[Material]:
    return db.query(Material).filter(Material.material_id == material_id).first()


def get_or_create_material(db: Session, name: str) -> Material:
    """Case-insensitive get-or-create so concurrent/duplicate inserts return the existing row."""
    name = name.strip()
    existing = db.query(Material).filter(func.lower(Material.material_name) == name.lower()).first()
    if existing:
        return existing
    obj = Material(material_name=name)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj
