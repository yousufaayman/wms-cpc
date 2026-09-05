import io
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from backend import models
from backend.core.deps import get_db, require_permission
from backend.core.authz import PERM_ANALYTICS
from backend.crud import analytics as crud_analytics
from backend.crud import analytics_export
from backend.schemas import AccountFlow, FlowAccount

router = APIRouter()
_REQUIRE_ANALYTICS = Depends(require_permission(PERM_ANALYTICS))

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_ISO_DAY_DESC = "Inclusive ISO day (YYYY-MM-DD)"
_LANG_DESC = "Workbook label language"
_LANG_PATTERN = "^(en|ar)$"


def _xlsx_response(data: bytes, filename: str) -> StreamingResponse:
    return StreamingResponse(
        io.BytesIO(data),
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}"},
    )


@router.get("/accounts", response_model=List[FlowAccount])
def get_flow_accounts(
    date_from: Optional[str] = Query(None, description=_ISO_DAY_DESC),
    date_to: Optional[str] = Query(None, description=_ISO_DAY_DESC),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    """Logical locations with roll activity (ingestion from them or receipt
    digestion to them) inside the optional date window."""
    return crud_analytics.get_flow_accounts(db, date_from=date_from, date_to=date_to)


@router.get("/account-flow", response_model=AccountFlow)
def get_account_flow(
    account_type: str = Query(..., description="'location', 'client', or 'external'"),
    account_id: Optional[int] = Query(None, description="Required for 'location'/'client'"),
    receiver: Optional[str] = Query(None, description="Required for 'external' — the receipt receiver name"),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    """All-time roll traffic for one account: a logical location (ingested
    from it + digested via supplier/internal receipts), a client, or an
    external-receipt receiver (both digested via external receipts)."""
    if account_type not in ("location", "client", "external"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="account_type must be 'location', 'client' or 'external'")
    if account_type in ("location", "client") and account_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="account_id is required for this account_type")
    if account_type == "external" and not receiver:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="receiver is required for external accounts")
    result = crud_analytics.get_account_flow(db, account_type, account_id=account_id, receiver=receiver)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")
    return result


@router.get("/roll-flow/export")
def export_roll_flow(
    date_from: Optional[str] = Query(None, description=_ISO_DAY_DESC),
    date_to: Optional[str] = Query(None, description=_ISO_DAY_DESC),
    lang: str = Query("en", pattern=_LANG_PATTERN, description=_LANG_DESC),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    """Excel workbook (Ingestion + Digestion sheets, dyed + undyed combined)
    for all roll traffic inside the given date window."""
    rows = crud_analytics.get_export_rows(db, date_from=date_from, date_to=date_to)
    data = analytics_export.build_roll_flow_workbook(rows["ingested"], rows["digested"], lang=lang)
    fname = f"roll-flow_{date_from or 'all'}_{date_to or 'all'}.xlsx"
    return _xlsx_response(data, fname)


@router.get("/account-flow/export")
def export_account_flow(
    account_type: str = Query(..., description="'location', 'client', or 'external'"),
    account_id: Optional[int] = Query(None, description="Required for 'location'/'client'"),
    receiver: Optional[str] = Query(None, description="Required for 'external' — the receipt receiver name"),
    date_from: Optional[str] = Query(None, description=_ISO_DAY_DESC),
    date_to: Optional[str] = Query(None, description=_ISO_DAY_DESC),
    lang: str = Query("en", pattern=_LANG_PATTERN, description=_LANG_DESC),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    """Excel workbook for one account: a sheet with separate Ingestion and
    Digestion tables, filtered to the given date window."""
    if account_type not in ("location", "client", "external"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="account_type must be 'location', 'client' or 'external'")
    if account_type in ("location", "client") and account_id is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="account_id is required for this account_type")
    if account_type == "external" and not receiver:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="receiver is required for external accounts")

    flow = crud_analytics.get_account_flow(db, account_type, account_id=account_id, receiver=receiver)
    if flow is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Account not found")

    ingested = crud_analytics.filter_rows_by_date(flow["ingested"], date_from, date_to)
    digested = crud_analytics.filter_rows_by_date(flow["digested"], date_from, date_to)
    data = analytics_export.build_single_account_workbook(flow["account_name"], ingested, digested, lang=lang)
    fname = f"account_{flow['account_name']}.xlsx"
    return _xlsx_response(data, fname)


@router.get("/accounts/export")
def export_all_accounts(
    date_from: Optional[str] = Query(None, description=_ISO_DAY_DESC),
    date_to: Optional[str] = Query(None, description=_ISO_DAY_DESC),
    lang: str = Query("en", pattern=_LANG_PATTERN, description=_LANG_DESC),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ANALYTICS,
):
    """Excel workbook with one sheet per account (with activity inside the
    given date window), each sheet holding separate Ingestion and
    Digestion tables."""
    accounts = crud_analytics.get_flow_accounts(db, date_from=date_from, date_to=date_to)
    payload = []
    for acc in accounts:
        flow = crud_analytics.get_account_flow(
            db,
            acc["account_type"],
            account_id=acc["id"] if acc["account_type"] != "external" else None,
            receiver=acc["name"] if acc["account_type"] == "external" else None,
        )
        if flow is None:
            continue
        payload.append({
            "name": flow["account_name"],
            "ingested": crud_analytics.filter_rows_by_date(flow["ingested"], date_from, date_to),
            "digested": crud_analytics.filter_rows_by_date(flow["digested"], date_from, date_to),
        })
    data = analytics_export.build_all_accounts_workbook(payload, lang=lang)
    fname = f"accounts_{date_from or 'all'}_{date_to or 'all'}.xlsx"
    return _xlsx_response(data, fname)
