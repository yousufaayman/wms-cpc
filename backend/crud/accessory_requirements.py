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
    return result, total


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
    return req


def requirement_entries(db: Session, requirement_id: int) -> List[models.AccessoryLedgerEntry]:
    """The ledger rows counted against a line (issues, returns and their
    reversals), oldest first."""
    get_requirement(db, requirement_id)
    return list(db.scalars(
        select(_Led).where(_Led.jo_requirement_id == requirement_id).order_by(_Led.id)
    ).all())
