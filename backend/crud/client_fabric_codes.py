from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Any, Dict, List, Optional
from backend.models import ClientFabricCode, Client, Material, Color, DyedFabricRoll
from backend.schemas import ClientFabricCodeCreate


def get_client_fabric_codes(
    db: Session,
    skip: int = 0,
    limit: int = 200,
    client_id: Optional[int] = None,
    material_id: Optional[int] = None,
    color_id: Optional[int] = None,
) -> List[ClientFabricCode]:
    q = db.query(ClientFabricCode)
    if client_id is not None:
        q = q.filter(ClientFabricCode.client_id == client_id)
    if material_id is not None:
        q = q.filter(ClientFabricCode.material_id == material_id)
    if color_id is not None:
        q = q.filter(ClientFabricCode.color_id == color_id)
    return q.offset(skip).limit(limit).all()


def get_client_fabric_code(db: Session, cfc_id: int) -> Optional[ClientFabricCode]:
    return db.query(ClientFabricCode).filter(ClientFabricCode.id == cfc_id).first()


def get_client_fabric_code_by_combination(
    db: Session, client_id: int, material_id: int, color_id: int
) -> Optional[ClientFabricCode]:
    return (
        db.query(ClientFabricCode)
        .filter(
            ClientFabricCode.client_id == client_id,
            ClientFabricCode.material_id == material_id,
            ClientFabricCode.color_id == color_id,
        )
        .first()
    )


def get_or_create_client_fabric_code(
    db: Session, client_id: int, material_id: int, color_id: int, fabric_code: Optional[str] = None
) -> ClientFabricCode:
    existing = get_client_fabric_code_by_combination(db, client_id, material_id, color_id)
    if existing:
        return existing
    db_obj = ClientFabricCode(
        client_id=client_id,
        material_id=material_id,
        color_id=color_id,
        fabric_code=fabric_code,
    )
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def create_client_fabric_code(db: Session, cfc: ClientFabricCodeCreate) -> ClientFabricCode:
    db_obj = ClientFabricCode(**cfc.model_dump())
    db.add(db_obj)
    db.commit()
    db.refresh(db_obj)
    return db_obj


def search_client_fabric_codes(db: Session, query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Fabric codes matching the query (case-insensitive substring), enriched
    with client/material/color names and current in-stock totals."""
    rows = (
        db.query(ClientFabricCode, Client, Material, Color)
        .join(Client, ClientFabricCode.client_id == Client.client_id)
        .join(Material, ClientFabricCode.material_id == Material.material_id)
        .join(Color, ClientFabricCode.color_id == Color.color_id)
        .filter(ClientFabricCode.fabric_code.ilike(f"%{query}%"))
        .order_by(ClientFabricCode.fabric_code)
        .limit(limit)
        .all()
    )
    if not rows:
        return []

    cfc_ids = [cfc.id for cfc, _, _, _ in rows]
    stock_rows = (
        db.query(
            DyedFabricRoll.client_fabric_code_id,
            func.sum(DyedFabricRoll.weight),
            func.sum(DyedFabricRoll.length),
            func.count(DyedFabricRoll.id),
        )
        .filter(DyedFabricRoll.client_fabric_code_id.in_(cfc_ids), DyedFabricRoll.status == "in")
        .group_by(DyedFabricRoll.client_fabric_code_id)
        .all()
    )
    stock_by_cfc = {
        cfc_id: {"weight": float(w or 0), "length": float(l) if l is not None else None, "rolls": c}
        for cfc_id, w, l, c in stock_rows
    }

    results = []
    for cfc, client, material, color in rows:
        stock = stock_by_cfc.get(cfc.id, {"weight": 0.0, "length": None, "rolls": 0})
        results.append({
            "client_fabric_code_id": cfc.id,
            "fabric_code": cfc.fabric_code,
            "client_id": client.client_id,
            "client_name": client.client_name,
            "material_id": material.material_id,
            "material_name": material.material_name,
            "color_id": color.color_id,
            "color_name": color.color_name,
            "in_stock_weight": stock["weight"],
            "in_stock_length": stock["length"],
            "in_stock_rolls": stock["rolls"],
        })
    return results
