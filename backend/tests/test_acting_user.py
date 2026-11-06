"""The user recorded on a document (issued_by, closed_by, confirmed_by,
created_by) must be the logged-in user, never a value sent by the client.

Each test also sends a fake id the old way (query string or body) to prove the
server ignores it.
"""
import itertools

import pytest

from backend import models

FAKE_ID = 999_999
_seq = itertools.count(1)


@pytest.fixture
def places(db):
    """A warehouse and an internal logical location to put receipts between."""
    n = next(_seq)
    wh = models.Warehouse(name=f"pytest_wh_{n}", type="Fabric")
    loc = models.LogicalLocation(name=f"pytest_loc_{n}", location_type="internal")
    db.add_all([wh, loc])
    db.flush()
    return wh, loc


def _bodies(wh, loc):
    return {
        "supplier-receipts": {"source_warehouse_id": wh.id, "target_logical_location_id": loc.id, "remarks": None},
        "internal-receipts": {"source_warehouse_id": wh.id, "target_logical_location_id": loc.id},
        "external-receipts": {"source_warehouse_id": wh.id, "receiver": "pytest receiver"},
    }


@pytest.mark.parametrize("kind", ["supplier-receipts", "internal-receipts", "external-receipts"])
def test_create_and_close_record_logged_in_user(client, make_user, auth_headers, places, kind):
    user = make_user("W_Manager")
    headers = auth_headers(user=user)
    body = _bodies(*places)[kind]

    r = client.post(f"/api/v1/{kind}/?issued_by={FAKE_ID}", json=body, headers=headers)
    assert r.status_code == 201, r.text
    receipt = r.json()
    assert receipt["issued_by"] == user.id

    r = client.post(f"/api/v1/{kind}/{receipt['id']}/close", json={"closed_by": FAKE_ID}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["closed_by"] == user.id


def test_internal_confirm_records_logged_in_user(client, make_user, auth_headers, places):
    issuer = make_user("W_Manager")
    admin = make_user("admin")
    body = _bodies(*places)["internal-receipts"]

    rid = client.post("/api/v1/internal-receipts/", json=body, headers=auth_headers(user=issuer)).json()["id"]
    r = client.post(
        f"/api/v1/internal-receipts/{rid}/confirm",
        json={"confirmed_by": FAKE_ID},
        headers=auth_headers(user=admin),
    )
    assert r.status_code == 200, r.text
    assert r.json()["confirmed_by"] == admin.id
    assert r.json()["issued_by"] == issuer.id


def test_confirm_still_needs_permission(client, auth_headers, places):
    body = _bodies(*places)["internal-receipts"]
    headers = auth_headers("W_Manager")
    rid = client.post("/api/v1/internal-receipts/", json=body, headers=headers).json()["id"]
    assert client.post(f"/api/v1/internal-receipts/{rid}/confirm", headers=headers).status_code == 403


def test_expected_delivery_creator_and_closer_are_logged_in_user(client, make_user, auth_headers, places):
    wh, _ = places
    creator = make_user("W_Manager")
    closer = make_user("gen_ops")
    admin = make_user("admin")

    r = client.post(
        f"/api/v1/expected-deliveries/?created_by={FAKE_ID}",
        json={"warehouse_id": wh.id},
        headers=auth_headers(user=creator),
    )
    assert r.status_code == 201, r.text
    delivery = r.json()
    assert delivery["created_by"] == creator.id
    assert delivery["closed_by"] is None

    r = client.put(
        f"/api/v1/expected-deliveries/{delivery['id']}",
        json={"status": "cancelled"},
        headers=auth_headers(user=closer),
    )
    assert r.status_code == 200, r.text
    assert r.json()["closed_by"] == closer.id

    # Reopening (admin-only) clears the closer again.
    r = client.put(
        f"/api/v1/expected-deliveries/{delivery['id']}",
        json={"status": "pending"},
        headers=auth_headers(user=admin),
    )
    assert r.status_code == 200, r.text
    assert r.json()["closed_by"] is None
