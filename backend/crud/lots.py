from sqlalchemy.orm import Session
from typing import List, Optional
from backend.models import Lot
from backend.schemas import LotCreate


def get_lots_by_fabric_code(db: Session, client_fabric_code_id: int) -> List[Lot]:
    return (
        db.query(Lot)
        .filter(Lot.client_fabric_code_id == client_fabric_code_id)
        .all()
    )


def get_lot_by_number(
    db: Session, client_fabric_code_id: int, lot_number: str
) -> Optional[Lot]:
    return (
        db.query(Lot)
        .filter(
            Lot.client_fabric_code_id == client_fabric_code_id,
            Lot.lot_number == lot_number,
        )
        .first()
    )


def create_lot(db: Session, lot: LotCreate) -> Lot:
    existing = get_lot_by_number(db, lot.client_fabric_code_id, lot.lot_number)
    if existing:
        raise ValueError(
            f"Lot '{lot.lot_number}' already exists for this fabric code."
        )
    db_lot = Lot(**lot.model_dump())
    db.add(db_lot)
    db.commit()
    db.refresh(db_lot)
    return db_lot


def get_or_create_lot(db: Session, client_fabric_code_id: int, lot_number: str) -> Lot:
    existing = get_lot_by_number(db, client_fabric_code_id, lot_number)
    if existing:
        return existing
    db_lot = Lot(client_fabric_code_id=client_fabric_code_id, lot_number=lot_number)
    db.add(db_lot)
    db.commit()
    db.refresh(db_lot)
    return db_lot
