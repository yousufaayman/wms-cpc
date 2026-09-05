import { ComponentType, LazyExoticComponent } from "react";
import { WarehouseType } from "@/lib/api";

/** Props every dashboard widget receives — widgets fetch their own data from these. */
export interface WidgetProps {
  warehouseId: number;
  warehouseType: WarehouseType;
}

/** Grid span hint: sm/md = one column, lg = two columns, full = entire row. */
export type WidgetSize = "sm" | "md" | "lg" | "full";

export interface WidgetDefinition {
  /** Unique, stable id (used as React key). */
  id: string;
  component: LazyExoticComponent<ComponentType<WidgetProps>> | ComponentType<WidgetProps>;
  size: WidgetSize;
  /** Explicit grid placement classes (col/row spans); overrides the size hint. */
  gridClass?: string;
}
