import { lazy } from "react";
import { WarehouseType } from "@/lib/api";
import { WidgetDefinition } from "./types";

const ExpectedDeliveriesCalendarWidget = lazy(
  () => import("./fabric/ExpectedDeliveriesCalendarWidget"),
);
const MaterialRequestsWidget = lazy(() => import("./fabric/MaterialRequestsWidget"));
const OpenReceiptsWidget = lazy(() => import("./fabric/OpenReceiptsWidget"));
const QuickViewWidget = lazy(() => import("./fabric/QuickViewWidget"));
const FabricCodeLookupWidget = lazy(() => import("./fabric/FabricCodeLookupWidget"));

/**
 * Dashboard widgets per warehouse type. Types are developed one at a time —
 * an empty list is valid and renders a "no widgets yet" dashboard.
 * To add a widget: create its component under widgets/<type>/ and register it here.
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
  Accessory: [],
};
