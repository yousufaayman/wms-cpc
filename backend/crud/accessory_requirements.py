"""Accessory requirements of job orders (item 19): read only.

What this file is for, in plain words:
The planning system (POMS) writes `core.job_order_accessory_requirements`:
"job order X needs N of accessory item Y". WMS never creates, edits or
deletes those rows. This file reads them and adds what the warehouse did
against each line, from the accessory ledger rows that name it:

- issued   = everything taken out of packs for it (`issue` rows, minus their reversals)
- returned = everything brought back from production (`return` rows)
- used     = issued - returned
- remaining = needed - used (below 0 = over-issued)

Nothing of that is stored, so it is always right. All quantities are in the
item's base unit.

Item 20 adds:
- pending = on issue receipts not confirmed yet (not in issued / remaining)
- `requirement_job_orders`: the job orders with lines (issue: pick the JO)
- `shortages`: per item, what open job orders still need vs on hand

Item 24 adds `open_job_orders` (dashboard Job Order Balances widget).
"""
from decimal import Decimal
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from .. import models

STATUSES = ("not_started", "partly_issued", "fully_issued", "over_issued")

_Req = models.JobOrderAccessoryRequirement
_Led = models.AccessoryLedgerEntry


def _totals_subquery():
    """issued / returned per requirement line (positive numbers)."""
    return (
        select(
            _Led.jo_requirement_id.label("req_id"),
            func.coalesce(-func.sum(_Led.qty_delta).filter(_Led.entry_type == "issue"), 0).label("issued"),
            func.coalesce(func.sum(_Led.qty_delta).filter(_Led.entry_type == "return"), 0).label("returned"),
        )
        .where(_Led.jo_requirement_id.is_not(None))
        .group_by(_Led.jo_requirement_id)
        .subquery()
    )


def _status_expr(totals):
    issued = func.coalesce(totals.c.issued, 0)
    used = issued - func.coalesce(totals.c.returned, 0)
    return case(
        (issued == 0, "not_started"),
        (used < _Req.qty_needed, "partly_issued"),
        (used == _Req.qty_needed, "fully_issued"),
        else_="over_issued",
    )


def list_requirements(
    db: Session,
    *,
    job_order_id: Optional[int] = None,
    search: Optional[str] = None,
    status_filter: Optional[str] = None,
    limit: int = 200,
    offset: int = 0,
) -> Tuple[List[models.JobOrderAccessoryRequirement], int]:
    """Requirement lines, newest job order first, then item code. `search`
    matches the job order number or the item's code / description."""
    if status_filter is not None and status_filter not in STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"status must be one of {', '.join(STATUSES)}")
    totals = _totals_subquery()
    status_col = _status_expr(totals)
    query = (
        select(_Req, totals.c.issued, totals.c.returned)
        .join(models.JobOrder, models.JobOrder.job_order_id == _Req.job_order_id)
        .join(models.AccessoryItem, models.AccessoryItem.id == _Req.accessory_item_id)
        .outerjoin(totals, totals.c.req_id == _Req.id)
    )
    if job_order_id is not None:
        query = query.where(_Req.job_order_id == job_order_id)
    if search and search.strip():
        like = f"%{search.strip()}%"
        query = query.where(or_(
            models.JobOrder.job_order_number.ilike(like),
            models.AccessoryItem.code.ilike(like),
            models.AccessoryItem.description.ilike(like),
        ))
    if status_filter is not None:
        query = query.where(status_col == status_filter)

    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(
        query.order_by(_Req.job_order_id.desc(), models.AccessoryItem.code, _Req.id).limit(limit).offset(offset)
    ).all()
    result = []
    for req, issued, returned in rows:
        req.issued = Decimal(issued or 0)
        req.returned = Decimal(returned or 0)
        result.append(req)
    _fill_pending(db, result)
    return result, total


def _fill_pending(db: Session, reqs) -> None:
    from ..domains.accessories.issuing import pending_by_requirement  # issuing imports crud modules

    pending = pending_by_requirement(db, (r.id for r in reqs))
    for req in reqs:
        req.pending = pending.get(req.id, Decimal(0))


def get_requirement(db: Session, requirement_id: int) -> models.JobOrderAccessoryRequirement:
    req = db.get(_Req, requirement_id)
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Requirement not found")
    totals = db.execute(
        select(
            func.coalesce(-func.sum(_Led.qty_delta).filter(_Led.entry_type == "issue"), 0),
            func.coalesce(func.sum(_Led.qty_delta).filter(_Led.entry_type == "return"), 0),
        ).where(_Led.jo_requirement_id == requirement_id)
    ).one()
    req.issued, req.returned = Decimal(totals[0]), Decimal(totals[1])
    _fill_pending(db, [req])
    return req


def requirement_entries(db: Session, requirement_id: int) -> List[models.AccessoryLedgerEntry]:
    """The ledger rows counted against a line (issues, returns and their
    reversals), oldest first."""
    get_requirement(db, requirement_id)
    return list(db.scalars(
        select(_Led).where(_Led.jo_requirement_id == requirement_id).order_by(_Led.id)
    ).all())


def requirement_job_orders(db: Session, search: Optional[str] = None, limit: int = 50) -> List[dict]:
    """Job orders that have requirement lines, newest first (the issue page's
    JO picker: only those can be issued to)."""
    query = (
        select(models.JobOrder.job_order_id, models.JobOrder.job_order_number, models.Client.client_name,
               func.count(_Req.id).label("lines"))
        .join(_Req, _Req.job_order_id == models.JobOrder.job_order_id)
        .outerjoin(models.Client, models.Client.client_id == models.JobOrder.client_id)
        .group_by(models.JobOrder.job_order_id, models.JobOrder.job_order_number, models.Client.client_name)
    )
    if search and search.strip():
        query = query.where(models.JobOrder.job_order_number.ilike(f"%{search.strip()}%"))
    rows = db.execute(query.order_by(models.JobOrder.job_order_id.desc()).limit(limit)).all()
    return [dict(row._mapping) for row in rows]


def open_job_orders(db: Session, limit: int = 10) -> List[dict]:
    """Item 24: job orders not archived that still have lines to issue
    (not started or partly issued), most urgent first (priority, lowest
    number first, like the fabric Material Requests widget; then newest).
    Per JO: all its lines, the ones still to issue, the over-issued ones."""
    totals = _totals_subquery()
    state = _status_expr(totals)
    to_issue = func.count().filter(state.in_(("not_started", "partly_issued")))
    rows = db.execute(
        select(
            models.JobOrder.job_order_id, models.JobOrder.job_order_number, models.JobOrder.priority,
            models.Client.client_name,
            func.count(_Req.id).label("lines"),
            to_issue.label("lines_to_issue"),
            func.count().filter(state == "over_issued").label("lines_over_issued"),
        )
        .join(_Req, _Req.job_order_id == models.JobOrder.job_order_id)
        .outerjoin(totals, totals.c.req_id == _Req.id)
        .outerjoin(models.Client, models.Client.client_id == models.JobOrder.client_id)
        .where(models.JobOrder.archived_at.is_(None))
        .group_by(models.JobOrder.job_order_id, models.JobOrder.job_order_number, models.JobOrder.priority,
                  models.Client.client_name)
        .having(to_issue > 0)
        .order_by(models.JobOrder.priority.asc().nulls_last(), models.JobOrder.job_order_id.desc())
        .limit(limit)
    ).all()
    return [dict(row._mapping) for row in rows]


def shortages(db: Session, warehouse_id: int) -> List[dict]:
    """Per item: remaining across open job orders (not archived; an
    over-issued line counts 0, not minus) vs on hand in this warehouse.
    Only items that are short, most short first. No reservations: remaining
    is demand, not a hold on stock (Tab 1)."""
    totals = _totals_subquery()
    used = func.coalesce(totals.c.issued, 0) - func.coalesce(totals.c.returned, 0)
    left = func.greatest(_Req.qty_needed - used, 0)
    demand = (
        select(
            _Req.accessory_item_id.label("item_id"),
            func.sum(left).label("remaining"),
            func.count(func.distinct(_Req.job_order_id)).filter(left > 0).label("job_orders"),
        )
        .join(models.JobOrder, models.JobOrder.job_order_id == _Req.job_order_id)
        .outerjoin(totals, totals.c.req_id == _Req.id)
        .where(models.JobOrder.archived_at.is_(None))
        .group_by(_Req.accessory_item_id)
        .subquery()
    )
    stock = models.accessory_stock.c
    on_hand = (
        select(stock.accessory_item_id.label("item_id"), func.sum(stock.on_hand).label("on_hand"))
        .where(stock.warehouse_id == warehouse_id)
        .group_by(stock.accessory_item_id)
        .subquery()
    )
    have = func.coalesce(on_hand.c.on_hand, 0)
    short = demand.c.remaining - have
    rows = db.execute(
        select(models.AccessoryItem, demand.c.job_orders, demand.c.remaining, have.label("on_hand"), short.label("short"))
        .join(demand, demand.c.item_id == models.AccessoryItem.id)
        .outerjoin(on_hand, on_hand.c.item_id == models.AccessoryItem.id)
        .where(short > 0)
        .order_by(short.desc(), models.AccessoryItem.code)
    ).all()
    return [
        {
            "accessory_item_id": item.id, "item_code": item.code, "item_description": item.description,
            "uom_code": item.base_uom.code, "job_orders": job_orders, "remaining": Decimal(remaining),
            "on_hand": Decimal(on_hand_qty), "short": Decimal(short_qty),
        }
        for item, job_orders, remaining, on_hand_qty, short_qty in rows
    ]
