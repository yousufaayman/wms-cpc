"""Posting service: every stock change caused by a receipt goes through here.

- service.py   the functions callers use (add_line, remove_line, post_confirm, reverse)
- registry.py  the adapter interface + which adapter serves which warehouse type
- fabric.py    Fabric's rules (roll in/out at scan time), unchanged from before
- accessory.py Accessory's adapter: a stub until the ledger exists (item 13)
"""
from . import accessory, fabric  # noqa: F401  (registers the adapters)
from .registry import PostingAdapter, adapter_for_line_kind, adapter_for_warehouse_type, register
from .service import add_line, post_confirm, remove_line, reverse

__all__ = [
    "PostingAdapter",
    "adapter_for_line_kind",
    "adapter_for_warehouse_type",
    "register",
    "add_line",
    "remove_line",
    "post_confirm",
    "reverse",
]
