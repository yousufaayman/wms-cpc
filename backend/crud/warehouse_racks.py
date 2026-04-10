from sqlalchemy.orm import Session
from typing import Any, List, Mapping, Optional, Union
from ..models import WarehouseRack


def _to_update_dict(obj_in: Any) -> dict[str, Any]:
    if isinstance(obj_in, Mapping):
        return dict(obj_in)
    if hasattr(obj_in, "model_dump"):
        return obj_in.model_dump(exclude_unset=True)
    if hasattr(obj_in, "dict"):
        return obj_in.dict(exclude_unset=True)
    raise TypeError("Unsupported payload type")


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


def create_warehouse_rack(db: Session, *, obj_in: Any) -> WarehouseRack:
    data = _to_update_dict(obj_in)
    db_obj = WarehouseRack(
        warehouse_id=data["warehouse_id"],
        rack_code=data["rack_code"],
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def update_warehouse_rack(
    db: Session, *, db_obj: WarehouseRack, obj_in: Union[Mapping[str, Any], Any]
) -> WarehouseRack:
    update_data = _to_update_dict(obj_in)
    
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
