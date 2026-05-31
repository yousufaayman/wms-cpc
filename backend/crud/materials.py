from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import Material


def get_materials(db: Session, skip: int = 0, limit: int = 500) -> List[Material]:
    return db.query(Material).offset(skip).limit(limit).all()


def get_material(db: Session, material_id: int) -> Optional[Material]:
    return db.query(Material).filter(Material.material_id == material_id).first()
