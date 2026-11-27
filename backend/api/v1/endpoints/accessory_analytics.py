"""Accessory Analytics (item 26): the report tabs of the Analytics page in an
Accessory warehouse, and their Excel export. Read-only.

- GET /analytics/accessories/flow                 per item: opening, in / out, closing
- GET /analytics/accessories/flow/{item}/entries  the ledger rows behind one item's flow
- GET /analytics/accessories/job-orders           issued / returned / net per JO and item
- GET /analytics/accessories/slow-moving          stock with no movement for N days
- GET /analytics/accessories/deliveries           expected vs received (open + over-received)
- GET /analytics/accessories/export               .xlsx with the chosen sheets (default: all)
- GET /analytics/accessories/suppliers            the Supplier filter's choices

`supplier=logical_location:12` (a supplier location) or `supplier=client:3`
(a client supplying its own trims) keeps only packs that supplier delivered
(flow, slow-moving, stock) or its deliveries. Job orders aren't filtered by it.

Same `analytics` permission as the fabric Analytics (Viewer included). Every
call names an Accessory warehouse that has the `analytics` module (400
otherwise); the router is off (404) while FEATURE_ACCESSORIES is off (api.py).
"""
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend import models
from backend.api.v1.endpoints.analytics import _LANG_PATTERN, _xlsx_response
from backend.core.authz import PERM_ANALYTICS
from backend.core.deps import get_db, require_permission
from backend.core.warehouse_modules import ACCESSORY, ensure_module
from backend.crud import accessory_analytics as crud
from backend.crud import accessory_analytics_export as export
from backend.schemas import (
    AccessoryDeliveryReportRow,
    AccessoryFlowEntry,
    AccessoryFlowRow,
    AccessoryJoIssues,
    AccessoryReportSupplier,
    AccessorySlowMovingRow,
)

router = APIRouter()
_REQUIRE_ANALYTICS = Depends(require_permission(PERM_ANALYTICS))

_WAREHOUSE = Query(..., description="The Accessory warehouse")
_FROM = Query(None, description="First day (local time), inclusive")
_TO = Query(None, description="Last day (local time), inclusive")
_CLIENT = Query(None, description="Only this client's items (flow, slow-moving, deliveries) or job orders")
_CATEGORY = Query(None)
_SUPPLIER = Query(None, pattern=r"^(client|logical_location):\d+$",
                  description="'logical_location:<id>' or 'client:<id>': only packs / deliveries of that supplier")
_DAYS = Query(crud.DEFAULT_IDLE_DAYS, ge=1, le=3650, description="No receipt, issue or return for this many days")


def _warehouse(db: Session, warehouse_id: int) -> models.Warehouse:
    wh = ensure_module(db, warehouse_id, "analytics")
    if getattr(wh.type, "value", wh.type) != ACCESSORY:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Accessory analytics are shown in Accessory warehouses")
    return wh


def _supplier(value: Optional[str]) -> Optional[crud.Supplier]:
    if not value:
        return None
    kind, _, ident = value.partition(":")
    return kind, int(ident)


def _check_range(date_from: Optional[date], date_to: Optional[date]) -> None:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "The start date is after the end date")


@router.get("/flow", response_model=List[AccessoryFlowRow])
def stock_flow(
    warehouse_id: int = _WAREHOUSE,
    date_from: Optional[date] = _FROM,
    date_to: Optional[date] = _TO,
    client_id: Optional[int] = _CLIENT,
    category_id: Optional[int] = _CATEGORY,
    supplier: Optional[str] = _SUPPLIER,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    _warehouse(db, warehouse_id)
    _check_range(date_from, date_to)
    return crud.stock_flow(db, warehouse_id, date_from, date_to, client_id=client_id, category_id=category_id,
                           supplier=_supplier(supplier))


@router.get("/flow/{item_id}/entries", response_model=List[AccessoryFlowEntry])
def flow_entries(
    item_id: int,
    warehouse_id: int = _WAREHOUSE,
    date_from: Optional[date] = _FROM,
    date_to: Optional[date] = _TO,
    supplier: Optional[str] = _SUPPLIER,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    _warehouse(db, warehouse_id)
    _check_range(date_from, date_to)
    return crud.item_entries(db, warehouse_id, item_id, date_from, date_to, supplier=_supplier(supplier))


@router.get("/job-orders", response_model=List[AccessoryJoIssues])
def job_orders(
    warehouse_id: int = _WAREHOUSE,
    date_from: Optional[date] = _FROM,
    date_to: Optional[date] = _TO,
    client_id: Optional[int] = _CLIENT,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    _warehouse(db, warehouse_id)
    _check_range(date_from, date_to)
    return crud.issued_to_jos(db, warehouse_id, date_from, date_to, client_id=client_id)


@router.get("/slow-moving", response_model=List[AccessorySlowMovingRow])
def slow_moving(
    warehouse_id: int = _WAREHOUSE,
    days: int = _DAYS,
    client_id: Optional[int] = _CLIENT,
    category_id: Optional[int] = _CATEGORY,
    supplier: Optional[str] = _SUPPLIER,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    _warehouse(db, warehouse_id)
    return crud.slow_moving(db, warehouse_id, days, client_id=client_id, category_id=category_id,
                            supplier=_supplier(supplier))


@router.get("/deliveries", response_model=List[AccessoryDeliveryReportRow])
def deliveries(
    warehouse_id: int = _WAREHOUSE,
    client_id: Optional[int] = _CLIENT,
    category_id: Optional[int] = _CATEGORY,
    supplier: Optional[str] = _SUPPLIER,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    _warehouse(db, warehouse_id)
    return crud.expected_deliveries(db, warehouse_id, client_id=client_id, category_id=category_id,
                                    supplier=_supplier(supplier))


@router.get("/suppliers", response_model=List[AccessoryReportSupplier])
def report_suppliers(
    warehouse_id: int = _WAREHOUSE,
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    """Who delivered packs here or has deliveries expected here, by name."""
    _warehouse(db, warehouse_id)
    return crud.suppliers(db, warehouse_id)


@router.get("/export")
def export_workbook(
    warehouse_id: int = _WAREHOUSE,
    sheets: Optional[List[str]] = Query(None, description=f"Any of {', '.join(export.SHEETS)}; default all"),
    date_from: Optional[date] = _FROM,
    date_to: Optional[date] = _TO,
    days: int = _DAYS,
    client_id: Optional[int] = _CLIENT,
    category_id: Optional[int] = _CATEGORY,
    supplier: Optional[str] = _SUPPLIER,
    lang: str = Query("en", pattern=_LANG_PATTERN),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    """The chosen report sheets with the same filters as the screen."""
    wh = _warehouse(db, warehouse_id)
    _check_range(date_from, date_to)
    chosen = [s for s in export.SHEETS if s in set(sheets)] if sheets else list(export.SHEETS)
    unknown = set(sheets or []) - set(export.SHEETS)
    if unknown or not chosen:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown sheet: {', '.join(sorted(unknown))}")

    pair = _supplier(supplier)
    filters = {"client_id": client_id, "category_id": category_id, "supplier": pair}
    loaders = {
        "stock": lambda: crud.stock_on_hand(db, warehouse_id, **filters),
        "flow": lambda: crud.stock_flow(db, warehouse_id, date_from, date_to, **filters),
        "jo_issues": lambda: crud.issued_to_jos(db, warehouse_id, date_from, date_to, client_id=client_id),
        "slow_moving": lambda: crud.slow_moving(db, warehouse_id, days, **filters),
        "deliveries": lambda: crud.expected_deliveries(db, warehouse_id, **filters),
    }
    data = {key: loaders[key]() for key in chosen}
    data["days"] = days
    supplier_name = crud.supplier_names(db, [pair]).get(pair) if pair else None
    content = export.build_workbook(chosen, data, warehouse_name=wh.name, date_from=date_from, date_to=date_to,
                                    supplier_name=supplier_name, lang=lang)
    name = chosen[0] if len(chosen) == 1 else "accessory-report"
    return _xlsx_response(content, f"{name}_{date_from or 'all'}_{date_to or 'all'}.xlsx")
