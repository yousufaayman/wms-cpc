"""Item 11: base items with color / size variants and no variable lines.

The case: client button code 00567 comes in black, olive and white. The
client code lives once, on the base item; each color is a variant with its own
code that carries the base's references.
1. A plain item without stock takes color variants: codes -001..-003, the
   base becomes a base (is_template, kind filter), searching the client code
   finds all of them, the base can't be stocked, the colors can.
2. Rules: a variant needs a color or a size (or a line value); the same color
   twice is refused; a variant can't have variants; the last line of a base
   can go while every variant has a color or a size.
Reuses the set-up helpers of test_accessory_items.py / test_accessory_variants.py.
"""
import pytest
from fastapi import HTTPException

from backend.crud import accessory_items as crud
from backend.models import AccessoryItem
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    ITEMS,
    _create,
    accessories_on,
    setup,
)
from backend.tests.test_accessory_variants import _template, _variant


def _button(client, h, s):
    return _create(client, h, s, client_id=s["client"].id, description="Button 4 hole 18L",
                   refs=[{"client_id": s["client"].id, "ref_code": "00567"}]).json()


def _colors(client, h, base_id, *colors):
    out = []
    for color in colors:
        r = _variant(client, h, base_id, {}, color=color)
        assert r.status_code == 201, r.text
        out.append(r.json())
    return out


# ── 1. The button in three colors ───────────────────────────────────────────

def test_one_client_code_three_colors(client, auth_headers, setup, db):
    h = auth_headers(role="W_Manager")
    base = _button(client, h, setup)
    assert base["is_template"] is False  # plain until it gets a variant

    black, olive, white = _colors(client, h, base["id"], "Black", "Olive", "White")
    assert [v["code"] for v in (black, olive, white)] == [f"{base['code']}-00{n}" for n in (1, 2, 3)]
    assert {v["color"] for v in (black, olive, white)} == {"Black", "Olive", "White"}
    assert all(v["refs"] == [] and v["template_code"] == base["code"] for v in (black, olive, white))
    assert all(v["client_id"] == setup["client"].id for v in (black, olive, white))

    base_now = client.get(f"{ITEMS}{base['id']}", headers=h).json()
    assert base_now["is_template"] is True and base_now["fields"] == []

    def codes(**params):
        return {i["code"] for i in client.get(ITEMS, headers=h, params=params).json()["items"]}

    assert codes(q="00567") == {base["code"], black["code"], olive["code"], white["code"]}
    assert codes(q="00567 olive") == {olive["code"]}
    assert codes(ref_code="00567", color="white") == {white["code"]}
    assert base["code"] in codes(kind="template") and base["code"] not in codes(kind="plain")

    with pytest.raises(HTTPException):
        crud.ensure_stockable(db.get(AccessoryItem, base["id"]))
    crud.ensure_stockable(db.get(AccessoryItem, olive["id"]))


# ── 2. Rules ────────────────────────────────────────────────────────────────

def test_color_or_size_needed_and_no_duplicates(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    base = _button(client, h, setup)
    empty = _variant(client, h, base["id"], {})
    assert empty.status_code == 400 and "color or a size" in empty.json()["detail"]
    _colors(client, h, base["id"], "Black")
    assert _variant(client, h, base["id"], {}, color=" black ").status_code == 409
    assert _variant(client, h, base["id"], {}, color="Black", size="20mm").status_code == 201
    only_size = _variant(client, h, base["id"], {}, size="24mm")
    assert only_size.status_code == 201, only_size.text


def test_editing_a_color_variant_keeps_the_rules(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    base = _button(client, h, setup)
    black, olive = _colors(client, h, base["id"], "Black", "Olive")
    assert client.patch(f"{ITEMS}{olive['id']}", headers=h, json={"color": "BLACK"}).status_code == 409
    assert client.patch(f"{ITEMS}{olive['id']}", headers=h, json={"color": None}).status_code == 400
    assert client.patch(f"{ITEMS}{olive['id']}", headers=h, json={"color": "Olive green"}).status_code == 200


def test_a_variant_cant_have_variants(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    base = _button(client, h, setup)
    black, = _colors(client, h, base["id"], "Black")
    r = _variant(client, h, black["id"], {}, size="20mm")
    assert r.status_code == 400 and base["code"] in r.json()["detail"]


def test_last_line_can_go_while_variants_have_colors(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup, lines=(("Note", "text", False),))
    field_id = t["fields"][0]["id"]
    _colors(client, h, t["id"], "Red")
    assert client.delete(f"{ITEMS}{t['id']}/fields/{field_id}", headers=h).status_code == 204
    after = client.get(f"{ITEMS}{t['id']}", headers=h).json()
    assert after["fields"] == [] and after["is_template"] is True  # still a base: it has variants
