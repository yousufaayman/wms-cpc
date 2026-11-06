"""Basic checks: the app starts against the test database and login rules work."""


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_no_login_is_rejected(client):
    assert client.get("/api/v1/warehouses/").status_code in (401, 403)


def test_user_without_wms_role_is_forbidden(client, auth_headers):
    assert client.get("/api/v1/warehouses/", headers=auth_headers(role=None)).status_code == 403


def test_user_with_wms_role_can_list_warehouses(client, auth_headers):
    r = client.get("/api/v1/warehouses/", headers=auth_headers(role="Viewer"))
    assert r.status_code == 200, r.text
    assert isinstance(r.json(), list)
