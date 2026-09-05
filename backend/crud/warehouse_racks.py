from sqlalchemy.orm import Session
from typing import Any, Dict, List, Mapping, Optional, Union
from ..models import (
    Client,
    ClientFabricCode,
    Color,
    DyedFabricRoll,
    Lot,
    Material,
    UndyedFabricRoll,
    WarehouseRack,
)


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


def search_racks_by_code(
    db: Session, rack_code: str, warehouse_id: Optional[int] = None
) -> List[WarehouseRack]:
    q = db.query(WarehouseRack).filter(WarehouseRack.rack_code == rack_code)
    if warehouse_id is not None:
        q = q.filter(WarehouseRack.warehouse_id == warehouse_id)
    return q.all()


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


def _sum_into_group(group: Dict[str, Any], weight, length) -> None:
    group["roll_count"] += 1
    group["total_weight"] += float(weight)
    if length is not None:
        group["total_length"] = (group["total_length"] or 0.0) + float(length)


def get_rack_contents(db: Session, rack_id: int) -> Optional[Dict[str, Any]]:
    """In-stock rolls in a rack, summed and grouped for the scan quick-view:
    dyed by fabric code + lot, undyed by client + material + lot."""
    rack = get_warehouse_rack(db, rack_id)
    if not rack:
        return None

    dyed_rows = (
        db.query(DyedFabricRoll, ClientFabricCode, Client, Material, Color, Lot)
        .join(ClientFabricCode, DyedFabricRoll.client_fabric_code_id == ClientFabricCode.id)
        .join(Client, ClientFabricCode.client_id == Client.client_id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
        .outerjoin(Lot, DyedFabricRoll.lot_id == Lot.id)
        .filter(DyedFabricRoll.rack_id == rack_id, DyedFabricRoll.status == "in")
        .all()
    )
    dyed_groups: Dict[tuple, Dict[str, Any]] = {}
    for roll, cfc, client, material, color, lot in dyed_rows:
        lot_number = lot.lot_number if lot else None
        key = (cfc.id, lot_number)
        group = dyed_groups.setdefault(key, {
            "client_fabric_code_id": cfc.id,
            "fabric_code": cfc.fabric_code,
            "client_name": client.client_name,
            "material_name": material.material_name,
            "color_name": color.color_name,
            "lot_number": lot_number,
            "roll_count": 0,
            "total_weight": 0.0,
            "total_length": None,
        })
        _sum_into_group(group, roll.weight, roll.length)

    undyed_rows = (
        db.query(UndyedFabricRoll, Client, Material)
        .join(Client, UndyedFabricRoll.client_id == Client.client_id)
        .join(Material, UndyedFabricRoll.material_id == Material.material_id)
        .filter(UndyedFabricRoll.rack_id == rack_id, UndyedFabricRoll.status == "in")
        .all()
    )
    undyed_groups: Dict[tuple, Dict[str, Any]] = {}
    for roll, client, material in undyed_rows:
        key = (roll.client_id, roll.material_id, roll.lot_number)
        group = undyed_groups.setdefault(key, {
            "client_id": roll.client_id,
            "client_name": client.client_name,
            "material_id": roll.material_id,
            "material_name": material.material_name,
            "lot_number": roll.lot_number,
            "roll_count": 0,
            "total_weight": 0.0,
            "total_length": None,
        })
        _sum_into_group(group, roll.weight, roll.length)

    all_groups = list(dyed_groups.values()) + list(undyed_groups.values())
    return {
        "rack_id": rack.id,
        "rack_code": rack.rack_code,
        "warehouse_id": rack.warehouse_id,
        "roll_count": sum(g["roll_count"] for g in all_groups),
        "total_weight": sum(g["total_weight"] for g in all_groups),
        "dyed_groups": sorted(dyed_groups.values(), key=lambda g: (g["fabric_code"] or "", g["lot_number"] or "")),
        "undyed_groups": sorted(undyed_groups.values(), key=lambda g: (g["client_name"], g["material_name"], g["lot_number"] or "")),
    }


def delete_warehouse_rack(db: Session, *, id: int) -> Optional[WarehouseRack]:
    obj = db.query(WarehouseRack).get(id)
    if obj:
        db.delete(obj)
        db.commit()
    return obj
