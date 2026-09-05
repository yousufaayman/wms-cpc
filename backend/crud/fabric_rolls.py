from sqlalchemy.orm import Session, aliased
from typing import List, Optional, Any, Dict
from backend.models import (
    DyedFabricRoll, ClientFabricCode, Client, Material, Color, Lot, WarehouseRack,
    FabricReceiptItem, ExternalReceipt, SupplierReceipt, InternalReceipt, LogicalLocation,
)
from backend.schemas import DyedFabricRollCreate
from backend.crud.expected_deliveries import (
    find_matching_expected_delivery_item,
    sync_delivery_item_from_rolls,
)


def create_fabric_roll(db: Session, roll: DyedFabricRollCreate, ingested_by: Optional[int] = None) -> DyedFabricRoll:
    roll_data = roll.model_dump()
    if roll_data["original_roll_id"] is not None:
        original = db.query(DyedFabricRoll).filter(DyedFabricRoll.id == roll_data["original_roll_id"]).first()
        if original is None:
            raise ValueError(f"Original roll {roll_data['original_roll_id']} not found")
        # A roll still 'in' stock hasn't been issued/cut yet, so it can't
        # have a remnant — only an already-issued ('out') roll can.
        if original.status != "out":
            raise ValueError("The original roll must be issued (status 'out') before it can be used as a remnant source")
        # Lot is never manually assigned for a remnant — always inherited
        # from the original roll, regardless of what the client sent.
        roll_data["lot_id"] = original.lot_id
    db_roll = DyedFabricRoll(**roll_data, ingested_by=ingested_by)
    # Auto-fulfillment: link the roll to the oldest open expected-delivery
    # item for the same fabric code. Received totals are then recomputed from
    # the roll ledger inside the same transaction as the INSERT.
    # No match → the roll is created unlinked; ingestion is never blocked.
    matched_item = find_matching_expected_delivery_item(
        db, client_fabric_code_id=db_roll.client_fabric_code_id
    )
    matched_delivery_id = None
    if matched_item:
        db_roll.expected_delivery_item_id = matched_item.id
        matched_delivery_id = matched_item.delivery_id
    db.add(db_roll)
    if matched_item:
        db.flush()  # make the new roll visible to the ledger SUM
        sync_delivery_item_from_rolls(db, matched_item.id)
    db.commit()
    db.refresh(db_roll)
    db_roll.matched_delivery_id = matched_delivery_id
    return db_roll


def delete_fabric_roll(db: Session, roll_id: int) -> bool:
    db_roll = db.query(DyedFabricRoll).filter(DyedFabricRoll.id == roll_id).first()
    if not db_roll:
        return False
    item_id = db_roll.expected_delivery_item_id
    db.delete(db_roll)
    # Ledger reversal: recompute the linked item without this roll
    # (no-op if the parent delivery is closed).
    if item_id is not None:
        db.flush()
        sync_delivery_item_from_rolls(db, item_id)
    db.commit()
    return True


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


def get_fabric_roll_detail(db: Session, roll_id: int):
    row = (
        db.query(DyedFabricRoll, ClientFabricCode, Client, Material, Color, Lot, WarehouseRack)
        .join(ClientFabricCode, DyedFabricRoll.client_fabric_code_id == ClientFabricCode.id)
        .join(Client, ClientFabricCode.client_id == Client.client_id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
        .outerjoin(Lot, DyedFabricRoll.lot_id == Lot.id)
        .outerjoin(WarehouseRack, DyedFabricRoll.rack_id == WarehouseRack.id)
        .filter(DyedFabricRoll.id == roll_id)
        .first()
    )
    if not row:
        return None
    roll, cfc, client, material, color, lot, rack = row
    return {
        "id": roll.id,
        "weight": float(roll.weight),
        "length": float(roll.length) if roll.length is not None else None,
        "status": roll.status,
        "material_name": material.material_name,
        "color_name": color.color_name,
        "lot_number": lot.lot_number if lot else None,
        "client_fabric_code_id": roll.client_fabric_code_id,
        "fabric_code": cfc.fabric_code,
        "client_name": client.client_name,
        "gsm": float(roll.gsm) if roll.gsm is not None else None,
        "fabric_width": float(roll.fabric_width) if roll.fabric_width is not None else None,
        "rack_code": rack.rack_code if rack else None,
        "supplier": roll.supplier,
        "received_date": roll.received_date,
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
        "original_roll_id": roll.original_roll_id,
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


def _flow_entry(entry_map: Dict[tuple, Dict[str, Any]], key: tuple, identity: Dict[str, Any]) -> Dict[str, Any]:
    if key not in entry_map:
        entry_map[key] = {**identity, "total_weight": 0.0, "total_length": 0.0, "roll_count": 0}
    return entry_map[key]


def _add_flow(entry: Dict[str, Any], weight: float, length: float) -> None:
    entry["total_weight"] += weight
    entry["total_length"] += length
    entry["roll_count"] += 1


def _dyed_receiver_by_roll(db: Session) -> Dict[int, Optional[str]]:
    """roll_id → who received it, resolved from the roll's latest receipt item:
    external receipts name the receiver directly (a client or free-text name);
    supplier/internal receipts target a logical location."""
    sup_loc = aliased(LogicalLocation)
    int_loc = aliased(LogicalLocation)
    rows = (
        db.query(FabricReceiptItem.dyed_roll_id, ExternalReceipt.receiver, sup_loc.name, int_loc.name)
        .outerjoin(ExternalReceipt, FabricReceiptItem.external_receipt_id == ExternalReceipt.id)
        .outerjoin(SupplierReceipt, FabricReceiptItem.supplier_receipt_id == SupplierReceipt.id)
        .outerjoin(sup_loc, SupplierReceipt.target_logical_location_id == sup_loc.id)
        .outerjoin(InternalReceipt, FabricReceiptItem.internal_receipt_id == InternalReceipt.id)
        .outerjoin(int_loc, InternalReceipt.target_logical_location_id == int_loc.id)
        .filter(FabricReceiptItem.dyed_roll_id.isnot(None))
        .order_by(FabricReceiptItem.id)
        .all()
    )
    receiver: Dict[int, Optional[str]] = {}
    for roll_id, ext_name, sup_name, int_name in rows:
        receiver[roll_id] = ext_name or sup_name or int_name  # latest item wins
    return receiver


def get_fabric_flow_analytics(db: Session) -> List[Dict[str, Any]]:
    """Daily flow rows per (day, direction, counterparty, fabric code identity)
    across every dyed roll (any status). Ingestion is keyed by received_date
    with the roll's supplier (a client or an actual supplier) as counterparty;
    digestion (status 'out') by issued_date with the receiver from the roll's
    latest receipt item. Rolls missing the relevant date land in a null-date
    bucket."""
    rows = (
        db.query(DyedFabricRoll, ClientFabricCode, Client, Material, Color)
        .join(ClientFabricCode, DyedFabricRoll.client_fabric_code_id == ClientFabricCode.id)
        .join(Client, ClientFabricCode.client_id == Client.client_id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
        .all()
    )
    receiver_by_roll = _dyed_receiver_by_roll(db)

    entry_map: Dict[tuple, Dict[str, Any]] = {}
    for roll, cfc, client, material, color in rows:
        weight = float(roll.weight)
        length = float(roll.length) if roll.length is not None else 0.0
        identity = {
            "client_id": client.client_id,
            "client_name": client.client_name,
            "material_id": material.material_id,
            "material_name": material.material_name,
            "client_fabric_code_id": cfc.id,
            "fabric_code": cfc.fabric_code,
            "color_id": color.color_id,
            "color_name": color.color_name,
        }
        received_key = roll.received_date.date().isoformat() if roll.received_date else None
        entry = _flow_entry(
            entry_map, (received_key, "ingested", roll.supplier, cfc.id),
            {"date": received_key, "direction": "ingested", "counterparty": roll.supplier, **identity},
        )
        _add_flow(entry, weight, length)
        if roll.status == "out":
            issued_key = roll.issued_date.date().isoformat() if roll.issued_date else None
            receiver = receiver_by_roll.get(roll.id)
            entry = _flow_entry(
                entry_map, (issued_key, "digested", receiver, cfc.id),
                {"date": issued_key, "direction": "digested", "counterparty": receiver, **identity},
            )
            _add_flow(entry, weight, length)

    return sorted(
        entry_map.values(),
        key=lambda d: (
            d["date"] is None, d["date"] or "", d["direction"],
            d["counterparty"] or "", d["client_name"], d["fabric_code"] or "", d["color_name"],
        ),
    )


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
