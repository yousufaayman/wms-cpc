// What each warehouse type can see and use.
// Mirrors backend/core/warehouse_modules.py exactly. Keep the two in sync
// (backend/tests/test_warehouse_modules.py fails if they drift).
//
// Permissions (permissions.ts) answer "may this person do X?"; this file
// answers "does X exist in this warehouse?". The sidebar shows a link and a
// route opens only when both say yes.
import type { WarehouseType } from "./api";
import type { Features } from "./api/features";

export type WarehouseModule =
  | "dashboard"
  | "fabric_inventory"
  | "fabric_rolls"
  | "receipts"
  | "expected_deliveries"
  | "material_requests"
  | "warehouse_racks"
  | "logical_locations"
  | "analytics"
  | "accessory_inventory"
  | "receive_packs"
  | "accessory_items"
  | "needle_exchange";

type Feature = keyof Features;

// module -> feature flag it needs in that warehouse type (null = always on).
// A module missing from a type does not exist in that type.
export const WAREHOUSE_MODULES: Record<WarehouseType, Partial<Record<WarehouseModule, Feature | null>>> = {
  Fabric: {
    dashboard: null,
    fabric_inventory: null,
    receipts: null,
    expected_deliveries: null,
    material_requests: null,
    fabric_rolls: null,
    warehouse_racks: null,
    logical_locations: null,
    analytics: null,
  },
  // Behind FEATURE_ACCESSORIES, except the set-up pages so the warehouse can
  // be prepared in advance. Accessory analytics arrives in item 26.
  Accessory: {
    dashboard: null,
    accessory_inventory: "accessories",
    receive_packs: "accessories",
    accessory_items: "accessories",
    needle_exchange: "needles",
    receipts: "accessories",
    expected_deliveries: "accessories",
    material_requests: "accessories",
    warehouse_racks: null,
    logical_locations: null,
  },
  // RMG is out of scope for now: set-up pages only.
  RMG: {
    dashboard: null,
    warehouse_racks: null,
    logical_locations: null,
  },
};

export function moduleEnabled(
  type: WarehouseType | null | undefined,
  module: WarehouseModule,
  features: Features,
): boolean {
  if (!type) return false;
  const modules = WAREHOUSE_MODULES[type];
  if (!modules || !(module in modules)) return false;
  const feature = modules[module];
  return feature == null || features[feature];
}
