from sqlalchemy.orm import Session
from typing import List, Dict, Optional, Any, Union
from ..models import Warehouse
from ..schemas import WarehouseCreate, WarehouseUpdate


def get_warehouse(db: Session, id: int) -> Optional[Warehouse]:
    return db.query(Warehouse).filter(Warehouse.id == id).first()


def get_warehouse_by_name(db: Session, name: str) -> Optional[Warehouse]:
    return db.query(Warehouse).filter(Warehouse.name == name).first()


def get_warehouses(db: Session, *, skip: int = 0, limit: int = 100) -> List[Warehouse]:
    return db.query(Warehouse).offset(skip).limit(limit).all()


def create_warehouse(db: Session, *, obj_in: WarehouseCreate) -> Warehouse:
    db_obj = Warehouse(name=obj_in.name, type=obj_in.type)
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def update_warehouse(
    db: Session, *, db_obj: Warehouse, obj_in: Union[WarehouseUpdate, Dict[str, Any]]
) -> Warehouse:
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


def delete_warehouse(db: Session, *, id: int) -> Optional[Warehouse]:
    obj = db.query(Warehouse).get(id)
    if obj:
        db.delete(obj)
        db.commit()
    return obj
