"""Item 11: searching the Accessory Items list, and the look-alike warning.

1. Quick search: every word must be found somewhere (code, description,
   color, size, a reference code, a line value); several words may also be
   one reference code written with spaces; % and _ are taken literally.
2. Advanced filters, all combined (AND): code, description, color, size
   (all "contains", user decision), reference code limited to one party,
   party alone, base unit, any line value, one template line, sort, paging.
3. `/similar`: same category + client + description + color + size ignoring
   case, spaces and - . / _ ; variants and other clients don't count;
   `exclude_id` leaves out the item being edited.
Reuses the set-up helpers of test_accessory_items.py / test_accessory_variants.py.
"""
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    ITEMS,
    _create,
    _supplier,
    accessories_on,
    setup,
)
from backend.tests.test_accessory_variants import _template, _variant


def _codes(client, h, **params):
    r = client.get(ITEMS, headers=h, params=params)
    assert r.status_code == 200, r.text
    return {i["code"] for i in r.json()["items"]}


def _items(client, h, s):
    """Three plain items in different colors / sizes."""
    red_s = _create(client, h, s, description="Zipper metal", color="Red", size="S").json()
    red_xl = _create(client, h, s, description="Zipper metal", color="Dark red", size="XL").json()
    navy_s = _create(client, h, s, description="Button 4 hole", color="Navy blue", size="S",
                     refs=[{"supplier_id": s["supplier"].id, "ref_code": "BTN-55/A"}]).json()
    return red_s["code"], red_xl["code"], navy_s["code"]


# ── 1. Quick search ─────────────────────────────────────────────────────────

def test_each_word_must_match_somewhere(client, auth_headers, setup):
    h = auth_headers(role="Viewer")
    red_s, red_xl, navy_s = _items(client, auth_headers(role="W_Manager"), setup)
    assert _codes(client, h, q="zipper red") == {red_s, red_xl}
    assert _codes(client, h, q="red xl") == {red_xl}
    assert _codes(client, h, q="navy btn") == {navy_s}  # color + reference code
    assert _codes(client, h, q="zipper navy") == set()


def test_words_can_be_one_reference_code(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    *_, navy_s = _items(client, h, setup)
    assert navy_s in _codes(client, h, q="btn 55a")  # BTN-55/A, typed with a space


def test_percent_and_underscore_are_literal(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    _items(client, h, setup)
    pct = _create(client, h, setup, description="Elastic 100% cotton").json()["code"]
    assert _codes(client, h, q="100%") == {pct}
    assert _codes(client, h, description="_") == set()


# ── 2. Advanced filters ─────────────────────────────────────────────────────

def test_color_and_size_contains_combined(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    red_s, red_xl, navy_s = _items(client, h, setup)
    assert _codes(client, h, color="red") == {red_s, red_xl}
    assert _codes(client, h, size="s") == {red_s, navy_s}  # contains: XL has no s
    assert _codes(client, h, color="red", size="s") == {red_s}
    assert _codes(client, h, description="zipper", size="xl") == {red_xl}
    assert _codes(client, h, code=red_xl) == {red_xl}


def test_reference_code_and_party(client, auth_headers, setup, db):
    h = auth_headers(role="W_Manager")
    *_, navy_s = _items(client, h, setup)
    other = _supplier(db, "Test Supplier Q9")
    elsewhere = _create(client, h, setup, refs=[{"supplier_id": other.id, "ref_code": "BTN-55/A"}]).json()["code"]
    assert _codes(client, h, ref_code="btn55") == {navy_s, elsewhere}
    assert _codes(client, h, ref_code="btn55", ref_supplier_id=other.id) == {elsewhere}
    assert _codes(client, h, ref_supplier_id=other.id) == {elsewhere}  # any code from that supplier


def test_base_unit_and_sort_and_paging(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    red_s, red_xl, navy_s = _items(client, h, setup)
    cone = _create(client, h, setup, category_id=setup["thr"].id, base_uom_id=setup["cone"].id).json()["code"]
    assert _codes(client, h, base_uom_id=setup["cone"].id) == {cone}

    newest = client.get(ITEMS, headers=h, params={"sort": "newest", "limit": 2}).json()
    assert [i["code"] for i in newest["items"]] == [cone, navy_s]
    assert newest["total"] >= 4
    page2 = client.get(ITEMS, headers=h, params={"sort": "newest", "limit": 2, "offset": 2}).json()
    assert [i["code"] for i in page2["items"]] == [red_xl, red_s]


def test_line_value_filters(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup)
    a = _variant(client, h, t["id"], {"price": "34.99", "po_number": "PO-45127"}).json()["code"]
    b = _variant(client, h, t["id"], {"price": "12.00", "po_number": "PO-99"}).json()["code"]
    assert _codes(client, h, line_value="45127") == {a}
    assert _codes(client, h, template_id=t["id"], line="po_number:po-") == {a, b}
    assert _codes(client, h, template_id=t["id"], line=["po_number:po-", "price:12"]) == {b}
    assert _codes(client, h, line="unknown_line:x") == set()


# ── 3. Look-alikes ──────────────────────────────────────────────────────────

def _similar(client, h, s, **params):
    base = {"category_id": s["cat"].id, "description": "zipper  METAL", "color": "red", "size": " s "}
    base.update(params)
    r = client.get(f"{ITEMS}similar", headers=h, params={k: v for k, v in base.items() if v is not None})
    assert r.status_code == 200, r.text
    return {i["code"] for i in r.json()}


def test_similar_ignores_case_and_spaces(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    red_s, red_xl, _ = _items(client, h, setup)
    assert _similar(client, h, setup) == {red_s}
    assert _similar(client, h, setup, description="Zipper-metal") == {red_s}
    assert _similar(client, h, setup, size="XL", color="dark red") == {red_xl}
    assert _similar(client, h, setup, size=None) == set()  # no size ≠ size S


def test_similar_respects_client_category_and_exclude(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    red_s, *_ = _items(client, h, setup)
    item_id = client.get(ITEMS, headers=h, params={"code": red_s}).json()["items"][0]["id"]
    assert _similar(client, h, setup, client_id=setup["client"].id) == set()
    assert _similar(client, h, setup, category_id=setup["thr"].id) == set()
    assert _similar(client, h, setup, exclude_id=item_id) == set()


def test_similar_leaves_out_variants(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    t = _template(client, h, setup, description="Ticket UA")
    _variant(client, h, t["id"], {"price": "1.00"})
    assert _similar(client, h, setup, description="ticket ua", color=None, size=None) == {t["code"]}
