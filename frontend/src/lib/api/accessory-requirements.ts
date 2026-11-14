import { api } from './client';
import { toQuery, type AccessoryValueLine } from './accessory-items';
import type { PackLedgerEntry } from './accessory-packs';

/**
 * Job order accessory requirements (item 19). The planning system (POMS)
 * writes them; WMS only reads them (no create / edit / delete here).
 * Quantities are in the item's base unit (`uom_code`), as decimal text.
 * issued / returned / used / remaining come from the ledger rows that name
 * the line: used = issued - returned, remaining = needed - used (< 0 = over-issued).
 * Needs the `operations` permission; 404 while FEATURE_ACCESSORIES is off.
 */

export type RequirementStatus = 'not_started' | 'partly_issued' | 'fully_issued' | 'over_issued';

export interface AccessoryRequirement {
  id: number;
  job_order_id: number;
  job_order_number: string;
  job_order_client_id: number | null;
  job_order_client_name: string | null;
  accessory_item_id: number;
  item_code: string;
  item_description: string;
  item_color: string | null;
  item_size: string | null;
  value_lines: AccessoryValueLine[];
  uom_code: string;
  /** The item belongs to another client than the job order's. */
  other_client: boolean;
  qty_needed: string;
  issued: string;
  returned: string;
  used: string;
  remaining: string;
  status: RequirementStatus;
  remarks: string | null;
  created_at: string;
}

export interface AccessoryRequirementPage {
  items: AccessoryRequirement[];
  total: number;
}

export interface RequirementQuery {
  /** The Accessory warehouse the page is in (checked, not a filter). */
  warehouse_id?: number;
  job_order_id?: number;
  search?: string;
  status?: RequirementStatus;
  limit?: number;
  offset?: number;
}

/** A ledger row counted against a requirement (issue, return, or a reversal of one). */
export type RequirementEntry = PackLedgerEntry & { pack_id: number; jo_requirement_id: number | null };

export const accessoryRequirementApi = {
  list: (params: RequirementQuery = {}) =>
    api.request<AccessoryRequirementPage>(`/accessory-requirements/${toQuery({ ...params })}`),
  get: (id: number) => api.request<AccessoryRequirement>(`/accessory-requirements/${id}`),
  entries: (id: number) => api.request<RequirementEntry[]>(`/accessory-requirements/${id}/entries`),
};
