"""Item 7: units of measure, unit conversions, trim categories.

1. The seed rows from cpc-db (units with Arabic names, 1 DOZ = 12 PCS, the
   13 starter categories). Skipped on a structure-only test DB (no rows).
2. The API: who may read/edit, the accessories flag, the rules (codes
   upper-case and unique, codes never change, one conversion per pair).
3. `domains/accessories/uom.convert`: both directions, rounding, no pair.
"""
from decimal import Decimal

import pytest

from backend import models
from backend.core.config import settings
from backend.domains.accessories import uom as uom_conv

UOMS = "/api/v1/uoms/"
CONVERSIONS = "/api/v1/uoms/conversions"
CATEGORIES = "/api/v1/accessory-categories/"


@pytest.fixture(autouse=True)
def accessories_on(monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", True)


def _uom(db, code, decimals=False, active=True):
    u = models.Uom(code=code, name_en=code.title(), name_ar="عربي", allows_decimals=decimals, active=active)
    db.add(u)
    db.flush()
    return u


# ── 1. Seed ──────────────────────────────────────────────────────────────────

def _seeded(db):
    if db.query(models.Uom).count() == 0:
        pytest.skip("structure-only test DB: seed rows come from cpc-db migrations")


def test_seed_units(db):
    _seeded(db)
    units = {u.code: u for u in db.query(models.Uom).all()}
    assert {"PCS", "M", "CONE", "KG", "DOZ"} <= set(units)
    assert units["PCS"].name_ar == "قطعة"
    assert units["DOZ"].name_ar == "دستة"
    assert units["M"].allows_decimals and not units["PCS"].allows_decimals


def test_seed_dozen_is_12_pieces(db):
    _seeded(db)
    pcs = db.query(models.Uom).filter_by(code="PCS").one()
    doz = db.query(models.Uom).filter_by(code="DOZ").one()
    assert uom_conv.convert(db, 3, doz.id, pcs.id) == Decimal("36")


def test_seed_categories(db):
    _seeded(db)
    cats = {c.code: c for c in db.query(models.AccessoryCategory).all()}
    expected = {"BTN", "ZIP", "LBL", "HTG", "TKT", "ELS", "THR", "INT", "DRC", "SNP", "TPE", "PKG", "NDL"}
    assert expected <= set(cats)
    assert cats["THR"].default_uom.code == "CONE"  # thread is counted in cones
    assert cats["ELS"].default_uom.code == "M"
    assert cats["LBL"].default_client_specific
    assert all(c.name_ar for c in cats.values())


# ── 2. API ───────────────────────────────────────────────────────────────────

def test_feature_off_hides_the_endpoints(client, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    h = auth_headers(role="W_Manager")
    assert client.get(UOMS, headers=h).status_code == 404
    assert client.get(CATEGORIES, headers=h).status_code == 404


def test_needs_login(client):
    assert client.get(UOMS).status_code in (401, 403)


def test_viewer_reads_worker_cannot_edit(client, auth_headers):
    assert client.get(UOMS, headers=auth_headers(role="Viewer")).status_code == 200
    assert client.get(CATEGORIES, headers=auth_headers(role="Viewer")).status_code == 200
    r = client.post(UOMS, json={"code": "TBOX", "name_en": "Box", "name_ar": "علبة"}, headers=auth_headers(role="W_Worker"))
    assert r.status_code == 403


def test_create_unit_normalizes_code_and_refuses_duplicates(client, auth_headers):
    h = auth_headers(role="W_Manager")
    r = client.post(UOMS, json={"code": " tgrs ", "name_en": " Gross ", "name_ar": "جروس"}, headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["code"] == "TGRS" and r.json()["name_en"] == "Gross"
    assert client.post(UOMS, json={"code": "TGRS", "name_en": "x", "name_ar": "x"}, headers=h).status_code == 409
    assert client.post(UOMS, json={"code": "T-1", "name_en": "x", "name_ar": "x"}, headers=h).status_code == 422


def test_edit_unit_and_switch_off(client, auth_headers, db):
    u = _uom(db, "TROLL")
    h = auth_headers(role="W_Manager")
    r = client.patch(f"{UOMS}{u.id}", json={"name_ar": "رول", "active": False, "code": "HACK"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["name_ar"] == "رول" and r.json()["active"] is False
    assert r.json()["code"] == "TROLL"  # code is not editable
    active = client.get(UOMS, params={"active_only": True}, headers=h).json()
    assert u.id not in {x["id"] for x in active}


def test_conversion_rules(client, auth_headers, db):
    a, b = _uom(db, "TBAG"), _uom(db, "TPC")
    h = auth_headers(role="W_Manager")
    r = client.post(CONVERSIONS, json={"from_uom_id": a.id, "to_uom_id": b.id, "factor": 50}, headers=h)
    assert r.status_code == 201, r.text
    conv_id = r.json()["id"]
    assert r.json()["factor"] == 50
    # The reverse pair is already answered by this row.
    assert client.post(CONVERSIONS, json={"from_uom_id": b.id, "to_uom_id": a.id, "factor": 0.02}, headers=h).status_code == 409
    assert client.post(CONVERSIONS, json={"from_uom_id": a.id, "to_uom_id": a.id, "factor": 1}, headers=h).status_code == 400
    assert client.post(CONVERSIONS, json={"from_uom_id": a.id, "to_uom_id": b.id, "factor": 0}, headers=h).status_code == 422
    assert client.patch(f"{CONVERSIONS}/{conv_id}", json={"factor": 25}, headers=h).json()["factor"] == 25
    assert client.delete(f"{CONVERSIONS}/{conv_id}", headers=h).status_code == 204
    assert conv_id not in {c["id"] for c in client.get(CONVERSIONS, headers=h).json()}


def test_category_rules(client, auth_headers, db):
    pcs, off = _uom(db, "TPCS"), _uom(db, "TOFF", active=False)
    h = auth_headers(role="W_Manager")
    body = {"code": "qzz", "name_en": "Badges", "name_ar": "بادج", "default_uom_id": pcs.id, "default_client_specific": True}
    r = client.post(CATEGORIES, json=body, headers=h)
    assert r.status_code == 201, r.text
    cat = r.json()
    assert cat["code"] == "QZZ" and cat["default_client_specific"] is True
    assert client.post(CATEGORIES, json=body, headers=h).status_code == 409
    assert client.post(CATEGORIES, json={**body, "code": "Q1"}, headers=h).status_code == 422
    assert client.post(CATEGORIES, json={**body, "code": "QZY", "default_uom_id": off.id}, headers=h).status_code == 400
    r = client.patch(f"{CATEGORIES}{cat['id']}", json={"name_ar": "بادجات", "code": "NEW"}, headers=h)
    assert r.json()["name_ar"] == "بادجات" and r.json()["code"] == "QZZ"
    assert client.patch(f"{CATEGORIES}{cat['id']}", json={"default_uom_id": off.id}, headers=h).status_code == 400
    assert client.patch(f"{CATEGORIES}99999999", json={"name_en": "x"}, headers=h).status_code == 404


# ── 3. Conversion helper ─────────────────────────────────────────────────────

def test_convert_both_ways_and_rounding(db):
    box, pc, m = _uom(db, "TBX"), _uom(db, "TP"), _uom(db, "TM", decimals=True)
    db.add(models.UomConversion(from_uom_id=box.id, to_uom_id=pc.id, factor=3))
    db.flush()
    assert uom_conv.convert(db, 2, box.id, pc.id) == Decimal("6")
    assert uom_conv.convert(db, 1, pc.id, box.id) == Decimal("0.3333")  # 4 places, like the ledger
    assert uom_conv.to_base(db, Decimal("2.5"), box.id, pc.id) == Decimal("7.5")
    assert uom_conv.convert(db, 7, m.id, m.id) == Decimal("7")
    with pytest.raises(uom_conv.NoConversion):
        uom_conv.convert(db, 1, m.id, pc.id)
