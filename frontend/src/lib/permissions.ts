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
  | "operations"
  // Accessory warehouse (see authz.py for what each covers)
  | "manage_accessory_items"
  | "receive_accessories"
  | "confirm_accessory_receipts"
  | "manage_jo_requirements"
  | "issue_accessories"
  | "needle_exchange"
  | "adjust_accessories";

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
    "manage_accessory_items",
    "receive_accessories",
    "confirm_accessory_receipts",
    "manage_jo_requirements",
    "issue_accessories",
    "needle_exchange",
  ]),
  W_Worker: new Set<Permission>([
    "create_receipts",
    "ingest_fabric",
    "operations",
    "receive_accessories",
    "issue_accessories",
    "needle_exchange",
  ]),
  gen_ops: new Set<Permission>([
    "manage_expected_deliveries",
    "logical_locations",
    "analytics",
    "operations",
    "manage_jo_requirements",
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
