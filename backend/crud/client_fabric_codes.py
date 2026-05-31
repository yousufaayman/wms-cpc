from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import ClientFabricCode
from backend.schemas import ClientFabricCodeCreate


def get_client_fabric_codes(
    db: Session,
    skip: int = 0,
    limit: int = 200,
    client_id: Optional[int] = None,
    material_id: Optional[int] = None,
    color_id: Optional[int] = None,
) -> List[ClientFabricCode]:
    q = db.query(ClientFabricCode)
    if client_id is not None:
        q = q.filter(ClientFabricCode.client_id == client_id)
    if material_id is not None:
        q = q.filter(ClientFabricCode.material_id == material_id)
    if color_id is not None:
        q = q.filter(ClientFabricCode.color_id == color_id)
    return q.offset(skip).limit(limit).all()


def get_client_fabric_code(db: Session, cfc_id: int) -> Optional[ClientFabricCode]:
    return db.query(ClientFabricCode).filter(ClientFabricCode.id == cfc_id).first()


def get_client_fabric_code_by_combination(
    db: Session, client_id: int, material_id: int, color_id: int
) -> Optional[ClientFabricCode]:
    return (
        db.query(ClientFabricCode)
        .filter(
            ClientFabricCode.client_id == client_id,
            ClientFabricCode.material_id == material_id,
            ClientFabricCode.color_id == color_id,
        )
        .first()
    )


def get_or_create_client_fabric_code(
    db: Session, client_id: int, material_id: int, color_id: int, fabric_code: Optional[str] = None
) -> ClientFabricCode:
    existing = get_client_fabric_code_by_combination(db, client_id, material_id, color_id)
    if existing:
        return existing
    db_obj = ClientFabricCode(
        client_id=client_id,
        material_id=material_id,
        color_id=color_id,
        fabric_code=fabric_code,
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def create_client_fabric_code(db: Session, cfc: ClientFabricCodeCreate) -> ClientFabricCode:
    db_obj = ClientFabricCode(**cfc.model_dump())
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj
