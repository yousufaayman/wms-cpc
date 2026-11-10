"""Item 9: client / supplier trim references on accessory items.

1. `normalize_code`: case, spaces and - . / _ don't count.
2. A new item needs at least one reference; the same code twice in one form is refused.
3. A code is unique per party (normalized): supplier A's `01` and supplier
   B's `01` are both fine, A's `01` on a second item is refused.
4. A client-specific item only takes its own client's codes; generic items
   take any number of clients.
5. Add / edit / delete on an item; the last one can't be deleted.
6. Lookup (is this code taken?) and search by reference code.
Reuses the set-up helpers of test_accessory_items.py.
"""
import pytest

from backend.domains.accessories.normalize import normalize_code
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    ITEMS,
    _client,
    _supplier,
    accessories_on,
    setup,
)

LOOKUP = ITEMS + "refs/lookup"


def _new(client, h, s, refs, **over):
    body = {
        "category_id": s["cat"].id, "client_id": None, "description": "Thread", "base_uom_id": s["pcs"].id,
        "refs": refs,
    }
    body.update(over)
    return client.post(ITEMS, json=body, headers=h)


def _sup(s, code, **extra):
    return {"supplier_id": s["supplier"].id, "ref_code": code, **extra}


# ── 1. Normalizing ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw", ["AB-01", "ab 01", " ab.01 ", "AB/01", "a_b01", "ab - 01"])
def test_normalize_ignores_case_spaces_and_separators(raw):
    assert normalize_code(raw) == "AB01"


def test_normalize_keeps_other_characters():
    assert normalize_code("AB#01") == "AB#01"
    assert normalize_code(" -./_ ") == ""


# ── 2. A new item needs references ──────────────────────────────────────────

def test_new_item_needs_a_reference(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    assert _new(client, h, setup, refs=[]).status_code == 422
    body = {"category_id": setup["cat"].id, "description": "x", "base_uom_id": setup["pcs"].id}
    assert client.post(ITEMS, json=body, headers=h).status_code == 422


def test_reference_needs_exactly_one_party(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    both = {"supplier_id": setup["supplier"].id, "client_id": setup["client"].id, "ref_code": "X1"}
    assert _new(client, h, setup, refs=[both]).status_code == 422
    assert _new(client, h, setup, refs=[{"ref_code": "X1"}]).status_code == 422


def test_item_saved_with_its_references(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    r = _new(client, h, setup, refs=[
        _sup(setup, " AB-01 ", ref_description="Polyester 40/2 black"),
        {"client_id": setup["client"].id, "ref_code": "BLK-40"},
    ])
    assert r.status_code == 201, r.text
    refs = r.json()["refs"]
    assert [x["ref_code"] for x in refs] == ["AB-01", "BLK-40"]  # trimmed, otherwise as typed
    assert refs[0]["ref_description"] == "Polyester 40/2 black"


def test_same_code_twice_in_one_form_refused(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    assert _new(client, h, setup, refs=[_sup(setup, "AB-01"), _sup(setup, "ab 01")]).status_code == 400


def test_code_without_letters_or_digits_refused(client, auth_headers, setup):
    assert _new(client, auth_headers(role="W_Manager"), setup, refs=[_sup(setup, "--")]).status_code == 400


# ── 3. Unique per party ─────────────────────────────────────────────────────

def test_same_code_from_two_suppliers_is_fine(client, auth_headers, setup, db):
    h = auth_headers(role="W_Manager")
    other = _supplier(db, "Test Supplier Q2")
    assert _new(client, h, setup, refs=[_sup(setup, "01")]).status_code == 201
    assert _new(client, h, setup, refs=[{"supplier_id": other.id, "ref_code": "01"}]).status_code == 201


def test_same_supplier_code_on_a_second_item_refused(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    first = _new(client, h, setup, refs=[_sup(setup, "AB-01")]).json()
    r = _new(client, h, setup, refs=[_sup(setup, "ab 01")])
    assert r.status_code == 409
    assert first["code"] in r.json()["detail"]


def test_supplier_must_be_a_supplier_location(client, auth_headers, setup, db):
    from backend import models
    internal = models.LogicalLocation(name="Test Internal Q1", location_type="internal")
    db.add(internal)
    db.flush()
    r = _new(client, auth_headers(role="W_Manager"), setup, refs=[{"supplier_id": internal.id, "ref_code": "Z1"}])
    assert r.status_code == 404


# ── 4. Client codes ─────────────────────────────────────────────────────────

def test_client_specific_item_takes_only_its_own_client(client, auth_headers, setup, db):
    h = auth_headers(role="W_Manager")
    other = _client(db, "Test Client Q5", "QB")
    own = {"client_id": setup["client"].id, "ref_code": "UA-1"}
    foreign = {"client_id": other.id, "ref_code": "EL-1"}
    assert _new(client, h, setup, refs=[foreign], client_id=setup["client"].id).status_code == 400
    assert _new(client, h, setup, refs=[own], client_id=setup["client"].id).status_code == 201


def test_generic_item_takes_many_clients(client, auth_headers, setup, db):
    h = auth_headers(role="W_Manager")
    other = _client(db, "Test Client Q6", "QC")
    r = _new(client, h, setup, refs=[
        {"client_id": setup["client"].id, "ref_code": "BLK-40"},
        {"client_id": other.id, "ref_code": "BLK-40"},
    ])
    assert r.status_code == 201
    assert len(r.json()["refs"]) == 2


# ── 5. Add / edit / delete ──────────────────────────────────────────────────

def test_add_edit_delete_references(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    item = _new(client, h, setup, refs=[_sup(setup, "R-1")]).json()
    url = f"{ITEMS}{item['id']}/refs"
    first_id = item["refs"][0]["id"]

    # The last one can't go.
    assert client.delete(f"{url}/{first_id}", headers=h).status_code == 400

    added = client.post(url, json={"client_id": setup["client"].id, "ref_code": "C-9"}, headers=h)
    assert added.status_code == 201
    # Fix a typo; the same code in another spelling is still "itself".
    r = client.patch(f"{url}/{first_id}", json={"ref_code": "r 1", "ref_description": "Their name"}, headers=h)
    assert r.status_code == 200 and r.json()["ref_code"] == "r 1"
    assert client.delete(f"{url}/{first_id}", headers=h).status_code == 204
    assert [x["ref_code"] for x in client.get(url, headers=h).json()] == ["C-9"]


def test_edit_to_a_code_taken_by_another_item_refused(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    _new(client, h, setup, refs=[_sup(setup, "TAKEN")])
    item = _new(client, h, setup, refs=[_sup(setup, "FREE")]).json()
    r = client.patch(f"{ITEMS}{item['id']}/refs/{item['refs'][0]['id']}", json={"ref_code": "taken"}, headers=h)
    assert r.status_code == 409


def test_worker_cannot_add_references(client, auth_headers, setup):
    item = _new(client, auth_headers(role="W_Manager"), setup, refs=[_sup(setup, "W-1")]).json()
    r = client.post(f"{ITEMS}{item['id']}/refs", json=_sup(setup, "W-2"), headers=auth_headers(role="W_Worker"))
    assert r.status_code == 403


# ── 6. Lookup and search ────────────────────────────────────────────────────

def test_lookup_finds_the_item_carrying_a_code(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    item = _new(client, h, setup, refs=[_sup(setup, "AB-01")]).json()
    found = client.get(LOOKUP, params={"code": "ab 01", "supplier_id": setup["supplier"].id}, headers=h)
    assert found.status_code == 200 and found.json()["code"] == item["code"]
    other_party = client.get(LOOKUP, params={"code": "AB-01", "client_id": setup["client"].id}, headers=h)
    assert other_party.json() is None


def test_search_by_reference_code(client, auth_headers, setup):
    h = auth_headers(role="W_Manager")
    item = _new(client, h, setup, refs=[_sup(setup, "4501-BLK")]).json()
    for q in ("4501", "4501 blk", "4501BLK"):
        codes = [i["code"] for i in client.get(ITEMS, params={"q": q}, headers=h).json()["items"]]
        assert item["code"] in codes, q
