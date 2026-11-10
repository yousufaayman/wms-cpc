"""Pack UIDs: the code that identifies every accessory pack.

UID: the pack's number in Base36 (0-9, A-Z), padded to at least 5 characters,
e.g. ``00001``, ``0000A``, ``4F9K2``. Five characters hold 60,466,175 packs;
after that the UID simply gets a sixth character.

Barcode on the label: the UID followed by the terminator ``*ACC``, e.g.
``4F9K2*ACC``. Same idea as the roll labels (``12*F`` dyed, ``12*K`` undyed):
the ending says what was scanned, so a pack can never be mistaken for a roll
or a rack.

Numbers come from the row ``accessory_pack_uid`` in ``wms.counters`` (D-8),
bumped with one upsert, so two workers receiving at the same time can't get
the same number. The bump runs in the caller's transaction: call
``next_pack_uid`` inside the same transaction that saves the pack. If that
transaction rolls back, the number was never used anywhere and nothing is lost.
Once committed, a number is never handed out again.
"""
import re

from sqlalchemy import text
from sqlalchemy.orm import Session

BARCODE_SUFFIX = "*ACC"
MIN_LENGTH = 5
COUNTER_NAME = "accessory_pack_uid"

_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_BARCODE_RE = re.compile(rf"^([0-9A-Z]{{{MIN_LENGTH},}}){re.escape(BARCODE_SUFFIX)}$")


def format_pack_uid(number: int) -> str:
    """Pack number (1, 2, ...) → UID: uppercase Base36, zero-padded to MIN_LENGTH."""
    if number < 1:
        raise ValueError("pack numbers start at 1")
    out = ""
    while number:
        number, rem = divmod(number, 36)
        out = _DIGITS[rem] + out
    return out.rjust(MIN_LENGTH, "0")


def pack_barcode(uid: str) -> str:
    """UID → what the label's barcode encodes."""
    return uid + BARCODE_SUFFIX


def parse_pack_barcode(scanned: str) -> str | None:
    """A scanned barcode → the pack UID, or None if it isn't a pack barcode.

    Accepts lowercase and surrounding spaces (some scanners send them).
    """
    match = _BARCODE_RE.match(scanned.strip().upper())
    return match.group(1) if match else None


def next_pack_uid(db: Session) -> str:
    """Reserve the next pack number and return its UID. Does not commit."""
    number = db.execute(
        text(
            """
            INSERT INTO wms.counters (name, last_value) VALUES (:name, 1)
            ON CONFLICT (name) DO UPDATE SET last_value = wms.counters.last_value + 1
            RETURNING last_value
            """
        ),
        {"name": COUNTER_NAME},
    ).scalar_one()
    return format_pack_uid(number)
