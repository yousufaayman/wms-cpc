"""Accessory Analytics (item 26): read-only reports for one Accessory warehouse.

Everything comes from the ledger (`wms.accessory_ledger` + its postings), the
`wms.accessory_stock` view and the expected delivery lines; nothing is stored.

- `stock_flow`: per item, what came in / went out between two days, with the
  quantity before (opening) and after (closing). Opening + movements = closing.
- `item_entries`: the ledger rows behind one item's flow (the drill-down).
- `issued_to_jos`: per job order and item, issued / returned / net used.
- `slow_moving`: items with stock here and no receipt, issue or return for N days.
- `expected_deliveries`: accessory lines of open deliveries, plus over-received
  lines of closed ones.
- `stock_on_hand`: per item, on hand / packs / racks (Excel only; the
  Accessory Inventory page shows this on screen).

Quantities are in each item's base unit. A reversal row keeps its original's
entry type with the opposite sign, so an undone receive simply cancels out of
"Received". Days are counted in the factory's local time (Africa/Cairo, as the
containers run), not UTC.
"""
from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Dict, Iterable, List, Optional

from sqlalchemy import and_, func, select, true
from sqlalchemy.orm import Session, selectinload

from backend.crud.expected_deliveries import (
    _OPEN_STATUSES,
    attach_accessory_received,
    resolve_supplier_name,
)
from backend.models import (
    AccessoryItem,
    AccessoryLedgerEntry,
    AccessoryPack,
    AccessoryPosting,
    ExpectedDelivery,
    ExpectedDeliveryItem,
    JobOrder,
    WarehouseRack,
    accessory_stock,
)

LOCAL_TZ = "Africa/Cairo"
ZERO = Decimal("0")
DEFAULT_IDLE_DAYS = 90
# What counts as "movement" for the slow-moving report (user, 2026-11-20).
MOVEMENT_TYPES = ("receipt", "issue", "return")

# Flow columns, in screen / sheet order. Out-going columns are shown as
# positive quantities; adjusted and reclassified keep their sign.
FLOW_COLUMNS = ("received", "issued", "returned", "supplier_returns", "written_off", "adjusted", "reclassified")
_TYPE_COLUMN = {
    "receipt": ("received", 1),
    "issue": ("issued", -1),
    "return": ("returned", 1),
    "supplier_return": ("supplier_returns", -1),
    "write_off": ("written_off", -1),
    "adjustment": ("adjusted", 1),       # opening stock (item 25) included
    "reclassify": ("reclassified", 1),   # stock moved to another item (also merge duplicates)
    "transfer": ("reclassified", 1),     # pack to pack of one item: nets to 0 per item
}

_L = AccessoryLedgerEntry
_P = AccessoryPosting
_K = AccessoryPack
_STOCK = accessory_stock.c


def _local_day(column):
    return func.date(func.timezone(LOCAL_TZ, column))


def _range(day, date_from: Optional[date], date_to: Optional[date]):
    conds = []
    if date_from is not None:
        conds.append(day >= date_from)
    if date_to is not None:
        conds.append(day <= date_to)
    return and_(true(), *conds)


def _item_filters(item_col, client_id: Optional[int], category_id: Optional[int]):
    """Conditions on an item id column: the item's client / category."""
    conds = []
    if client_id is not None:
        conds.append(item_col.in_(select(AccessoryItem.id).where(AccessoryItem.client_id == client_id)))
    if category_id is not None:
        conds.append(item_col.in_(select(AccessoryItem.id).where(AccessoryItem.category_id == category_id)))
    return conds


def _items(db: Session, ids: Iterable[int]) -> Dict[int, AccessoryItem]:
    ids = list(set(ids))
    if not ids:
        return {}
    rows = db.scalars(
        select(AccessoryItem)
        .where(AccessoryItem.id.in_(ids))
        .options(
            selectinload(AccessoryItem.category),
            selectinload(AccessoryItem.client),
            selectinload(AccessoryItem.base_uom),
            selectinload(AccessoryItem.parent_template),
        )
    )
    return {i.id: i for i in rows}


def item_info(item: AccessoryItem) -> dict:
    """The item columns every report shows."""
    return {
        "accessory_item_id": item.id,
        "item_code": item.code,
        "description": item.description,
        "color": item.color,
        "size": item.size,
        "template_code": item.template_code,
        "client_id": item.client_id,
        "client_name": item.client.client_name if item.client is not None else None,
        "category_name_en": item.category.name_en if item.category is not None else None,
        "category_name_ar": item.category.name_ar if item.category is not None else None,
        "uom_code": item.base_uom.code,
    }


# ── Stock flow ───────────────────────────────────────────────────────────────

def stock_flow(
    db: Session, warehouse_id: int, date_from: Optional[date], date_to: Optional[date],
    client_id: Optional[int] = None, category_id: Optional[int] = None,
) -> List[dict]:
    """One row per item with stock or movement in this warehouse: opening (before
    `date_from`), one total per flow column for the days in range, closing (end
    of `date_to`). Items with nothing before and nothing in range are left out."""
    day = _local_day(_P.created_at)
    before = day < date_from if date_from is not None else None
    in_range = _range(day, date_from, date_to)
    opening_sum = func.sum(_L.qty_delta).filter(before) if before is not None else func.sum(0)
    rows = db.execute(
        select(
            _L.accessory_item_id,
            _L.entry_type,
            func.coalesce(opening_sum, 0),
            func.coalesce(func.sum(_L.qty_delta).filter(in_range), 0),
            func.count().filter(in_range),
        )
        .join(_P, _P.id == _L.posting_id)
        .join(_K, _K.id == _L.pack_id)
        .where(_K.warehouse_id == warehouse_id, *_item_filters(_L.accessory_item_id, client_id, category_id))
        .group_by(_L.accessory_item_id, _L.entry_type)
    ).all()

    flows: Dict[int, dict] = {}
    for item_id, entry_type, opening, moved, count in rows:
        f = flows.setdefault(item_id, {"opening": ZERO, "entries": 0, **{c: ZERO for c in FLOW_COLUMNS}})
        f["opening"] += Decimal(opening)
        column, sign = _TYPE_COLUMN[entry_type]
        f[column] += sign * Decimal(moved)
        f["entries"] += count

    items = _items(db, flows)
    out = []
    for item_id, f in flows.items():
        moved = sum((_stock_effect(c, f[c]) for c in FLOW_COLUMNS), ZERO)
        f["closing"] = f["opening"] + moved
        if f["opening"] == 0 and f["closing"] == 0 and f["entries"] == 0:
            continue
        out.append({**item_info(items[item_id]), **f})
    out.sort(key=lambda r: r["item_code"])
    return out


_OUT_COLUMNS = {"issued", "supplier_returns", "written_off"}


def _stock_effect(column: str, value: Decimal) -> Decimal:
    """A flow column's effect on stock (out-going columns are shown positive)."""
    return -value if column in _OUT_COLUMNS else value


def item_entries(
    db: Session, warehouse_id: int, item_id: int, date_from: Optional[date], date_to: Optional[date],
) -> List[AccessoryLedgerEntry]:
    """The ledger rows of one item's packs in this warehouse, oldest first."""
    return list(db.scalars(
        select(_L)
        .join(_P, _P.id == _L.posting_id)
        .join(_K, _K.id == _L.pack_id)
        .where(_K.warehouse_id == warehouse_id, _L.accessory_item_id == item_id,
               _range(_local_day(_P.created_at), date_from, date_to))
        .order_by(_P.created_at, _L.id)
    ))


# ── Issued to job orders ─────────────────────────────────────────────────────

def issued_to_jos(
    db: Session, warehouse_id: int, date_from: Optional[date], date_to: Optional[date],
    client_id: Optional[int] = None,
) -> List[dict]:
    """Per job order (client = the JO's client): one line per item with issued,
    returned and net used, from this warehouse's packs in the date range."""
    rows = db.execute(
        select(
            _L.job_order_id,
            _L.accessory_item_id,
            func.coalesce(func.sum(_L.qty_delta).filter(_L.entry_type == "issue"), 0),
            func.coalesce(func.sum(_L.qty_delta).filter(_L.entry_type == "return"), 0),
        )
        .join(_P, _P.id == _L.posting_id)
        .join(_K, _K.id == _L.pack_id)
        .join(JobOrder, JobOrder.job_order_id == _L.job_order_id)
        .where(
            _K.warehouse_id == warehouse_id,
            _L.entry_type.in_(("issue", "return")),
            _range(_local_day(_P.created_at), date_from, date_to),
            *([JobOrder.client_id == client_id] if client_id is not None else []),
        )
        .group_by(_L.job_order_id, _L.accessory_item_id)
    ).all()

    jo_ids = {r[0] for r in rows}
    jos = {
        j.job_order_id: j
        for j in db.scalars(
            select(JobOrder).where(JobOrder.job_order_id.in_(jo_ids)).options(selectinload(JobOrder.client))
        )
    } if jo_ids else {}
    items = _items(db, (r[1] for r in rows))

    grouped: Dict[int, List[dict]] = defaultdict(list)
    for jo_id, item_id, issued, returned in rows:
        issued, returned = -Decimal(issued), Decimal(returned)
        if issued == 0 and returned == 0:
            continue  # everything in range was reversed
        grouped[jo_id].append({**item_info(items[item_id]), "issued": issued, "returned": returned,
                               "net": issued - returned})

    out = []
    for jo_id, lines in grouped.items():
        jo = jos[jo_id]
        lines.sort(key=lambda r: r["item_code"])
        out.append({
            "job_order_id": jo_id,
            "job_order_number": jo.job_order_number,
            "client_id": jo.client_id,
            "client_name": jo.client.client_name if jo.client is not None else None,
            "lines": lines,
            "totals": _totals(lines, ("issued", "returned", "net")),
        })
    out.sort(key=lambda r: r["job_order_number"])
    return out


def _totals(lines: List[dict], fields) -> List[dict]:
    """Sums per unit (quantities of different units are never added up)."""
    by_uom: Dict[str, dict] = {}
    for line in lines:
        t = by_uom.setdefault(line["uom_code"], {"uom_code": line["uom_code"], **{f: ZERO for f in fields}})
        for f in fields:
            t[f] += line[f]
    return [by_uom[k] for k in sorted(by_uom)]


# ── Slow-moving stock ────────────────────────────────────────────────────────

def _stock_by_item(db: Session, warehouse_id: int, client_id, category_id) -> Dict[int, dict]:
    """{item: on hand, packs, unracked qty, rack codes} for packs with stock here."""
    rows = db.execute(
        select(_STOCK.accessory_item_id, _STOCK.rack_id, func.count(), func.sum(_STOCK.on_hand))
        .where(_STOCK.warehouse_id == warehouse_id, _STOCK.on_hand > 0,
               *_item_filters(_STOCK.accessory_item_id, client_id, category_id))
        .group_by(_STOCK.accessory_item_id, _STOCK.rack_id)
    ).all()
    rack_ids = {r[1] for r in rows if r[1] is not None}
    racks = dict(db.execute(
        select(WarehouseRack.id, WarehouseRack.rack_code).where(WarehouseRack.id.in_(rack_ids))
    ).all()) if rack_ids else {}
    stock: Dict[int, dict] = {}
    for item_id, rack_id, packs, qty in rows:
        s = stock.setdefault(item_id, {"on_hand": ZERO, "pack_count": 0, "unracked": ZERO, "racks": []})
        s["on_hand"] += Decimal(qty)
        s["pack_count"] += packs
        if rack_id is None:
            s["unracked"] += Decimal(qty)
        else:
            s["racks"].append(racks[rack_id])
    for s in stock.values():
        s["racks"].sort()
    return stock


def slow_moving(
    db: Session, warehouse_id: int, days: int = DEFAULT_IDLE_DAYS,
    client_id: Optional[int] = None, category_id: Optional[int] = None, now: Optional[datetime] = None,
) -> List[dict]:
    """Items with stock here whose last receipt / issue / return (on this
    warehouse's packs) is at least `days` ago. An item that never had one (e.g.
    only opening stock) counts from its first pack. Longest idle first."""
    now = now or datetime.now(timezone.utc)
    stock = _stock_by_item(db, warehouse_id, client_id, category_id)
    if not stock:
        return []
    ids = list(stock)
    last = dict(db.execute(
        select(_L.accessory_item_id, func.max(_P.created_at))
        .join(_P, _P.id == _L.posting_id)
        .join(_K, _K.id == _L.pack_id)
        .where(_K.warehouse_id == warehouse_id, _L.accessory_item_id.in_(ids), _L.entry_type.in_(MOVEMENT_TYPES))
        .group_by(_L.accessory_item_id)
    ).all())
    first_pack = dict(db.execute(
        select(_K.accessory_item_id, func.min(_K.created_at))
        .where(_K.warehouse_id == warehouse_id, _K.accessory_item_id.in_(ids))
        .group_by(_K.accessory_item_id)
    ).all())
    items = _items(db, ids)
    out = []
    for item_id, s in stock.items():
        since = last.get(item_id) or first_pack[item_id]
        idle = (now - since).days
        if idle < days:
            continue
        out.append({
            **item_info(items[item_id]), **s,
            "last_movement": last.get(item_id),
            "in_stock_since": first_pack[item_id],
            "idle_days": idle,
            "generic": items[item_id].client_id is None,
        })
    out.sort(key=lambda r: (-r["idle_days"], r["item_code"]))
    return out


# ── Stock on hand (Excel) ────────────────────────────────────────────────────

def stock_on_hand(
    db: Session, warehouse_id: int, client_id: Optional[int] = None, category_id: Optional[int] = None,
) -> List[dict]:
    stock = _stock_by_item(db, warehouse_id, client_id, category_id)
    items = _items(db, stock)
    out = [{**item_info(items[i]), **s, "generic": items[i].client_id is None} for i, s in stock.items()]
    out.sort(key=lambda r: r["item_code"])
    return out


# ── Expected deliveries ──────────────────────────────────────────────────────

def expected_deliveries(
    db: Session, warehouse_id: int, client_id: Optional[int] = None, category_id: Optional[int] = None,
) -> List[dict]:
    """Accessory lines of this warehouse's open (pending / partial) deliveries,
    and over-received lines of closed ones. Oldest expected date first."""
    lines = list(db.scalars(
        select(ExpectedDeliveryItem)
        .join(ExpectedDelivery, ExpectedDelivery.id == ExpectedDeliveryItem.delivery_id)
        .where(
            ExpectedDelivery.warehouse_id == warehouse_id,
            ExpectedDelivery.status != "cancelled",
            ExpectedDeliveryItem.accessory_item_id.is_not(None),
            *_item_filters(ExpectedDeliveryItem.accessory_item_id, client_id, category_id),
        )
        .options(selectinload(ExpectedDeliveryItem.delivery))
    ))
    attach_accessory_received(db, lines)
    lines = [l for l in lines if l.delivery.status in _OPEN_STATUSES or l.receive_state == "over"]
    items = _items(db, (l.accessory_item_id for l in lines))
    suppliers: Dict[tuple, Optional[str]] = {}
    out = []
    for line in lines:
        d = line.delivery
        key = (d.client_supplier_id, d.supplier_type)
        if key not in suppliers:
            suppliers[key] = resolve_supplier_name(db, *key)
        out.append({
            **item_info(items[line.accessory_item_id]),
            "delivery_id": d.id,
            "delivery_status": d.status,
            "expected_date": d.expected_date,
            "supplier_name": suppliers[key],
            "expected_qty": line.expected_qty,
            "received_qty": line.received_qty,
            "difference": line.received_qty - line.expected_qty,
            "state": line.receive_state,
        })
    out.sort(key=lambda r: (r["expected_date"] is None, r["expected_date"] or datetime.min, r["delivery_id"], r["item_code"]))
    return out
