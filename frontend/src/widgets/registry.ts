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
  // Accessory dashboard (lg+): calendar rows 1-4, open receipts rows 5-7, both
  // full width. Both hide while FEATURE_ACCESSORIES is off. Accessory-specific
  // widgets (stock, shortages, needles) arrive in item 24.
  Accessory: [
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
