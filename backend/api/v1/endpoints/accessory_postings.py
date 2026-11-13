"""Accessory postings (item 13): read one posting, and reverse it.

A posting is one action that changed accessory stock (a receive session, an
issue, a split...) with its ledger rows. Nothing here creates postings: the
screens of later items do that through `domains/posting/accessory.py`.

Reading needs any WMS role. Reversing is admin only (Tab 1: reversals are
admin). The router is off (404) while FEATURE_ACCESSORIES is off (see api.py).
"""
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend import models
from backend.core.authz import ensure_admin
from backend.core.deps import get_current_user, get_db
from backend.domains.posting import accessory as accessory_posting
from backend.schemas import AccessoryPosting, AccessoryReverseIn

router = APIRouter()


@router.get("/{posting_id}", response_model=AccessoryPosting)
def get_posting(posting_id: int, db: Session = Depends(get_db)):
    return accessory_posting.get_posting_or_404(db, posting_id)


@router.post("/{posting_id}/reverse", response_model=AccessoryPosting, status_code=status.HTTP_201_CREATED)
def reverse_posting(
    posting_id: int,
    payload: AccessoryReverseIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(get_current_user),
):
    """Cancel the whole posting with opposite rows. Returns the new (reversal) posting."""
    ensure_admin(db, current_user)
    reversal = accessory_posting.reverse_posting(db, current_user.id, posting_id, payload.reason)
    db.commit()
    db.refresh(reversal)
    return reversal
