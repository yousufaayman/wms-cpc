"""Item 35: bulk item import from Excel.

Builds workbooks in memory with openpyxl and uploads them. Covers:
1. The blank sheet: headers, dropdowns from the live lists, Arabic version.
2. Preview: OK rows, every error kind (blocks), warnings (allowed), the
   reference owner defaulting to the item's client, base unit defaulting
   to the category's, codes typed without the dropdown names.
3. Confirm: all or nothing, codes from the system, created_by from login,
   refused when any row has an error.
4. Result sheet with the new codes; permissions and the feature flag.
"""
import io

import pytest
from openpyxl import Workbook, load_workbook

from backend import models
from backend.core.config import settings
from backend.tests.test_accessory_items import _category, _client, _supplier, _uom

BASE = "/api/v1/accessory-items/import"
HEADERS = ["Category *", "Client", "Base unit", "Description *", "Color", "Size",
           "Reference owner", "Reference code *", "Reference description"]


@pytest.fixture(autouse=True)
def accessories_on(monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", True)


@pytest.fixture
def s(db):
    pcs = _uom(db, "QPC")
    cone = _uom(db, "QCN")
    off_uom = _uom(db, "QOF", active=False)
    cat = _category(db, "QEL", pcs)
    thr = _category(db, "QTH", cone)
    off_cat = _category(db, "QOC", pcs, active=False)
    cl = _client(db, "Import Client Q1", "qa")
    other = _client(db, "Import Client Q2", "qb")
    no_code = _client(db, "Import Client Q3", "gen")  # reserved for generic items = no usable code (a blank one is filled by a DB trigger)
    sup = _supplier(db, "Import Supplier Q1")
    return dict(pcs=pcs, cone=cone, off_uom=off_uom, cat=cat, thr=thr, off_cat=off_cat,
                client=cl, other=other, no_code=no_code, supplier=sup)


def _sheet(*rows, headers=HEADERS) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.append(headers)
    for r in rows:
        ws.append(list(r))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _upload(client, h, content, step="preview"):
    files = {"file": ("items.xlsx", content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    return client.post(f"{BASE}/{step}", files=files, headers=h)


def _codes(row):
    return [m["code"] for m in row["errors"]], [m["code"] for m in row["warnings"]]


def test_blank_sheet_has_headers_and_dropdowns(client, auth_headers, s):
    h = auth_headers(role="W_Manager")
    r = client.get(f"{BASE}/template", headers=h)
    assert r.status_code == 200
    wb = load_workbook(io.BytesIO(r.content))
    ws = wb.worksheets[0]
    assert [c.value for c in ws[1]] == HEADERS
    lists = wb["Lists"]
    assert lists.sheet_state == "hidden"
    values = {c.value for col in lists.iter_cols() for c in col}
    assert "QEL · QEL" in values and "QOC · QOC" not in values  # active categories only
    assert "qa · Import Client Q1" in values
    assert "Supplier · Import Supplier Q1" in values and "Client · Import Client Q1" in values
    assert len(ws.data_validations.dataValidation) == 4

    ar = load_workbook(io.BytesIO(client.get(f"{BASE}/template?lang=ar", headers=h).content))
    assert ar.worksheets[0]["A1"].value == "الفئة *"
    assert ar.worksheets[0].sheet_view.rightToLeft


def test_preview_ok_rows_and_defaults(client, auth_headers, s):
    content = _sheet(
        # dropdown values; owner blank on a client item = that client; unit blank = category default
        ["QEL · QEL", "qa · Import Client Q1", None, "Elastic 2 cm", "Black", None, None, "CL-001", "their elastic"],
        # bare codes typed by hand, supplier owner without the prefix
        ["qth", None, "QCN", "Thread 40/2", None, None, "Import Supplier Q1", 12345, None],
    )
    r = _upload(client, auth_headers(role="W_Manager"), content)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok_count"] == 2 and body["error_count"] == 0
    assert body["rows"][0]["row"] == 2
    assert body["rows"][1]["values"]["ref_code"] == "12345"  # no ".0"


def test_preview_saves_nothing(client, auth_headers, s, db):
    content = _sheet(["QEL", None, None, "Preview only", None, None, "Import Supplier Q1", "PV-1", None])
    assert _upload(client, auth_headers(role="W_Manager"), content).json()["ok_count"] == 1
    assert db.query(models.AccessoryItem).filter_by(description="Preview only").count() == 0


def test_preview_errors_block_and_warnings_allow(client, auth_headers, s, db):
    h = auth_headers(role="W_Manager")
    existing = client.post("/api/v1/accessory-items/", headers=h, json={
        "category_id": s["cat"].id, "client_id": None, "description": "Zip 20 cm", "base_uom_id": s["pcs"].id,
        "refs": [{"supplier_id": s["supplier"].id, "ref_code": "TAKEN-1"}],
    }).json()
    content = _sheet(
        [None] * 9 + ["x"],  # 2: only a cell past the last column -> blank, skipped
        ["NOPE", None, None, "A", None, None, "Supplier · Import Supplier Q1", "R1", None],  # 3 unknown category
        ["QOC", None, None, "A", None, None, "Supplier · Import Supplier Q1", "R2", None],  # 4 switched off
        ["QEL", "Import Client Q3", None, "A", None, None, None, "R3", None],  # 5 client without code
        ["QEL", None, "QOF", "A", None, None, "Supplier · Import Supplier Q1", "R4", None],  # 6 unit off
        ["QEL", None, None, "A", None, None, None, "R5", None],  # 7 generic needs an owner
        ["QEL", "qa · Import Client Q1", None, "A", None, None, "Client · Import Client Q2", "R6", None],  # 8 other client's code
        ["QEL", None, None, "A", None, None, "Supplier · Import Supplier Q1", "taken 1", None],  # 9 ref taken
        ["QEL", None, None, "B" * 300, None, None, "Supplier · Import Supplier Q1", "R7", None],  # 10 too long
        ["QEL", None, None, "C", None, None, "Supplier · Import Supplier Q1", "R-8", None],  # 11 ok
        ["QEL", None, None, "D", None, None, "Supplier · Import Supplier Q1", "r8", None],  # 12 same ref as 11
        ["QEL", None, None, "zip 20cm", None, None, "Supplier · Import Supplier Q1", "R9", None],  # 13 like existing
        ["QEL", None, None, "C", None, None, "Supplier · Import Supplier Q1", "R10", None],  # 14 like row 11
        ["QEL", None, None, None, None, None, "Nobody", None, None],  # 15 required + unknown owner
    )
    r = _upload(client, h, content)
    assert r.status_code == 200, r.text
    rows = {row["row"]: row for row in r.json()["rows"]}
    assert 2 not in rows
    assert _codes(rows[3])[0] == ["unknown"] and rows[3]["errors"][0]["field"] == "category"
    assert _codes(rows[4])[0] == ["switched_off"]
    assert _codes(rows[5])[0] == ["no_client_code"]
    assert _codes(rows[6])[0] == ["switched_off"] and rows[6]["errors"][0]["field"] == "base_unit"
    assert rows[7]["errors"] == [{"code": "required", "field": "ref_owner", "value": None, "max": None, "row": None, "item_code": None}]
    assert _codes(rows[8])[0] == ["other_client"]
    assert rows[9]["errors"][0]["code"] == "ref_taken" and rows[9]["errors"][0]["item_code"] == existing["code"]
    assert rows[10]["errors"][0] == {"code": "too_long", "field": "description", "value": None, "max": 255, "row": None, "item_code": None}
    assert _codes(rows[11]) == ([], [])
    assert rows[12]["errors"][0]["code"] == "ref_twice" and rows[12]["errors"][0]["row"] == 11
    assert _codes(rows[13]) == ([], ["similar_item"]) and rows[13]["warnings"][0]["item_code"] == existing["code"]
    assert _codes(rows[14]) == ([], ["similar_row"]) and rows[14]["warnings"][0]["row"] == 11
    assert sorted(_codes(rows[15])[0]) == ["required", "required", "unknown"]

    # Any error = nothing created
    before = db.query(models.AccessoryItem).count()
    assert _upload(client, h, content, "confirm").status_code == 400
    assert db.query(models.AccessoryItem).count() == before


def test_confirm_creates_all_and_result_sheet(client, auth_headers, make_user, s, db):
    user = make_user("W_Manager")
    h = auth_headers(user=user)
    content = _sheet(
        ["QEL · QEL", "qa · Import Client Q1", None, "Elastic 2 cm", "Black", "M", None, "CL-001", "their elastic"],
        ["QTH", None, None, "Thread 40/2", None, None, "Import Supplier Q1", "T-77", None],
        ["QEL", None, None, "Elastic 2 cm", None, None, "Supplier · Import Supplier Q1", "S-1", None],
    )
    r = _upload(client, h, content, "confirm")
    assert r.status_code == 201, r.text
    created = r.json()
    assert [c["code"] for c in created] == ["QA-QEL-0001", "GEN-QTH-0001", "GEN-QEL-0001"]
    assert [c["row"] for c in created] == [2, 3, 4]
    first = db.get(models.AccessoryItem, created[0]["id"])
    assert first.created_by == user.id and first.base_uom_id == s["pcs"].id and first.size == "M"
    assert [(ref.client_id, ref.ref_code, ref.ref_description) for ref in first.refs] == [(s["client"].client_id, "CL-001", "their elastic")]
    thread = db.get(models.AccessoryItem, created[1]["id"])
    assert thread.base_uom_id == s["cone"].id and thread.refs[0].supplier_id == s["supplier"].id

    # The same file again: every reference is now taken -> refused, nothing new
    again = _upload(client, h, content, "preview").json()
    assert again["error_count"] == 3
    assert _upload(client, h, content, "confirm").status_code == 400

    ids = "&".join(f"ids={c['id']}" for c in created)
    res = client.get(f"{BASE}/result?{ids}", headers=h)
    assert res.status_code == 200
    ws = load_workbook(io.BytesIO(res.content)).worksheets[0]
    assert ws["A1"].value == "Item code"
    assert [ws.cell(row=i, column=1).value for i in (2, 3, 4)] == ["QA-QEL-0001", "GEN-QTH-0001", "GEN-QEL-0001"]
    assert ws["H2"].value == "Client · Import Client Q1" and ws["I2"].value == "CL-001"
    assert ws["H3"].value == "Supplier · Import Supplier Q1"


def test_bad_files(client, auth_headers, s):
    h = auth_headers(role="W_Manager")
    assert _upload(client, h, b"not excel").json()["detail"] == "not_import_sheet"
    assert _upload(client, h, _sheet(["x"], headers=["Something else"])).json()["detail"] == "not_import_sheet"
    assert _upload(client, h, _sheet()).json()["detail"] == "no_rows"
    many = _sheet(*[["QEL", None, None, f"Item {i}", None, None, "Import Supplier Q1", f"M-{i}", None] for i in range(501)])
    assert _upload(client, h, many).json()["detail"] == "too_many_rows"
    ar = _sheet(["QEL", None, None, "A", None, None, "مورد · Import Supplier Q1", "AR-1", None],
                headers=["الفئة *"] + HEADERS[1:])
    body = _upload(client, h, ar).json()
    assert body["ok_count"] == 1, body


def test_permissions_and_flag(client, auth_headers, s, monkeypatch):
    content = _sheet(["QEL", None, None, "A", None, None, "Import Supplier Q1", "P-1", None])
    worker = auth_headers(role="W_Worker")
    assert client.get(f"{BASE}/template", headers=worker).status_code == 403
    assert _upload(client, worker, content).status_code == 403
    assert _upload(client, worker, content, "confirm").status_code == 403
    assert client.get(f"{BASE}/result?ids=1", headers=worker).status_code == 403
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    assert client.get(f"{BASE}/template", headers=auth_headers(role="admin")).status_code == 404
