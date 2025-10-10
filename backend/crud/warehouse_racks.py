from sqlalchemy.orm import Session
from typing import List, Dict, Optional, Any, Union
from ..models import WarehouseRack
from ..schemas import WarehouseRackCreate, WarehouseRackUpdate


def get_warehouse_rack(db: Session, id: int) -> Optional[WarehouseRack]:
    return db.query(WarehouseRack).filter(WarehouseRack.id == id).first()


def get_warehouse_rack_by_code(db: Session, warehouse_id: int, rack_code: str) -> Optional[WarehouseRack]:
    return db.query(WarehouseRack).filter(
        WarehouseRack.warehouse_id == warehouse_id,
        WarehouseRack.rack_code == rack_code
    ).first()


def get_warehouse_racks(db: Session, *, skip: int = 0, limit: int = 100) -> List[WarehouseRack]:
    return db.query(WarehouseRack).offset(skip).limit(limit).all()


def get_warehouse_racks_by_warehouse(db: Session, warehouse_id: int, *, skip: int = 0, limit: int = 100) -> List[WarehouseRack]:
    return db.query(WarehouseRack).filter(WarehouseRack.warehouse_id == warehouse_id).offset(skip).limit(limit).all()


def create_warehouse_rack(db: Session, *, obj_in: WarehouseRackCreate) -> WarehouseRack:
    db_obj = WarehouseRack(
        warehouse_id=obj_in.warehouse_id,
        rack_code=obj_in.rack_code
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def update_warehouse_rack(
    db: Session, *, db_obj: WarehouseRack, obj_in: Union[WarehouseRackUpdate, Dict[str, Any]]
) -> WarehouseRack:
    if isinstance(obj_in, dict):
        update_data = obj_in
    else:
        update_data = obj_in.dict(exclude_unset=True)
    
    for field in update_data:
        setattr(db_obj, field, update_data[field])
    
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def delete_warehouse_rack(db: Session, *, id: int) -> Optional[WarehouseRack]:
    obj = db.query(WarehouseRack).get(id)
    if obj:
        db.delete(obj)
        db.commit()
    return obj
