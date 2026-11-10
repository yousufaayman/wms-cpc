"""Database reads/writes for accessory items (core.accessory_items) and their
own unit conversions (core.uom_conversions rows with accessory_item_id set).

Rules checked here, raised as HTTP errors:
- the category and base unit must be switched on; the client must exist;
- category and client are fixed after creation (they're part of the code);
- the base unit can't change once the item has stock (`has_stock`), nor while
  the item has its own conversions (they're written against the base unit);
- an item conversion must involve the item's base unit;
- references (item 9): a new item needs at least one; a code is unique per
  client / per supplier, compared normalized (`normalize.normalize_code`);
  a client-specific item only takes its own client's codes; the last
  reference can't be deleted.
- templates + variants (item 10): an item with variable lines is a template
  (never stocked); lines can only be added while it has no stock, and once it
  has variants only optional ones; a line a variant uses can't be deleted or
  change type. A variant takes category, client, base unit and conversions
  from its template; the same template + color + size + values can exist
  only once (`domains/accessories/variants.py`). Variants don't need
  references of their own: the template's apply.
"""
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func, literal, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.domains.accessories import item_codes, variants
from backend.domains.accessories.normalize import normalize_code
from backend.models import (
    AccessoryCategory,
    AccessoryItem,
    AccessoryItemField,
    AccessoryItemRef,
    Client,
    LogicalLocation,
    LogicalLocationType,
    Uom,
    UomConversion,
)
from backend.schemas import (
    AccessoryItemCreate,
    AccessoryItemFieldCreate,
    AccessoryItemFieldUpdate,
    AccessoryItemRefIn,
    AccessoryItemRefUpdate,
    AccessoryItemUpdate,
    AccessoryVariantCreate,
    UomConversionCreate,
)


def _bad(detail: str, code: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def has_stock(db: Session, item_id: int) -> bool:
    """Has this item ever held stock? Packs and the ledger don't exist yet
    (items 12/13), so nothing has: item 12 makes this check its packs."""
    return False


def ensure_stockable(item: AccessoryItem) -> None:
    """For receiving / packing / issuing (items 12+): only plain items and
    variants of a switched-on template can hold stock."""
    if item.is_template:
        raise _bad(f"{item.code} is a template: pick one of its variants")
    if not item.active:
        raise _bad(f"{item.code} is switched off")
    if item.parent_template is not None and not item.parent_template.active:
        raise _bad(f"The template {item.parent_template.code} is switched off")


def list_items(
    db: Session,
    q: Optional[str] = None,
    category_id: Optional[int] = None,
    client_id: Optional[int] = None,
    generic_only: bool = False,
    active_only: bool = True,
    kind: Optional[str] = None,
    template_id: Optional[int] = None,
    limit: int = 50,
    offset: int = 0,
) -> Tuple[List[AccessoryItem], int]:
    query = db.query(AccessoryItem)
    if q and q.strip():
        like = f"%{q.strip()}%"
        norm = normalize_code(q)
        ref_match = AccessoryItemRef.ref_code.ilike(like)
        if norm:  # "ab 01" also finds AB-01
            ref_match = or_(ref_match, AccessoryItemRef.ref_code_norm.contains(norm))
        conditions = [
            AccessoryItem.code.ilike(like),
            AccessoryItem.description.ilike(like),
            AccessoryItem.color.ilike(like),
            AccessoryItem.size.ilike(like),
            AccessoryItem.refs.any(ref_match),
            # A template's references find its variants too.
            AccessoryItem.parent_template.has(AccessoryItem.refs.any(ref_match)),
        ]
        # A variant's values: "45127" finds the variant with that PO.
        values = func.jsonb_each_text(AccessoryItem.variable_values).table_valued("key", "value").render_derived()
        conditions.append(select(literal(1)).select_from(values).where(values.c.value.ilike(like)).exists())
        query = query.filter(or_(*conditions))
    if kind == "variant":
        query = query.filter(AccessoryItem.parent_template_id.isnot(None))
    elif kind == "template":
        query = query.filter(AccessoryItem.fields.any())
    elif kind == "plain":
        query = query.filter(AccessoryItem.parent_template_id.is_(None), ~AccessoryItem.fields.any())
    if template_id is not None:
        query = query.filter(AccessoryItem.parent_template_id == template_id)
    if category_id is not None:
        query = query.filter(AccessoryItem.category_id == category_id)
    if generic_only:
        query = query.filter(AccessoryItem.client_id.is_(None))
    elif client_id is not None:
        query = query.filter(AccessoryItem.client_id == client_id)
    if active_only:
        query = query.filter(AccessoryItem.active.is_(True))
    total = query.count()
    items = query.order_by(AccessoryItem.code).offset(offset).limit(limit).all()
    return items, total


def get_item_or_404(db: Session, item_id: int) -> AccessoryItem:
    item = db.get(AccessoryItem, item_id)
    if item is None:
        raise _bad("Item not found", status.HTTP_404_NOT_FOUND)
    return item


def _active_uom(db: Session, uom_id: int) -> Uom:
    uom = db.get(Uom, uom_id)
    if uom is None:
        raise _bad("Unit not found", status.HTTP_404_NOT_FOUND)
    if not uom.active:
        raise _bad(f"Unit {uom.code} is switched off")
    return uom


def create_item(db: Session, payload: AccessoryItemCreate, user_id: int) -> AccessoryItem:
    category = db.get(AccessoryCategory, payload.category_id)
    if category is None:
        raise _bad("Category not found", status.HTTP_404_NOT_FOUND)
    if not category.active:
        raise _bad(f"Category {category.code} is switched off")
    _active_uom(db, payload.base_uom_id)

    client_code = None
    if payload.client_id is not None:
        client = db.get(Client, payload.client_id)
        if client is None:
            raise _bad("Client not found", status.HTTP_404_NOT_FOUND)
        client_code = client.client_code
    try:
        prefix = item_codes.prefix_for(client_code, generic=payload.client_id is None)
    except item_codes.NoClientCode as exc:
        raise _bad(str(exc)) from exc

    item = AccessoryItem(
        **payload.model_dump(exclude={"refs"}),
        code=item_codes.next_code(db, prefix, category.id, category.code),
        created_by=user_id,
    )
    seen = set()
    for ref in payload.refs:
        key = (ref.client_id, ref.supplier_id, normalize_code(ref.ref_code))
        if key in seen:
            raise _bad("The same code is entered twice")
        seen.add(key)
        _check_ref(db, item, ref.client_id, ref.supplier_id, ref.ref_code)
    db.add(item)
    db.flush()
    for ref in payload.refs:
        db.add(_new_ref(item.id, ref, user_id))
    db.commit()
    db.refresh(item)
    return item


def _own_conversions(db: Session, item_id: int) -> List[UomConversion]:
    return (
        db.query(UomConversion)
        .filter(UomConversion.accessory_item_id == item_id)
        .order_by(UomConversion.id)
        .all()
    )


def update_item(db: Session, item_id: int, payload: AccessoryItemUpdate) -> AccessoryItem:
    item = get_item_or_404(db, item_id)
    changes = payload.model_dump(exclude_unset=True)
    # Only color/size may be cleared; a null for the others means "leave it".
    for field in ("description", "base_uom_id", "active"):
        if changes.get(field, ...) is None:
            changes.pop(field)

    new_values = changes.pop("variable_values", None)
    if item.parent_template is not None:
        _update_variant(db, item, changes, new_values)
    elif new_values is not None:
        raise _bad("Only a variant has values")

    new_uom = changes.get("base_uom_id")
    if new_uom is not None and new_uom != item.base_uom_id:
        if item.parent_template is not None:
            raise _bad("A variant uses its template's base unit")
        if _has_variants(db, item.id):
            raise _bad("The base unit can't change once the template has variants")
        _active_uom(db, new_uom)
        if has_stock(db, item.id):
            raise _bad("The base unit can't change once the item has stock")
        if _own_conversions(db, item.id):
            raise _bad("Delete this item's conversions before changing its base unit")

    for field, value in changes.items():
        setattr(item, field, value)
    if changes or new_values is not None:
        item.updated_at = datetime.now(timezone.utc)
    _commit_variant(db)
    db.refresh(item)
    return item


def list_item_conversions(db: Session, item_id: int) -> List[UomConversion]:
    get_item_or_404(db, item_id)
    return _own_conversions(db, item_id)


def create_item_conversion(db: Session, item_id: int, payload: UomConversionCreate) -> UomConversion:
    item = get_item_or_404(db, item_id)
    if item.parent_template is not None:
        raise _bad(f"A variant uses its template's conversions: add them on {item.parent_template.code}")
    if payload.from_uom_id == payload.to_uom_id:
        raise _bad("A unit can't convert to itself")
    if item.base_uom_id not in (payload.from_uom_id, payload.to_uom_id):
        raise _bad("One side must be the item's base unit")
    _active_uom(db, payload.from_uom_id)
    _active_uom(db, payload.to_uom_id)
    pair = {payload.from_uom_id, payload.to_uom_id}
    if any({c.from_uom_id, c.to_uom_id} == pair for c in _own_conversions(db, item_id)):
        raise _bad("This item already has a conversion for these two units", status.HTTP_409_CONFLICT)
    conv = UomConversion(**payload.model_dump(), accessory_item_id=item_id)
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return conv


def delete_item_conversion(db: Session, item_id: int, conversion_id: int) -> None:
    conv = db.get(UomConversion, conversion_id)
    if conv is None or conv.accessory_item_id != item_id:
        raise _bad("Conversion not found", status.HTTP_404_NOT_FOUND)
    # Safe: stock is stored in base units, so no saved quantity depends on it.
    db.delete(conv)
    db.commit()


# ── References (item 9) ─────────────────────────────────────────────────────

def _new_ref(item_id: int, ref: AccessoryItemRefIn, user_id: int) -> AccessoryItemRef:
    return AccessoryItemRef(
        accessory_item_id=item_id,
        client_id=ref.client_id,
        supplier_id=ref.supplier_id,
        ref_code=ref.ref_code,
        ref_code_norm=normalize_code(ref.ref_code),
        ref_description=ref.ref_description,
        created_by=user_id,
    )


def find_ref(
    db: Session, code: str, client_id: Optional[int] = None, supplier_id: Optional[int] = None
) -> Optional[AccessoryItemRef]:
    """The reference this party already has for `code` (compared normalized), if any."""
    norm = normalize_code(code)
    if not norm or (client_id is None) == (supplier_id is None):
        return None
    q = db.query(AccessoryItemRef).filter(AccessoryItemRef.ref_code_norm == norm)
    if client_id is not None:
        q = q.filter(AccessoryItemRef.client_id == client_id)
    else:
        q = q.filter(AccessoryItemRef.supplier_id == supplier_id)
    return q.first()


def _check_ref(
    db: Session,
    item: AccessoryItem,
    client_id: Optional[int],
    supplier_id: Optional[int],
    code: str,
    ignore_ref_id: Optional[int] = None,
) -> None:
    """Raise if this reference can't go on `item`."""
    if not normalize_code(code):
        raise _bad("Enter a code with letters or digits")
    if client_id is not None:
        if db.get(Client, client_id) is None:
            raise _bad("Client not found", status.HTTP_404_NOT_FOUND)
        if item.client_id is not None and item.client_id != client_id:
            raise _bad("A client-specific item can only carry its own client's codes")
    else:
        supplier = db.get(LogicalLocation, supplier_id)
        if supplier is None or supplier.location_type != LogicalLocationType.SUPPLIER.value:
            raise _bad("Supplier not found", status.HTTP_404_NOT_FOUND)
    existing = find_ref(db, code, client_id=client_id, supplier_id=supplier_id)
    if existing is not None and existing.id != ignore_ref_id:
        raise _bad(f"This code already belongs to {existing.item.code}", status.HTTP_409_CONFLICT)


def list_refs(db: Session, item_id: int) -> List[AccessoryItemRef]:
    return get_item_or_404(db, item_id).refs


def add_ref(db: Session, item_id: int, ref: AccessoryItemRefIn, user_id: int) -> AccessoryItemRef:
    item = get_item_or_404(db, item_id)
    _check_ref(db, item, ref.client_id, ref.supplier_id, ref.ref_code)
    row = _new_ref(item.id, ref, user_id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _ref_or_404(db: Session, item_id: int, ref_id: int) -> AccessoryItemRef:
    row = db.get(AccessoryItemRef, ref_id)
    if row is None or row.accessory_item_id != item_id:
        raise _bad("Reference not found", status.HTTP_404_NOT_FOUND)
    return row


def update_ref(db: Session, item_id: int, ref_id: int, payload: AccessoryItemRefUpdate) -> AccessoryItemRef:
    row = _ref_or_404(db, item_id, ref_id)
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("ref_code"):
        _check_ref(db, row.item, row.client_id, row.supplier_id, changes["ref_code"], ignore_ref_id=row.id)
        row.ref_code = changes["ref_code"]
        row.ref_code_norm = normalize_code(changes["ref_code"])
    if "ref_description" in changes:
        row.ref_description = changes["ref_description"]
    db.commit()
    db.refresh(row)
    return row


def delete_ref(db: Session, item_id: int, ref_id: int) -> None:
    row = _ref_or_404(db, item_id, ref_id)
    # A variant's own references are optional: its template's apply.
    if row.item.parent_template_id is None and len(row.item.refs) <= 1:
        raise _bad("An item needs at least one reference")
    db.delete(row)
    db.commit()


# ── Templates: variable lines (item 10) ─────────────────────────────────────

def _has_variants(db: Session, template_id: int) -> bool:
    return db.query(AccessoryItem.id).filter(AccessoryItem.parent_template_id == template_id).first() is not None


def _variants_using(db: Session, template_id: int, field_key: str):
    """Variants of this template that hold a value for this line."""
    return db.query(AccessoryItem).filter(
        AccessoryItem.parent_template_id == template_id,
        AccessoryItem.variable_values.has_key(field_key),
    )


def _field_or_404(db: Session, item_id: int, field_id: int) -> AccessoryItemField:
    row = db.get(AccessoryItemField, field_id)
    if row is None or row.accessory_item_id != item_id:
        raise _bad("Line not found", status.HTTP_404_NOT_FOUND)
    return row


def list_fields(db: Session, item_id: int) -> List[AccessoryItemField]:
    return get_item_or_404(db, item_id).fields


def add_field(db: Session, item_id: int, payload: AccessoryItemFieldCreate) -> AccessoryItemField:
    item = get_item_or_404(db, item_id)
    if item.parent_template_id is not None:
        raise _bad("A variant can't have variable lines; add them on its template")
    if not item.fields and has_stock(db, item.id):
        raise _bad("Can't add lines: this item has stock. Create a new item for the variable version")
    if payload.required and _has_variants(db, item.id):
        raise _bad("Required lines can't be added once variants exist")
    row = AccessoryItemField(
        **payload.model_dump(),
        accessory_item_id=item.id,
        field_key=variants.field_key_from_label(payload.label_en, [f.field_key for f in item.fields]),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    db.expire(item, ["fields"])
    return row


def update_field(db: Session, item_id: int, field_id: int, payload: AccessoryItemFieldUpdate) -> AccessoryItemField:
    row = _field_or_404(db, item_id, field_id)
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if "field_type" in changes and changes["field_type"] != row.field_type:
        if _variants_using(db, item_id, row.field_key).first() is not None:
            raise _bad("This line is used by variants, so its type can't change")
    if changes.get("required") and not row.required:
        missing = (
            db.query(AccessoryItem)
            .filter(AccessoryItem.parent_template_id == item_id, ~AccessoryItem.variable_values.has_key(row.field_key))
            .first()
        )
        if missing is not None:
            raise _bad(f"Variant {missing.code} has no value for this line, so it can't be required")
    for field, value in changes.items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


def delete_field(db: Session, item_id: int, field_id: int) -> None:
    row = _field_or_404(db, item_id, field_id)
    if _variants_using(db, item_id, row.field_key).first() is not None:
        raise _bad("This line is used by variants and can't be deleted")
    if len(row.item.fields) <= 1 and _has_variants(db, item_id):
        raise _bad("A template with variants needs at least one line")
    db.delete(row)
    db.commit()


# ── Variants (item 10) ──────────────────────────────────────────────────────

def _template_or_400(db: Session, template_id: int) -> AccessoryItem:
    template = get_item_or_404(db, template_id)
    if not template.is_template:
        raise _bad(f"{template.code} has no variable lines, so it has no variants")
    return template


def _clean(template: AccessoryItem, values, color, size) -> Tuple[dict, str]:
    try:
        cleaned = variants.clean_values(template.fields, values)
        return cleaned, variants.variant_key(template.fields, cleaned, color, size)
    except variants.BadValues as exc:
        raise _bad(str(exc)) from exc


def _find_variant(db: Session, template_id: int, key: str) -> Optional[AccessoryItem]:
    return (
        db.query(AccessoryItem)
        .filter(AccessoryItem.parent_template_id == template_id, AccessoryItem.variant_key == key)
        .first()
    )


def _taken(existing: AccessoryItem) -> HTTPException:
    return _bad(f"This combination already exists: {existing.code}", status.HTTP_409_CONFLICT)


def _commit_variant(db: Session) -> None:
    """Commit; two people saving the same combination at once hit the unique index."""
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if "uq_accessory_items_variant" in str(exc.orig):
            raise _bad("This combination already exists", status.HTTP_409_CONFLICT) from exc
        raise


def check_variant(db: Session, template_id: int, payload: AccessoryVariantCreate) -> Optional[AccessoryItem]:
    """The variant that already has this combination, or None (for the form)."""
    template = _template_or_400(db, template_id)
    _, key = _clean(template, payload.values, payload.color, payload.size)
    return _find_variant(db, template.id, key)


def list_variants(db: Session, template_id: int, active_only: bool = False) -> List[AccessoryItem]:
    get_item_or_404(db, template_id)
    q = db.query(AccessoryItem).filter(AccessoryItem.parent_template_id == template_id)
    if active_only:
        q = q.filter(AccessoryItem.active.is_(True))
    return q.order_by(AccessoryItem.code).all()


def create_variant(db: Session, template_id: int, payload: AccessoryVariantCreate, user_id: int) -> AccessoryItem:
    template = _template_or_400(db, template_id)
    if not template.active:
        raise _bad(f"The template {template.code} is switched off")
    values, key = _clean(template, payload.values, payload.color, payload.size)
    existing = _find_variant(db, template.id, key)
    if existing is not None:
        raise _taken(existing)
    item = AccessoryItem(
        category_id=template.category_id,
        client_id=template.client_id,
        description=payload.description or template.description,
        color=payload.color,
        size=payload.size,
        base_uom_id=template.base_uom_id,
        created_by=user_id,
        parent_template_id=template.id,
        variable_values=values,
        variant_key=key,
    )
    seen = set()
    for ref in payload.refs:
        ref_key = (ref.client_id, ref.supplier_id, normalize_code(ref.ref_code))
        if ref_key in seen:
            raise _bad("The same code is entered twice")
        seen.add(ref_key)
        _check_ref(db, item, ref.client_id, ref.supplier_id, ref.ref_code)
    try:
        item.code = variants.next_variant_code(db, template.code, template.category_id)
    except variants.BadValues as exc:
        raise _bad(str(exc)) from exc
    db.add(item)
    db.flush()
    for ref in payload.refs:
        db.add(_new_ref(item.id, ref, user_id))
    _commit_variant(db)
    db.refresh(item)
    return item


def _update_variant(db: Session, item: AccessoryItem, changes: dict, new_values) -> None:
    """Color / size / values of a variant changed: re-check the combination."""
    if new_values is None and "color" not in changes and "size" not in changes:
        return
    if has_stock(db, item.id):
        raise _bad("A variant's values, color and size can't change once it has stock")
    color = changes.get("color", item.color)
    size = changes.get("size", item.size)
    values, key = _clean(
        item.parent_template, item.variable_values if new_values is None else new_values, color, size
    )
    existing = _find_variant(db, item.parent_template_id, key)
    if existing is not None and existing.id != item.id:
        raise _taken(existing)
    item.variable_values = values
    item.variant_key = key
