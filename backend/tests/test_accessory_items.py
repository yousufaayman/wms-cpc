"""Item 8: accessory items, code generation, per-item unit conversions.

Each test makes its own units, categories and clients, so it runs on a
structure-only test DB too. Covers:
1. Codes: `<client code|GEN>-<category>-<0001>`, counted per prefix + category,
   never reused, two clients sharing a client code never collide.
2. The API: who may read/create, flag off = 404, created_by from the login,
   category/client fixed after creation, switched-off category/unit refused,
   search and filters.
3. Per-item conversions: one side must be the base unit, they win over the
   global pair in `uom.convert`, base unit locked while they exist.
"""
from decimal import Decimal

import pytest

from backend import models
from backend.core.config import settings
from backend.domains.accessories import uom as uom_conv

ITEMS = "/api/v1/accessory-items/"


@pytest.fixture(autouse=True)
def accessories_on(monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", True)


def _uom(db, code, active=True):
    u = models.Uom(code=code, name_en=code.title(), name_ar="عربي", active=active)
    db.add(u)
    db.flush()
    return u


def _category(db, code, uom, active=True):
    c = models.AccessoryCategory(code=code, name_en=code, name_ar="عربي", default_uom_id=uom.id, active=active)
    db.add(c)
    db.flush()
    return c


def _client(db, name, code):
    c = models.Client(client_name=name, client_code=code)
    db.add(c)
    db.flush()
    return c


@pytest.fixture
def setup(db):
    pcs = _uom(db, "QPC")
    cone = _uom(db, "QCN")
    mtr = _uom(db, "QMT")
    cat = _category(db, "QEL", pcs)
    thr = _category(db, "QTH", cone)
    client = _client(db, "Test Client Q1", "qa")
    return {"pcs": pcs, "cone": cone, "m": mtr, "cat": cat, "thr": thr, "client": client}


def _create(client, h, s, **over):
    body = {"category_id": s["cat"].id, "client_id": None, "description": "Elastic 2 cm", "base_uom_id": s["pcs"].id}
    body.update(over)
    return client.post(ITEMS, json=body, headers=h)


# ── 1. Codes ────────────────────────────────────────────────────────────────

def test_generic_codes_count_up(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    first = _create(client, h, setup)
    second = _create(client, h, setup)
    assert first.status_code == 201, first.text
    assert first.json()["code"] == "GEN-QEL-0001"
    assert second.json()["code"] == "GEN-QEL-0002"


def test_client_code_prefix_upper_case_and_separate_counter(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    _create(client, h, setup)  # GEN-QEL-0001
    r = _create(client, h, setup, client_id=setup["client"].id)
    assert r.json()["code"] == "QA-QEL-0001"
    other_cat = _create(client, h, setup, client_id=setup["client"].id, category_id=setup["thr"].id, base_uom_id=setup["cone"].id)
    assert other_cat.json()["code"] == "QA-QTH-0001"


def test_two_clients_with_the_same_code_never_collide(client, auth_headers, setup, db):
    twin = _client(db, "Test Client Q2", "QA")
    h = auth_headers(role="W_Manager")
    a = _create(client, h, setup, client_id=setup["client"].id).json()["code"]
    b = _create(client, h, setup, client_id=twin.id).json()["code"]
    assert {a, b} == {"QA-QEL-0001", "QA-QEL-0002"}


def test_codes_are_not_reused_after_switching_off(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    first = _create(client, h, setup).json()
    assert client.patch(f"{ITEMS}{first['id']}", json={"active": False}, headers=h).status_code == 200
    assert _create(client, h, setup).json()["code"] == "GEN-QEL-0002"


def test_client_without_code_refused(client, auth_headers, setup, db):
    blank = _client(db, "Test Client Q3", " ")
    reserved = _client(db, "Test Client Q4", "gen")
    h = auth_headers(role="W_Manager")
    assert _create(client, h, setup, client_id=blank.id).status_code == 400
    assert _create(client, h, setup, client_id=reserved.id).status_code == 400


# ── 2. API ──────────────────────────────────────────────────────────────────

def test_feature_off_hides_the_endpoints(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    assert client.get(ITEMS, headers=auth_headers(role="W_Manager")).status_code == 404


def test_viewer_reads_worker_cannot_create(client, auth_headers, setup):
    assert client.get(ITEMS, headers=auth_headers(role="Viewer")).status_code == 200
    assert _create(client, auth_headers(role="W_Worker"), setup).status_code == 403


def test_created_by_is_the_logged_in_user(client, make_user, auth_headers, setup):
    user = make_user("W_Manager")
    r = _create(client, auth_headers(user=user), setup, created_by=999999)
    assert r.status_code == 201
    assert r.json()["created_by"] == user.id


def test_category_and_client_cannot_change(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    item = _create(client, h, setup).json()
    r = client.patch(
        f"{ITEMS}{item['id']}",
        json={"category_id": setup["thr"].id, "client_id": setup["client"].id, "description": "Elastic 3 cm"},
        headers=h,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["category_id"] == setup["cat"].id and body["client_id"] is None
    assert body["description"] == "Elastic 3 cm" and body["code"] == item["code"]
    assert body["updated_at"] is not None


def test_switched_off_category_or_unit_refused(client, auth_headers, setup, db):
    h = auth_headers(role="W_Manager")
    off_cat = _category(db, "QOF", setup["pcs"], active=False)
    off_uom = _uom(db, "QOU", active=False)
    assert _create(client, h, setup, category_id=off_cat.id).status_code == 400
    assert _create(client, h, setup, base_uom_id=off_uom.id).status_code == 400


def test_blank_description_refused_and_color_size_cleared(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    assert _create(client, h, setup, description="   ").status_code == 422
    item = _create(client, h, setup, color=" Navy ", size="").json()
    assert item["color"] == "Navy" and item["size"] is None
    r = client.patch(f"{ITEMS}{item['id']}", json={"color": ""}, headers=h)
    assert r.json()["color"] is None


def test_search_and_filters(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    _create(client, h, setup, description="Flat elastic", color="Black")
    _create(client, h, setup, description="Round elastic", client_id=setup["client"].id)
    off = _create(client, h, setup, description="Old elastic").json()
    client.patch(f"{ITEMS}{off['id']}", json={"active": False}, headers=h)

    def codes(**params):
        params.setdefault("category_id", setup["cat"].id)
        return {i["description"] for i in client.get(ITEMS, params=params, headers=h).json()["items"]}

    assert codes() == {"Flat elastic", "Round elastic"}
    assert codes(q="black") == {"Flat elastic"}
    assert codes(q="qa-qel") == {"Round elastic"}
    assert codes(generic_only=True) == {"Flat elastic"}
    assert codes(client_id=setup["client"].id) == {"Round elastic"}
    assert "Old elastic" in codes(active_only=False)


# ── 3. Per-item conversions ─────────────────────────────────────────────────

def test_item_conversion_wins_over_global(client, auth_headers, setup, db):
    h = auth_headers(role="W_Manager")
    db.add(models.UomConversion(from_uom_id=setup["cone"].id, to_uom_id=setup["m"].id, factor=1000))
    db.flush()
    item = _create(client, h, setup, category_id=setup["thr"].id, base_uom_id=setup["m"].id).json()
    r = client.post(
        f"{ITEMS}{item['id']}/conversions",
        json={"from_uom_id": setup["cone"].id, "to_uom_id": setup["m"].id, "factor": 5000},
        headers=h,
    )
    assert r.status_code == 201, r.text
    assert uom_conv.to_base(db, 2, setup["cone"].id, setup["m"].id, item_id=item["id"]) == Decimal("10000")
    assert uom_conv.to_base(db, 2, setup["cone"].id, setup["m"].id) == Decimal("2000")  # global
    # The item's conversion doesn't show in the global list.
    globals_ = client.get("/api/v1/uoms/conversions", headers=h).json()
    assert all(c["accessory_item_id"] is None for c in globals_)


def test_item_conversion_rules(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    item = _create(client, h, setup, base_uom_id=setup["m"].id).json()
    url = f"{ITEMS}{item['id']}/conversions"
    # Neither side is the base unit (M).
    assert client.post(url, json={"from_uom_id": setup["cone"].id, "to_uom_id": setup["pcs"].id, "factor": 2}, headers=h).status_code == 400
    assert client.post(url, json={"from_uom_id": setup["cone"].id, "to_uom_id": setup["m"].id, "factor": 5000}, headers=h).status_code == 201
    # Same pair, other direction.
    assert client.post(url, json={"from_uom_id": setup["m"].id, "to_uom_id": setup["cone"].id, "factor": 0.0002}, headers=h).status_code == 409
    # Base unit is locked while the item has its own conversions.
    assert client.patch(f"{ITEMS}{item['id']}", json={"base_uom_id": setup["pcs"].id}, headers=h).status_code == 400
    conv_id = client.get(url, headers=h).json()[0]["id"]
    assert client.delete(f"{url}/{conv_id}", headers=h).status_code == 204
    assert client.patch(f"{ITEMS}{item['id']}", json={"base_uom_id": setup["pcs"].id}, headers=h).status_code == 200
