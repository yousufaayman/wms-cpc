"""Accessory item codes: `[client code | GEN]-[category code]-[number]`.

Examples: `UR-ELS-0007` (elastic made for client UR), `GEN-THR-0031`
(generic thread). The number is counted per prefix + category in
`core.accessory_seq`, padded to 4 digits (it simply grows past 9999).

A code is permanent: it never changes and is never reused, even when its
item is switched off. Done in Python rather than a database trigger (D-8),
so Atlas sees everything.
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

GENERIC_PREFIX = "GEN"
SEQ_DIGITS = 4


class NoClientCode(ValueError):
    """The client has no client code, so no item code can be made for it."""


def prefix_for(client_code: str | None, *, generic: bool) -> str:
    """`GEN` for generic items, else the client code in upper case."""
    if generic:
        return GENERIC_PREFIX
    prefix = (client_code or "").strip().upper()
    if not prefix:
        raise NoClientCode("This client has no client code")
    if prefix == GENERIC_PREFIX:
        # Would look like a generic item.
        raise NoClientCode(f"Client code {GENERIC_PREFIX} is reserved for generic items")
    return prefix


def next_code(db: Session, prefix: str, category_id: int, category_code: str) -> str:
    """Take the next number for this prefix + category and return the new code.

    One upsert, run inside the caller's transaction: the row stays locked
    until that transaction ends, so two people saving at the same moment
    get different numbers. If the transaction rolls back, the number is
    handed out again, which is fine: it was never used.
    """
    seq = db.execute(
        text(
            """
            INSERT INTO core.accessory_seq (prefix, category_id, last_seq)
            VALUES (:prefix, :category_id, 1)
            ON CONFLICT (prefix, category_id)
            DO UPDATE SET last_seq = core.accessory_seq.last_seq + 1
            RETURNING last_seq
            """
        ),
        {"prefix": prefix, "category_id": category_id},
    ).scalar_one()
    return f"{prefix}-{category_code}-{seq:0{SEQ_DIGITS}d}"
