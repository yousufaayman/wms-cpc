import { lazy } from "react";
import { WarehouseType } from "@/lib/api";
import { WidgetDefinition } from "./types";

// Shared: work in any warehouse type (they filter by warehouse id only).
const ExpectedDeliveriesCalendarWidget = lazy(
  () => import("./shared/ExpectedDeliveriesCalendarWidget"),
);
const OpenReceiptsWidget = lazy(() => import("./shared/OpenReceiptsWidget"));
// Fabric only.
const MaterialRequestsWidget = lazy(() => import("./fabric/MaterialRequestsWidget"));
const QuickViewWidget = lazy(() => import("./fabric/QuickViewWidget"));
const FabricCodeLookupWidget = lazy(() => import("./fabric/FabricCodeLookupWidget"));
// Accessory only (item 24).
const TrimLookupWidget = lazy(() => import("./accessory/TrimLookupWidget"));
const NeedsAttentionWidget = lazy(() => import("./accessory/NeedsAttentionWidget"));
const ShortagesWidget = lazy(() => import("./accessory/ShortagesWidget"));
const JobOrderBalancesWidget = lazy(() => import("./accessory/JobOrderBalancesWidget"));

/**
 * Dashboard widgets per warehouse type. Types are developed one at a time —
 * an empty list is valid and renders a "no widgets yet" dashboard.
 * To add a widget: create its component under widgets/<type>/ (or widgets/shared/
 * if several types use it) and register it here. Set `module` when the widget
 * belongs to a module that can be switched off in that warehouse type.
 */
export const widgetRegistry: Record<WarehouseType, WidgetDefinition[]> = {
  // Fabric dashboard grid (lg+): 2 columns × 7 rows —
  // calendar rows 1-3 full width, quick view + fabric code lookup share row 4
  // (one column each, auto-placed), material requests rows 5-7 col 1, open
  // receipts rows 5-7 col 2.
  Fabric: [
    {
      id: "fabric-expected-deliveries-calendar",
      component: ExpectedDeliveriesCalendarWidget,
      size: "full",
      gridClass: "lg:col-span-2 lg:row-span-3",
    },
    {
      id: "fabric-quick-view",
      component: QuickViewWidget,
      size: "md",
    },
    {
      id: "fabric-code-lookup",
      component: FabricCodeLookupWidget,
      size: "md",
    },
    {
      id: "fabric-material-requests",
      component: MaterialRequestsWidget,
      size: "md",
      gridClass: "lg:row-span-3",
    },
    {
      id: "fabric-open-receipts",
      component: OpenReceiptsWidget,
      size: "md",
      gridClass: "lg:row-span-3",
    },
  ],
  RMG: [],
  // Accessory dashboard (lg+), 2 columns × 11 rows, scrolls (item 24):
  // trim lookup + needs attention row 1, shortages + job order balances rows
  // 2-4, calendar rows 5-8 full width, open receipts rows 9-11 full width.
  // Everything hides while FEATURE_ACCESSORIES is off; shortages and JO
  // balances need `operations` (Viewer has none).
  Accessory: [
    {
      id: "accessory-trim-lookup",
      component: TrimLookupWidget,
      size: "md",
      module: "accessory_inventory",
    },
    {
      id: "accessory-needs-attention",
      component: NeedsAttentionWidget,
      size: "md",
      module: "accessory_inventory",
    },
    {
      id: "accessory-shortages",
      component: ShortagesWidget,
      size: "md",
      gridClass: "lg:row-span-3",
      module: "material_requests",
      permission: "operations",
    },
    {
      id: "accessory-job-order-balances",
      component: JobOrderBalancesWidget,
      size: "md",
      gridClass: "lg:row-span-3",
      module: "material_requests",
      permission: "operations",
    },
    {
      id: "accessory-expected-deliveries-calendar",
      component: ExpectedDeliveriesCalendarWidget,
      size: "full",
      gridClass: "lg:col-span-2 lg:row-span-4",
      module: "expected_deliveries",
    },
    {
      id: "accessory-open-receipts",
      component: OpenReceiptsWidget,
      size: "full",
      gridClass: "lg:col-span-2 lg:row-span-3",
      module: "receipts",
    },
  ],
};

/** Grid rows per dashboard (lg+). Fabric fits the screen (7 rows); the
 *  Accessory dashboard has more widgets, so its rows have a fixed height
 *  and the page scrolls. Full class names, so Tailwind keeps them. */
export const gridRows: Record<WarehouseType, string> = {
  Fabric: "flex-1 min-h-0 lg:grid-rows-7",
  RMG: "flex-1 min-h-0 lg:grid-rows-7",
  Accessory: "lg:grid-rows-[repeat(11,7rem)]",
};
