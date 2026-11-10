"""Templates and variants (item 10): the rules that don't need the database.

A *template* is an accessory item with variable lines (a price ticket with
"Price" and "PO number"). It's never stocked. A *variant* is one combination
of values for it (price 34.99, PO 45127, size M), and that is what packs and
the ledger use.

This module:
- turns a line's English label into its key (`field_key_from_label`);
- checks and tidies a variant's values against the template's lines
  (`clean_values`): money to 2 decimals, numbers without extra zeros,
  dates as YYYY-MM-DD, text trimmed;
- builds the comparison form of a variant (`variant_key`), so the same
  combination can't be entered twice. Text is compared like reference codes
  (`normalize.normalize_code`: no case, spaces or - . / _), so "SS-26" and
  "ss 26" are the same; numbers as numbers (34.99 = 34.990);
- makes variant codes: template code + `-` + 3 digits (`UA-TKT-0003-007`).
"""
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Dict, Iterable, Optional, Protocol

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.domains.accessories.normalize import normalize_code

FIELD_TYPES = ("text", "number", "money", "date")
VARIANT_DIGITS = 3
MAX_VALUE_LENGTH = 100
MAX_KEY_LENGTH = 1000
MAX_CODE_LENGTH = 30  # core.accessory_items.code


class BadValues(ValueError):
    """The values don't fit the template's lines; the message says why."""


class FieldDef(Protocol):
    field_key: str
    label_en: str
    field_type: str
    required: bool


def field_key_from_label(label_en: str, taken: Iterable[str] = ()) -> str:
    """"PO number" → `po_number`; adds `_2`, `_3` … when the key is taken."""
    base = re.sub(r"[^a-z0-9]+", "_", label_en.strip().lower()).strip("_")[:30]
    if not base:
        base = "line"
    if base[0].isdigit():
        base = f"f_{base}"[:30]
    taken = set(taken)
    key, n = base, 2
    while key in taken:
        key = f"{base}_{n}"
        n += 1
    return key


def _clean_number(raw: str, label: str, places: Optional[int]) -> str:
    try:
        value = Decimal(raw.replace(",", ""))
    except InvalidOperation as exc:
        raise BadValues(f"{label}: enter a number") from exc
    if not value.is_finite():
        raise BadValues(f"{label}: enter a number")
    if places is not None:  # money
        if value < 0:
            raise BadValues(f"{label}: can't be negative")
        return str(value.quantize(Decimal(1).scaleb(-places)))
    value = value.normalize()
    # normalize() writes 100 as 1E+2; format it back without the exponent.
    return format(value, "f")


def clean_value(field: FieldDef, raw) -> Optional[str]:
    """The stored form of one value, or None when it's blank."""
    if raw is None:
        return None
    raw = str(raw).strip()
    if not raw:
        return None
    label = field.label_en
    if field.field_type == "text":
        if len(raw) > MAX_VALUE_LENGTH:
            raise BadValues(f"{label}: at most {MAX_VALUE_LENGTH} characters")
        if not normalize_code(raw):
            raise BadValues(f"{label}: enter letters or digits")
        return " ".join(raw.split())
    if field.field_type == "number":
        return _clean_number(raw, label, None)
    if field.field_type == "money":
        return _clean_number(raw, label, 2)
    if field.field_type == "date":
        try:
            return date.fromisoformat(raw).isoformat()
        except ValueError as exc:
            raise BadValues(f"{label}: enter a date as YYYY-MM-DD") from exc
    raise BadValues(f"{label}: unknown line type {field.field_type}")


def clean_values(fields: Iterable[FieldDef], values: Optional[Dict[str, object]]) -> Dict[str, str]:
    """Check `values` against the template's lines and return them tidied.
    Blank optional values are left out; unknown keys and missing required
    values are refused."""
    fields = list(fields)
    values = dict(values or {})
    known = {f.field_key for f in fields}
    unknown = sorted(set(values) - known)
    if unknown:
        raise BadValues(f"Unknown line(s): {', '.join(unknown)}")
    cleaned: Dict[str, str] = {}
    for field in fields:
        value = clean_value(field, values.get(field.field_key))
        if value is None:
            if field.required:
                raise BadValues(f"{field.label_en} is required")
            continue
        cleaned[field.field_key] = value
    return cleaned


def _compare_form(field_type: str, value: str) -> str:
    if field_type == "text":
        return normalize_code(value)
    return value  # numbers, money and dates are already in one fixed form


def variant_key(
    fields: Iterable[FieldDef], values: Dict[str, str], color: Optional[str], size: Optional[str]
) -> str:
    """What two variants are compared by. `values` must come from `clean_values`.
    Lines are sorted by key, so changing print order changes nothing."""
    types = {f.field_key: f.field_type for f in fields}
    parts = [f"color={normalize_code(color)}", f"size={normalize_code(size)}"]
    parts += [f"{key}={_compare_form(types[key], values[key])}" for key in sorted(values)]
    key = "|".join(parts)
    if len(key) > MAX_KEY_LENGTH:
        raise BadValues("Too many values for one variant")
    return key


def next_variant_code(db: Session, template_code: str, category_id: int) -> str:
    """Next code for a variant of this template, e.g. `UA-TKT-0003-007`.

    The number is counted in `core.accessory_seq` with the template code as
    prefix (same upsert as `item_codes.next_code`, so two people saving at the
    same moment get different numbers). Never reused."""
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
        {"prefix": template_code, "category_id": category_id},
    ).scalar_one()
    code = f"{template_code}-{seq:0{VARIANT_DIGITS}d}"
    if len(code) > MAX_CODE_LENGTH:
        raise BadValues("The template code is too long to add variant numbers")
    return code
