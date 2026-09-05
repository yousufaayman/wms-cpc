// Mirrors backend/core/authz.py exactly. Keep the two in sync.
import type { WmsRole } from "./api";

export type Permission =
  | "create_receipts"
  | "confirm_receipts"
  | "reopen_receipts"
  | "delete_receipts"
  | "ingest_fabric"
  | "manage_expected_deliveries"
  | "warehouse_racks"
  | "logical_locations"
  | "analytics"
  | "operations";

const ROLE_PERMISSIONS: Record<WmsRole, Set<Permission>> = {
  admin: new Set(), // admin bypasses the set entirely — see hasPermission
  W_Manager: new Set<Permission>([
    "create_receipts",
    "ingest_fabric",
    "manage_expected_deliveries",
    "warehouse_racks",
    "logical_locations",
    "analytics",
    "operations",
  ]),
  W_Worker: new Set<Permission>([
    "create_receipts",
    "ingest_fabric",
    "operations",
  ]),
  gen_ops: new Set<Permission>([
    "manage_expected_deliveries",
    "logical_locations",
    "analytics",
    "operations",
  ]),
  Viewer: new Set<Permission>([
    "analytics",
  ]),
};

export function hasPermission(role: WmsRole | null, permission: Permission): boolean {
  if (role === "admin") return true;
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
