from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..crud import user_roles
from ..models import User

# core.users / core.user_roles are shared across multiple systems (WMS, OPS,
# PLAN, ...). This app is WMS, which owns system_id 1 in core.systems. A
# user's role in another system must never grant (or be checked for) access
# here, so every role lookup below is scoped to WMS_SYSTEM_ID.
WMS_SYSTEM_ID = 1

ROLE_ADMIN = "admin"
ROLE_GEN_OPS = "gen_ops"
ROLE_W_MANAGER = "W_Manager"
ROLE_W_WORKER = "W_Worker"
ROLE_VIEWER = "Viewer"

WMS_ROLES = {ROLE_ADMIN, ROLE_GEN_OPS, ROLE_W_MANAGER, ROLE_W_WORKER, ROLE_VIEWER}

# ── Permissions ──────────────────────────────────────────────────────────────
# Fine-grained capabilities checked on top of the base "has a WMS role" gate
# (ensure_wt_or_admin, applied router-wide in api.py). Admin implicitly holds
# every permission (see has_permission) and is never listed below.
#
# Receipts: creating/updating/closing a receipt — including scanning items
# onto it, and creating one via the material-request fulfillment flow — is
# all PERM_CREATE_RECEIPTS. Confirming, reopening a closed receipt, and
# deleting a receipt are each separately gated and admin-only.
PERM_CREATE_RECEIPTS = "create_receipts"
PERM_CONFIRM_RECEIPTS = "confirm_receipts"
PERM_REOPEN_RECEIPTS = "reopen_receipts"
PERM_DELETE_RECEIPTS = "delete_receipts"

# Creating/editing/deleting dyed or undyed fabric rolls ("ingesting" fabric).
PERM_INGEST_FABRIC = "ingest_fabric"

# Expected deliveries: viewing is open to every role except Viewer (see
# PERM_OPERATIONS below); creating/altering/deleting one (or its items) is
# PERM_MANAGE_EXPECTED_DELIVERIES. Reopening a closed delivery stays
# admin-only (enforced inline in expected_deliveries.py, not via a permission
# here) since no role below admin was granted it.
PERM_MANAGE_EXPECTED_DELIVERIES = "manage_expected_deliveries"

# Warehouse racks / logical locations / analytics are all-or-nothing: unlike
# receipts or fabric rolls, a role either has full (read+write) access to the
# page or none at all.
PERM_WAREHOUSE_RACKS = "warehouse_racks"
PERM_LOGICAL_LOCATIONS = "logical_locations"
PERM_ANALYTICS = "analytics"

# General operational access: viewing/creating material requests, and
# viewing expected deliveries. Granted to every role except Viewer, who is
# read-only and restricted to receipts, fabric inventory, and analytics.
PERM_OPERATIONS = "operations"

ROLE_PERMISSIONS = {
    ROLE_W_MANAGER: {
        PERM_CREATE_RECEIPTS,
        PERM_INGEST_FABRIC,
        PERM_MANAGE_EXPECTED_DELIVERIES,
        PERM_WAREHOUSE_RACKS,
        PERM_LOGICAL_LOCATIONS,
        PERM_ANALYTICS,
        PERM_OPERATIONS,
    },
    ROLE_W_WORKER: {
        PERM_CREATE_RECEIPTS,
        PERM_INGEST_FABRIC,
        PERM_OPERATIONS,
    },
    ROLE_GEN_OPS: {
        PERM_MANAGE_EXPECTED_DELIVERIES,
        PERM_LOGICAL_LOCATIONS,
        PERM_ANALYTICS,
        PERM_OPERATIONS,
    },
    ROLE_VIEWER: {
        PERM_ANALYTICS,
    },
}


def _wms_role(db: Session, user: User) -> Optional[str]:
    role = user_roles.get_user_role_by_user_and_system(
        db, user_id=user.id, system_id=WMS_SYSTEM_ID
    )
    return role.role if role else None


def user_has_admin_role(db: Session, user: User) -> bool:
    return _wms_role(db, user) == ROLE_ADMIN


def has_permission(db: Session, user: User, permission: str) -> bool:
    role = _wms_role(db, user)
    if role == ROLE_ADMIN:
        return True
    return permission in ROLE_PERMISSIONS.get(role, set())


def ensure_superuser(db: Session, user: User) -> User:
    if not user_has_admin_role(db, user):
        raise HTTPException(
            status_code=400,
            detail="The user doesn't have enough privileges",
        )
    return user


def ensure_admin(db: Session, user: User) -> User:
    if not user_has_admin_role(db, user):
        raise HTTPException(
            status_code=403,
            detail="Requires the admin role",
        )
    return user


def ensure_permission(db: Session, user: User, permission: str) -> User:
    if not has_permission(db, user, permission):
        raise HTTPException(
            status_code=403,
            detail=f"Requires the '{permission}' permission",
        )
    return user


def ensure_wt_or_admin(db: Session, user: User) -> User:
    if _wms_role(db, user) not in WMS_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Requires an assigned WMS role",
        )
    return user
