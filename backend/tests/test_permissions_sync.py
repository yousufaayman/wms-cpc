"""backend/core/authz.py and frontend/src/lib/permissions.ts must list the same
permissions and give each role the same set. Needs no database."""
import re
from pathlib import Path

from backend.core import authz

PERMISSIONS_TS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "permissions.ts"


def _parse_ts():
    src = PERMISSIONS_TS.read_text(encoding="utf-8")
    union = re.search(r"export type Permission\s*=(.*?);", src, re.S)
    assert union, "Permission type not found in permissions.ts"
    declared = set(re.findall(r'"([a-z_]+)"', union.group(1)))

    mapping = re.search(r"ROLE_PERMISSIONS[^=]*=\s*\{(.*?)\n\};", src, re.S)
    assert mapping, "ROLE_PERMISSIONS not found in permissions.ts"
    roles = {
        role: set(re.findall(r'"([a-z_]+)"', body))
        for role, body in re.findall(r"^\s*(\w+):\s*new Set(?:<Permission>)?\((.*?)\)\s*,", mapping.group(1), re.S | re.M)
    }
    return declared, roles


def test_same_permission_names():
    declared, _ = _parse_ts()
    backend = {v for k, v in vars(authz).items() if k.startswith("PERM_") and isinstance(v, str)}
    assert declared == backend, f"only in permissions.ts: {declared - backend}; only in authz.py: {backend - declared}"


def test_same_permissions_per_role():
    _, ts_roles = _parse_ts()
    assert ts_roles.pop("admin", set()) == set(), "admin must stay an empty set in permissions.ts (it bypasses checks)"
    assert ts_roles == {role: set(perms) for role, perms in authz.ROLE_PERMISSIONS.items()}


def test_every_role_is_listed_in_frontend():
    _, ts_roles = _parse_ts()
    assert set(ts_roles) == authz.WMS_ROLES
