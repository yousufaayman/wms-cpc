from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import Client


def get_clients(db: Session, skip: int = 0, limit: int = 500) -> List[Client]:
    return db.query(Client).offset(skip).limit(limit).all()


def get_client(db: Session, client_id: int) -> Optional[Client]:
    return db.query(Client).filter(Client.client_id == client_id).first()
