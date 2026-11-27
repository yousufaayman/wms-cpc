"""Bulk item import from Excel (item 35).

Lets the team register many plain accessory items at once, e.g. before the
go-live count. Four steps, one function each:

1. `build_template`: a blank workbook. Sheet "Items" has one row per item
   with dropdowns (category, client, base unit, reference owner) filled from
   the live lists, a hidden "Lists" sheet holds those lists, and an
   instructions sheet explains each column. English or Arabic.
2. `preview`: reads an uploaded workbook and checks every row the same way
   the item form does. Errors block the import; warnings (looks like an
   existing item / like another row) don't. Nothing is saved.
3. `create_all`: checks again and, only if no row has an error, creates all
   items in one transaction (all or nothing). Codes come from the system.
4. `build_result`: the created items as a workbook with their new codes.

Plain items only: one reference per row, no templates, variable lines,
variants or per-item conversions (those stay on the item screen).

Row messages are returned as codes + values (e.g. `{"code": "unknown",
"field": "client", "value": "XX"}`) so the screen shows them in English or
Arabic. Columns are read by position, so a sheet in either language works.
"""
import io
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font
from openpyxl.worksheet.datavalidation import DataValidation
from sqlalchemy.orm import Session

from backend.crud import accessory_items as items_crud
from backend.crud.analytics_export import _BORDER, _apply_direction, _to_bytes, _write_header
from backend.domains.accessories import item_codes
from backend.domains.accessories.normalize import normalize_code
from backend.models import (
    AccessoryCategory,
    AccessoryItem,
    Client,
    LogicalLocation,
    LogicalLocationType,
    Uom,
)
from backend.schemas import AccessoryItemCreate, AccessoryItemRefIn

MAX_ROWS = 500
MAX_FILE_BYTES = 5 * 1024 * 1024
SEP = " · "  # between a code and its name in the dropdown values

# Column order of the Items sheet (and the result sheet, after the code).
COLUMNS = (
    "category", "client", "base_unit", "description", "color", "size",
    "ref_owner", "ref_code", "ref_description",
)
REQUIRED = {"category", "description", "ref_code"}  # ref_owner: see _check_row
MAX_LEN = {"description": 255, "color": 100, "size": 50, "ref_code": 100, "ref_description": 255}

_LABELS: Dict[str, Dict[str, str]] = {
    "en": {
        "sheet_items": "Items",
        "sheet_help": "Instructions",
        "category": "Category",
        "client": "Client",
        "base_unit": "Base unit",
        "description": "Description",
        "color": "Color",
        "size": "Size",
        "ref_owner": "Reference owner",
        "ref_code": "Reference code",
        "ref_description": "Reference description",
        "item_code": "Item code",
        "kind_client": "Client",
        "kind_supplier": "Supplier",
        "help_title": "How to fill this sheet",
        "help_column": "Column",
        "help_what": "What to enter",
        "help_category": "Required. Pick from the list.",
        "help_client": "Leave empty for a generic item (all clients). Pick a client for a client-specific item.",
        "help_base_unit": "Leave empty to use the category's default unit.",
        "help_description": "Required. What the trim is.",
        "help_color": "Optional.",
        "help_size": "Optional.",
        "help_ref_owner": "Whose code this is: a client or a supplier. Leave empty on a client item to use that client.",
        "help_ref_code": "Required. The trim code exactly as written on their BOM or packing list.",
        "help_ref_description": "Optional. Their description, as given.",
        "help_rules": "One row = one new item. The system makes the item codes. Up to 500 rows. "
                      "Only plain items: add variants, more references and unit conversions on the item screen afterwards.",
    },
    "ar": {
        "sheet_items": "الأصناف",
        "sheet_help": "التعليمات",
        "category": "الفئة",
        "client": "العميل",
        "base_unit": "الوحدة الأساسية",
        "description": "الوصف",
        "color": "اللون",
        "size": "المقاس",
        "ref_owner": "صاحب الكود",
        "ref_code": "كود المرجع",
        "ref_description": "وصف المرجع",
        "item_code": "كود الصنف",
        "kind_client": "عميل",
        "kind_supplier": "مورد",
        "help_title": "طريقة تعبئة الشيت",
        "help_column": "العمود",
        "help_what": "ماذا تكتب",
        "help_category": "مطلوب. اختر من القائمة.",
        "help_client": "اتركه فارغًا للصنف العام (لكل العملاء). اختر عميلًا للصنف الخاص بعميل.",
        "help_base_unit": "اتركه فارغًا لاستخدام الوحدة الافتراضية للفئة.",
        "help_description": "مطلوب. ما هو الصنف.",
        "help_color": "اختياري.",
        "help_size": "اختياري.",
        "help_ref_owner": "صاحب هذا الكود: عميل أو مورد. اتركه فارغًا في صنف العميل لاستخدام نفس العميل.",
        "help_ref_code": "مطلوب. الكود كما هو مكتوب في قائمة الخامات أو قائمة التعبئة.",
        "help_ref_description": "اختياري. وصفهم كما هو.",
        "help_rules": "كل صف = صنف جديد. النظام يعطي أكواد الأصناف. حتى 500 صف. "
                      "أصناف عادية فقط: أضف الأشكال والمراجع الإضافية وتحويلات الوحدات من شاشة الصنف بعد ذلك.",
    },
}

_LISTS_SHEET = "Lists"


def _labels(lang: str) -> Dict[str, str]:
    return _LABELS["ar" if lang == "ar" else "en"]


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


# ── Live lists (dropdowns + lookups) ────────────────────────────────────────

@dataclass
class _Lists:
    categories: Dict[str, AccessoryCategory]  # normalized code → category
    uoms: Dict[str, Uom]  # normalized code → unit
    clients_by_name: Dict[str, Client]  # casefolded name → client
    clients_by_code: Dict[str, List[Client]]  # normalized code → clients
    suppliers: Dict[str, LogicalLocation]  # casefolded name → supplier


def _load_lists(db: Session) -> _Lists:
    clients = db.query(Client).all()
    by_code: Dict[str, List[Client]] = {}
    for c in clients:
        by_code.setdefault(normalize_code(c.client_code), []).append(c)
    return _Lists(
        categories={normalize_code(c.code): c for c in db.query(AccessoryCategory).all()},
        uoms={normalize_code(u.code): u for u in db.query(Uom).all()},
        clients_by_name={c.client_name.strip().casefold(): c for c in clients},
        clients_by_code=by_code,
        suppliers={
            s.name.strip().casefold(): s
            for s in db.query(LogicalLocation)
            .filter(LogicalLocation.location_type == LogicalLocationType.SUPPLIER.value)
            .all()
        },
    )


def _category_label(c: AccessoryCategory, lang: str) -> str:
    return f"{c.code}{SEP}{c.name_ar if lang == 'ar' else c.name_en}"


def _uom_label(u: Uom, lang: str) -> str:
    return f"{u.code}{SEP}{u.name_ar if lang == 'ar' else u.name_en}"


def _client_label(c: Client) -> str:
    return f"{c.client_code}{SEP}{c.client_name}" if c.client_code else c.client_name


def _owner_label(kind: str, name: str, lang: str) -> str:
    return f"{_labels(lang)['kind_' + kind]}{SEP}{name}"


# ── 1. Blank sheet ──────────────────────────────────────────────────────────

def _write_list(ws, col: int, values: List[str]) -> str:
    """Write one dropdown list in the hidden sheet; return its range formula."""
    for i, v in enumerate(values, start=1):
        ws.cell(row=i, column=col, value=v)
    letter = ws.cell(row=1, column=col).column_letter
    return f"={_LISTS_SHEET}!${letter}$1:${letter}${max(len(values), 1)}"


def _items_sheet(wb: Workbook, lang: str, extra_first: Optional[str] = None):
    lb = _labels(lang)
    ws = wb.active
    ws.title = lb["sheet_items"]
    _apply_direction(ws, lang)
    headers = [lb[c] + (" *" if c in REQUIRED else "") for c in COLUMNS]
    if extra_first:
        headers = [extra_first] + headers
    _write_header(ws, 1, headers)
    for i in range(1, len(headers) + 1):
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = 24
    ws.freeze_panes = "A2"
    return ws


def build_template(db: Session, lang: str = "en") -> bytes:
    lb = _labels(lang)
    wb = Workbook()
    ws = _items_sheet(wb, lang)

    lists = wb.create_sheet(_LISTS_SHEET)
    lists.sheet_state = "hidden"
    categories = sorted(db.query(AccessoryCategory).filter(AccessoryCategory.active.is_(True)), key=lambda c: c.code)
    uoms = sorted(db.query(Uom).filter(Uom.active.is_(True)), key=lambda u: u.code)
    clients = sorted(db.query(Client).all(), key=lambda c: (c.client_code or "", c.client_name))
    suppliers = sorted(
        db.query(LogicalLocation).filter(LogicalLocation.location_type == LogicalLocationType.SUPPLIER.value).all(),
        key=lambda s: s.name,
    )
    sources = {
        "category": [_category_label(c, lang) for c in categories],
        "client": [_client_label(c) for c in clients],
        "base_unit": [_uom_label(u, lang) for u in uoms],
        "ref_owner": [_owner_label("client", c.client_name, lang) for c in clients]
        + [_owner_label("supplier", s.name, lang) for s in suppliers],
    }
    for list_col, (name, values) in enumerate(sources.items(), start=1):
        if not values:
            continue
        dv = DataValidation(type="list", formula1=_write_list(lists, list_col, values), allow_blank=True)
        dv.showErrorMessage = False  # a typed value is still checked on upload
        ws.add_data_validation(dv)
        letter = ws.cell(row=1, column=COLUMNS.index(name) + 1).column_letter
        dv.add(f"{letter}2:{letter}{MAX_ROWS + 1}")

    help_ws = wb.create_sheet(lb["sheet_help"])
    _apply_direction(help_ws, lang)
    help_ws.cell(row=1, column=1, value=lb["help_title"]).font = Font(bold=True, size=13)
    help_ws.cell(row=2, column=1, value=lb["help_rules"]).alignment = Alignment(wrap_text=True, vertical="top")
    help_ws.merge_cells("A2:B2")
    help_ws.row_dimensions[2].height = 45
    _write_header(help_ws, 4, [lb["help_column"], lb["help_what"]])
    for r, col in enumerate(COLUMNS, start=5):
        for c, value in enumerate((lb[col], lb["help_" + col]), start=1):
            cell = help_ws.cell(row=r, column=c, value=value)
            cell.border = _BORDER
            cell.alignment = Alignment(wrap_text=True, vertical="top")
    help_ws.column_dimensions["A"].width = 24
    help_ws.column_dimensions["B"].width = 90
    return _to_bytes(wb)


# ── 2. Read + check ─────────────────────────────────────────────────────────

def _cell_text(value: Any) -> Optional[str]:
    """Cell → trimmed text; whole numbers lose the `.0` Excel gives them."""
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    return text or None


def read_rows(content: bytes) -> List[Tuple[int, Dict[str, Optional[str]]]]:
    """(sheet row number, values by column) for every non-empty row."""
    if len(content) > MAX_FILE_BYTES:
        raise _bad("too_big")
    try:
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001 - any unreadable file gets the same answer
        raise _bad("not_import_sheet") from exc
    ws = wb.worksheets[0]
    header = [_cell_text(v) for v in next(ws.iter_rows(min_row=1, max_row=1, values_only=True), ())]
    known = {lb[COLUMNS[0]] for lb in _LABELS.values()}
    if not header or (header[0] or "").rstrip(" *") not in known:
        raise _bad("not_import_sheet")
    rows = []
    for number, values in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        cells = [_cell_text(v) for v in list(values)[: len(COLUMNS)]]
        if not any(cells):
            continue
        cells += [None] * (len(COLUMNS) - len(cells))
        rows.append((number, dict(zip(COLUMNS, cells))))
        if len(rows) > MAX_ROWS:
            raise _bad("too_many_rows")
    if not rows:
        raise _bad("no_rows")
    return rows


@dataclass
class _Row:
    row: int
    values: Dict[str, Optional[str]]
    errors: List[dict] = field(default_factory=list)
    warnings: List[dict] = field(default_factory=list)
    payload: Optional[AccessoryItemCreate] = None

    def error(self, code: str, **extra) -> None:
        self.errors.append({"code": code, **extra})


def _code_part(text: str) -> str:
    """"BTN · Buttons" → "BTN" (the dropdown shows code + name)."""
    return text.split(SEP, 1)[0].strip()


def _find_client(lists: _Lists, text: str) -> Optional[Client]:
    """By name (dropdown "UA · Under Armour" or just the name), else by a
    client code that only one client has."""
    name = text.split(SEP, 1)[1] if SEP in text else text
    client = lists.clients_by_name.get(name.strip().casefold())
    if client is not None:
        return client
    same_code = lists.clients_by_code.get(normalize_code(_code_part(text)), [])
    return same_code[0] if len(same_code) == 1 else None


_KIND_WORDS = {
    "client": {_LABELS[l]["kind_client"].casefold() for l in _LABELS},
    "supplier": {_LABELS[l]["kind_supplier"].casefold() for l in _LABELS},
}


def _find_owner(lists: _Lists, text: str) -> Tuple[Optional[int], Optional[int]]:
    """"Client · Under Armour" / "Supplier · YKK" → (client_id, supplier_id).
    Without the prefix: a supplier name, else a client."""
    kind, name = (None, text)
    if SEP in text:
        first, rest = text.split(SEP, 1)
        for k, words in _KIND_WORDS.items():
            if first.strip().casefold() in words:
                kind, name = k, rest
    if kind in (None, "supplier"):
        supplier = lists.suppliers.get(name.strip().casefold())
        if supplier is not None:
            return None, supplier.id
    if kind in (None, "client"):
        client = _find_client(lists, name)
        if client is not None:
            return client.client_id, None
    return None, None


def _check_text(r: _Row) -> None:
    for col in COLUMNS:
        value = r.values[col]
        if col in REQUIRED and not value:
            r.error("required", field=col)
        if value and col in MAX_LEN and len(value) > MAX_LEN[col]:
            r.error("too_long", field=col, max=MAX_LEN[col])


def _check_category(lists: _Lists, r: _Row) -> Optional[AccessoryCategory]:
    text = r.values["category"]
    if not text:
        return None
    category = lists.categories.get(normalize_code(_code_part(text)))
    if category is None:
        r.error("unknown", field="category", value=text)
    elif not category.active:
        r.error("switched_off", field="category", value=category.code)
    return category


def _check_client(lists: _Lists, r: _Row) -> Optional[Client]:
    text = r.values["client"]
    if not text:
        return None
    client = _find_client(lists, text)
    if client is None:
        r.error("unknown", field="client", value=text)
        return None
    try:
        item_codes.prefix_for(client.client_code, generic=False)
    except item_codes.NoClientCode:
        r.error("no_client_code", value=client.client_name)
    return client


def _check_unit(lists: _Lists, r: _Row, category: Optional[AccessoryCategory]) -> Optional[Uom]:
    """The unit typed, else the category's default unit."""
    text = r.values["base_unit"]
    if text:
        uom = lists.uoms.get(normalize_code(_code_part(text)))
        if uom is None:
            r.error("unknown", field="base_unit", value=text)
    elif category is not None:
        uom = next((u for u in lists.uoms.values() if u.id == category.default_uom_id), None)
    else:
        uom = None
    if uom is not None and not uom.active:
        r.error("switched_off", field="base_unit", value=uom.code)
    return uom


def _check_owner(lists: _Lists, r: _Row, client: Optional[Client]) -> Tuple[Optional[int], Optional[int]]:
    """(client_id, supplier_id) of the reference. Blank on a client item = that client."""
    text = r.values["ref_owner"]
    if not text:
        if client is None:
            r.error("required", field="ref_owner")
            return None, None
        return client.client_id, None
    owner = _find_owner(lists, text)
    if owner == (None, None):
        r.error("unknown", field="ref_owner", value=text)
    elif client is not None and owner[0] is not None and owner[0] != client.client_id:
        r.error("other_client")
    return owner


def _check_ref_code(db: Session, r: _Row, owner: Tuple[Optional[int], Optional[int]]) -> None:
    code = r.values["ref_code"]
    if not code:
        return
    if not normalize_code(code):
        r.error("required", field="ref_code")
    elif owner != (None, None):
        taken = items_crud.find_ref(db, code, client_id=owner[0], supplier_id=owner[1])
        if taken is not None:
            r.error("ref_taken", item_code=taken.item.code)


def _check_row(db: Session, lists: _Lists, r: _Row) -> None:
    """Check one row like the item form does; on success set `r.payload`."""
    _check_text(r)
    category = _check_category(lists, r)
    client = _check_client(lists, r)
    uom = _check_unit(lists, r, category)
    owner = _check_owner(lists, r, client)
    _check_ref_code(db, r, owner)
    if r.errors or category is None or uom is None:
        return
    v = r.values
    r.payload = AccessoryItemCreate(
        category_id=category.id,
        client_id=client.client_id if client else None,
        description=v["description"],
        color=v["color"],
        size=v["size"],
        base_uom_id=uom.id,
        refs=[AccessoryItemRefIn(
            client_id=owner[0], supplier_id=owner[1],
            ref_code=v["ref_code"], ref_description=v["ref_description"],
        )],
    )
    similar = items_crud.find_similar(
        db, category.id, r.payload.client_id, r.payload.description, r.payload.color, r.payload.size,
    )
    if similar:
        r.warnings.append({"code": "similar_item", "item_code": similar[0].code})


def _check_between_rows(rows: List[_Row]) -> None:
    """The same reference twice is an error; the same item twice a warning."""
    refs: Dict[tuple, int] = {}
    looks: Dict[tuple, int] = {}
    for r in rows:
        if r.payload is None:
            continue
        p = r.payload
        ref = p.refs[0]
        ref_key = (ref.client_id, ref.supplier_id, normalize_code(ref.ref_code))
        if ref_key in refs:
            r.errors.append({"code": "ref_twice", "row": refs[ref_key]})
        else:
            refs[ref_key] = r.row
        look_key = (p.category_id, p.client_id, normalize_code(p.description), normalize_code(p.color), normalize_code(p.size))
        if look_key in looks:
            r.warnings.append({"code": "similar_row", "row": looks[look_key]})
        else:
            looks[look_key] = r.row


def check(db: Session, content: bytes) -> List[_Row]:
    lists = _load_lists(db)
    rows = [_Row(row=n, values=v) for n, v in read_rows(content)]
    for r in rows:
        _check_row(db, lists, r)
    _check_between_rows(rows)
    return rows


def preview(db: Session, content: bytes) -> dict:
    rows = check(db, content)
    return {
        "rows": [
            {"row": r.row, "values": r.values, "errors": r.errors, "warnings": r.warnings}
            for r in rows
        ],
        "ok_count": sum(1 for r in rows if not r.errors),
        "error_count": sum(1 for r in rows if r.errors),
    }


# ── 3. Create (all or nothing) ──────────────────────────────────────────────

def create_all(db: Session, content: bytes, user_id: int) -> List[dict]:
    rows = check(db, content)
    if any(r.errors for r in rows):
        raise _bad("has_errors")
    created = []
    try:
        for r in rows:
            item = items_crud.build_item(db, r.payload, user_id)
            created.append({"row": r.row, "id": item.id, "code": item.code})
        db.commit()
    except Exception:
        db.rollback()
        raise
    return created


# ── 4. Sheet back with the new codes ────────────────────────────────────────

def build_result(db: Session, item_ids: List[int], lang: str = "en") -> bytes:
    lb = _labels(lang)
    wb = Workbook()
    ws = _items_sheet(wb, lang, extra_first=lb["item_code"])
    items = db.query(AccessoryItem).filter(AccessoryItem.id.in_(item_ids)).order_by(AccessoryItem.id).all()
    suppliers = {
        s.id: s.name
        for s in db.query(LogicalLocation).filter(
            LogicalLocation.id.in_([r.supplier_id for i in items for r in i.refs if r.supplier_id])
        )
    }
    for row, item in enumerate(items, start=2):
        ref = min(item.refs, key=lambda r: r.id) if item.refs else None
        owner = None
        if ref is not None and ref.client_id is not None:
            owner_client = db.get(Client, ref.client_id)
            owner = _owner_label("client", owner_client.client_name, lang) if owner_client else None
        elif ref is not None:
            owner = _owner_label("supplier", suppliers.get(ref.supplier_id, ""), lang)
        values = [
            item.code,
            _category_label(item.category, lang),
            _client_label(item.client) if item.client else None,
            _uom_label(item.base_uom, lang),
            item.description,
            item.color,
            item.size,
            owner,
            ref.ref_code if ref else None,
            ref.ref_description if ref else None,
        ]
        for col, value in enumerate(values, start=1):
            cell = ws.cell(row=row, column=col, value=value)
            cell.border = _BORDER
            if col == 1:
                cell.font = Font(bold=True)
    return _to_bytes(wb)
