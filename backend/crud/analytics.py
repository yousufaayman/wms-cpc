from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session
from typing import Any, Dict, List, Optional

from backend.models import (
    Client,
    ClientFabricCode,
    Color,
    DyedFabricRoll,
    ExternalReceipt,
    FabricReceiptItem,
    InternalReceipt,
    LogicalLocation,
    Material,
    SupplierReceipt,
    UndyedFabricRoll,
    User,
)


def _username_map(db: Session) -> Dict[int, str]:
    return {u.id: u.username for u in db.query(User.id, User.username).all()}


def _day(ts) -> Optional[str]:
    return ts.date().isoformat() if ts else None


def _row(
    roll,
    roll_type: str,
    date: Optional[str],
    client,
    material,
    fabric_code=None,
    color=None,
    receipt_kind: Optional[str] = None,
    receipt_id: Optional[int] = None,
    counterparty: Optional[str] = None,
    ingested_by: Optional[str] = None,
    is_remnant: bool = False,
    issued_by: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "roll_id": roll.id,
        "roll_type": roll_type,
        "date": date,
        "receipt_kind": receipt_kind,
        "receipt_id": receipt_id,
        # Ingested: the roll's supplier. Digested: who received it (a
        # logical location or an external receiver name).
        "counterparty": counterparty,
        "fabric_code": fabric_code.fabric_code if fabric_code else None,
        "client_fabric_code_id": fabric_code.id if fabric_code else None,
        "client_name": client.client_name,
        "material_name": material.material_name,
        "color_name": color.color_name if color else None,
        "weight": float(roll.weight),
        "length": float(roll.length) if roll.length is not None else None,
        # Ingestion-only: who ingested the roll, and whether it's a remnant
        # (re-ingested from another dyed roll — never true for undyed).
        "ingested_by": ingested_by,
        "remnant_flag": "Remnant" if is_remnant else "",
        # Digestion-only: who issued the receipt that took the roll out.
        "issued_by": issued_by,
    }


def filter_rows_by_date(
    rows: List[Dict[str, Any]], date_from: Optional[str], date_to: Optional[str]
) -> List[Dict[str, Any]]:
    """Keep rows whose day falls inside the (optional) inclusive range.
    Unknown-date rows only survive when no range is active."""
    if not date_from and not date_to:
        return rows
    out = []
    for r in rows:
        d = r.get("date")
        if d is None:
            continue
        if date_from and d < date_from:
            continue
        if date_to and d > date_to:
            continue
        out.append(r)
    return out


def _sort_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # Newest first; rows without a date last
    return sorted(rows, key=lambda r: (r["date"] is not None, r["date"] or ""), reverse=True)


def get_flow_accounts(db: Session, date_from: Optional[str] = None, date_to: Optional[str] = None) -> List[Dict[str, Any]]:
    """Accounts with roll activity in the (optional) date window. An account
    is a logical location OR a client — roll.supplier stores either name —
    matched on rolls ingested in range; logical locations additionally match
    fabric rolls digested to them on supplier/internal receipts issued in
    range, and clients match external receipts naming them as receiver.
    Dates are inclusive ISO days."""
    def in_range(col):
        conds = []
        if date_from:
            conds.append(func.date(col) >= date_from)
        if date_to:
            conds.append(func.date(col) <= date_to)
        return conds

    location_ids = set()
    client_ids = set()

    # Ingestion: a roll names a location or a client as its supplier
    for roll_model in (DyedFabricRoll, UndyedFabricRoll):
        rows = (
            db.query(LogicalLocation.id)
            .join(roll_model, roll_model.supplier == LogicalLocation.name)
            .filter(*in_range(roll_model.received_date))
            .distinct()
            .all()
        )
        location_ids.update(loc_id for (loc_id,) in rows)

        rows = (
            db.query(Client.client_id)
            .join(roll_model, roll_model.supplier == Client.client_name)
            .filter(*in_range(roll_model.received_date))
            .distinct()
            .all()
        )
        client_ids.update(cid for (cid,) in rows)

    # Digestion: fabric receipt items on receipts targeting the location
    for receipt_model, item_fk in (
        (SupplierReceipt, FabricReceiptItem.supplier_receipt_id),
        (InternalReceipt, FabricReceiptItem.internal_receipt_id),
    ):
        rows = (
            db.query(receipt_model.target_logical_location_id)
            .join(FabricReceiptItem, item_fk == receipt_model.id)
            .filter(*in_range(receipt_model.issued_at))
            .distinct()
            .all()
        )
        location_ids.update(loc_id for (loc_id,) in rows)

    # Digestion: external receipts name a receiver — a client or a free-text name
    external_rows = (
        db.query(ExternalReceipt.receiver)
        .join(FabricReceiptItem, FabricReceiptItem.external_receipt_id == ExternalReceipt.id)
        .filter(*in_range(ExternalReceipt.issued_at))
        .distinct()
        .all()
    )
    receivers = {name for (name,) in external_rows if name}

    # A receiver naming a client is that client's account, not an 'external' one
    if receivers:
        matched_clients = db.query(Client).filter(Client.client_name.in_(receivers)).all()
        client_ids.update(c.client_id for c in matched_clients)
        receivers -= {c.client_name for c in matched_clients}

    accounts: List[Dict[str, Any]] = []
    if location_ids:
        locations = db.query(LogicalLocation).filter(LogicalLocation.id.in_(location_ids)).all()
        accounts.extend({"id": loc.id, "name": loc.name, "account_type": "location"} for loc in locations)
    if client_ids:
        clients = db.query(Client).filter(Client.client_id.in_(client_ids)).all()
        accounts.extend({"id": c.client_id, "name": c.client_name, "account_type": "client"} for c in clients)
    accounts.extend({"id": None, "name": name, "account_type": "external"} for name in receivers)
    return sorted(accounts, key=lambda a: a["name"].lower())


def _resolve_account(
    db: Session, account_type: str, account_id: Optional[int], receiver: Optional[str]
) -> Optional[str]:
    """Return the account's display/supplier name, or None if it doesn't exist."""
    if account_type == "location" and account_id is not None:
        location = db.query(LogicalLocation).filter(LogicalLocation.id == account_id).first()
        return location.name if location else None
    if account_type == "client" and account_id is not None:
        client = db.query(Client).filter(Client.client_id == account_id).first()
        return client.client_name if client else None
    if account_type == "external" and receiver:
        exists = db.query(ExternalReceipt.id).filter(ExternalReceipt.receiver == receiver).first()
        return receiver if exists else None
    return None


def _ingested_rows(db: Session, supplier_name: str, username_map: Dict[int, str]) -> List[Dict[str, Any]]:
    """Rolls received from the account (roll.supplier stores the name)."""
    rows: List[Dict[str, Any]] = []

    dyed_in = (
        db.query(DyedFabricRoll, ClientFabricCode, Client, Material, Color)
        .join(ClientFabricCode, DyedFabricRoll.client_fabric_code_id == ClientFabricCode.id)
        .join(Client, ClientFabricCode.client_id == Client.client_id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
        .filter(DyedFabricRoll.supplier == supplier_name)
        .all()
    )
    for roll, cfc, client, material, color in dyed_in:
        rows.append(_row(
            roll, "dyed", _day(roll.received_date), client, material, cfc, color, counterparty=supplier_name,
            ingested_by=username_map.get(roll.ingested_by), is_remnant=roll.original_roll_id is not None,
        ))

    undyed_in = (
        db.query(UndyedFabricRoll, Client, Material)
        .join(Client, UndyedFabricRoll.client_id == Client.client_id)
        .join(Material, UndyedFabricRoll.material_id == Material.material_id)
        .filter(UndyedFabricRoll.supplier == supplier_name)
        .all()
    )
    for roll, client, material in undyed_in:
        rows.append(_row(
            roll, "undyed", _day(roll.received_date), client, material, counterparty=supplier_name,
            ingested_by=username_map.get(roll.ingested_by),
        ))

    return rows


def _digested_rows(db: Session, location_id: int, username_map: Dict[int, str]) -> List[Dict[str, Any]]:
    """Rolls issued to the location on supplier/internal receipts."""
    rows: List[Dict[str, Any]] = []
    target_filter = or_(
        SupplierReceipt.target_logical_location_id == location_id,
        InternalReceipt.target_logical_location_id == location_id,
    )

    dyed_out = (
        db.query(FabricReceiptItem, DyedFabricRoll, ClientFabricCode, Client, Material, Color, SupplierReceipt, InternalReceipt)
        .join(DyedFabricRoll, FabricReceiptItem.dyed_roll_id == DyedFabricRoll.id)
        .join(ClientFabricCode, DyedFabricRoll.client_fabric_code_id == ClientFabricCode.id)
        .join(Client, ClientFabricCode.client_id == Client.client_id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
        .outerjoin(SupplierReceipt, FabricReceiptItem.supplier_receipt_id == SupplierReceipt.id)
        .outerjoin(InternalReceipt, FabricReceiptItem.internal_receipt_id == InternalReceipt.id)
        .filter(target_filter)
        .all()
    )
    for _item, roll, cfc, client, material, color, sr, ir in dyed_out:
        receipt = sr or ir
        rows.append(_row(
            roll, "dyed", _day(receipt.issued_at), client, material, cfc, color,
            receipt_kind="supplier" if sr else "internal", receipt_id=receipt.id,
            counterparty=receipt.target_logical_location.name,
            issued_by=username_map.get(receipt.issued_by),
        ))

    undyed_out = (
        db.query(FabricReceiptItem, UndyedFabricRoll, Client, Material, SupplierReceipt, InternalReceipt)
        .join(UndyedFabricRoll, FabricReceiptItem.undyed_roll_id == UndyedFabricRoll.id)
        .join(Client, UndyedFabricRoll.client_id == Client.client_id)
        .join(Material, UndyedFabricRoll.material_id == Material.material_id)
        .outerjoin(SupplierReceipt, FabricReceiptItem.supplier_receipt_id == SupplierReceipt.id)
        .outerjoin(InternalReceipt, FabricReceiptItem.internal_receipt_id == InternalReceipt.id)
        .filter(target_filter)
        .all()
    )
    for _item, roll, client, material, sr, ir in undyed_out:
        receipt = sr or ir
        rows.append(_row(
            roll, "undyed", _day(receipt.issued_at), client, material,
            receipt_kind="supplier" if sr else "internal", receipt_id=receipt.id,
            counterparty=receipt.target_logical_location.name,
            issued_by=username_map.get(receipt.issued_by),
        ))

    return rows


def _external_digested_rows(db: Session, receiver: str, username_map: Dict[int, str]) -> List[Dict[str, Any]]:
    """Rolls issued to the named receiver on external receipts."""
    rows: List[Dict[str, Any]] = []

    dyed_out = (
        db.query(FabricReceiptItem, DyedFabricRoll, ClientFabricCode, Client, Material, Color, ExternalReceipt)
        .join(DyedFabricRoll, FabricReceiptItem.dyed_roll_id == DyedFabricRoll.id)
        .join(ClientFabricCode, DyedFabricRoll.client_fabric_code_id == ClientFabricCode.id)
        .join(Client, ClientFabricCode.client_id == Client.client_id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
        .join(ExternalReceipt, FabricReceiptItem.external_receipt_id == ExternalReceipt.id)
        .filter(ExternalReceipt.receiver == receiver)
        .all()
    )
    for _item, roll, cfc, client, material, color, er in dyed_out:
        rows.append(_row(
            roll, "dyed", _day(er.issued_at), client, material, cfc, color,
            receipt_kind="external", receipt_id=er.id, counterparty=er.receiver,
            issued_by=username_map.get(er.issued_by),
        ))

    undyed_out = (
        db.query(FabricReceiptItem, UndyedFabricRoll, Client, Material, ExternalReceipt)
        .join(UndyedFabricRoll, FabricReceiptItem.undyed_roll_id == UndyedFabricRoll.id)
        .join(Client, UndyedFabricRoll.client_id == Client.client_id)
        .join(Material, UndyedFabricRoll.material_id == Material.material_id)
        .join(ExternalReceipt, FabricReceiptItem.external_receipt_id == ExternalReceipt.id)
        .filter(ExternalReceipt.receiver == receiver)
        .all()
    )
    for _item, roll, client, material, er in undyed_out:
        rows.append(_row(
            roll, "undyed", _day(er.issued_at), client, material,
            receipt_kind="external", receipt_id=er.id, counterparty=er.receiver,
            issued_by=username_map.get(er.issued_by),
        ))

    return rows


def _all_ingested_rows(
    db: Session, username_map: Dict[int, str], date_from: Optional[str] = None, date_to: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """All rolls ingested (received) inside the date window, across every
    supplier/client — used for the roll-flow export (not scoped to one
    account). counterparty = roll.supplier, which varies per row."""
    def in_range(col):
        conds = []
        if date_from:
            conds.append(func.date(col) >= date_from)
        if date_to:
            conds.append(func.date(col) <= date_to)
        return conds

    rows: List[Dict[str, Any]] = []

    dyed_in = (
        db.query(DyedFabricRoll, ClientFabricCode, Client, Material, Color)
        .join(ClientFabricCode, DyedFabricRoll.client_fabric_code_id == ClientFabricCode.id)
        .join(Client, ClientFabricCode.client_id == Client.client_id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
        .filter(*in_range(DyedFabricRoll.received_date))
        .all()
    )
    for roll, cfc, client, material, color in dyed_in:
        rows.append(_row(
            roll, "dyed", _day(roll.received_date), client, material, cfc, color, counterparty=roll.supplier,
            ingested_by=username_map.get(roll.ingested_by), is_remnant=roll.original_roll_id is not None,
        ))

    undyed_in = (
        db.query(UndyedFabricRoll, Client, Material)
        .join(Client, UndyedFabricRoll.client_id == Client.client_id)
        .join(Material, UndyedFabricRoll.material_id == Material.material_id)
        .filter(*in_range(UndyedFabricRoll.received_date))
        .all()
    )
    for roll, client, material in undyed_in:
        rows.append(_row(
            roll, "undyed", _day(roll.received_date), client, material, counterparty=roll.supplier,
            ingested_by=username_map.get(roll.ingested_by),
        ))

    return rows


def _resolve_target(sr, ir, er):
    """Receipt kind + counterparty name for whichever of the three
    (mutually-exclusive) receipt joins is populated on a row."""
    if sr:
        return "supplier", sr.target_logical_location.name
    if ir:
        return "internal", ir.target_logical_location.name
    return "external", er.receiver


def _in_range_any(cols, date_from: Optional[str], date_to: Optional[str]):
    """OR across several nullable timestamp columns — exactly one is
    populated per row, so this matches whichever one applies."""
    if not date_from and not date_to:
        return None
    ors = []
    for col in cols:
        conds = []
        if date_from:
            conds.append(func.date(col) >= date_from)
        if date_to:
            conds.append(func.date(col) <= date_to)
        ors.append(and_(*conds))
    return or_(*ors)


def _with_receipt_joins(query):
    return (
        query
        .outerjoin(SupplierReceipt, FabricReceiptItem.supplier_receipt_id == SupplierReceipt.id)
        .outerjoin(InternalReceipt, FabricReceiptItem.internal_receipt_id == InternalReceipt.id)
        .outerjoin(ExternalReceipt, FabricReceiptItem.external_receipt_id == ExternalReceipt.id)
    )


def _all_digested_rows(
    db: Session, username_map: Dict[int, str], date_from: Optional[str] = None, date_to: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """All rolls digested (issued out) inside the date window, across every
    target — used for the roll-flow export. Supplier/internal receipts
    target a logical location; external receipts name a receiver.
    counterparty = that target's name, which varies per row."""
    date_cond = _in_range_any(
        (SupplierReceipt.issued_at, InternalReceipt.issued_at, ExternalReceipt.issued_at), date_from, date_to,
    )

    rows: List[Dict[str, Any]] = []

    dyed_out_q = _with_receipt_joins(
        db.query(FabricReceiptItem, DyedFabricRoll, ClientFabricCode, Client, Material, Color, SupplierReceipt, InternalReceipt, ExternalReceipt)
        .join(DyedFabricRoll, FabricReceiptItem.dyed_roll_id == DyedFabricRoll.id)
        .join(ClientFabricCode, DyedFabricRoll.client_fabric_code_id == ClientFabricCode.id)
        .join(Client, ClientFabricCode.client_id == Client.client_id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
    )
    if date_cond is not None:
        dyed_out_q = dyed_out_q.filter(date_cond)
    for _item, roll, cfc, client, material, color, sr, ir, er in dyed_out_q.all():
        receipt = sr or ir or er
        kind, counterparty = _resolve_target(sr, ir, er)
        rows.append(_row(
            roll, "dyed", _day(receipt.issued_at), client, material, cfc, color,
            receipt_kind=kind, receipt_id=receipt.id, counterparty=counterparty,
            issued_by=username_map.get(receipt.issued_by),
        ))

    undyed_out_q = _with_receipt_joins(
        db.query(FabricReceiptItem, UndyedFabricRoll, Client, Material, SupplierReceipt, InternalReceipt, ExternalReceipt)
        .join(UndyedFabricRoll, FabricReceiptItem.undyed_roll_id == UndyedFabricRoll.id)
        .join(Client, UndyedFabricRoll.client_id == Client.client_id)
        .join(Material, UndyedFabricRoll.material_id == Material.material_id)
    )
    if date_cond is not None:
        undyed_out_q = undyed_out_q.filter(date_cond)
    for _item, roll, client, material, sr, ir, er in undyed_out_q.all():
        receipt = sr or ir or er
        kind, counterparty = _resolve_target(sr, ir, er)
        rows.append(_row(
            roll, "undyed", _day(receipt.issued_at), client, material,
            receipt_kind=kind, receipt_id=receipt.id, counterparty=counterparty,
            issued_by=username_map.get(receipt.issued_by),
        ))

    return rows


def get_export_rows(db: Session, date_from: Optional[str] = None, date_to: Optional[str] = None) -> Dict[str, List[Dict[str, Any]]]:
    """All-accounts ingestion/digestion rows for the roll-flow Excel export,
    inside the (optional) inclusive date window."""
    username_map = _username_map(db)
    return {
        "ingested": _sort_rows(_all_ingested_rows(db, username_map, date_from, date_to)),
        "digested": _sort_rows(_all_digested_rows(db, username_map, date_from, date_to)),
    }


def get_account_flow(
    db: Session,
    account_type: str,
    account_id: Optional[int] = None,
    receiver: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Roll traffic for one account, all-time. Accounts are logical locations,
    clients (both identified by id), or external-receipt receivers (identified
    by the free-text receiver name).

    Ingested = rolls received from the account (roll.supplier stores the
    account name as a denormalized string). Digested = rolls issued out on
    receipts to the account: supplier/internal receipts target locations,
    external receipts name a receiver — a free-text name or a client.
    Date filtering is applied by the caller/UI."""
    account_name = _resolve_account(db, account_type, account_id, receiver)
    if account_name is None:
        return None

    username_map = _username_map(db)
    ingested = _ingested_rows(db, account_name, username_map)
    if account_type == "location":
        digested = _digested_rows(db, account_id, username_map)
    else:
        # Clients and external receivers are both named on external receipts
        digested = _external_digested_rows(db, account_name, username_map)

    return {
        "account_id": account_id,
        "account_name": account_name,
        "account_type": account_type,
        "ingested": _sort_rows(ingested),
        "digested": _sort_rows(digested),
    }
