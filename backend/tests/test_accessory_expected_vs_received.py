"""Item 18: expected vs received on accessory deliveries.

Received is always worked out from the packs' `receipt` ledger rows (item 15).
This file checks what item 18 adds on top:
- each line's state (waiting / partial / complete / over) and the delivery's
  flags (lines complete, over-received, closed short), plus the list filter;
- the close / reopen rules: a delivery that closed itself reopens when an
  undo leaves it short (R1); one a person closed stays closed (R2); an admin's
  Reopen follows what arrived and isn't closed again just by viewing it (R3);
- the packs received on one line (`GET /expected-deliveries/items/{id}/packs`).
"""
from decimal import Decimal

from backend import models
from backend.tests.test_accessory_invariants import check_invariants
from backend.tests.test_accessory_items import accessories_on, setup  # noqa: F401  (fixtures)
from backend.tests.test_accessory_ledger import stock  # noqa: F401  (fixture)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)
from backend.tests.test_accessory_receive_packs import (  # noqa: F401  (s = fixture)
    DELIVERIES, RECEIVE, _body, _delivery, _line, _ok, s,
)


def _get(client, h, delivery_id):
    r = client.get(f"{DELIVERIES}{delivery_id}", headers=h)
    assert r.status_code == 200, r.text
    return r.json()


def _undo(client, h, posting_id):
    r = client.post(f"{RECEIVE}/{posting_id}/undo", headers=h)
    assert r.status_code == 201, r.text


def _line_picked(s, line, packs, qty="10"):
    return _body(s, expected_delivery_item_id=line.id, pack_count=packs, qty_per_pack=qty,
                 supplier_type=None, client_supplier_id=None)


# ── Line states and delivery flags ──────────────────────────────────────────

def test_line_states_and_delivery_flags(client, auth_headers, db, s):
    h = auth_headers(role="W_Worker")
    d = _delivery(db, s["wh"], s["supplier"])
    waiting = _line(db, d, s["item"], 10)
    partial = _line(db, d, s["item"], 30)
    complete = _line(db, d, s["item"], 20)
    over = _line(db, d, s["item"], 5)
    _ok(client, h, _line_picked(s, partial, 1))
    _ok(client, h, _line_picked(s, complete, 2))
    _ok(client, h, _line_picked(s, over, 1))

    out = _get(client, h, d.id)
    states = {i["id"]: i["receive_state"] for i in out["items"]}
    assert states == {waiting.id: "waiting", partial.id: "partial", complete.id: "complete", over.id: "over"}
    assert (out["lines_total"], out["lines_complete"]) == (4, 2)
    assert out["over_received"] is True and out["closed_short"] is False
    assert out["status"] == "partial"


def test_fabric_deliveries_carry_no_flags(client, auth_headers, db, s):
    d = models.ExpectedDelivery(status="pending")
    db.add(d)
    db.flush()
    out = _get(client, auth_headers(role="W_Manager"), d.id)
    assert out["lines_total"] is None and out["over_received"] is None and out["closed_short"] is None


def test_closed_short_and_the_list_filters(client, auth_headers, db, s):
    mgr = auth_headers(role="W_Manager")
    short = _delivery(db, s["wh"], s["supplier"])
    short_line = _line(db, short, s["item"], 50)
    over = _delivery(db, s["wh"], s["supplier"])
    over_line = _line(db, over, s["item"], 5)
    plain = _delivery(db, s["wh"], s["supplier"])
    _line(db, plain, s["item"], 10)
    _ok(client, mgr, _line_picked(s, short_line, 1))
    _ok(client, mgr, _line_picked(s, over_line, 1))

    # someone closes `short` by hand with 10 of 50
    r = client.put(f"{DELIVERIES}{short.id}", json={"status": "received"}, headers=mgr)
    assert r.status_code == 200, r.text
    assert r.json()["closed_short"] is True

    def listed(flag):
        r = client.get(DELIVERIES, params={"warehouse_id": s["wh"].id, "flag": flag}, headers=mgr)
        assert r.status_code == 200, r.text
        return {d["id"] for d in r.json()}

    assert listed("closed_short") == {short.id}
    assert listed("over_received") == {over.id}
    assert client.get(DELIVERIES, params={"flag": "nope"}, headers=mgr).status_code == 422


# ── Close / reopen rules ────────────────────────────────────────────────────

def test_undo_reopens_a_delivery_that_closed_itself(client, auth_headers, db, s):
    """R1: auto-closed (no closed_by) + an undo that leaves it short = open again."""
    h = auth_headers(role="W_Worker")
    d = _delivery(db, s["wh"], s["supplier"])
    _line(db, d, s["item"], 20)
    first = _ok(client, h, _body(s))
    second = _ok(client, h, _body(s))
    out = _get(client, h, d.id)
    assert out["status"] == "received" and out["closed_by"] is None and out["closed_at"] is not None

    _undo(client, h, second["posting_id"])
    out = _get(client, h, d.id)
    assert out["status"] == "partial" and out["closed_at"] is None

    _undo(client, h, first["posting_id"])
    assert _get(client, h, d.id)["status"] == "pending"

    # open again, so the next receive matches it once more and closes it
    _ok(client, h, _body(s, pack_count=2))
    assert _get(client, h, d.id)["status"] == "received"
    check_invariants(db)


def test_undo_never_reopens_a_delivery_a_person_closed(client, auth_headers, db, s, make_user):
    """R2: closed by hand (received or cancelled) stays frozen."""
    worker = make_user("W_Worker")
    h = auth_headers(user=worker)
    mgr = auth_headers(role="W_Manager")
    for final in ("received", "cancelled"):
        d = _delivery(db, s["wh"], s["supplier"])
        line = _line(db, d, s["item"], 30)
        out = _ok(client, h, _line_picked(s, line, 1))
        r = client.put(f"{DELIVERIES}{d.id}", json={"status": final}, headers=mgr)
        assert r.status_code == 200, r.text
        _undo(client, h, out["posting_id"])
        after = _get(client, h, d.id)
        assert after["status"] == final and after["closed_by"] is not None


def test_admin_reopen_follows_what_arrived_and_viewing_does_not_close_it(client, auth_headers, db, s):
    """R3: Reopen = partial when anything arrived (else pending); a complete
    delivery isn't closed again by viewing it, only by the next receive."""
    h = auth_headers(role="W_Worker")
    admin = auth_headers(role="admin")
    d = _delivery(db, s["wh"], s["supplier"])
    line = _line(db, d, s["item"], 10)
    _ok(client, h, _line_picked(s, line, 1))
    assert _get(client, h, d.id)["status"] == "received"

    r = client.put(f"{DELIVERIES}{d.id}", json={"status": "pending"}, headers=admin)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "partial" and r.json()["closed_at"] is None
    assert _get(client, h, d.id)["status"] == "partial"  # viewing doesn't re-close

    # a manager may now add a line; the delivery stays open until it arrives
    mgr = auth_headers(role="W_Manager")
    r = client.post(f"{DELIVERIES}{d.id}/items", json={"accessory_item_id": s["item"], "expected_qty": "5"}, headers=mgr)
    assert r.status_code == 201, r.text
    _ok(client, h, _line_picked(s, db.get(models.ExpectedDeliveryItem, r.json()["id"]), 1, qty="5"))
    assert _get(client, h, d.id)["status"] == "received"

    # nothing received → pending
    empty = _delivery(db, s["wh"], s["supplier"], status="cancelled")
    _line(db, empty, s["item"], 10)
    r = client.put(f"{DELIVERIES}{empty.id}", json={"status": "partial"}, headers=admin)
    assert r.status_code == 200 and r.json()["status"] == "pending"


# ── Packs per line ──────────────────────────────────────────────────────────

def test_packs_received_on_a_line(client, auth_headers, db, s, make_user):
    worker = make_user("W_Worker")
    h = auth_headers(user=worker)
    d = _delivery(db, s["wh"], s["supplier"])
    line = _line(db, d, s["item"], 100)
    kept = _ok(client, h, _line_picked(s, line, 2, qty="7"))
    undone = _ok(client, h, _line_picked(s, line, 1, qty="3"))
    _undo(client, h, undone["posting_id"])

    r = client.get(f"{DELIVERIES}items/{line.id}/packs", headers=h)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert [p["id"] for p in rows] == sorted([p["id"] for p in kept["packs"] + undone["packs"]], reverse=True)
    by_id = {p["id"]: p for p in rows}
    for p in kept["packs"]:
        row = by_id[p["id"]]
        assert Decimal(row["received_qty"]) == 7 and Decimal(row["quantity"]) == 7
        assert "barcode" not in row and row["received_by"] == worker.username
    gone = by_id[undone["packs"][0]["id"]]
    assert Decimal(gone["received_qty"]) == 0 and gone["status"] == "empty"

    assert client.get(f"{DELIVERIES}items/999999999/packs", headers=h).status_code == 404
    assert client.get(f"{DELIVERIES}items/{line.id}/packs", headers=auth_headers(role="Viewer")).status_code == 403
