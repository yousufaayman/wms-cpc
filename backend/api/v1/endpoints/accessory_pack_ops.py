"""Pack operations (item 21): the Pack Operations page's API.

- GET  /accessory-pack-ops/returns?warehouse_id=&job_order_id=  what is still out on a JO
- POST /accessory-pack-ops/returns                 trims back from production
- GET  /accessory-pack-ops/packs/{id}/free         on hand / held by open issues / free
- POST /accessory-pack-ops/packs/{id}/split        part of a pack into new packs
- POST /accessory-pack-ops/packs/{id}/merge        other packs emptied into this one
- POST /accessory-pack-ops/packs/{id}/reclassify   part of a pack becomes another item (admin)

Returns, split and merge need `issue_accessories` (W_Manager, W_Worker: Tab 1
"returns from the floor, split and merge packs"); reclassify is admin only.
Each action is one posting, so an admin can undo it with
`POST /accessory-postings/{id}/reverse`. The rules are in
`domains/accessories/pack_ops.py`. The router is off (404) while
FEATURE_ACCESSORIES is off (api.py).
"""
from typing import List

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from backend import models
from backend.core.authz import PERM_ISSUE_ACCESSORIES, ensure_admin
from backend.core.deps import get_db, require_permission
from backend.crud.accessory_packs import get_pack_or_404
from backend.domains.accessories import pack_ops
from backend.domains.accessories.issuing import pending_by_pack
from backend.domains.posting import accessory as accessory_posting
from backend.schemas import (
    AccessoryMergeIn,
    AccessoryMergeOut,
    AccessoryPackFree,
    AccessoryReclassifyIn,
    AccessoryReclassifyOut,
    AccessoryReturnableLine,
    AccessoryReturnIn,
    AccessoryReturnOut,
    AccessorySplitIn,
    AccessorySplitOut,
)

router = APIRouter()
_REQUIRE_ISSUE = Depends(require_permission(PERM_ISSUE_ACCESSORIES))


def _fresh(db: Session, *packs: models.AccessoryPack) -> None:
    for pack in packs:
        db.refresh(pack)


@router.get("/returns", response_model=List[AccessoryReturnableLine])
def returnable(
    warehouse_id: int = Query(...),
    job_order_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ISSUE,
):
    return [
        {
            "jo_requirement_id": line.requirement.id,
            "job_order_id": line.requirement.job_order_id,
            "accessory_item_id": line.requirement.accessory_item_id,
            "item_code": line.requirement.accessory_item.code,
            "item_description": line.requirement.accessory_item.description,
            "uom_code": line.requirement.accessory_item.base_uom.code,
            "issued": line.issued,
            "returned": line.returned,
            "out": line.out,
            "last_location_id": line.last_location_id,
            "locations": [{"id": loc.id, "name": loc.name} for loc, _ in line.issued_to],
        }
        for line in pack_ops.returnable_lines(db, warehouse_id, job_order_id)
    ]


@router.post("/returns", response_model=AccessoryReturnOut, status_code=status.HTTP_201_CREATED)
def return_trims(payload: AccessoryReturnIn, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_ISSUE):
    posting, pack, created = pack_ops.return_trims(db, current_user.id, payload)
    db.commit()
    _fresh(db, pack)
    return {"posting_id": posting.id, "pack": pack, "created": created}


@router.get("/packs/{pack_id}/free", response_model=AccessoryPackFree)
def pack_free(pack_id: int, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_ISSUE):
    pack = get_pack_or_404(db, pack_id)
    quantity = accessory_posting.pack_quantity(db, pack.id)
    held = pending_by_pack(db, [pack.id]).get(pack.id, 0)
    return {"pack_id": pack.id, "quantity": quantity, "held": held, "free": quantity - held}


@router.post("/packs/{pack_id}/split", response_model=AccessorySplitOut, status_code=status.HTTP_201_CREATED)
def split_pack(
    pack_id: int, payload: AccessorySplitIn, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_ISSUE,
):
    posting, packs = pack_ops.split(db, current_user.id, pack_id, payload)
    db.commit()
    source = get_pack_or_404(db, pack_id)
    _fresh(db, source, *packs)
    return {"posting_id": posting.id, "source": source, "packs": packs}


@router.post("/packs/{pack_id}/merge", response_model=AccessoryMergeOut, status_code=status.HTTP_201_CREATED)
def merge_packs(
    pack_id: int, payload: AccessoryMergeIn, db: Session = Depends(get_db), current_user: models.User = _REQUIRE_ISSUE,
):
    posting = pack_ops.merge(db, current_user.id, pack_id, payload.from_pack_ids)
    db.commit()
    pack = get_pack_or_404(db, pack_id)
    _fresh(db, pack)
    return {"posting_id": posting.id, "pack": pack}


@router.post("/packs/{pack_id}/reclassify", response_model=AccessoryReclassifyOut, status_code=status.HTTP_201_CREATED)
def reclassify_pack(
    pack_id: int, payload: AccessoryReclassifyIn, db: Session = Depends(get_db),
    current_user: models.User = _REQUIRE_ISSUE,
):
    """Admin only (admin holds every permission, so `_REQUIRE_ISSUE` lets it in too)."""
    ensure_admin(db, current_user)
    posting, new_pack = pack_ops.reclassify(db, current_user.id, pack_id, payload)
    db.commit()
    source = get_pack_or_404(db, pack_id)
    _fresh(db, source, new_pack)
    return {"posting_id": posting.id, "source": source, "pack": new_pack}
