"""Returnable tools (items 33–34): folders, presser feet, machine equipment.

Tools are never used up, so they don't go through packs and the ledger.
They are either **in** (in the warehouse) or **out** (with a worker), and the
number we own only goes up when tools are added and down when an admin
retires one (lost / broken).

Which items are tools: an item whose category is `tracked` (Units &
Categories). If the category is also `individual`, every **piece** gets its
own label (`wms.returnable_units` row, quantity always 1, optional serial
number). If not, a **tracked pack** holds several identical tools under one
label, with a quantity.

Every change is a row in `wms.returnable_movements` (never edited):
`added`, `out`, `in`, `retired`. The numbers are worked out from those rows:
  owned = added − retired      out = out − in      in = owned − out

This file is the only writer of tools and their movements. Item 33 = adding
tools (and undoing a mistaken Add during the same session); item 34 adds
check-out / check-in to a worker and retire.

Labels: the barcode is the tool's id + `*TL` (tool 57 = `57*TL`), like packs
(`*ACC`) and rolls (`*F` / `*K`), so a scan says what it is.

Nothing here commits; the endpoint commits once.
"""
import re
from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from backend import models
from backend.core.authz import user_has_admin_role
from backend.core.warehouse_modules import ensure_module
from backend.crud.accessory_analytics import supplier_names
from backend.crud.accessory_items import get_item_or_404
from backend.crud.accessory_packs import _check_supplier, _rack_in_warehouse
from backend.domains.accessories import uom
from backend.schemas import ReturnableAddIn

MODULE = "returnable_tools"
BARCODE_SUFFIX = "*TL"
_BARCODE_RE = re.compile(rf"^([1-9][0-9]*){re.escape(BARCODE_SUFFIX)}$")
MAX_PIECES = 500

_Unit = models.ReturnableUnit
_Move = models.ReturnableMovement


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


# ── Barcodes ────────────────────────────────────────────────────────────────

def tool_barcode(unit_id: int) -> str:
    if unit_id < 1:
        raise ValueError("tool ids start at 1")
    return f"{unit_id}{BARCODE_SUFFIX}"


def parse_tool_barcode(scanned: str) -> Optional[int]:
    """A scanned barcode → the tool id, or None if it isn't a tool label."""
    match = _BARCODE_RE.match(scanned.strip().upper())
    return int(match.group(1)) if match else None


# ── Quantities ──────────────────────────────────────────────────────────────

@dataclass
class Totals:
    added: Decimal = Decimal(0)
    retired: Decimal = Decimal(0)
    out_total: Decimal = Decimal(0)  # every `out` row
    in_total: Decimal = Decimal(0)   # every `in` row

    @property
    def owned(self) -> Decimal:
        return self.added - self.retired

    @property
    def out(self) -> Decimal:
        return self.out_total - self.in_total

    @property
    def in_stock(self) -> Decimal:
        return self.owned - self.out


def _sum(kind: str):
    return func.coalesce(func.sum(case((_Move.movement_type == kind, _Move.qty), else_=0)), 0)


_SUMS = (_sum("added"), _sum("retired"), _sum("out"), _sum("in"))


def unit_totals(db: Session, unit_ids: Iterable[int]) -> Dict[int, Totals]:
    """{tool id: Totals}; a tool with no rows gets zeros."""
    ids = list(set(unit_ids))
    out = {i: Totals() for i in ids}
    if ids:
        for unit_id, *sums in db.execute(
            select(_Move.unit_id, *_SUMS).where(_Move.unit_id.in_(ids)).group_by(_Move.unit_id)
        ):
            out[unit_id] = Totals(*(Decimal(s) for s in sums))
    return out


# ── Checks ──────────────────────────────────────────────────────────────────

def ensure_tool(item: models.AccessoryItem) -> None:
    """Only active, non-template items of a tracked category are tools."""
    if not item.is_tool:
        raise _bad(f"{item.code} is not a returnable tool")
    if item.is_template:
        raise _bad(f"{item.code} is a template: pick one of its variants")
    if not item.active:
        raise _bad(f"{item.code} is switched off")
    if item.parent_template is not None and not item.parent_template.active:
        raise _bad(f"The template {item.parent_template.code} is switched off")


def _whole(item: models.AccessoryItem, qty) -> Decimal:
    """A tool quantity: more than 0 and a whole number (tools are pieces)."""
    value = Decimal(str(qty)).quantize(uom.QTY_PLACES)
    if value <= 0:
        raise _bad("The quantity must be more than 0")
    if value != value.to_integral_value():
        raise _bad(f"{item.code} is counted in whole {item.base_uom.code}")
    return value


def get_unit_or_404(db: Session, unit_id: int) -> models.ReturnableUnit:
    unit = db.get(_Unit, unit_id)
    if unit is None:
        raise _bad("Tool not found", status.HTTP_404_NOT_FOUND)
    return unit


def find_by_barcode(db: Session, barcode: str) -> models.ReturnableUnit:
    unit_id = parse_tool_barcode(barcode)
    if unit_id is None:
        raise _bad("Not a tool label")
    return get_unit_or_404(db, unit_id)


# ── Add (item 33) ───────────────────────────────────────────────────────────

def _check_serials(db: Session, item: models.AccessoryItem, serials: List[Optional[str]]) -> List[Optional[str]]:
    """Blank = none. The same serial number can't be used twice on one item."""
    cleaned = [(s or "").strip() or None for s in serials]
    given = [s.upper() for s in cleaned if s is not None]
    if len(given) != len(set(given)):
        raise _bad("The same serial number is entered twice")
    if given:
        taken = db.scalar(
            select(_Unit.serial_no).where(
                _Unit.accessory_item_id == item.id, func.upper(_Unit.serial_no).in_(given)
            ).limit(1)
        )
        if taken is not None:
            raise _bad(f"{item.code} already has a piece with serial number {taken}")
    return cleaned


def add_tools(
    db: Session, actor_id: int, payload: ReturnableAddIn
) -> List[Tuple[models.ReturnableUnit, models.ReturnableMovement]]:
    """New tools: `count` pieces (individual items, one label each) or one new
    tracked pack holding `qty`. Each gets its `added` row."""
    ensure_module(db, payload.warehouse_id, MODULE)
    item = get_item_or_404(db, payload.accessory_item_id)
    ensure_tool(item)
    if payload.rack_id is not None:
        _rack_in_warehouse(db, payload.rack_id, payload.warehouse_id)
    _check_supplier(db, payload.supplier_type, payload.client_supplier_id)

    individual = item.is_individual_tool
    if individual:
        if payload.qty is not None:
            raise _bad("Pieces are added by count: one label per piece")
        if payload.count is None:
            raise _bad("How many pieces?")
        if len(payload.serial_nos) > payload.count:
            raise _bad("More serial numbers than pieces")
        serials = _check_serials(db, item, payload.serial_nos)
        serials += [None] * (payload.count - len(serials))
        rows = [(s, Decimal(1)) for s in serials]
    else:
        if payload.count is not None or payload.serial_nos:
            raise _bad(f"{item.code} is kept in packs: give the quantity of the new pack")
        if payload.qty is None:
            raise _bad("How many are in the pack?")
        rows = [(None, _whole(item, payload.qty))]

    out = []
    for serial, qty in rows:
        unit = _Unit(
            accessory_item_id=item.id,
            is_individual=individual,
            warehouse_id=payload.warehouse_id,
            rack_id=payload.rack_id,
            supplier_type=payload.supplier_type,
            client_supplier_id=payload.client_supplier_id,
            serial_no=serial,
            remarks=payload.remarks,
            created_by=actor_id,
        )
        db.add(unit)
        db.flush()
        move = _Move(unit_id=unit.id, movement_type="added", qty=qty, created_by=actor_id)
        db.add(move)
        out.append((unit, move))
    db.flush()
    return out


def top_up(db: Session, actor_id: int, unit_id: int, qty) -> models.ReturnableMovement:
    """More identical tools into an existing tracked pack (no new label)."""
    unit = get_unit_or_404(db, unit_id)
    ensure_module(db, unit.warehouse_id, MODULE)
    if unit.is_individual:
        raise _bad("A piece can't be topped up: add new pieces instead")
    ensure_tool(unit.item)
    move = _Move(unit_id=unit.id, movement_type="added", qty=_whole(unit.item, qty), created_by=actor_id)
    db.add(move)
    db.flush()
    return move


def undo_add(db: Session, user: models.User, movement_id: int) -> Optional[int]:
    """Cancel an Add made by mistake (the Add page's Undo, during that
    session). Allowed for the person who added it (or an admin) while nothing
    has happened to the tool since. A new tool disappears completely (the
    rows are deleted, so it never counts as retired); a top-up only loses that
    row. Returns the id of the deleted tool, or None if the tool stays."""
    move = db.get(_Move, movement_id)
    if move is None:
        raise _bad("Not found", status.HTTP_404_NOT_FOUND)
    if move.movement_type != "added":
        raise _bad("Only an Add can be undone")
    if move.created_by != user.id and not user_has_admin_role(db, user):
        raise _bad("Only the person who added these tools can undo it", status.HTTP_403_FORBIDDEN)
    later = db.scalar(
        select(_Move.id).where(_Move.unit_id == move.unit_id, _Move.id > move.id).limit(1)
    )
    if later is not None:
        raise _bad("This tool was used since, so the Add can't be undone")
    unit = move.unit
    is_first = db.scalar(
        select(_Move.id).where(_Move.unit_id == unit.id, _Move.id < move.id).limit(1)
    ) is None
    db.delete(move)
    db.flush()
    if is_first:
        db.delete(unit)
        db.flush()
        return unit.id
    return None


# ── Reads ───────────────────────────────────────────────────────────────────

def _item_search(q: Optional[str]):
    if not q or not q.strip():
        return []
    like = f"%{q.strip()}%"
    return [or_(models.AccessoryItem.code.ilike(like), models.AccessoryItem.description.ilike(like))]


def summary(db: Session, warehouse_id: int, q: Optional[str] = None) -> List[dict]:
    """One row per tool item that has tools in this warehouse: how many
    labels, owned / in / out / retired."""
    ensure_module(db, warehouse_id, MODULE)
    Item = models.AccessoryItem
    rows = db.execute(
        select(_Unit.accessory_item_id, func.count(func.distinct(_Unit.id)), *_SUMS)
        .join(_Move, _Move.unit_id == _Unit.id)
        .join(Item, Item.id == _Unit.accessory_item_id)
        .where(_Unit.warehouse_id == warehouse_id, *_item_search(q))
        .group_by(_Unit.accessory_item_id)
    ).all()
    items = {i.id: i for i in db.scalars(select(Item).where(Item.id.in_([r[0] for r in rows])))}
    out = []
    for item_id, labels, *sums in rows:
        t = Totals(*(Decimal(s) for s in sums))
        item = items[item_id]
        out.append({
            "accessory_item_id": item.id, "item_code": item.code, "item_description": item.description,
            "item_color": item.color, "item_size": item.size, "uom_code": item.base_uom.code,
            "is_individual": item.is_individual_tool, "labels": labels,
            "owned": t.owned, "in_stock": t.in_stock, "out": t.out, "retired": t.retired,
        })
    return sorted(out, key=lambda r: r["item_code"])


def unit_rows(db: Session, units: List[models.ReturnableUnit]) -> List[dict]:
    """Tools as the API shows them: the row + barcode, item, rack, supplier
    name and its numbers."""
    totals = unit_totals(db, [u.id for u in units])
    names = supplier_names(db, [(u.supplier_type, u.client_supplier_id) for u in units])
    rows = []
    for u in units:
        t = totals[u.id]
        rows.append({
            "id": u.id, "barcode": tool_barcode(u.id), "accessory_item_id": u.accessory_item_id,
            "item_code": u.item.code, "item_description": u.item.description,
            "item_color": u.item.color, "item_size": u.item.size, "uom_code": u.item.base_uom.code,
            "is_individual": u.is_individual, "warehouse_id": u.warehouse_id,
            "rack_id": u.rack_id, "rack_code": u.rack.rack_code if u.rack is not None else None,
            "supplier_type": u.supplier_type, "client_supplier_id": u.client_supplier_id,
            "supplier_name": names.get((u.supplier_type, u.client_supplier_id)),
            "serial_no": u.serial_no, "remarks": u.remarks,
            "created_by": u.created_by, "created_at": u.created_at,
            "owned": t.owned, "in_stock": t.in_stock, "out": t.out, "retired": t.retired,
        })
    return rows


def list_units(db: Session, warehouse_id: int, item_id: Optional[int] = None) -> List[dict]:
    ensure_module(db, warehouse_id, MODULE)
    query = select(_Unit).where(_Unit.warehouse_id == warehouse_id)
    if item_id is not None:
        query = query.where(_Unit.accessory_item_id == item_id)
    return unit_rows(db, list(db.scalars(query.order_by(_Unit.id))))
