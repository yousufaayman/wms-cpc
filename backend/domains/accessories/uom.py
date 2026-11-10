"""Unit conversions: the one place a quantity changes unit.

Stock and the ledger always hold an item's **base unit** (PCS, M, CONE...).
People sometimes count in another unit (a carton of 10 dozen buttons), so the
receiving and issuing screens convert at the boundary with ``to_base``.

A conversion row says ``1 from_uom = factor × to_uom`` (1 DOZ = 12 PCS) and
works both ways: PCS → DOZ uses 1 / 12. Only direct pairs convert; there is
no chaining through a third unit, so every allowed pair is visible in the
Units & Categories page. An item can also have its own conversions (meters
per cone of one thread); those win over a global pair for that item.
"""
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

from sqlalchemy.orm import Session

from backend.models import UomConversion

# Ledger quantities are NUMERIC(14,4).
QTY_PLACES = Decimal("0.0001")


class NoConversion(ValueError):
    """No conversion exists between the two units."""


def find_factor(
    db: Session, from_uom_id: int, to_uom_id: int, item_id: Optional[int] = None
) -> Optional[Decimal]:
    """How many `to` units one `from` unit is, or None if the pair isn't defined.
    With `item_id`, that item's own conversion is used first, then a global one."""
    if from_uom_id == to_uom_id:
        return Decimal(1)
    if item_id is not None:
        factor = _factor_from(db, from_uom_id, to_uom_id, item_id)
        if factor is not None:
            return factor
    return _factor_from(db, from_uom_id, to_uom_id, None)


def _factor_from(db: Session, from_uom_id: int, to_uom_id: int, item_id: Optional[int]) -> Optional[Decimal]:
    """Look in one set of conversions: the global ones (item_id None) or one item's."""
    rows = (
        db.query(UomConversion)
        .filter(
            ((UomConversion.from_uom_id == from_uom_id) & (UomConversion.to_uom_id == to_uom_id))
            | ((UomConversion.from_uom_id == to_uom_id) & (UomConversion.to_uom_id == from_uom_id))
        )
        .filter(
            UomConversion.accessory_item_id.is_(None)
            if item_id is None
            else UomConversion.accessory_item_id == item_id
        )
        .all()
    )
    for row in rows:
        if row.from_uom_id == from_uom_id:
            return Decimal(row.factor)
    for row in rows:
        return Decimal(1) / Decimal(row.factor)
    return None


def convert(db: Session, qty, from_uom_id: int, to_uom_id: int, item_id: Optional[int] = None) -> Decimal:
    """`qty` in `from` units → `to` units, rounded to 4 places like the ledger.
    Raises NoConversion when the pair isn't defined."""
    factor = find_factor(db, from_uom_id, to_uom_id, item_id)
    if factor is None:
        raise NoConversion(f"No conversion from unit {from_uom_id} to unit {to_uom_id}")
    return (Decimal(str(qty)) * factor).quantize(QTY_PLACES, rounding=ROUND_HALF_UP)


# The name the receiving/issuing code reads best with.
def to_base(db: Session, qty, uom_id: int, base_uom_id: int, item_id: Optional[int] = None) -> Decimal:
    return convert(db, qty, uom_id, base_uom_id, item_id)
