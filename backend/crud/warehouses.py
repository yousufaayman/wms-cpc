from sqlalchemy.orm import Session
from typing import Any, List, Mapping, Optional, Union
from ..models import Warehouse


def _to_update_dict(obj_in: Any) -> dict[str, Any]:
    if isinstance(obj_in, Mapping):
        return dict(obj_in)
    if hasattr(obj_in, "model_dump"):
        return obj_in.model_dump(exclude_unset=True)
    if hasattr(obj_in, "dict"):
        return obj_in.dict(exclude_unset=True)
    raise TypeError("Unsupported payload type")


def get_warehouse(db: Session, id: int) -> Optional[Warehouse]:
    return db.query(Warehouse).filter(Warehouse.id == id).first()


def get_warehouse_by_name(db: Session, name: str) -> Optional[Warehouse]:
    return db.query(Warehouse).filter(Warehouse.name == name).first()


def get_warehouses(db: Session, *, skip: int = 0, limit: int = 100) -> List[Warehouse]:
    return db.query(Warehouse).offset(skip).limit(limit).all()


def create_warehouse(db: Session, *, obj_in: Any) -> Warehouse:
    data = _to_update_dict(obj_in)
    db_obj = Warehouse(name=data["name"], type=data["type"])
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def update_warehouse(
    db: Session, *, db_obj: Warehouse, obj_in: Union[Mapping[str, Any], Any]
) -> Warehouse:
    update_data = _to_update_dict(obj_in)
    
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
