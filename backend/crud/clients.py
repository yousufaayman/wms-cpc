from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import Client


def get_clients(db: Session, skip: int = 0, limit: int = 500) -> List[Client]:
    return db.query(Client).offset(skip).limit(limit).all()


def get_client(db: Session, client_id: int) -> Optional[Client]:
    return db.query(Client).filter(Client.client_id == client_id).first()


def get_or_create_client(db: Session, name: str) -> Client:
    """Case-insensitive get-or-create so concurrent/duplicate inserts return the existing row."""
    name = name.strip()
    existing = db.query(Client).filter(func.lower(Client.client_name) == name.lower()).first()
    if existing:
        return existing
    obj = Client(client_name=name)
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj
