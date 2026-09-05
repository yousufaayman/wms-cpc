from sqlalchemy.orm import Session, aliased
from typing import List, Optional, Any, Dict
from backend.models import (
    UndyedFabricRoll, Client, Material, WarehouseRack,
    FabricReceiptItem, ExternalReceipt, SupplierReceipt, InternalReceipt, LogicalLocation,
)
from backend.schemas import UndyedFabricRollCreate, UndyedFabricRollUpdate
from backend.crud.expected_deliveries import (
    find_matching_expected_delivery_item,
    sync_delivery_item_from_rolls,
)


def create_undyed_fabric_roll(db: Session, roll: UndyedFabricRollCreate, ingested_by: Optional[int] = None) -> UndyedFabricRoll:
    db_roll = UndyedFabricRoll(**roll.model_dump(), ingested_by=ingested_by)
    # Auto-fulfillment: link the roll to the oldest open expected-delivery
    # item for the same client + material (undyed items carry the pair
    # directly — there is no fabric code). Received totals are then recomputed
    # from the roll ledger inside the same transaction as the INSERT.
    # No match → the roll is created unlinked; ingestion never blocks.
    matched_item = find_matching_expected_delivery_item(
        db, client_id=db_roll.client_id, material_id=db_roll.material_id
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


def delete_undyed_fabric_roll(db: Session, roll_id: int) -> bool:
    db_roll = db.query(UndyedFabricRoll).filter(UndyedFabricRoll.id == roll_id).first()
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


def get_undyed_fabric_rolls(
    db: Session,
    skip: int = 0,
    limit: int = 200,
    client_id: Optional[int] = None,
    material_id: Optional[int] = None,
) -> List[UndyedFabricRoll]:
    q = db.query(UndyedFabricRoll)
    if client_id is not None:
        q = q.filter(UndyedFabricRoll.client_id == client_id)
    if material_id is not None:
        q = q.filter(UndyedFabricRoll.material_id == material_id)
    return q.order_by(UndyedFabricRoll.id.desc()).offset(skip).limit(limit).all()


def get_undyed_fabric_roll(db: Session, roll_id: int) -> Optional[UndyedFabricRoll]:
    return db.query(UndyedFabricRoll).filter(UndyedFabricRoll.id == roll_id).first()


def get_undyed_fabric_roll_detail(db: Session, roll_id: int):
    row = (
        db.query(UndyedFabricRoll, Material, Client, WarehouseRack)
        .join(Material, UndyedFabricRoll.material_id == Material.material_id)
        .join(Client, UndyedFabricRoll.client_id == Client.client_id)
        .outerjoin(WarehouseRack, UndyedFabricRoll.rack_id == WarehouseRack.id)
        .filter(UndyedFabricRoll.id == roll_id)
        .first()
    )
    if not row:
        return None
    roll, material, client, rack = row
    return {
        "id": roll.id,
        "weight": float(roll.weight),
        "length": float(roll.length) if roll.length is not None else None,
        "status": roll.status,
        "material_name": material.material_name,
        "lot_number": roll.lot_number,
        "client_id": roll.client_id,
        "material_id": roll.material_id,
        "client_name": client.client_name,
        "gsm": float(roll.gsm) if roll.gsm is not None else None,
        "fabric_width": float(roll.fabric_width) if roll.fabric_width is not None else None,
        "rack_code": rack.rack_code if rack else None,
        "supplier": roll.supplier,
        "received_date": roll.received_date,
    }


def update_undyed_fabric_roll(
    db: Session, roll_id: int, roll: UndyedFabricRollUpdate
) -> Optional[UndyedFabricRoll]:
    db_roll = get_undyed_fabric_roll(db, roll_id)
    if not db_roll:
        return None
    for field, value in roll.model_dump(exclude_unset=True).items():
        setattr(db_roll, field, value)
    # Weight/length edits change the roll's ledger contribution — resync.
    if db_roll.expected_delivery_item_id is not None:
        db.flush()
        sync_delivery_item_from_rolls(db, db_roll.expected_delivery_item_id)
    db.commit()
    db.refresh(db_roll)
    return db_roll


def _build_undyed_lot_groups(rolls_with_racks: list) -> list:
    lot_key_map: Dict[tuple, Dict[str, Any]] = {}
    for roll, rack in rolls_with_racks:
        key = (roll.lot_number, roll.supplier)
        if key not in lot_key_map:
            lot_key_map[key] = {
                "lot_number": roll.lot_number,
                "supplier": roll.supplier,
                "rolls": [],
            }
        lot_key_map[key]["rolls"].append({
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
        })

    lot_groups = []
    for lg in lot_key_map.values():
        rolls = lg["rolls"]
        lg["total_weight"] = sum(r["weight"] for r in rolls)
        lengths = [r["length"] for r in rolls if r["length"] is not None]
        lg["total_length"] = sum(lengths) if lengths else None
        lg["roll_count"] = len(rolls)
        lot_groups.append(lg)
    return lot_groups


def _totals(items: list) -> tuple:
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


def _undyed_receiver_by_roll(db: Session) -> Dict[int, Optional[str]]:
    """roll_id → who received it, resolved from the roll's latest receipt item:
    external receipts name the receiver directly (a client or free-text name);
    supplier/internal receipts target a logical location."""
    sup_loc = aliased(LogicalLocation)
    int_loc = aliased(LogicalLocation)
    rows = (
        db.query(FabricReceiptItem.undyed_roll_id, ExternalReceipt.receiver, sup_loc.name, int_loc.name)
        .outerjoin(ExternalReceipt, FabricReceiptItem.external_receipt_id == ExternalReceipt.id)
        .outerjoin(SupplierReceipt, FabricReceiptItem.supplier_receipt_id == SupplierReceipt.id)
        .outerjoin(sup_loc, SupplierReceipt.target_logical_location_id == sup_loc.id)
        .outerjoin(InternalReceipt, FabricReceiptItem.internal_receipt_id == InternalReceipt.id)
        .outerjoin(int_loc, InternalReceipt.target_logical_location_id == int_loc.id)
        .filter(FabricReceiptItem.undyed_roll_id.isnot(None))
        .order_by(FabricReceiptItem.id)
        .all()
    )
    receiver: Dict[int, Optional[str]] = {}
    for roll_id, ext_name, sup_name, int_name in rows:
        receiver[roll_id] = ext_name or sup_name or int_name  # latest item wins
    return receiver


def get_undyed_fabric_flow_analytics(db: Session) -> List[Dict[str, Any]]:
    """Daily flow rows per (day, direction, counterparty, client + material)
    across every undyed roll (any status). Ingestion is keyed by received_date
    with the roll's supplier (a client or an actual supplier) as counterparty;
    digestion (status 'out') by issued_date with the receiver from the roll's
    latest receipt item. Rolls missing the relevant date land in a null-date
    bucket."""
    rows = (
        db.query(UndyedFabricRoll, Client, Material)
        .join(Client, UndyedFabricRoll.client_id == Client.client_id)
        .join(Material, UndyedFabricRoll.material_id == Material.material_id)
        .all()
    )
    receiver_by_roll = _undyed_receiver_by_roll(db)

    entry_map: Dict[tuple, Dict[str, Any]] = {}
    for roll, client, material in rows:
        weight = float(roll.weight)
        length = float(roll.length) if roll.length is not None else 0.0
        identity = {
            "client_id": client.client_id,
            "client_name": client.client_name,
            "material_id": material.material_id,
            "material_name": material.material_name,
        }
        received_key = roll.received_date.date().isoformat() if roll.received_date else None
        entry = _flow_entry(
            entry_map, (received_key, "ingested", roll.supplier, client.client_id, material.material_id),
            {"date": received_key, "direction": "ingested", "counterparty": roll.supplier, **identity},
        )
        _add_flow(entry, weight, length)
        if roll.status == "out":
            issued_key = roll.issued_date.date().isoformat() if roll.issued_date else None
            receiver = receiver_by_roll.get(roll.id)
            entry = _flow_entry(
                entry_map, (issued_key, "digested", receiver, client.client_id, material.material_id),
                {"date": issued_key, "direction": "digested", "counterparty": receiver, **identity},
            )
            _add_flow(entry, weight, length)

    return sorted(
        entry_map.values(),
        key=lambda d: (
            d["date"] is None, d["date"] or "", d["direction"],
            d["counterparty"] or "", d["client_name"], d["material_name"],
        ),
    )


def get_undyed_fabric_inventory(db: Session) -> List[Dict[str, Any]]:
    """Return undyed fabric rolls grouped by client → material → lot/supplier → rolls."""
    rows = (
        db.query(UndyedFabricRoll, Client, Material, WarehouseRack)
        .join(Client, UndyedFabricRoll.client_id == Client.client_id)
        .join(Material, UndyedFabricRoll.material_id == Material.material_id)
        .outerjoin(WarehouseRack, UndyedFabricRoll.rack_id == WarehouseRack.id)
        .filter(UndyedFabricRoll.status == "in")
        .order_by(Client.client_name, Material.material_name, UndyedFabricRoll.id)
        .all()
    )

    # client_id → { meta, _mats: { material_id → { meta, _rolls } } }
    client_map: Dict[int, Dict[str, Any]] = {}

    for roll, client, material, rack in rows:
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
                "_rolls": [],
            }
        mats[material.material_id]["_rolls"].append((roll, rack))

    result = []
    for client_entry in client_map.values():
        materials = []
        for mat_entry in client_entry.pop("_mats").values():
            lot_groups = _build_undyed_lot_groups(mat_entry.pop("_rolls"))
            mat_entry["lot_groups"] = lot_groups
            mat_entry["total_weight"], mat_entry["total_length"], mat_entry["roll_count"] = _totals(lot_groups)
            materials.append(mat_entry)

        client_entry["materials"] = materials
        client_entry["total_weight"], client_entry["total_length"], client_entry["roll_count"] = _totals(materials)
        result.append(client_entry)

    return result
