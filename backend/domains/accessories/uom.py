"""Unit conversions: the one place a quantity changes unit.

Stock and the ledger always hold an item's **base unit** (PCS, M, CONE...).
People sometimes count in another unit (a carton of 10 dozen buttons), so the
receiving and issuing screens convert at the boundary with ``to_base``.

A conversion row says ``1 from_uom = factor × to_uom`` (1 DOZ = 12 PCS) and
works both ways: PCS → DOZ uses 1 / 12. Only direct pairs convert; there is
no chaining through a third unit, so every allowed pair is visible in the
Units & Categories page. Per-item conversions (meters per cone of a given
thread) are added with accessory items in item 8.
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy.orm import Session

from backend.models import UomConversion

# Ledger quantities are NUMERIC(14,4).
QTY_PLACES = Decimal("0.0001")


class NoConversion(ValueError):
    """No conversion exists between the two units."""


def find_factor(db: Session, from_uom_id: int, to_uom_id: int) -> Optional[Decimal]:
    """How many `to` units one `from` unit is, or None if the pair isn't defined."""
    if from_uom_id == to_uom_id:
        return Decimal(1)
    rows = (
        db.query(UomConversion)
        .filter(
            ((UomConversion.from_uom_id == from_uom_id) & (UomConversion.to_uom_id == to_uom_id))
            | ((UomConversion.from_uom_id == to_uom_id) & (UomConversion.to_uom_id == from_uom_id))
        )
        .all()
    )
    for row in rows:
        if row.from_uom_id == from_uom_id:
            return Decimal(row.factor)
    for row in rows:
        return Decimal(1) / Decimal(row.factor)
    return None


def convert(db: Session, qty, from_uom_id: int, to_uom_id: int) -> Decimal:
    """`qty` in `from` units → `to` units, rounded to 4 places like the ledger.
    Raises NoConversion when the pair isn't defined."""
    factor = find_factor(db, from_uom_id, to_uom_id)
    if factor is None:
        raise NoConversion(f"No conversion from unit {from_uom_id} to unit {to_uom_id}")
    return (Decimal(str(qty)) * factor).quantize(QTY_PLACES, rounding=ROUND_HALF_UP)


# The name the receiving/issuing code reads best with.
def to_base(db: Session, qty, uom_id: int, base_uom_id: int) -> Decimal:
    return convert(db, qty, uom_id, base_uom_id)
