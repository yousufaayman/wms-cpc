import { api } from './client';
import { toQuery, type AccessoryValueLine } from './accessory-items';

/**
 * Accessory packs and stock (items 12–14). A pack holds one item; its label
 * barcode is `<id>*ACC`. How much it holds (`quantity`, in the item's base
 * unit) is the sum of its ledger rows. Packs are made by Receive Packs
 * (item 17), so there's no create call here. Reading is open to every WMS
 * role; 404 while FEATURE_ACCESSORIES is off.
 *
 * `stock` (item 14) = the Accessory Inventory roll-ups by item, client or rack.
 * A row's `key` is null for generic items (by client) or for packs waiting for
 * put-away (by rack). Totals come one per unit: pieces and metres are never
 * added together.
 */

export type PackStatus = 'active' | 'empty';
export type StockGroupBy = 'item' | 'client' | 'rack';

export interface AccessoryPack {
  id: number;
  barcode: string;
  accessory_item_id: number;
  item_code: string;
  item_description: string;
  item_color: string | null;
  item_size: string | null;
  value_lines: AccessoryValueLine[];
  uom_code: string;
  client_id: number | null;
  warehouse_id: number;
  rack_id: number | null; // null = waiting for put-away
  rack_code: string | null;
  expected_delivery_item_id: number | null;
  supplier_type: 'client' | 'logical_location' | null;
  client_supplier_id: number | null;
  status: PackStatus;
  quantity: string; // decimal as text, base unit
  created_by: number;
  created_at: string;
}

export interface AccessoryPackPage {
  items: AccessoryPack[];
  total: number;
}

/** Filters shared by the roll-ups and the pack list. The item fields mean the
    same as on the Items page's advanced search. */
export interface StockFilters {
  warehouse_id?: number;
  q?: string;
  code?: string;
  description?: string;
  color?: string;
  size?: string;
  ref_code?: string;
  ref_client_id?: number;
  ref_supplier_id?: number;
  base_uom_id?: number;
  category_id?: number;
  line_value?: string;
  template_id?: number;
  line?: string[]; // "key:text", one template line each
  client_id?: number;
  generic?: boolean; // items for no client
  rack_id?: number;
  unracked?: boolean; // waiting for put-away
  limit?: number;
  offset?: number;
}

export interface PackQuery extends StockFilters {
  accessory_item_id?: number;
  status?: PackStatus;
}

export interface StockQuery extends StockFilters {
  group_by: StockGroupBy;
  include_empty?: boolean;
}

export interface StockTotal {
  uom_id: number;
  uom_code: string;
  qty: string;
}

export interface StockRow {
  key: number | null;
  code: string | null; // item code / client code / rack code
  name: string | null; // item description / client name
  color: string | null;
  size: string | null;
  value_lines: AccessoryValueLine[];
  client_name: string | null;
  item_count: number;
  pack_count: number;
  totals: StockTotal[];
}

export interface StockPage {
  items: StockRow[];
  total: number;
}

/** One ledger row of a pack's history; `balance` = what the pack held after it. */
export interface PackLedgerEntry {
  id: number;
  posting_id: number;
  entry_type: string;
  qty_delta: string;
  balance: string | null;
  job_order_id: number | null;
  job_order_number: string | null;
  reversal_of: number | null;
  is_reversed: boolean;
  reason: string | null;
  created_by: number;
  created_by_name: string | null;
  created_at: string;
}

export interface PackMove {
  id: number;
  pack_id: number;
  from_rack_code: string | null; // null = no rack
  to_rack_code: string | null;
  moved_by: number;
  moved_by_name: string | null;
  moved_at: string;
}

export const accessoryPackApi = {
  stock: (params: StockQuery) => api.request<StockPage>(`/accessory-packs/stock${toQuery({ ...params })}`),
  list: (params: PackQuery = {}) => api.request<AccessoryPackPage>(`/accessory-packs/${toQuery({ ...params })}`),
  get: (id: number) => api.request<AccessoryPack>(`/accessory-packs/${id}`),
  ledger: (id: number) => api.request<PackLedgerEntry[]>(`/accessory-packs/${id}/ledger`),
  moves: (id: number) => api.request<PackMove[]>(`/accessory-packs/${id}/moves`),
};
