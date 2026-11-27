"""Excel workbook for Accessory Analytics (item 26).

Turns the report rows of `crud/accessory_analytics.py` into an .xlsx file,
in English or Arabic (Arabic sheets read right-to-left). One sheet per
report; "Export all" puts the five in one workbook, a tab's own export puts
only its sheet. The look (header colours, borders, column widths) is shared
with the fabric exports in `analytics_export.py`.

Quantities stay per unit: a total row is written per unit, never one sum of
PCS and metres.
"""
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Callable, Dict, List, Optional, Sequence

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.worksheet.worksheet import Worksheet

from backend.crud.analytics_export import (
    _BORDER,
    _GRAND_FILL,
    _GRAND_FONT,
    _apply_direction,
    _autosize,
    _to_bytes,
    _write_header,
)

SHEETS = ("stock", "flow", "jo_issues", "slow_moving", "deliveries")

_LABELS: Dict[str, Dict[str, str]] = {
    "en": {
        "title": "Accessory report",
        "warehouse": "Warehouse",
        "period": "Period",
        "all_dates": "All dates",
        "printed": "Exported",
        "sheet_stock": "Stock on hand",
        "sheet_flow": "Stock flow",
        "sheet_jo_issues": "Issued to job orders",
        "sheet_slow_moving": "Slow-moving stock",
        "sheet_deliveries": "Expected vs received",
        "item_code": "Item code",
        "description": "Description",
        "color": "Color",
        "size": "Size",
        "template": "Template",
        "client": "Client",
        "category": "Category",
        "unit": "Unit",
        "generic": "Generic",
        "client_specific": "Client-specific",
        "packs": "Packs",
        "on_hand": "On hand",
        "unracked": "Waiting for put-away",
        "racks": "Racks",
        "opening": "Opening qty",
        "received": "Received",
        "issued": "Issued",
        "returned": "Returned",
        "supplier_returns": "Supplier returns",
        "written_off": "Written off",
        "adjusted": "Adjusted",
        "reclassified": "Reclassified",
        "closing": "Closing qty",
        "job_order": "Job order",
        "net": "Net used",
        "last_movement": "Last movement",
        "idle_days": "Days idle",
        "kind": "Generic / Client-specific",
        "no_movement_for": "No movement for (days)",
        "delivery": "Delivery #",
        "expected_date": "Expected Date",
        "supplier": "Supplier",
        "expected": "Expected quantity",
        "received_qty": "Received quantity",
        "difference": "Difference",
        "state": "Status",
        "state_waiting": "Waiting",
        "state_partial": "Partly received",
        "state_complete": "Complete",
        "state_over": "Over-received",
        "total": "Total ({uom})",
        "no_data": "No data",
        "supplier_codes": "Supplier codes",
        "received_by_supplier": "Received by supplier",
        "no_supplier": "No supplier",
    },
    "ar": {
        "title": "تقرير الإكسسوارات",
        "warehouse": "المخزن",
        "period": "الفترة",
        "all_dates": "كل التواريخ",
        "printed": "تاريخ التصدير",
        "sheet_stock": "الرصيد الحالي",
        "sheet_flow": "حركة المخزون",
        "sheet_jo_issues": "المنصرف لأوامر التشغيل",
        "sheet_slow_moving": "المخزون الراكد",
        "sheet_deliveries": "المتوقع مقابل المستلم",
        "item_code": "كود الصنف",
        "description": "الوصف",
        "color": "اللون",
        "size": "المقاس",
        "template": "قالب",
        "client": "العميل",
        "category": "الفئة",
        "unit": "الوحدة الأساسية",
        "generic": "عام",
        "client_specific": "خاص بعميل",
        "packs": "عدد العبوات",
        "on_hand": "الرصيد",
        "unracked": "في انتظار التسكين",
        "racks": "الرفوف",
        "opening": "الرصيد الافتتاحي",
        "received": "المستلم",
        "issued": "المنصرف",
        "returned": "المرتجع",
        "supplier_returns": "مرتجع للمورد",
        "written_off": "المشطوب",
        "adjusted": "التسويات",
        "reclassified": "إعادة التصنيف",
        "closing": "الرصيد الختامي",
        "job_order": "أمر التشغيل",
        "net": "صافي الاستهلاك",
        "last_movement": "آخر حركة",
        "idle_days": "أيام الركود",
        "kind": "عام / خاص بعميل",
        "no_movement_for": "بدون حركة منذ (يوم)",
        "delivery": "تسليم #",
        "expected_date": "التاريخ المتوقع",
        "supplier": "المورد",
        "expected": "الكمية المتوقعة",
        "received_qty": "الكمية المستلمة",
        "difference": "الفرق",
        "state": "الحالة",
        "state_waiting": "بانتظار الاستلام",
        "state_partial": "مستلم جزئياً",
        "state_complete": "مكتمل",
        "state_over": "مستلم بالزيادة",
        "total": "الإجمالي ({uom})",
        "no_data": "لا توجد بيانات",
        "supplier_codes": "أكواد المورد",
        "received_by_supplier": "المستلم حسب المورد",
        "no_supplier": "بدون مورد",
    },
}


def _num(v: Any) -> Optional[float]:
    return float(v) if v is not None else None


def _day(v: Any) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    return v.isoformat() if isinstance(v, date) else str(v)


# A column = (label key, how to get the cell value from a row, is it a quantity?)
Column = tuple


def _item_columns(lang: str) -> List[Column]:
    labels = _LABELS[lang]
    cat = "category_name_ar" if lang == "ar" else "category_name_en"
    return [
        ("item_code", lambda r: r["item_code"], False),
        ("description", lambda r: r["description"], False),
        ("color", lambda r: r.get("color"), False),
        ("size", lambda r: r.get("size"), False),
        ("client", lambda r: r.get("client_name") or labels["generic"], False),
        ("category", lambda r: r.get(cat), False),
        ("unit", lambda r: r["uom_code"], False),
        ("supplier_codes", _supplier_codes, False),
    ]


def _supplier_codes(r: dict) -> Optional[str]:
    """'YKK: SUP-1; Coats: C-77' (the item's supplier references)."""
    refs = r.get("supplier_refs") or []
    return "; ".join(f"{x['supplier_name']}: {x['ref_code']}" if x.get("supplier_name") else x["ref_code"]
                     for x in refs) or None


def _qty(key: str) -> Column:
    return (key, lambda r: _num(r[key]), True)


def _write_sheet(
    ws: Worksheet, title: str, meta: List[tuple], columns: Sequence[Column], rows: List[dict], lang: str,
) -> None:
    """Title, info lines, header, one row per report row, then a total row
    per unit for the quantity columns."""
    labels = _LABELS[lang]
    ws.cell(row=1, column=1, value=title).font = Font(bold=True, size=13)
    r = 2
    for key, value in meta:
        ws.cell(row=r, column=1, value=labels[key]).font = Font(bold=True)
        ws.cell(row=r, column=2, value=value)
        r += 1
    r += 1
    _write_header(ws, r, [labels[c[0]] for c in columns])
    r += 1
    if not rows:
        ws.cell(row=r, column=1, value=labels["no_data"]).font = Font(italic=True, color="888888")
    for row in rows:
        for col, (_, get, _) in enumerate(columns, start=1):
            ws.cell(row=r, column=col, value=get(row)).border = _BORDER
        r += 1

    qty_cols = [(i, c) for i, c in enumerate(columns, start=1) if c[2]]
    if rows and qty_cols:
        by_uom: Dict[str, Dict[int, float]] = defaultdict(lambda: defaultdict(float))
        for row in rows:
            for i, (_, get, _) in qty_cols:
                by_uom[row["uom_code"]][i] += get(row) or 0
        for uom in sorted(by_uom):
            ws.cell(row=r, column=1, value=labels["total"].format(uom=uom)).font = _GRAND_FONT
            for col in range(1, len(columns) + 1):
                ws.cell(row=r, column=col).fill = _GRAND_FILL
            for i, _ in qty_cols:
                ws.cell(row=r, column=i, value=round(by_uom[uom][i], 4)).font = _GRAND_FONT
            r += 1
    _autosize(ws, len(columns))
    _apply_direction(ws, lang)


def _stock(ws, data, meta, lang):
    columns = _item_columns(lang) + [
        ("packs", lambda r: r["pack_count"], False),
        _qty("on_hand"),
        _qty("unracked"),
        ("racks", lambda r: ", ".join(r["racks"]), False),
    ]
    _write_sheet(ws, _LABELS[lang]["sheet_stock"], meta, columns, data["stock"], lang)


def _flow(ws, data, meta, lang):
    labels = _LABELS[lang]

    def by_supplier(r):
        return "; ".join(f"{x.get('supplier_name') or labels['no_supplier']}: {_num(x['qty']):g}"
                         for x in r.get("received_by_supplier") or []) or None

    columns = _item_columns(lang) + [_qty(k) for k in (
        "opening", "received", "issued", "returned", "supplier_returns", "written_off", "adjusted",
        "reclassified", "closing",
    )] + [("received_by_supplier", by_supplier, False)]
    _write_sheet(ws, _LABELS[lang]["sheet_flow"], meta, columns, data["flow"], lang)


def _jo_issues(ws, data, meta, lang):
    labels = _LABELS[lang]
    rows = [
        {**line, "job_order_number": jo["job_order_number"], "jo_client": jo["client_name"]}
        for jo in data["jo_issues"] for line in jo["lines"]
    ]
    item_cols = [c for c in _item_columns(lang) if c[0] != "client"]
    columns = [
        ("job_order", lambda r: r["job_order_number"], False),
        ("client", lambda r: r.get("jo_client") or labels["generic"], False),
        *item_cols,
        _qty("issued"), _qty("returned"), _qty("net"),
    ]
    _write_sheet(ws, labels["sheet_jo_issues"], meta, columns, rows, lang)


def _slow_moving(ws, data, meta, lang):
    labels = _LABELS[lang]
    columns = _item_columns(lang) + [
        _qty("on_hand"),
        ("packs", lambda r: r["pack_count"], False),
        ("racks", lambda r: ", ".join(r["racks"]), False),
        ("last_movement", lambda r: _day(r.get("last_movement")), False),
        ("idle_days", lambda r: r["idle_days"], False),
        ("kind", lambda r: labels["generic"] if r["generic"] else labels["client_specific"], False),
    ]
    _write_sheet(ws, labels["sheet_slow_moving"], meta + [("no_movement_for", data["days"])], columns,
                 data["slow_moving"], lang)


def _deliveries(ws, data, meta, lang):
    labels = _LABELS[lang]
    columns = [
        ("delivery", lambda r: r["delivery_id"], False),
        ("expected_date", lambda r: _day(r.get("expected_date")), False),
        ("supplier", lambda r: r.get("supplier_name"), False),
        *_item_columns(lang),
        _qty("expected"), _qty("received_qty"), _qty("difference"),
        ("state", lambda r: labels.get(f"state_{r['state']}", r["state"]), False),
    ]
    rows = [{**r, "expected": r["expected_qty"]} for r in data["deliveries"]]
    _write_sheet(ws, labels["sheet_deliveries"], meta, columns, rows, lang)


_BUILDERS: Dict[str, Callable] = {
    "stock": _stock,
    "flow": _flow,
    "jo_issues": _jo_issues,
    "slow_moving": _slow_moving,
    "deliveries": _deliveries,
}
# Reports that depend on the date range (the others are "now").
_DATED = {"flow", "jo_issues"}


def build_workbook(
    sheets: Sequence[str], data: Dict[str, Any], *, warehouse_name: str,
    date_from: Optional[date], date_to: Optional[date], supplier_name: Optional[str] = None, lang: str = "en",
) -> bytes:
    """`data` holds the rows of each sheet in `sheets` (keys as in SHEETS),
    plus `days` for the slow-moving sheet. `supplier_name`: the Supplier
    filter, written at the top of the sheets it applies to."""
    labels = _LABELS[lang if lang in _LABELS else "en"]
    lang = lang if lang in _LABELS else "en"
    if date_from or date_to:
        period = f"{_day(date_from) or '…'} → {_day(date_to) or '…'}"
    else:
        period = labels["all_dates"]
    wb = Workbook()
    wb.remove(wb.active)
    for key in sheets:
        ws = wb.create_sheet(labels[f"sheet_{key}"][:31])
        meta = [("warehouse", warehouse_name), ("printed", date.today().isoformat())]
        if key in _DATED:
            meta.insert(1, ("period", period))
        if supplier_name and key != "jo_issues":  # job orders aren't filtered by supplier
            meta.insert(1, ("supplier", supplier_name))
        _BUILDERS[key](ws, data, meta, lang)
    return _to_bytes(wb)
