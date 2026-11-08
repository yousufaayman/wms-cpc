"""The adapter interface and the list of adapters, one per warehouse type.

An *adapter* holds the stock rules of one warehouse type: what a receipt line
must satisfy, and what happens to stock when a line is added or removed or the
receipt is confirmed. The posting service (service.py) looks up the right
adapter and calls it; nothing else should change stock.

A warehouse type with no adapter registered gets `PostingAdapter` itself, which
accepts every line and changes nothing (RMG today).

Adapters never commit. The service commits once, so a failure anywhere leaves
nothing half-done.
"""
from typing import Any, Dict

from sqlalchemy.orm import Session

from ...core.warehouse_modules import RECEIPT_LINE_KIND


class PostingAdapter:
    """Default adapter: no checks, no stock effects. Subclass and override."""

    def validate_line(self, db: Session, receipt_kind: str, receipt_id: int, line_in: Any) -> None:
        """Before a line is added. Raise ValueError to refuse it (→ HTTP 400)."""

    def on_line_added(self, db: Session, line: Any) -> None:
        """After the line row is added (not yet committed). Fabric issues the roll here."""

    def on_line_removed(self, db: Session, line: Any) -> None:
        """Before the line row is deleted. Undo whatever on_line_added did."""

    def post_confirm(self, db: Session, receipt_kind: str, receipt: Any, actor_id: int) -> None:
        """When the receipt is confirmed. Accessories will write ledger rows here (item 13/18)."""

    def reverse(self, db: Session, receipt_kind: str, receipt: Any, actor_id: int, reason: str) -> None:
        """Undo a confirmed receipt with linked opposite entries (item 13)."""
        raise NotImplementedError("Reversal is not available for this warehouse type yet")


_DEFAULT = PostingAdapter()
_ADAPTERS: Dict[str, PostingAdapter] = {}

# "fabric" -> "Fabric", "accessory" -> "Accessory", "box" -> "RMG"
_WAREHOUSE_TYPE_OF_LINE = {line: wtype for wtype, line in RECEIPT_LINE_KIND.items()}


def register(warehouse_type: str, adapter: PostingAdapter) -> None:
    _ADAPTERS[warehouse_type] = adapter


def adapter_for_warehouse_type(warehouse_type: str) -> PostingAdapter:
    return _ADAPTERS.get(warehouse_type, _DEFAULT)


def adapter_for_line_kind(line_kind: str) -> PostingAdapter:
    """Lines are dispatched by their table (fabric/box/accessory), not by a DB
    lookup, so removing an old line always runs its own type's undo."""
    return adapter_for_warehouse_type(_WAREHOUSE_TYPE_OF_LINE[line_kind])
