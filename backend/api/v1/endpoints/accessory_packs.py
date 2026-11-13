"""Accessory packs (item 12): look packs up and move them between racks.

Reading needs any WMS role; moving needs `receive_accessories` (W_Manager,
W_Worker: "receive packs, labels, move packs" in authz.py). The router is off
(404) while FEATURE_ACCESSORIES is off (see api.py).

There's no endpoint that creates a pack: a pack is made together with its
first ledger row by Receive Packs (item 17) or the opening balance (item 25),
through `crud.accessory_packs.create_pack`.
"""
from typing import Annotated, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend import models
from backend.core.authz import PERM_RECEIVE_ACCESSORIES
from backend.core.deps import get_db, require_permission
from backend.crud import accessory_packs as crud
from backend.domains.posting import accessory as accessory_posting
from backend.schemas import (
    AccessoryLedgerEntry,
    AccessoryPack,
    AccessoryPackMove,
    AccessoryPackMoveIn,
    AccessoryPackPage,
    AccessoryPackSearch,
)

router = APIRouter()


@router.get("/", response_model=AccessoryPackPage)
def list_packs(search: Annotated[AccessoryPackSearch, Query()], db: Session = Depends(get_db)):
    """Newest first. `?warehouse_id=3&unracked=true` = packs waiting for put-away."""
    packs, total = crud.list_packs(db, search)
    return {"items": packs, "total": total}


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
