"""Item 10: templates (items with variable lines) and their variants.

1. Pure rules (`domains/accessories/variants.py`): line keys from labels,
   value cleaning per type, the comparison key.
2. Lines: adding the first makes a template; a variant can't have lines;
   after variants exist only optional lines; a used line can't be deleted or
   change type; can't become required while a variant lacks it.
3. Variants: code = template code + 3 digits; category / client / unit from
   the template; required / unknown / badly typed values refused; the same
   combination (case, spaces, 34.99 = 34.990) refused with 409, `check`
   finds it; color / size make a different variant; edits re-check.
4. Stock rules: a template isn't stockable, a variant of a switched-off
   template isn't either; variants use the template's conversions and unit;
   switched-off templates take no new variants.
5. Search: template references and values find variants; kind filter.
Reuses the set-up helpers of test_accessory_items.py.
"""
from decimal import Decimal
from types import SimpleNamespace

import pytest

from backend.crud import accessory_items as crud
from backend.domains.accessories import uom, variants
from backend.models import AccessoryItem, UomConversion
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    ITEMS,
    _create,
    accessories_on,
    setup,
)


def _f(key, field_type="text", required=False, label=None):
    return SimpleNamespace(field_key=key, label_en=label or key, field_type=field_type, required=required)


# ── 1. Pure rules ───────────────────────────────────────────────────────────

def test_field_key_from_label():
    assert variants.field_key_from_label("PO number") == "po_number"
    assert variants.field_key_from_label(" Price ($) ") == "price"
    assert variants.field_key_from_label("2nd line") == "f_2nd_line"
    assert variants.field_key_from_label("السعر") == "line"
    assert variants.field_key_from_label("Price", ["price", "price_2"]) == "price_3"


@pytest.mark.parametrize("field_type,raw,stored", [
    ("money", "34.9", "34.90"),
    ("money", "1,250", "1250.00"),
    ("number", "12.500", "12.5"),
    ("number", "100", "100"),
    ("date", "2026-03-01", "2026-03-01"),
    ("text", "  SS   26 ", "SS 26"),
])
def test_clean_value(field_type, raw, stored):
    assert variants.clean_value(_f("x", field_type), raw) == stored


@pytest.mark.parametrize("field_type,raw", [
    ("money", "abc"), ("money", "-1"), ("number", "NaN"), ("date", "01/03/2026"), ("text", " -/ "),
])
def test_clean_value_refuses(field_type, raw):
    with pytest.raises(variants.BadValues):
        variants.clean_value(_f("x", field_type), raw)


def test_clean_values_required_unknown_blank():
    fields = [_f("price", "money", required=True), _f("po")]
    assert variants.clean_values(fields, {"price": "5", "po": " "}) == {"price": "5.00"}
    with pytest.raises(variants.BadValues, match="required"):
        variants.clean_values(fields, {"po": "1"})
    with pytest.raises(variants.BadValues, match="Unknown"):
        variants.clean_values(fields, {"price": "5", "season": "SS26"})


def test_variant_key_ignores_case_spaces_and_order():
    fields = [_f("po"), _f("price", "money")]
    a = variants.variant_key(fields, {"po": "ab-12", "price": "34.99"}, "Navy", " m ")
    b = variants.variant_key(fields, {"price": "34.99", "po": "AB 12"}, "navy", "M")
    assert a == b
    assert a != variants.variant_key(fields, {"po": "ab-12", "price": "34.99"}, "Navy", "L")


# ── helpers ─────────────────────────────────────────────────────────────────

def _template(client, h, s, lines=(("Price", "money", True), ("PO number", "text", False)), **over):
    item = _create(client, h, s, **over).json()
    for label, field_type, required in lines:
        r = client.post(f"{ITEMS}{item['id']}/fields", headers=h, json={
            "label_en": label, "label_ar": "عربي", "field_type": field_type, "required": required,
        })
        assert r.status_code == 201, r.text
    return client.get(f"{ITEMS}{item['id']}", headers=h).json()


def _variant(client, h, template_id, values, **extra):
    return client.post(f"{ITEMS}{template_id}/variants", headers=h, json={"values": values, **extra})


# ── 2. Lines ────────────────────────────────────────────────────────────────

def test_first_line_makes_a_template(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    assert t["is_template"] is True
    assert [f["field_key"] for f in t["fields"]] == ["price", "po_number"]
    plain = _create(client, h, setup).json()
    assert plain["is_template"] is False and plain["fields"] == []


def test_worker_cannot_add_lines(client, auth_headers, setup):
    item = _create(client, auth_headers(role="W_Manager"), setup).json()
    r = client.post(f"{ITEMS}{item['id']}/fields", headers=auth_headers(role="W_Worker"),
                    json={"label_en": "Price", "label_ar": "السعر", "field_type": "money"})
    assert r.status_code == 403


def test_bad_line_type_refused(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    item = _create(client, h, setup).json()
    r = client.post(f"{ITEMS}{item['id']}/fields", headers=h,
                    json={"label_en": "Price", "label_ar": "السعر", "field_type": "colour"})
    assert r.status_code == 422


def test_variant_cannot_have_lines(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    v = _variant(client, h, t["id"], {"price": "1"}).json()
    r = client.post(f"{ITEMS}{v['id']}/fields", headers=h,
                    json={"label_en": "Season", "label_ar": "الموسم", "field_type": "text"})
    assert r.status_code == 400


def test_lines_after_variants_exist(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    _variant(client, h, t["id"], {"price": "1"})
    base = {"label_ar": "الموسم", "field_type": "text"}
    assert client.post(f"{ITEMS}{t['id']}/fields", headers=h,
                       json={**base, "label_en": "Season", "required": True}).status_code == 400
    assert client.post(f"{ITEMS}{t['id']}/fields", headers=h,
                       json={**base, "label_en": "Season"}).status_code == 201


def test_used_line_locked_unused_line_free(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    price, po = t["fields"]
    _variant(client, h, t["id"], {"price": "1"})  # PO left empty
    url = f"{ITEMS}{t['id']}/fields/"
    assert client.patch(f"{url}{price['id']}", headers=h, json={"field_type": "number"}).status_code == 400
    assert client.delete(f"{url}{price['id']}", headers=h).status_code == 400
    # Labels and order always change.
    r = client.patch(f"{url}{price['id']}", headers=h, json={"label_en": "Retail price", "print_order": 5})
    assert r.status_code == 200 and r.json()["field_key"] == "price"
    # PO can't become required: the variant has no PO.
    assert client.patch(f"{url}{po['id']}", headers=h, json={"required": True}).status_code == 400
    assert client.patch(f"{url}{po['id']}", headers=h, json={"field_type": "number"}).status_code == 200
    assert client.delete(f"{url}{po['id']}", headers=h).status_code == 204


# ── 3. Variants ─────────────────────────────────────────────────────────────

def test_variant_codes_and_inherited_fields(client, auth_headers, setup, make_user):
    user = make_user("W_Manager")
    h = auth_headers(user=user)
    t = _template(client, h, setup, client_id=setup["client"].id, description="UA price ticket")
    r1 = _variant(client, h, t["id"], {"price": "34.99", "po_number": "45127"}, size="M")
    r2 = _variant(client, h, t["id"], {"price": "34.99", "po_number": "45127"}, size="L")
    assert r1.status_code == 201, r1.text
    v1, v2 = r1.json(), r2.json()
    assert v1["code"] == f"{t['code']}-001" and v2["code"] == f"{t['code']}-002"
    assert (v1["category_id"], v1["client_id"], v1["base_uom_id"]) == (t["category_id"], t["client_id"], t["base_uom_id"])
    assert v1["description"] == "UA price ticket"
    assert v1["parent_template_id"] == t["id"] and v1["template_code"] == t["code"]
    assert v1["variable_values"] == {"price": "34.99", "po_number": "45127"}
    assert [(x["field_key"], x["value"]) for x in v1["value_lines"]] == [("price", "34.99"), ("po_number", "45127")]
    assert v1["created_by"] == user.id
    assert v1["refs"] == []  # the template's references apply


def test_values_checked_against_the_lines(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    assert _variant(client, h, t["id"], {"po_number": "1"}).status_code == 400  # price required
    assert _variant(client, h, t["id"], {"price": "x"}).status_code == 400
    assert _variant(client, h, t["id"], {"price": "1", "season": "SS"}).status_code == 400


def test_plain_item_has_no_variants(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    plain = _create(client, h, setup).json()
    assert _variant(client, h, plain["id"], {}).status_code == 400


def test_same_combination_refused_and_found(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    first = _variant(client, h, t["id"], {"price": "34.99", "po_number": "AB-12"}, color="Navy").json()
    again = {"price": "34.990", "po_number": "ab 12"}
    r = _variant(client, h, t["id"], again, color=" navy ")
    assert r.status_code == 409 and first["code"] in r.json()["detail"]
    found = client.post(f"{ITEMS}{t['id']}/variants/check", headers=h, json={"values": again, "color": "NAVY"})
    assert found.status_code == 200 and found.json()["id"] == first["id"]
    other = client.post(f"{ITEMS}{t['id']}/variants/check", headers=h, json={"values": again, "color": "Red"})
    assert other.json() is None


def test_editing_a_variant_rechecks(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    a = _variant(client, h, t["id"], {"price": "1"}).json()
    b = _variant(client, h, t["id"], {"price": "2"}).json()
    assert client.patch(f"{ITEMS}{b['id']}", headers=h, json={"variable_values": {"price": "1.00"}}).status_code == 409
    r = client.patch(f"{ITEMS}{b['id']}", headers=h, json={"variable_values": {"price": "3", "po_number": "9"}})
    assert r.status_code == 200 and r.json()["variable_values"] == {"price": "3.00", "po_number": "9"}
    # Same values as a, but a different size = a different variant.
    assert client.patch(f"{ITEMS}{b['id']}", headers=h,
                        json={"variable_values": {"price": "1"}, "size": "XL"}).status_code == 200
    assert client.patch(f"{ITEMS}{b['id']}", headers=h, json={"size": None}).status_code == 409
    assert client.patch(f"{ITEMS}{a['id']}", headers=h, json={"base_uom_id": setup["cone"].id}).status_code == 400
    # Only variants have values.
    assert client.patch(f"{ITEMS}{t['id']}", headers=h, json={"variable_values": {"price": "1"}}).status_code == 400


def test_variant_references_are_optional(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    v = _variant(client, h, t["id"], {"price": "1"},
                 refs=[{"supplier_id": setup["supplier"].id, "ref_code": "TKT-V1"}]).json()
    assert [x["ref_code"] for x in v["refs"]] == ["TKT-V1"]
    assert client.delete(f"{ITEMS}{v['id']}/refs/{v['refs'][0]['id']}", headers=h).status_code == 204


def test_switched_off_template_takes_no_variants(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    client.patch(f"{ITEMS}{t['id']}", headers=h, json={"active": False})
    assert _variant(client, h, t["id"], {"price": "1"}).status_code == 400


def test_template_with_variants_keeps_its_unit(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    _variant(client, h, t["id"], {"price": "1"})
    assert client.patch(f"{ITEMS}{t['id']}", headers=h, json={"base_uom_id": setup["cone"].id}).status_code == 400


# ── 4. Stock rules + conversions ────────────────────────────────────────────

def test_ensure_stockable(client, auth_headers, setup, db):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    v = _variant(client, h, t["id"], {"price": "1"}).json()
    plain = _create(client, h, setup).json()
    crud.ensure_stockable(db.get(AccessoryItem, plain["id"]))
    crud.ensure_stockable(db.get(AccessoryItem, v["id"]))
    with pytest.raises(Exception, match="template"):
        crud.ensure_stockable(db.get(AccessoryItem, t["id"]))
    client.patch(f"{ITEMS}{t['id']}", headers=h, json={"active": False})
    db.expire_all()
    with pytest.raises(Exception, match="switched off"):
        crud.ensure_stockable(db.get(AccessoryItem, v["id"]))


def test_variant_uses_template_conversions(client, auth_headers, setup, db):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    v = _variant(client, h, t["id"], {"price": "1"}).json()
    r = client.post(f"{ITEMS}{t['id']}/conversions", headers=h,
                    json={"from_uom_id": setup["cone"].id, "to_uom_id": setup["pcs"].id, "factor": 500})
    assert r.status_code == 201, r.text
    assert client.post(f"{ITEMS}{v['id']}/conversions", headers=h,
                       json={"from_uom_id": setup["m"].id, "to_uom_id": setup["pcs"].id, "factor": 2}).status_code == 400
    assert uom.to_base(db, 2, setup["cone"].id, setup["pcs"].id, item_id=v["id"]) == Decimal("1000.0000")
    assert db.query(UomConversion).filter(UomConversion.accessory_item_id == v["id"]).count() == 0


# ── 5. Search + kind filter ─────────────────────────────────────────────────

def test_search_by_template_reference_and_values(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup, refs=[{"supplier_id": setup["supplier"].id, "ref_code": "UA-TKT-77"}])
    v = _variant(client, h, t["id"], {"price": "34.99", "po_number": "Q-998877"}).json()

    def codes(**params):
        return {i["code"] for i in client.get(ITEMS, headers=h, params=params).json()["items"]}

    assert {t["code"], v["code"]} <= codes(q="ua tkt 77")
    assert v["code"] in codes(q="998877")
    assert codes(q="998877", kind="template") == set()
    assert codes(kind="variant", template_id=t["id"]) == {v["code"]}
    assert t["code"] in codes(kind="template") and t["code"] not in codes(kind="plain")
    listed = client.get(f"{ITEMS}{t['id']}/variants", headers=h).json()
    assert [x["code"] for x in listed] == [v["code"]]
