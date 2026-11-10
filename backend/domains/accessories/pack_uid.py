"""Pack UIDs: the code that identifies every accessory pack.

A pack's UID is simply its primary key (``wms.accessory_packs.id``, item 12)
written in Base36 (0-9, A-Z), padded to at least 5 characters: pack 1 =
``00001``, pack 10 = ``0000A``, pack 1042 = ``000SY``. Five characters cover
60,466,175 packs; after that the UID simply gets a sixth character. Nothing
is stored: the UID is computed from the id, so it can't drift, and ids are
never reused.

Barcode on the label: the UID followed by the terminator ``*ACC``, e.g.
``000SY*ACC``. Same idea as the roll labels (``<roll id>*F`` dyed,
``<roll id>*K`` undyed): the ending says what was scanned, so a pack can never
be mistaken for a roll or a rack.

The frontend label builder (lib/zpl/accessoryPackLabelTemplates.ts, `packUid`)
does the same conversion; keep the two in step.
"""
import re

BARCODE_SUFFIX = "*ACC"
MIN_LENGTH = 5

_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_BARCODE_RE = re.compile(rf"^([0-9A-Z]{{{MIN_LENGTH},}}){re.escape(BARCODE_SUFFIX)}$")


def pack_uid(pack_id: int) -> str:
    """Pack id → UID: uppercase Base36, zero-padded to MIN_LENGTH."""
    if pack_id < 1:
        raise ValueError("pack ids start at 1")
    out = ""
    while pack_id:
        pack_id, rem = divmod(pack_id, 36)
        out = _DIGITS[rem] + out
    return out.rjust(MIN_LENGTH, "0")


def pack_barcode(pack_id: int) -> str:
    """Pack id → what the label's barcode encodes."""
    return pack_uid(pack_id) + BARCODE_SUFFIX


def parse_pack_barcode(scanned: str) -> int | None:
    """A scanned barcode → the pack id, or None if it isn't a pack barcode.

    Accepts lowercase and surrounding spaces (some scanners send them).
    """
    match = _BARCODE_RE.match(scanned.strip().upper())
    return int(match.group(1), 36) if match else None
