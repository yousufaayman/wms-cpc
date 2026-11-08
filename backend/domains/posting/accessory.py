"""Accessory's stock rules: a placeholder until the ledger exists.

Accessory stock will live in wms.accessory_ledger (item 13), one row per
quantity change of a pack, and this adapter will be the only code that writes
it. Today the ledger, packs and items don't exist yet, so every hook below is
empty and accessory lines behave like before (stored, nothing posted).

Where each later item plugs in:
- validate_line  item 20: pack is active and has enough quantity; the item
                 matches the JO's client; the line names a JO requirement
- post_confirm   item 13/20: one `issue` ledger row per line, base UOM
- reverse        item 13: linked opposite rows for a confirmed receipt
- receiving      item 17: there is no receipt (D-1), so packs are received
                 through a separate `posting.post_receive(...)`, not here
"""
from ...core.warehouse_modules import ACCESSORY
from .registry import PostingAdapter, register


class AccessoryAdapter(PostingAdapter):
    """Accepts accessory lines and posts nothing (yet)."""


register(ACCESSORY, AccessoryAdapter())
