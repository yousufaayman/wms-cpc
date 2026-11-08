"""Item 4: accessory permissions follow the agreed role matrix, and feature
flags reach GET /api/v1/features. The matrix test needs no database."""
import pytest

from backend.core import authz
from backend.core.config import settings

# development_DOCs/Tab 1.md, "Roles and permissions" (admin has everything).
EXPECTED = {
    "manage_accessory_items":     {"W_Manager"},
    "receive_accessories":        {"W_Manager", "W_Worker"},
    "confirm_accessory_receipts": {"W_Manager"},
    "issue_accessories":          {"W_Manager", "W_Worker"},
    "needle_exchange":            {"W_Manager", "W_Worker"},
    "adjust_accessories":         set(),
}


@pytest.mark.parametrize("perm,roles", EXPECTED.items())
def test_accessory_role_matrix(perm, roles):
    granted = {role for role, perms in authz.ROLE_PERMISSIONS.items() if perm in perms}
    assert granted == roles


def test_fabric_confirm_stays_admin_only():
    assert not any(authz.PERM_CONFIRM_RECEIPTS in p for p in authz.ROLE_PERMISSIONS.values())


@pytest.mark.parametrize("acc,needles,expected", [
    (False, False, {"accessories": False, "needles": False}),
    (True, False, {"accessories": True, "needles": False}),
    (True, True, {"accessories": True, "needles": True}),
    (False, True, {"accessories": False, "needles": False}),  # needles need accessories
])
def test_features_endpoint(client, auth_headers, monkeypatch, acc, needles, expected):
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", acc)
    monkeypatch.setattr(settings, "FEATURE_NEEDLES", needles)
    r = client.get("/api/v1/features/", headers=auth_headers(role="Viewer"))
    assert r.status_code == 200, r.text
    assert r.json() == expected


def test_features_need_login(client):
    assert client.get("/api/v1/features/").status_code in (401, 403)


def test_require_feature(monkeypatch):
    from fastapi import HTTPException
    from backend.core.deps import require_feature

    check = require_feature("accessories")
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", False)
    with pytest.raises(HTTPException) as e:
        check()
    assert e.value.status_code == 404
    monkeypatch.setattr(settings, "FEATURE_ACCESSORIES", True)
    check()  # no error
    with pytest.raises(ValueError):
        require_feature("nope")
