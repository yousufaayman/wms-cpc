from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import Color


def get_colors(db: Session, skip: int = 0, limit: int = 500) -> List[Color]:
    return db.query(Color).offset(skip).limit(limit).all()


def get_color(db: Session, color_id: int) -> Optional[Color]:
    return db.query(Color).filter(Color.color_id == color_id).first()
