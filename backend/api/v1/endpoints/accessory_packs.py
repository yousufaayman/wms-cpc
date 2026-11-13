"""Accessory packs (item 12): look packs up and move them between racks.
`GET /stock` (item 14) = the Accessory Inventory roll-ups by item, client or rack.

Reading needs any WMS role; moving needs `receive_accessories` (W_Manager,
W_Worker: "receive packs, labels, move packs" in authz.py). The router is off
(404) while FEATURE_ACCESSORIES is off (see api.py).

Packs are only made together with their first ledger row: `POST /receive`
(Receive Packs, item 17; rules in `domains/accessories/receiving.py`) and,
later, the opening balance (item 25). `POST /receive/{posting_id}/undo`
cancels one Add and `POST /receive/pack/{pack_id}/undo` one pack of it (its
receiver or an admin, while the packs are unused).
"""
from typing import Annotated, List

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from backend import models
from backend.core.authz import PERM_RECEIVE_ACCESSORIES
from backend.core.deps import get_db, require_permission
from backend.crud import accessory_packs as crud
from backend.domains.accessories import receiving
from backend.domains.posting import accessory as accessory_posting
from backend.schemas import (
    AccessoryLedgerEntry,
    AccessoryPack,
    AccessoryPackMove,
    AccessoryPackMoveIn,
    AccessoryPackPage,
    AccessoryPackSearch,
    AccessoryPosting,
    AccessoryReceiveIn,
    AccessoryReceiveOut,
    AccessoryStockPage,
    AccessoryStockSearch,
)

router = APIRouter()


@router.get("/", response_model=AccessoryPackPage)
def list_packs(search: Annotated[AccessoryPackSearch, Query()], db: Session = Depends(get_db)):
    """Newest first. `?warehouse_id=3&unracked=true` = packs waiting for put-away."""
    packs, total = crud.list_packs(db, search)
    return {"items": packs, "total": total}


@router.get("/stock", response_model=AccessoryStockPage)
def stock_summary(search: Annotated[AccessoryStockSearch, Query()], db: Session = Depends(get_db)):
    """On hand grouped by item, client or rack (`?group_by=`), from the
    `wms.accessory_stock` view. Totals are per unit; empty packs are left out
    unless `include_empty=true`."""
    rows, total = crud.stock_summary(db, search)
    return {"items": rows, "total": total}


@router.post("/receive", response_model=AccessoryReceiveOut, status_code=status.HTTP_201_CREATED)
def receive_packs(
    payload: AccessoryReceiveIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_RECEIVE_ACCESSORIES)),
):
    """Make `pack_count` packs of the item, each with its `receipt` row, and
    link each to a delivery line (picked, or matched). Returns the packs,
    newest last, each with `delivery_id` / `batch_no` (null = no delivery)."""
    posting, packs = receiving.receive_packs(db, current_user.id, payload)
    db.commit()
    for pack in packs:
        db.refresh(pack)
    return {"posting_id": posting.id, "packs": packs}


@router.post("/receive/{posting_id}/undo", response_model=AccessoryPosting, status_code=status.HTTP_201_CREATED)
def undo_receive(
    posting_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_RECEIVE_ACCESSORIES)),
):
    """Cancel one Add: its packs go back to 0. Returns the reversal posting."""
    reversal = receiving.undo_receive(db, current_user, posting_id)
    db.commit()
    db.refresh(reversal)
    return reversal


@router.post("/receive/pack/{pack_id}/undo", response_model=AccessoryPosting, status_code=status.HTTP_201_CREATED)
def undo_receive_pack(
    pack_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_RECEIVE_ACCESSORIES)),
):
    """Cancel one received pack (Receive Packs' per-row Undo): it goes back to
    0 and off its delivery line. Returns the reversal posting."""
    reversal = receiving.undo_receive_pack(db, current_user, pack_id)
    db.commit()
    db.refresh(reversal)
    return reversal


@router.get("/scan", response_model=AccessoryPack)
def scan_pack(barcode: str, db: Session = Depends(get_db)):
    """The pack behind a scanned label, e.g. `?barcode=1042*ACC`."""
    return crud.find_by_barcode(db, barcode)


@router.get("/{pack_id}", response_model=AccessoryPack)
def get_pack(pack_id: int, db: Session = Depends(get_db)):
    return crud.get_pack_or_404(db, pack_id)


@router.get("/{pack_id}/moves", response_model=List[AccessoryPackMove])
def list_moves(pack_id: int, db: Session = Depends(get_db)):
    """Rack history, oldest first."""
    return crud.list_moves(db, pack_id)


@router.get("/{pack_id}/ledger", response_model=List[AccessoryLedgerEntry])
def pack_ledger(pack_id: int, db: Session = Depends(get_db)):
    """Quantity history, oldest first; `balance` = what the pack held after each row."""
    crud.get_pack_or_404(db, pack_id)
    return accessory_posting.pack_history(db, pack_id)


@router.post("/{pack_id}/move", response_model=AccessoryPackMove)
def move_pack(
    pack_id: int,
    payload: AccessoryPackMoveIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_permission(PERM_RECEIVE_ACCESSORIES)),
):
    """Put the pack on `rack_id`, or take it off its rack with `rack_id: null`."""
    pack = crud.get_pack_or_404(db, pack_id)
    return crud.move_pack(db, pack, payload.rack_id, current_user.id)
