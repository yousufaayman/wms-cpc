"""Pack barcodes: what the label on every accessory pack encodes.

A pack is identified by its primary key (``wms.accessory_packs.id``, item 12),
and its barcode is that id followed by the terminator ``*ACC``: pack 1042 =
``1042*ACC``. Same rule as the roll labels (``<roll id>*F`` dyed,
``<roll id>*K`` undyed): the ending says what was scanned, so a pack can never
be mistaken for a roll or a rack. Nothing is stored; ids are never reused.

The frontend label builder (lib/zpl/accessoryPackLabelTemplates.ts,
`packBarcode`) builds the same text; a test keeps the suffix in step.
"""
import re

BARCODE_SUFFIX = "*ACC"

_BARCODE_RE = re.compile(rf"^([1-9][0-9]*){re.escape(BARCODE_SUFFIX)}$")


def pack_barcode(pack_id: int) -> str:
    """Pack id → what the label's barcode encodes."""
    if pack_id < 1:
        raise ValueError("pack ids start at 1")
    return f"{pack_id}{BARCODE_SUFFIX}"


def parse_pack_barcode(scanned: str) -> int | None:
    """A scanned barcode → the pack id, or None if it isn't a pack barcode.

    Accepts lowercase and surrounding spaces (some scanners send them).
    """
    match = _BARCODE_RE.match(scanned.strip().upper())
    return int(match.group(1)) if match else None
