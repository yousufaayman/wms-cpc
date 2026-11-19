"""Accessory dashboard widgets (item 24): read-only numbers, nothing is written.

- `lookup`: the Trim Code Lookup widget. Finds items by **our code** or a
  **client / supplier reference code** only (not description, color or size:
  user rule), and says how much of each is in one warehouse. A template's
  stock is the sum of its variants' (templates never hold stock themselves).
- `attention`: the Needs Attention widget's four counts for one warehouse.

Job order balances live with the other requirement queries
(`crud/accessory_requirements.open_job_orders`); shortages reuse
`crud/accessory_requirements.shortages` (item 20).
"""
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Dict, List

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from backend.crud.accessory_items import _has_ref, _like, _ref_code_match
from backend.crud.expected_deliveries import _OPEN_STATUSES, _accessory_lines_where
from backend.models import (
    AccessoryItem,
    AccessoryReceiptItem,
    ExpectedDelivery,
    ExpectedDeliveryItem,
    InternalReceipt,
    LogicalLocation,
    accessory_stock,
)

_STOCK = accessory_stock.c

# Over-received / closed-short deliveries stay on the dashboard while open and
# for this long after they were closed, so the count doesn't grow forever.
ATTENTION_DAYS = 30


def lookup(db: Session, warehouse_id: int, code: str, limit: int = 10) -> List[dict]:
    """Items whose code, or one of whose reference codes (a variant also has
    its template's), contains `code`. Exact code matches first, then by code.
    Merged and switched-off items are listed too, marked."""
    text = code.strip()
    if not text:
        return []
    exact = func.upper(AccessoryItem.code) == text.upper()
    items = (
        db.query(AccessoryItem)
        .filter(or_(AccessoryItem.code.ilike(_like(text), escape="\\"), _has_ref(_ref_code_match(text))))
        .order_by(case((exact, 0), else_=1), AccessoryItem.code)
        .limit(limit)
        .all()
    )
    if not items:
        return []

    # Stock here per item, and per template through its variants.
    ids = [i.id for i in items]
    owner = func.coalesce(AccessoryItem.parent_template_id, _STOCK.accessory_item_id)
    rows = db.execute(
        select(
            _STOCK.accessory_item_id,
            AccessoryItem.parent_template_id,
            func.coalesce(func.sum(_STOCK.on_hand), 0),
            func.count().filter(_STOCK.on_hand > 0),
            func.coalesce(func.sum(_STOCK.on_hand).filter(_STOCK.rack_id.is_(None)), 0),
        )
        .join(AccessoryItem, AccessoryItem.id == _STOCK.accessory_item_id)
        .where(_STOCK.warehouse_id == warehouse_id, or_(_STOCK.accessory_item_id.in_(ids), owner.in_(ids)))
        .group_by(_STOCK.accessory_item_id, AccessoryItem.parent_template_id)
    ).all()
    stock: Dict[int, dict] = defaultdict(lambda: {"on_hand": Decimal("0"), "pack_count": 0, "unracked": Decimal("0")})

    def add(key: int, on_hand, packs, unracked) -> None:
        stock[key]["on_hand"] += Decimal(on_hand)
        stock[key]["pack_count"] += packs
        stock[key]["unracked"] += Decimal(unracked)

    for item_id, template_id, on_hand, packs, unracked in rows:
        if item_id in ids:
            add(item_id, on_hand, packs, unracked)
        if template_id is not None and template_id in ids:
            add(template_id, on_hand, packs, unracked)

    suppliers = _supplier_names(db, items)
    return [_lookup_row(item, stock[item.id], suppliers) for item in items]


def _supplier_names(db: Session, items: List[AccessoryItem]) -> Dict[int, str]:
    ids = {r.supplier_id for item in items for r in _refs(item) if r.supplier_id is not None}
    if not ids:
        return {}
    return dict(db.execute(select(LogicalLocation.id, LogicalLocation.name).where(LogicalLocation.id.in_(ids))).all())


def _refs(item: AccessoryItem):
    """The item's references; a variant without its own shows its template's."""
    if item.refs or item.parent_template is None:
        return item.refs
    return item.parent_template.refs


def _lookup_row(item: AccessoryItem, stock: dict, suppliers: Dict[int, str]) -> dict:
    refs = [
        {
            "ref_code": r.ref_code,
            "party": "client" if r.client_id is not None else "supplier",
            "party_name": (r.client.client_name if r.client is not None else None)
            if r.client_id is not None else suppliers.get(r.supplier_id),
        }
        for r in _refs(item)
    ]
    return {
        "accessory_item_id": item.id,
        "code": item.code,
        "description": item.description,
        "color": item.color,
        "size": item.size,
        "value_lines": item.value_lines,
        "uom_code": item.base_uom.code,
        "client_name": item.client.client_name if item.client is not None else None,
        "is_template": bool(item.is_template),
        "active": item.active,
        "merged_into_code": item.merged_into_code,
        "refs": refs,
        **stock,
    }


def attention(db: Session, warehouse_id: int) -> dict:
    """Needs Attention counts for one warehouse:
    - unracked_packs: packs holding stock with no rack (waiting for put-away)
    - over_received / closed_short: deliveries of this warehouse with that
      item-18 flag, still open or closed in the last ATTENTION_DAYS days
    - over_issue_receipts: unconfirmed issues with an over-issue line (D-2)
    """
    unracked = db.scalar(
        select(func.count()).select_from(accessory_stock)
        .where(_STOCK.warehouse_id == warehouse_id, _STOCK.rack_id.is_(None), _STOCK.on_hand > 0)
    )
    return {
        "unracked_packs": unracked or 0,
        "over_received": _flagged_deliveries(db, warehouse_id, "over_received"),
        "closed_short": _flagged_deliveries(db, warehouse_id, "closed_short"),
        "over_issue_receipts": db.scalar(
            select(func.count(func.distinct(InternalReceipt.id)))
            .join(AccessoryReceiptItem, AccessoryReceiptItem.internal_receipt_id == InternalReceipt.id)
            .where(
                InternalReceipt.source_warehouse_id == warehouse_id,
                InternalReceipt.status == "issued",
                AccessoryReceiptItem.over_issue_reason.is_not(None),
            )
        ) or 0,
        "days": ATTENTION_DAYS,
    }


def _flagged_deliveries(db: Session, warehouse_id: int, flag: str) -> int:
    # Same flag rules as the Expected Deliveries list filter (item 18).
    since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=ATTENTION_DAYS)
    recent = or_(ExpectedDelivery.status.in_(_OPEN_STATUSES), ExpectedDelivery.closed_at >= since)
    if flag == "over_received":
        conditions = [
            ExpectedDelivery.status != "cancelled",
            ExpectedDelivery.id.in_(_accessory_lines_where(lambda qty: qty > ExpectedDeliveryItem.expected_qty)),
        ]
    else:
        conditions = [
            ExpectedDelivery.status == "received",
            ExpectedDelivery.id.in_(_accessory_lines_where(lambda qty: qty < ExpectedDeliveryItem.expected_qty)),
        ]
    return db.scalar(
        select(func.count()).select_from(ExpectedDelivery)
        .where(ExpectedDelivery.warehouse_id == warehouse_id, recent, *conditions)
    ) or 0

