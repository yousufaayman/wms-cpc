"""Item 19: job order accessory requirements (read only) and their balance.

The planning system (POMS) writes the requirement rows, so these tests insert
them directly. What they prove:
1. needed / issued / returned / used / remaining come from the ledger rows
   that name the requirement (reversals included) and match a hand calculation
2. the four statuses, and the list filters (status, search, job order)
3. the posting service refuses a requirement of another JO / item, and the
   database refuses it too when the service is skipped
4. the API is read-only, flags another client's item, needs `operations`,
   is off with the feature flag, and only accepts Accessory warehouses
"""
import itertools
from datetime import datetime
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError

from backend import models
from backend.core.config import settings
from backend.domains.posting import accessory as ledger
from backend.domains.posting.accessory import LedgerLine, NewPack
from backend.tests.test_accessory_items import (  # noqa: F401  (fixtures)
    _client,
    _create,
    accessories_on,
    setup,
)
from backend.tests.test_accessory_packs import place  # noqa: F401  (fixture)

REQS = "/api/v1/accessory-requirements/"
_seq = itertools.count(1)


def _jo(db, client_id):
    style = models.Model(model_name=f"pytest_req_model_{next(_seq)}")
    db.add(style)
    db.flush()
    jo = models.JobOrder(job_order_number=f"pytest-req-jo-{next(_seq)}", client_id=client_id,
                         model_id=style.model_id, date_created=datetime.now())
    db.add(jo)
    db.flush()
    return jo


def _req(db, jo, item_id, qty):
    r = models.JobOrderAccessoryRequirement(job_order_id=jo.job_order_id, accessory_item_id=item_id,
                                            qty_needed=Decimal(str(qty)))
    db.add(r)
    db.flush()
    return r


@pytest.fixture
def plan(client, auth_headers, setup, place, db, make_user):
    """Two items, two job orders of the setup client, one pack of 500 of each
    item, a worker and a manager's headers."""
    h = auth_headers(role="W_Manager")
    item = _create(client, h, setup).json()["id"]
    other = _create(client, h, setup, description="Button 15 mm").json()["id"]
    jo1, jo2 = _jo(db, setup["client"].client_id), _jo(db, setup["client"].client_id)
    user = make_user("W_Worker")
    _, (pack, other_pack) = ledger.receive(db, user.id, place["acc"].id, [NewPack(item, 500), NewPack(other, 500)])
    db.commit()
    return {"item": item, "other": other, "jo1": jo1, "jo2": jo2, "user": user, "pack": pack,
            "other_pack": other_pack, "h": h, "wh": place["acc"], "fab": place["fab"]}


def _get(client, p, req):
    r = client.get(f"{REQS}{req.id}", headers=p["h"])
    assert r.status_code == 200, r.text
    return r.json()


def _refused(fn, code=400, text=None):
    with pytest.raises(HTTPException) as e:
        fn()
    assert e.value.status_code == code, e.value.detail
    if text:
        assert text in e.value.detail, e.value.detail


# ── 1. Balance ──────────────────────────────────────────────────────────────

def test_balance_matches_hand_calculation(client, db, plan):
    p, u = plan, plan["user"].id
    req = _req(db, p["jo1"], p["item"], 100)
    db.commit()
    assert _get(client, p, req)["status"] == "not_started"

    ledger.issue(db, u, p["pack"].id, 30, p["jo1"].job_order_id, jo_requirement_id=req.id)
    wrong = ledger.issue(db, u, p["pack"].id, "20.25", p["jo1"].job_order_id, jo_requirement_id=req.id)
    ledger.return_to_pack(db, u, p["pack"].id, 5, p["jo1"].job_order_id, jo_requirement_id=req.id)
    # Issues for the same JO without the requirement don't count against it
    ledger.issue(db, u, p["pack"].id, 7, p["jo1"].job_order_id)
    db.commit()
    reversal = ledger.reverse_posting(db, u, wrong.id, "wrong pack")  # the 20.25 is cancelled
    db.commit()
    assert {e.jo_requirement_id for e in reversal.entries} == {req.id}

    body = _get(client, p, req)
    assert Decimal(body["qty_needed"]) == 100
    assert Decimal(body["issued"]) == 30
    assert Decimal(body["returned"]) == 5
    assert Decimal(body["used"]) == 25
    assert Decimal(body["remaining"]) == 75
    assert body["status"] == "partly_issued"
    assert body["uom_code"] == "QPC" and body["other_client"] is False

    entries = client.get(f"{REQS}{req.id}/entries", headers=p["h"]).json()
    assert [(e["entry_type"], Decimal(e["qty_delta"])) for e in entries] == [
        ("issue", Decimal("-30")), ("issue", Decimal("-20.25")), ("return", Decimal("5")), ("issue", Decimal("20.25")),
    ]
    assert all(e["jo_requirement_id"] == req.id for e in entries)


def test_statuses_and_filters(client, db, plan):
    p, u = plan, plan["user"].id
    jo1, jo2 = p["jo1"].job_order_id, p["jo2"].job_order_id
    untouched = _req(db, p["jo1"], p["item"], 10)
    full = _req(db, p["jo1"], p["other"], 10)
    over = _req(db, p["jo2"], p["item"], 10)
    partly = _req(db, p["jo2"], p["other"], 10)
    db.commit()
    ledger.issue(db, u, p["other_pack"].id, 10, jo1, jo_requirement_id=full.id)
    ledger.issue(db, u, p["pack"].id, 12, jo2, jo_requirement_id=over.id)
    ledger.issue(db, u, p["other_pack"].id, 4, jo2, jo_requirement_id=partly.id)
    db.commit()

    def ids(**params):
        r = client.get(REQS, params={"search": "pytest-req-jo", **params}, headers=p["h"])
        assert r.status_code == 200, r.text
        return {row["id"]: row["status"] for row in r.json()["items"]}

    mine = {untouched.id, full.id, over.id, partly.id}
    assert {k: v for k, v in ids().items() if k in mine} == {
        untouched.id: "not_started", full.id: "fully_issued", over.id: "over_issued", partly.id: "partly_issued",
    }
    for status, req in [("not_started", untouched), ("fully_issued", full), ("over_issued", over), ("partly_issued", partly)]:
        assert req.id in ids(status=status)
        assert not (mine - {req.id}) & set(ids(status=status))
    assert set(ids(job_order_id=jo2)) == {over.id, partly.id}
    assert Decimal(next(r for r in client.get(REQS, params={"job_order_id": jo2}, headers=p["h"]).json()["items"]
                        if r["id"] == over.id)["remaining"]) == -2
    by_number = client.get(REQS, params={"search": p["jo2"].job_order_number}, headers=p["h"]).json()
    assert {r["id"] for r in by_number["items"]} == {over.id, partly.id} and by_number["total"] == 2
    assert client.get(REQS, params={"status": "nope"}, headers=p["h"]).status_code == 422


# ── 2. Posting rules and database guards ────────────────────────────────────

def test_service_refuses_mismatched_requirement(db, plan):
    p, u = plan, plan["user"].id
    req = _req(db, p["jo1"], p["item"], 10)
    db.commit()
    _refused(lambda: ledger.issue(db, u, p["pack"].id, 1, p["jo2"].job_order_id, jo_requirement_id=req.id),
             text="another job order")
    _refused(lambda: ledger.issue(db, u, p["other_pack"].id, 1, p["jo1"].job_order_id, jo_requirement_id=req.id),
             text="another item")
    _refused(lambda: ledger.issue(db, u, p["pack"].id, 1, p["jo1"].job_order_id, jo_requirement_id=999999999),
             code=404)
    _refused(lambda: ledger.post(db, u, [LedgerLine(p["pack"].id, "adjustment", Decimal(1), jo_requirement_id=req.id)],
                                 reason="x"), text="needs its job order")


@pytest.mark.parametrize("case", ["other_jo", "other_item", "no_jo"])
def test_database_refuses_mismatched_requirement(db, plan, case):
    p = plan
    req = _req(db, p["jo1"], p["item"], 10)
    posting = models.AccessoryPosting(created_by=p["user"].id, reason="direct")
    db.add(posting)
    db.flush()
    row = {
        "other_jo": dict(pack_id=p["pack"].id, accessory_item_id=p["item"], entry_type="issue", qty_delta=-1,
                         job_order_id=p["jo2"].job_order_id),
        "other_item": dict(pack_id=p["other_pack"].id, accessory_item_id=p["other"], entry_type="issue", qty_delta=-1,
                           job_order_id=p["jo1"].job_order_id),
        "no_jo": dict(pack_id=p["pack"].id, accessory_item_id=p["item"], entry_type="adjustment", qty_delta=-1,
                      job_order_id=None),
    }[case]
    db.add(models.AccessoryLedgerEntry(posting_id=posting.id, jo_requirement_id=req.id, **row))
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_one_line_per_item_per_job_order(db, plan):
    _req(db, plan["jo1"], plan["item"], 10)
    with pytest.raises(IntegrityError):
        _req(db, plan["jo1"], plan["item"], 5)
    db.rollback()


# ── 3. API ──────────────────────────────────────────────────────────────────

def test_other_client_item_is_flagged(client, auth_headers, db, setup, plan):
    other_client = _client(db, "Test Client Q2", "qb")
    theirs = _create(client, plan["h"], setup, client_id=other_client.client_id).json()["id"]
    own = _create(client, plan["h"], setup, client_id=setup["client"].client_id).json()["id"]
    flagged, fine = _req(db, plan["jo1"], theirs, 3), _req(db, plan["jo1"], own, 3)
    db.commit()
    assert _get(client, plan, flagged)["other_client"] is True
    assert _get(client, plan, fine)["other_client"] is False


def test_read_only_permissions_flag_and_warehouse(client, auth_headers, db, plan, monkeypatch):
    req = _req(db, plan["jo1"], plan["item"], 10)
    db.commit()
    h = plan["h"]
    # No write endpoints at all
    assert client.post(REQS, json={}, headers=h).status_code == 405
    assert client.patch(f"{REQS}{req.id}", json={}, headers=h).status_code == 405
    assert client.delete(f"{REQS}{req.id}", headers=h).status_code == 405
    # Accessory warehouse ok, Fabric refused
    assert client.get(REQS, params={"warehouse_id": plan["wh"].id}, headers=h).status_code == 200
    assert client.get(REQS, params={"warehouse_id": plan["fab"].id}, headers=h).status_code == 400
    # Worker yes, Viewer no
    assert client.get(REQS, headers=auth_headers(role="W_Worker")).status_code == 200
    assert client.get(REQS, headers=auth_headers(role="Viewer")).status_code == 403
    assert client.get(f"{REQS}999999999", headers=h).status_code == 404
    assert client.get(f"{REQS}999999999/entries", headers=h).status_code == 404
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    assert client.get(REQS, headers=h).status_code == 404
