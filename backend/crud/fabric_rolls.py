from sqlalchemy.orm import Session
from typing import List, Optional, Any, Dict
from backend.models import DyedFabricRoll, ClientFabricCode, Client, Material, Color, Lot, WarehouseRack
from backend.schemas import DyedFabricRollCreate
from backend.crud.expected_deliveries import reverse_roll_delivery_contributions


def create_fabric_roll(db: Session, roll: DyedFabricRollCreate) -> DyedFabricRoll:
    db_roll = DyedFabricRoll(**roll.model_dump())
    db.add(db_roll)
    db.commit()
    db.refresh(db_roll)
    return db_roll


def get_fabric_rolls(
    db: Session,
    skip: int = 0,
    limit: int = 200,
    client_fabric_code_id: Optional[int] = None,
    lot_id: Optional[int] = None,
) -> List[DyedFabricRoll]:
    q = db.query(DyedFabricRoll)
    if client_fabric_code_id is not None:
        q = q.filter(DyedFabricRoll.client_fabric_code_id == client_fabric_code_id)
    if lot_id is not None:
        q = q.filter(DyedFabricRoll.lot_id == lot_id)
    return q.order_by(DyedFabricRoll.id.desc()).offset(skip).limit(limit).all()


def get_fabric_roll(db: Session, roll_id: int) -> Optional[DyedFabricRoll]:
    return db.query(DyedFabricRoll).filter(DyedFabricRoll.id == roll_id).first()


def delete_fabric_roll(db: Session, roll_id: int) -> bool:
    db_roll = db.query(DyedFabricRoll).filter(DyedFabricRoll.id == roll_id).first()
    if not db_roll:
        return False
    reverse_roll_delivery_contributions(db, roll_id)
    db.delete(db_roll)
    db.commit()
    return True


def get_fabric_roll_detail(db: Session, roll_id: int):
    row = (
        db.query(DyedFabricRoll, Material, Color, Lot)
        .join(ClientFabricCode, DyedFabricRoll.client_fabric_code_id == ClientFabricCode.id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
        .outerjoin(Lot, DyedFabricRoll.lot_id == Lot.id)
        .filter(DyedFabricRoll.id == roll_id)
        .first()
    )
    if not row:
        return None
    roll, material, color, lot = row
    return {
        "id": roll.id,
        "weight": float(roll.weight),
        "length": float(roll.length) if roll.length is not None else None,
        "status": roll.status,
        "material_name": material.material_name,
        "color_name": color.color_name,
        "lot_number": lot.lot_number if lot else None,
        "client_fabric_code_id": roll.client_fabric_code_id,
    }


def _lot_group_init(roll, lot) -> Dict[str, Any]:
    return {"lot_id": roll.lot_id, "lot_number": lot.lot_number if lot else None, "supplier": roll.supplier, "rolls": []}


def _roll_dict(roll, rack) -> Dict[str, Any]:
    return {
        "id": roll.id,
        "weight": float(roll.weight),
        "length": float(roll.length) if roll.length is not None else None,
        "gsm": float(roll.gsm) if roll.gsm is not None else None,
        "fabric_width": float(roll.fabric_width) if roll.fabric_width is not None else None,
        "status": roll.status,
        "received_date": roll.received_date,
        "issued_date": roll.issued_date,
        "rack_id": roll.rack_id,
        "rack_code": rack.rack_code if rack else None,
        "quality_grade": roll.quality_grade,
        "defect_points": roll.defect_points,
        "remarks": roll.remarks,
    }


def _finalize_lot_group(lg: Dict[str, Any]) -> None:
    rolls = lg["rolls"]
    lg["total_weight"] = sum(r["weight"] for r in rolls)
    lengths = [r["length"] for r in rolls if r["length"] is not None]
    lg["total_length"] = sum(lengths) if lengths else None
    lg["roll_count"] = len(rolls)


def _build_lot_groups(raw_rolls: list) -> list:
    lot_key_map: Dict[tuple, Dict[str, Any]] = {}
    for roll, lot, rack in raw_rolls:
        key = (roll.lot_id, roll.supplier)
        if key not in lot_key_map:
            lot_key_map[key] = _lot_group_init(roll, lot)
        lot_key_map[key]["rolls"].append(_roll_dict(roll, rack))
    for lg in lot_key_map.values():
        _finalize_lot_group(lg)
    return list(lot_key_map.values())


def _totals(items: list) -> tuple:
    """Return (total_weight, total_length, roll_count) from a list of grouped entries."""
    total_weight = sum(i["total_weight"] for i in items)
    lengths = [i["total_length"] for i in items if i["total_length"] is not None]
    total_length = sum(lengths) if lengths else None
    roll_count = sum(i["roll_count"] for i in items)
    return total_weight, total_length, roll_count


def get_fabric_inventory(db: Session) -> List[Dict[str, Any]]:
    """Return dyed fabric rolls grouped by client → material → fabric code → lot+supplier → rolls."""
    rows = (
        db.query(DyedFabricRoll, ClientFabricCode, Client, Material, Color, Lot, WarehouseRack)
        .join(ClientFabricCode, DyedFabricRoll.client_fabric_code_id == ClientFabricCode.id)
        .join(Client, ClientFabricCode.client_id == Client.client_id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
        .outerjoin(Lot, DyedFabricRoll.lot_id == Lot.id)
        .outerjoin(WarehouseRack, DyedFabricRoll.rack_id == WarehouseRack.id)
        .filter(DyedFabricRoll.status == "in")
        .order_by(Client.client_name, Material.material_name, DyedFabricRoll.id)
        .all()
    )

    # client_id → { meta, _mats: { material_id → { meta, _cfcs: { cfc_id → { meta, _rolls } } } } }
    client_map: Dict[int, Dict[str, Any]] = {}

    for roll, cfc, client, material, color, lot, rack in rows:
        if client.client_id not in client_map:
            client_map[client.client_id] = {
                "client_id": client.client_id,
                "client_name": client.client_name,
                "_mats": {},
            }
        mats = client_map[client.client_id]["_mats"]
        if material.material_id not in mats:
            mats[material.material_id] = {
                "material_id": material.material_id,
                "material_name": material.material_name,
                "_cfcs": {},
            }
        cfcs = mats[material.material_id]["_cfcs"]
        if cfc.id not in cfcs:
            cfcs[cfc.id] = {
                "client_fabric_code_id": cfc.id,
                "fabric_code": cfc.fabric_code,
                "color_id": color.color_id,
                "color_name": color.color_name,
                "_rolls": [],
            }
        cfcs[cfc.id]["_rolls"].append((roll, lot, rack))

    result = []
    for client_entry in client_map.values():
        materials = []
        for mat_entry in client_entry.pop("_mats").values():
            fabric_codes = []
            for cfc_entry in mat_entry.pop("_cfcs").values():
                lot_groups = _build_lot_groups(cfc_entry.pop("_rolls"))
                cfc_entry["lot_groups"] = lot_groups
                cfc_entry["total_weight"], cfc_entry["total_length"], cfc_entry["roll_count"] = _totals(lot_groups)
                fabric_codes.append(cfc_entry)

            mat_entry["fabric_codes"] = fabric_codes
            mat_entry["total_weight"], mat_entry["total_length"], mat_entry["roll_count"] = _totals(fabric_codes)
            materials.append(mat_entry)

        client_entry["materials"] = materials
        client_entry["total_weight"], client_entry["total_length"], client_entry["roll_count"] = _totals(materials)
        result.append(client_entry)

    return result
