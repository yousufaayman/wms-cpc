// Accessory Analytics (item 26): the report tabs of the Analytics page in an
// Accessory warehouse, and their Excel export. Read-only; mirrors
// backend/api/v1/endpoints/accessory_analytics.py. Quantities are strings
// (NUMERIC) in each item's base unit (`uom_code`).
import { api } from './client';
import type { ExportLang } from './analytics';
import type { PackLedgerEntry } from './accessory-packs';
import type { AccessorySupplierRef } from './accessory-items';

export interface ReportItem {
  accessory_item_id: number;
  item_code: string;
  description: string;
  color: string | null;
  size: string | null;
  template_code: string | null;
  client_id: number | null;
  client_name: string | null;
  category_name_en: string | null;
  category_name_ar: string | null;
  uom_code: string;
  /** The item's supplier codes (a variant shows its template's). */
  supplier_refs: AccessorySupplierRef[];
}

/** Received in the range from one supplier (null type = received with no supplier). */
export interface ReceivedBySupplier {
  supplier_type: string | null;
  client_supplier_id: number | null;
  supplier_name: string | null;
  qty: string;
}

/** A Supplier filter choice. `key` for the API = `${supplier_type}:${client_supplier_id}`. */
export interface ReportSupplier {
  supplier_type: 'client' | 'logical_location';
  client_supplier_id: number;
  name: string;
}

/** A drill-down ledger row with the supplier that delivered its pack. */
export type FlowEntry = PackLedgerEntry & { supplier_name: string | null };

/** Opening + the movements = closing. Issued, supplier returns and written
    off are positive (out-going) quantities; adjusted / reclassified are signed. */
export interface FlowRow extends ReportItem {
  opening: string;
  received: string;
  issued: string;
  returned: string;
  supplier_returns: string;
  written_off: string;
  adjusted: string;
  reclassified: string;
  closing: string;
  entries: number;
  received_by_supplier: ReceivedBySupplier[];
}

export interface JoIssueLine extends ReportItem {
  issued: string;
  returned: string;
  net: string;
}

export interface JoIssues {
  job_order_id: number;
  job_order_number: string;
  client_id: number | null;
  client_name: string | null;
  lines: JoIssueLine[];
  totals: { uom_code: string; issued: string; returned: string; net: string }[];
}

export interface SlowMovingRow extends ReportItem {
  on_hand: string;
  pack_count: number;
  unracked: string;
  racks: string[];
  /** Null = no receipt, issue or return yet (e.g. opening stock only). */
  last_movement: string | null;
  in_stock_since: string;
  idle_days: number;
  generic: boolean;
}

export interface DeliveryReportRow extends ReportItem {
  delivery_id: number;
  delivery_status: string;
  expected_date: string | null;
  supplier_name: string | null;
  expected_qty: string;
  received_qty: string;
  difference: string;
  state: 'waiting' | 'partial' | 'complete' | 'over';
}

export type ReportSheet = 'stock' | 'flow' | 'jo_issues' | 'slow_moving' | 'deliveries';

export interface ReportFilters {
  warehouseId: number;
  dateFrom?: string;
  dateTo?: string;
  clientId?: number | null;
  categoryId?: number | null;
  days?: number;
  /** `logical_location:<id>` or `client:<id>`; not used by the job orders report. */
  supplier?: string | null;
}

function query(f: ReportFilters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams({ warehouse_id: String(f.warehouseId), ...extra });
  if (f.dateFrom) p.append('date_from', f.dateFrom);
  if (f.dateTo) p.append('date_to', f.dateTo);
  if (f.clientId != null) p.append('client_id', String(f.clientId));
  if (f.categoryId != null) p.append('category_id', String(f.categoryId));
  if (f.days != null) p.append('days', String(f.days));
  if (f.supplier) p.append('supplier', f.supplier);
  return p.toString();
}

const BASE = '/analytics/accessories';

export const accessoryAnalyticsApi = {
  flow: (f: ReportFilters) => api.request<FlowRow[]>(`${BASE}/flow?${query({ ...f, days: undefined })}`),
  flowEntries: (itemId: number, f: ReportFilters) =>
    api.request<FlowEntry[]>(`${BASE}/flow/${itemId}/entries?${query({ warehouseId: f.warehouseId, dateFrom: f.dateFrom, dateTo: f.dateTo, supplier: f.supplier })}`),
  jobOrders: (f: ReportFilters) =>
    api.request<JoIssues[]>(`${BASE}/job-orders?${query({ ...f, categoryId: undefined, days: undefined, supplier: undefined })}`),
  suppliers: (warehouseId: number) => api.request<ReportSupplier[]>(`${BASE}/suppliers?${query({ warehouseId })}`),
  slowMoving: (f: ReportFilters) =>
    api.request<SlowMovingRow[]>(`${BASE}/slow-moving?${query({ ...f, dateFrom: undefined, dateTo: undefined })}`),
  deliveries: (f: ReportFilters) =>
    api.request<DeliveryReportRow[]>(`${BASE}/deliveries?${query({ ...f, dateFrom: undefined, dateTo: undefined, days: undefined })}`),
  /** Downloads the workbook: the given sheets (default all five) with the same filters. */
  exportWorkbook: (f: ReportFilters, lang: ExportLang, sheets?: ReportSheet[]) => {
    const p = new URLSearchParams(query(f, { lang }));
    sheets?.forEach((s) => p.append('sheets', s));
    const name = sheets?.length === 1 ? sheets[0] : 'accessory-report';
    return api.downloadFile(`${BASE}/export?${p.toString()}`, `${name}.xlsx`);
  },
};
