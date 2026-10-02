from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import Color


def get_colors(db: Session, skip: int = 0, limit: int = 500) -> List[Color]:
    return db.query(Color).offset(skip).limit(limit).all()


def get_color(db: Session, color_id: int) -> Optional[Color]:
    return db.query(Color).filter(Color.color_id == color_id).first()


def get_or_create_color(db: Session, name: str) -> Color:
    """Case-insensitive get-or-create so concurrent/duplicate inserts return the existing row."""
    name = name.strip()
    existing = db.query(Color).filter(func.lower(Color.color_name) == name.lower()).first()
    if existing:
        return existing
    obj = Color(color_name=name)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj
