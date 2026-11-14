from decimal import Decimal

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy.sql import func
from typing import Iterable, List, Optional

from backend.crud.accessory_items import ensure_stockable, get_item_or_404
from backend.domains.accessories import uom
from backend.models import (
    AccessoryLedgerEntry,
    AccessoryPack,
    Client,
    DyedFabricRoll,
    ExpectedDelivery,
    ExpectedDeliveryItem,
    LogicalLocation,
    UndyedFabricRoll,
    User,
)
from backend.schemas import (
    ExpectedDeliveryCreate,
    ExpectedDeliveryUpdate,
    ExpectedDeliveryItemCreate,
    ExpectedDeliveryItemUpdate,
)

SUPPLIER_TYPE_CLIENT = "client"
SUPPLIER_TYPE_LOCATION = "logical_location"

_OPEN_STATUSES = ("pending", "partial")


# ── Polymorphic supplier reference helpers ───────────────────────────────────
# client_supplier_id points at core.clients or wms.logical_locations depending
# on supplier_type. The DB cannot enforce this with a real FK, so every write
# path must call validate_supplier_ref, and reads resolve the display name.

def resolve_supplier_name(
    db: Session,
    client_supplier_id: Optional[int],
    supplier_type: Optional[str],
) -> Optional[str]:
    if client_supplier_id is None or supplier_type is None:
        return None
    if supplier_type == SUPPLIER_TYPE_CLIENT:
        row = db.query(Client.client_name).filter(Client.client_id == client_supplier_id).first()
    elif supplier_type == SUPPLIER_TYPE_LOCATION:
        row = db.query(LogicalLocation.name).filter(LogicalLocation.id == client_supplier_id).first()
    else:
        row = None
    return row[0] if row else None


def validate_supplier_ref(
    db: Session,
    client_supplier_id: Optional[int],
    supplier_type: Optional[str],
) -> None:
    """Raise ValueError unless the supplier pair is consistent and resolvable."""
    if (client_supplier_id is None) != (supplier_type is None):
        raise ValueError("client_supplier_id and supplier_type must both be set or both be null")
    if client_supplier_id is None:
        return
    if supplier_type not in (SUPPLIER_TYPE_CLIENT, SUPPLIER_TYPE_LOCATION):
        raise ValueError("supplier_type must be 'client' or 'logical_location'")
    if resolve_supplier_name(db, client_supplier_id, supplier_type) is None:
        raise ValueError(f"No {supplier_type} exists with id {client_supplier_id}")


def _attach_supplier_names(db: Session, deliveries: Iterable[ExpectedDelivery]) -> None:
    """Set the transient supplier_name attribute on each delivery (one query per table)."""
    deliveries = [d for d in deliveries if d is not None]
    client_ids = {d.client_supplier_id for d in deliveries if d.supplier_type == SUPPLIER_TYPE_CLIENT}
    location_ids = {d.client_supplier_id for d in deliveries if d.supplier_type == SUPPLIER_TYPE_LOCATION}
    client_names = (
        dict(db.query(Client.client_id, Client.client_name).filter(Client.client_id.in_(client_ids)).all())
        if client_ids else {}
    )
    location_names = (
        dict(db.query(LogicalLocation.id, LogicalLocation.name).filter(LogicalLocation.id.in_(location_ids)).all())
        if location_ids else {}
    )
    for d in deliveries:
        if d.supplier_type == SUPPLIER_TYPE_CLIENT:
            d.supplier_name = client_names.get(d.client_supplier_id)
        elif d.supplier_type == SUPPLIER_TYPE_LOCATION:
            d.supplier_name = location_names.get(d.client_supplier_id)
        else:
            d.supplier_name = None


# ── Delivery header CRUD ─────────────────────────────────────────────────────

def _load_delivery(db: Session, delivery_id: int) -> Optional[ExpectedDelivery]:
    # selectinload avoids the cartesian product that two separate joinedload
    # chains on the same collection would produce.
    delivery = (
        db.query(ExpectedDelivery)
        .options(
            selectinload(ExpectedDelivery.items).options(
                joinedload(ExpectedDeliveryItem.material),
                joinedload(ExpectedDeliveryItem.client),
                joinedload(ExpectedDeliveryItem.client_fabric_code),
                joinedload(ExpectedDeliveryItem.accessory_item),
            )
        )
        .filter(ExpectedDelivery.id == delivery_id)
        .first()
    )
    if delivery:
        _attach_supplier_names(db, [delivery])
        attach_accessory_received(db, delivery.items)
        attach_delivery_flags([delivery])
    return delivery


def get_expected_delivery(db: Session, delivery_id: int) -> Optional[ExpectedDelivery]:
    return _load_delivery(db, delivery_id)


def get_expected_deliveries(
    db: Session,
    skip: int = 0,
    limit: int = 100,
    warehouse_id: Optional[int] = None,
    status: Optional[str] = None,
    open_only: bool = False,
    flag: Optional[str] = None,
) -> List[ExpectedDelivery]:
    q = db.query(ExpectedDelivery)
    if warehouse_id is not None:
        q = q.filter(ExpectedDelivery.warehouse_id == warehouse_id)
    if status is not None:
        q = q.filter(ExpectedDelivery.status == status)
    if open_only:
        q = q.filter(ExpectedDelivery.status.in_(_OPEN_STATUSES))
    # Item 18 report filters (accessory lines): over-received anywhere, or
    # received (closed) with a line still short.
    if flag == "over_received":
        q = q.filter(ExpectedDelivery.id.in_(_accessory_lines_where(lambda qty: qty > ExpectedDeliveryItem.expected_qty)))
    elif flag == "closed_short":
        q = q.filter(
            ExpectedDelivery.status == "received",
            ExpectedDelivery.id.in_(_accessory_lines_where(lambda qty: qty < ExpectedDeliveryItem.expected_qty)),
        )
    deliveries = q.order_by(ExpectedDelivery.id.desc()).offset(skip).limit(limit).all()
    _attach_supplier_names(db, deliveries)
    attach_accessory_received(db, [i for d in deliveries for i in d.items])
    attach_delivery_flags(deliveries)
    return deliveries


def create_expected_delivery(
    db: Session,
    delivery: ExpectedDeliveryCreate,
    created_by: Optional[int] = None,
) -> ExpectedDelivery:
    validate_supplier_ref(db, delivery.client_supplier_id, delivery.supplier_type)
    db_delivery = ExpectedDelivery(
        **delivery.model_dump(),
        created_by=created_by,
        status="pending",
    )
    db.add(db_delivery)
    db.commit()
    db.refresh(db_delivery)
    return _load_delivery(db, db_delivery.id)


def update_expected_delivery(
    db: Session,
    delivery_id: int,
    delivery: ExpectedDeliveryUpdate,
    actor_id: Optional[int] = None,
) -> Optional[ExpectedDelivery]:
    db_delivery = db.query(ExpectedDelivery).filter(ExpectedDelivery.id == delivery_id).first()
    if not db_delivery:
        return None
    updates = delivery.model_dump(exclude_unset=True)
    if "client_supplier_id" in updates or "supplier_type" in updates:
        validate_supplier_ref(
            db,
            updates.get("client_supplier_id", db_delivery.client_supplier_id),
            updates.get("supplier_type", db_delivery.supplier_type),
        )
    if "status" in updates:
        if updates["status"] in ("received", "cancelled"):
            db_delivery.closed_at = func.current_timestamp()
            db_delivery.closed_by = actor_id
        else:
            # Reopening — the delivery becomes live again for roll matching.
            # Item 18: from a closed state, the status follows what arrived
            # (partial / pending) whatever was asked.
            if db_delivery.status not in _OPEN_STATUSES:
                updates["status"] = _reopened_status(db, db_delivery)
            db_delivery.closed_at = None
            db_delivery.closed_by = None
    for field, value in updates.items():
        setattr(db_delivery, field, value)
    db.commit()
    return _load_delivery(db, delivery_id)


def delete_expected_delivery(db: Session, delivery_id: int) -> bool:
    db_delivery = db.query(ExpectedDelivery).filter(ExpectedDelivery.id == delivery_id).first()
    if not db_delivery:
        return False
    db.delete(db_delivery)
    db.commit()
    return True


# ── Item sub-resource CRUD ───────────────────────────────────────────────────

def _load_item(db: Session, item_id: int) -> Optional[ExpectedDeliveryItem]:
    line = (
        db.query(ExpectedDeliveryItem)
        .options(
            joinedload(ExpectedDeliveryItem.material),
            joinedload(ExpectedDeliveryItem.client),
            joinedload(ExpectedDeliveryItem.client_fabric_code),
            joinedload(ExpectedDeliveryItem.accessory_item),
        )
        .filter(ExpectedDeliveryItem.id == item_id)
        .first()
    )
    if line is not None:
        attach_accessory_received(db, [line])
    return line


ACCESSORY_LINE_HAS_PACKS = "Packs were already received on this line, so it can't be deleted or change item"


def _accessory_qty_in_base(db: Session, accessory_item_id: int, qty, uom_id: Optional[int]) -> Decimal:
    """Check the item can be stocked and turn `qty` (typed in `uom_id`, default
    the base unit) into the item's base unit. ValueError on a bad unit."""
    acc_item = get_item_or_404(db, accessory_item_id)
    ensure_stockable(acc_item)
    if uom_id is None or uom_id == acc_item.base_uom_id:
        return Decimal(str(qty)).quantize(uom.QTY_PLACES)
    try:
        base_qty = uom.to_base(db, qty, uom_id, acc_item.base_uom_id, acc_item.id)
    except uom.NoConversion:
        raise ValueError(f"{acc_item.code}: no conversion from that unit to its base unit {acc_item.base_uom.code}")
    if base_qty <= 0:
        raise ValueError("The quantity is too small for the base unit")
    return base_qty


def _line_has_packs(db: Session, line_id: int) -> bool:
    return db.query(AccessoryPack.id).filter(AccessoryPack.expected_delivery_item_id == line_id).first() is not None


def add_delivery_item(
    db: Session,
    delivery_id: int,
    item: ExpectedDeliveryItemCreate,
) -> ExpectedDeliveryItem:
    data = item.model_dump(exclude={"uom_id"})
    if item.accessory_item_id is not None:
        data["expected_qty"] = _accessory_qty_in_base(db, item.accessory_item_id, item.expected_qty, item.uom_id)
    db_item = ExpectedDeliveryItem(
        **data,
        delivery_id=delivery_id,
        received_weight_kg=0,
        received_length_m=0,
    )
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return _load_item(db, db_item.id)


def update_delivery_item(
    db: Session,
    item_id: int,
    item: ExpectedDeliveryItemUpdate,
) -> Optional[ExpectedDeliveryItem]:
    db_item = db.query(ExpectedDeliveryItem).filter(ExpectedDeliveryItem.id == item_id).first()
    if not db_item:
        return None
    updates = item.model_dump(exclude_unset=True)
    uom_id = updates.pop("uom_id", None)
    if db_item.accessory_item_id is not None:
        updates = _accessory_line_updates(db, db_item, updates, uom_id)
    elif any(updates.get(f) is not None for f in ("accessory_item_id", "expected_qty")) or uom_id is not None:
        raise ValueError("A fabric line can't take accessory fields")
    for field, value in updates.items():
        setattr(db_item, field, value)
    db.flush()
    # Changing expected quantities can complete (or reopen) the delivery.
    _recompute_delivery_status(db, db_item.delivery_id)
    db.commit()
    return _load_item(db, item_id)


_FABRIC_FIELDS = ("client_fabric_code_id", "client_id", "material_id", "expected_weight_kg", "expected_length_m")


def _accessory_line_updates(db: Session, line: ExpectedDeliveryItem, updates: dict, uom_id: Optional[int]) -> dict:
    """Check an edit of an accessory line: it stays an accessory line, its item
    can't change once packs were received on it, and a new quantity is saved
    in the item's base unit."""
    if any(updates.get(f) is not None for f in _FABRIC_FIELDS):
        raise ValueError("An accessory line can't take fabric fields")
    new_item_id = updates.get("accessory_item_id") or line.accessory_item_id
    item_changes = new_item_id != line.accessory_item_id
    if item_changes and _line_has_packs(db, line.id):
        raise ValueError(ACCESSORY_LINE_HAS_PACKS)
    updates.pop("accessory_item_id", None)
    if updates.get("expected_qty") is None:
        updates.pop("expected_qty", None)  # an accessory line always keeps a quantity
    if item_changes or "expected_qty" in updates:
        if "expected_qty" in updates:
            qty, unit = updates["expected_qty"], uom_id
        else:
            qty, unit = line.expected_qty, None  # the stored quantity is already in base units
        updates["accessory_item_id"] = new_item_id
        updates["expected_qty"] = _accessory_qty_in_base(db, new_item_id, qty, unit)
    return updates


def delete_delivery_item(db: Session, item_id: int) -> bool:
    db_item = db.query(ExpectedDeliveryItem).filter(ExpectedDeliveryItem.id == item_id).first()
    if not db_item:
        return False
    # Fabric unlinks its rolls (FK SET NULL); accessory packs keep their line.
    if db_item.accessory_item_id is not None and _line_has_packs(db, db_item.id):
        raise ValueError(ACCESSORY_LINE_HAS_PACKS)
    db.delete(db_item)
    db.commit()
    return True


# ── Auto-fulfillment on roll ingestion ───────────────────────────────────────

def find_matching_expected_delivery_item(
    db: Session,
    *,
    client_fabric_code_id: Optional[int] = None,
    client_id: Optional[int] = None,
    material_id: Optional[int] = None,
) -> Optional[ExpectedDeliveryItem]:
    """Return the oldest open, not-yet-fully-received item matching a roll.

    Dyed rolls pass client_fabric_code_id; undyed rolls pass client_id +
    material_id. Items whose expected_weight_kg is null are treated as
    always open.
    """
    q = (
        db.query(ExpectedDeliveryItem)
        .join(ExpectedDelivery, ExpectedDeliveryItem.delivery_id == ExpectedDelivery.id)
        .filter(ExpectedDelivery.status.in_(_OPEN_STATUSES))
    )
    if client_fabric_code_id is not None:
        q = q.filter(ExpectedDeliveryItem.client_fabric_code_id == client_fabric_code_id)
    else:
        q = q.filter(
            ExpectedDeliveryItem.client_id == client_id,
            ExpectedDeliveryItem.material_id == material_id,
        )
    q = q.filter(
        or_(
            ExpectedDeliveryItem.expected_weight_kg.is_(None),
            ExpectedDeliveryItem.received_weight_kg < ExpectedDeliveryItem.expected_weight_kg,
        )
    )
    return q.order_by(
        ExpectedDelivery.expected_date.asc().nulls_last(),
        ExpectedDelivery.created_at.asc(),
    ).first()


# ── Roll ledger ──────────────────────────────────────────────────────────────
# The single source of truth for received quantities is the set of rolls whose
# expected_delivery_item_id points at an item. Each roll carries exactly one
# such FK, so a roll can never feed two deliveries at once, and moving or
# deleting a roll automatically reverses its contribution on the next sync.
# received_weight_kg / received_length_m are derived caches — recomputed from
# the ledger here, never incremented.

_TWO_PLACES = Decimal("0.01")


def _sum_linked_rolls(db: Session, item_ids: List[int]) -> dict:
    """Sum weight/length of every roll (dyed + undyed) linked to each item."""
    sums: dict = {}
    for model in (DyedFabricRoll, UndyedFabricRoll):
        rows = (
            db.query(
                model.expected_delivery_item_id,
                func.coalesce(func.sum(model.weight), 0),
                func.coalesce(func.sum(model.length), 0),
            )
            .filter(model.expected_delivery_item_id.in_(item_ids))
            .group_by(model.expected_delivery_item_id)
            .all()
        )
        for item_id, weight_sum, length_sum in rows:
            acc = sums.setdefault(item_id, [Decimal("0"), Decimal("0")])
            acc[0] += Decimal(weight_sum)
            acc[1] += Decimal(length_sum)
    return sums


def _sync_items_received(db: Session, items: List[ExpectedDeliveryItem]) -> bool:
    """Recompute received totals for the given items from the roll ledger.
    Returns True when any stored value changed. No commit."""
    if not items:
        return False
    sums = _sum_linked_rolls(db, [i.id for i in items])
    changed = False
    for item in items:
        weight_sum, length_sum = sums.get(item.id, (Decimal("0"), Decimal("0")))
        weight_sum = weight_sum.quantize(_TWO_PLACES)
        length_sum = length_sum.quantize(_TWO_PLACES)
        if (item.received_weight_kg or Decimal("0")) != weight_sum:
            item.received_weight_kg = weight_sum
            changed = True
        if (item.received_length_m or Decimal("0")) != length_sum:
            item.received_length_m = length_sum
            changed = True
    return changed


def sync_delivery_item_from_rolls(db: Session, item_id: int) -> None:
    """Ledger recompute for one item (and the parent delivery's status) after
    a roll insert/delete/update. No-op when the parent delivery is closed —
    closed deliveries are frozen until reopened. The caller must flush the
    pending roll change first and owns the transaction — no commit here."""
    item = db.query(ExpectedDeliveryItem).filter(ExpectedDeliveryItem.id == item_id).first()
    if not item:
        return
    delivery_status = (
        db.query(ExpectedDelivery.status)
        .filter(ExpectedDelivery.id == item.delivery_id)
        .scalar()
    )
    if delivery_status not in _OPEN_STATUSES:
        return
    _sync_items_received(db, [item])
    _recompute_delivery_status(db, item.delivery_id)


def sync_delivery_received(db: Session, delivery_id: int) -> None:
    """Full ledger sync for the delivery view path: recompute every item's
    received totals from its linked rolls and re-derive the delivery status.
    Commits only when something actually changed; closed deliveries are
    frozen and skipped."""
    delivery = (
        db.query(ExpectedDelivery)
        .options(selectinload(ExpectedDelivery.items))
        .filter(ExpectedDelivery.id == delivery_id)
        .first()
    )
    if not delivery or delivery.status not in _OPEN_STATUSES:
        return
    changed = _sync_items_received(db, delivery.items)
    # Viewing never closes (item 18): only a receive or a line edit does.
    status_changed = _recompute_delivery_status(db, delivery_id, allow_close=False)
    if changed or status_changed:
        db.commit()


# ── Accessory lines (item 15): received from the pack ledger ───────────────
# Nothing is stored: received on a line = the `receipt` ledger rows of the
# packs linked to it (accessory_packs.expected_delivery_item_id). A reversed
# receipt is a negative `receipt` row, so it nets out; issuing or moving
# stock from those packs later doesn't change what was received.

def accessory_received(db: Session, line_ids: List[int]) -> dict:
    """{line id: received in base units} for accessory lines (missing = 0)."""
    if not line_ids:
        return {}
    rows = (
        db.query(AccessoryPack.expected_delivery_item_id, func.sum(AccessoryLedgerEntry.qty_delta))
        .join(AccessoryLedgerEntry, AccessoryLedgerEntry.pack_id == AccessoryPack.id)
        .filter(
            AccessoryPack.expected_delivery_item_id.in_(line_ids),
            AccessoryLedgerEntry.entry_type == "receipt",
        )
        .group_by(AccessoryPack.expected_delivery_item_id)
        .all()
    )
    return {line_id: Decimal(total) for line_id, total in rows}


def line_receive_state(expected: Decimal, received: Decimal) -> str:
    """Item 18: where an accessory line stands. Over-receipts are allowed,
    only flagged."""
    if received <= 0:
        return "waiting"
    if received < expected:
        return "partial"
    return "complete" if received == expected else "over"


def attach_accessory_received(db: Session, lines: Iterable[ExpectedDeliveryItem]) -> None:
    """Set the transient `received_qty` and `receive_state` on each accessory
    line (one query)."""
    acc = [i for i in lines if i is not None and i.accessory_item_id is not None]
    sums = accessory_received(db, [i.id for i in acc])
    for line in acc:
        line.received_qty = sums.get(line.id, Decimal("0"))
        line.receive_state = line_receive_state(line.expected_qty, line.received_qty)


def attach_delivery_flags(deliveries: Iterable[ExpectedDelivery]) -> None:
    """Item 18: the summary flags of a delivery with accessory lines, from
    lines that already carry `receive_state`. Fabric deliveries keep None."""
    for d in deliveries:
        acc = [i for i in d.items if i.accessory_item_id is not None]
        if not acc:
            continue
        states = [i.receive_state for i in acc]
        d.lines_total = len(acc)
        d.lines_complete = sum(s in ("complete", "over") for s in states)
        d.over_received = "over" in states
        # Received but something is still missing = someone closed it early.
        d.closed_short = d.status == "received" and any(s in ("waiting", "partial") for s in states)


def _accessory_lines_where(condition):
    """Ids of deliveries with an accessory line matching `condition`, which
    compares `received` (base units, the receipt rows) with the line."""
    received = (
        select(AccessoryPack.expected_delivery_item_id.label("line_id"), func.sum(AccessoryLedgerEntry.qty_delta).label("qty"))
        .join(AccessoryLedgerEntry, AccessoryLedgerEntry.pack_id == AccessoryPack.id)
        .where(AccessoryLedgerEntry.entry_type == "receipt")
        .group_by(AccessoryPack.expected_delivery_item_id)
        .subquery()
    )
    qty = func.coalesce(received.c.qty, 0)
    return (
        select(ExpectedDeliveryItem.delivery_id)
        .outerjoin(received, received.c.line_id == ExpectedDeliveryItem.id)
        .where(ExpectedDeliveryItem.accessory_item_id.is_not(None), condition(qty))
    )


def line_packs(db: Session, line_id: int) -> List[dict]:
    """Item 18: the packs received on one delivery line: what each pack
    brought in (its receipt rows, so an undone receive shows 0), what it
    holds now, where it is, and who received it when. Newest first."""
    received = func.coalesce(
        func.sum(AccessoryLedgerEntry.qty_delta).filter(AccessoryLedgerEntry.entry_type == "receipt"), 0
    )
    on_hand = func.coalesce(func.sum(AccessoryLedgerEntry.qty_delta), 0)
    rows = db.execute(
        select(AccessoryPack, received, on_hand, User.username)
        .outerjoin(AccessoryLedgerEntry, AccessoryLedgerEntry.pack_id == AccessoryPack.id)
        .outerjoin(User, User.id == AccessoryPack.created_by)
        .where(AccessoryPack.expected_delivery_item_id == line_id)
        .group_by(AccessoryPack.id, User.username)
        .order_by(AccessoryPack.id.desc())
    ).all()
    return [
        {
            "id": pack.id,
            "status": pack.status,
            "received_qty": Decimal(rec),
            "quantity": Decimal(held),
            "rack_code": pack.rack_code,
            "created_at": pack.created_at,
            "received_by": username,
        }
        for pack, rec, held, username in rows
    ]


def sync_delivery_item_from_packs(db: Session, item_id: int) -> None:
    """Re-derive the parent delivery's status after packs were received
    against (or a receipt reversed on) an accessory line. Same contract as
    sync_delivery_item_from_rolls: the caller flushes first and commits.
    Item 18: a delivery that **closed itself** (received, no closed_by)
    reopens when a reversal leaves it short; one a person closed, or a
    cancelled one, stays frozen. For Receive Packs (item 17)."""
    delivery_id = db.query(ExpectedDeliveryItem.delivery_id).filter(ExpectedDeliveryItem.id == item_id).scalar()
    if delivery_id is not None:
        _recompute_delivery_status(db, delivery_id, reopen_auto_closed=True)


def _item_fully_received(item: ExpectedDeliveryItem) -> bool:
    if item.accessory_item_id is not None:
        return (item.received_qty or Decimal("0")) >= item.expected_qty
    return (
        item.expected_weight_kg is not None
        and (item.received_weight_kg or Decimal("0")) >= item.expected_weight_kg
    )


def _item_has_received(item: ExpectedDeliveryItem) -> bool:
    if item.accessory_item_id is not None:
        return (item.received_qty or Decimal("0")) > 0
    return (item.received_weight_kg or 0) > 0 or (item.received_length_m or 0) > 0


def _recompute_delivery_status(
    db: Session,
    delivery_id: int,
    *,
    allow_close: bool = True,
    reopen_auto_closed: bool = False,
) -> bool:
    """Re-derive pending/partial/received from item totals. Returns True when
    the status changed. No commit.

    `allow_close=False` (the view path) never closes a delivery: closing
    happens on a receive or a line edit, so an admin's Reopen of a complete
    delivery isn't undone by just looking at it. `reopen_auto_closed=True`
    (pack receive / undo) also re-derives a delivery that closed itself
    (received, closed_by NULL), so a reversal that leaves it short reopens it."""
    delivery = (
        db.query(ExpectedDelivery)
        .options(selectinload(ExpectedDelivery.items))
        .filter(ExpectedDelivery.id == delivery_id)
        .first()
    )
    if not delivery:
        return False
    auto_closed = delivery.status == "received" and delivery.closed_by is None
    if delivery.status not in _OPEN_STATUSES and not (reopen_auto_closed and auto_closed):
        return False
    items = delivery.items
    attach_accessory_received(db, items)
    if items and all(_item_fully_received(i) for i in items):
        new_status = "received" if allow_close or delivery.status == "received" else "partial"
    elif any(_item_has_received(i) for i in items):
        new_status = "partial"
    else:
        new_status = "pending"
    if new_status != delivery.status:
        delivery.status = new_status
        delivery.closed_at = func.current_timestamp() if new_status == "received" else None
        return True
    return False


def _reopened_status(db: Session, delivery: ExpectedDelivery) -> str:
    """Item 18: what an admin's Reopen sets: partial when anything was
    received, else pending (no closing again until the next receive)."""
    attach_accessory_received(db, delivery.items)
    return "partial" if any(_item_has_received(i) for i in delivery.items) else "pending"
