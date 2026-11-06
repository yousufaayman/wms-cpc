"""Posting service (backend/domains/posting): the right adapter serves each
warehouse type, and Fabric behaves exactly as before the move:
scan = roll 'out' + issued_date set, a second scan is refused, removing the
line = roll 'in' + issued_date cleared, and confirming an internal receipt
leaves the rolls alone.
"""
import itertools

import pytest

from backend import models
from backend.domains import posting
from backend.domains.posting.fabric import FabricAdapter

_seq = itertools.count(1)


@pytest.fixture
def fabric_setup(db):
    """A Fabric warehouse, a location, and one undyed roll in stock."""
    n = next(_seq)
    wh = models.Warehouse(name=f"pytest_post_wh_{n}", type="Fabric")
    loc = models.LogicalLocation(name=f"pytest_post_loc_{n}", location_type="internal")
    cl = models.Client(client_name=f"pytest_post_client_{n}")
    mat = models.Material(material_name=f"pytest_post_mat_{n}")
    db.add_all([wh, loc, cl, mat])
    db.flush()
    roll = models.UndyedFabricRoll(client_id=cl.client_id, material_id=mat.material_id, weight=20, status="in")
    db.add(roll)
    db.flush()
    return wh, loc, roll


def _new_internal_receipt(client, headers, wh, loc):
    r = client.post(
        "/api/v1/internal-receipts/",
        json={"source_warehouse_id": wh.id, "target_logical_location_id": loc.id},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _scan(client, headers, rid, roll):
    return client.post(
        f"/api/v1/receipts/internal/{rid}/fabric-items",
        json={"item_type": "UndyedFabricRoll", "undyed_roll_id": roll.id},
        headers=headers,
    )


def test_registry_picks_adapter_per_warehouse_type():
    assert isinstance(posting.adapter_for_warehouse_type("Fabric"), FabricAdapter)
    assert isinstance(posting.adapter_for_line_kind("fabric"), FabricAdapter)
    # No adapter yet: the do-nothing default.
    for wtype in ("Accessory", "RMG"):
        assert type(posting.adapter_for_warehouse_type(wtype)) is posting.PostingAdapter
    assert type(posting.adapter_for_line_kind("box")) is posting.PostingAdapter


def test_default_adapter_has_no_reverse_yet():
    with pytest.raises(NotImplementedError):
        posting.PostingAdapter().reverse(None, "internal", None, 1, "test")


def test_fabric_scan_issues_roll_and_delete_restores_it(client, db, auth_headers, fabric_setup):
    wh, loc, roll = fabric_setup
    headers = auth_headers("W_Manager")
    rid = _new_internal_receipt(client, headers, wh, loc)

    r = _scan(client, headers, rid, roll)
    assert r.status_code == 201, r.text
    line = r.json()
    assert line["internal_receipt_id"] == rid
    assert line["supplier_receipt_id"] is None and line["external_receipt_id"] is None
    db.refresh(roll)
    assert roll.status == "out"
    assert roll.issued_date is not None

    r = _scan(client, headers, rid, roll)
    assert r.status_code == 400
    assert "not in stock" in r.json()["detail"]

    r = client.delete(f"/api/v1/receipts/fabric-items/{line['id']}", headers=headers)
    assert r.status_code == 204, r.text
    db.refresh(roll)
    assert roll.status == "in"
    assert roll.issued_date is None
    assert db.get(models.FabricReceiptItem, line["id"]) is None


def test_fabric_scan_of_unknown_roll_is_refused(client, auth_headers, fabric_setup):
    wh, loc, _ = fabric_setup
    headers = auth_headers("W_Manager")
    rid = _new_internal_receipt(client, headers, wh, loc)
    r = client.post(
        f"/api/v1/receipts/internal/{rid}/fabric-items",
        json={"item_type": "UndyedFabricRoll", "undyed_roll_id": 987_654_321},
        headers=headers,
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Roll not found"


def test_internal_confirm_leaves_fabric_rolls_out(client, db, auth_headers, fabric_setup):
    wh, loc, roll = fabric_setup
    rid = _new_internal_receipt(client, auth_headers("W_Manager"), wh, loc)
    assert _scan(client, auth_headers("W_Manager"), rid, roll).status_code == 201

    r = client.post(f"/api/v1/internal-receipts/{rid}/confirm", headers=auth_headers("admin"))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "confirmed"
    db.refresh(roll)
    assert roll.status == "out"


def test_confirm_calls_the_warehouse_adapter(client, db, auth_headers, fabric_setup, monkeypatch):
    """post_confirm reaches the adapter of the receipt's warehouse type, once,
    with the logged-in user: this is where accessories will post the ledger."""
    wh, loc, _ = fabric_setup
    rid = _new_internal_receipt(client, auth_headers("W_Manager"), wh, loc)
    admin_headers = auth_headers("admin")
    calls = []
    monkeypatch.setattr(
        FabricAdapter, "post_confirm",
        lambda self, db, kind, receipt, actor_id: calls.append((kind, receipt.id, actor_id)),
    )

    r = client.post(f"/api/v1/internal-receipts/{rid}/confirm", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert calls == [("internal", rid, r.json()["confirmed_by"])]

    # Already confirmed: no second posting.
    client.post(f"/api/v1/internal-receipts/{rid}/confirm", headers=admin_headers)
    assert len(calls) == 1
