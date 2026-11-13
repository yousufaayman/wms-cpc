import { api } from './client';
import type { AccessoryClientRef, AccessoryValueLine } from './accessory-items';

export type ExpectedDeliveryStatus = 'pending' | 'partial' | 'received' | 'cancelled';

/** Which table client_supplier_id points at (polymorphic reference). */
export type SupplierType = 'client' | 'logical_location';

export interface ExpectedDeliveryItemDetail {
  id: number;
  name: string;
}

export interface ExpectedDeliveryItem {
  id: number;
  delivery_id: number;
  // Dyed fabric path
  client_fabric_code_id?: number | null;
  client_fabric_code?: {
    id: number;
    fabric_code?: string | null;
    material_id: number;
    color_id: number;
    client_id: number;
  } | null;
  // Undyed fabric path (client + material)
  client_id?: number | null;
  client?: ExpectedDeliveryItemDetail | null;
  material_id?: number | null;
  material?: ExpectedDeliveryItemDetail | null;
  expected_weight_kg?: number | null;
  expected_length_m?: number | null;
  received_weight_kg: number;
  received_length_m: number;
  notes?: string | null;
  // Accessory path (item 15). Quantities are decimals as text, in the item's
  // base unit (uom_code). received_qty is worked out from the packs received
  // against the line; null on fabric lines.
  accessory_item_id?: number | null;
  expected_qty?: string | null;
  received_qty?: string | null;
  item_code?: string | null;
  item_description?: string | null;
  item_color?: string | null;
  item_size?: string | null;
  value_lines?: AccessoryValueLine[];
  client_refs?: AccessoryClientRef[]; // the client's own codes for the item
  uom_code?: string | null;
  template_id?: number | null; // set = a variant of this template
  template_code?: string | null;
  template_description?: string | null;
}

export interface ExpectedDeliveryItemCreate {
  // Dyed: client_fabric_code_id only. Undyed: client_id + material_id.
  // Accessory: accessory_item_id + expected_qty (in uom_id, default base unit).
  client_fabric_code_id?: number | null;
  client_id?: number | null;
  material_id?: number | null;
  expected_weight_kg?: number | null;
  expected_length_m?: number | null;
  accessory_item_id?: number | null;
  expected_qty?: string | null;
  uom_id?: number | null;
  notes?: string | null;
}

export interface ExpectedDeliveryItemUpdate {
  client_fabric_code_id?: number | null;
  client_id?: number | null;
  material_id?: number | null;
  expected_weight_kg?: number | null;
  expected_length_m?: number | null;
  received_weight_kg?: number;
  received_length_m?: number;
  accessory_item_id?: number;
  expected_qty?: string;
  uom_id?: number | null;
  notes?: string | null;
}

export interface ExpectedDelivery {
  id: number;
  client_supplier_id?: number | null;
  supplier_type?: SupplierType | null;
  /** Display name resolved by the API from the supplier reference. */
  supplier_name?: string | null;
  warehouse_id?: number | null;
  expected_date?: string | null;
  status: ExpectedDeliveryStatus;
  notes?: string | null;
  created_by?: number | null;
  created_at: string;
  closed_at?: string | null;
  closed_by?: number | null;
  items: ExpectedDeliveryItem[];
}

export interface ExpectedDeliveryCreate {
  client_supplier_id?: number | null;
  supplier_type?: SupplierType | null;
  warehouse_id?: number | null;
  expected_date?: string | null;
  notes?: string | null;
}

export interface ExpectedDeliveryUpdate {
  client_supplier_id?: number | null;
  supplier_type?: SupplierType | null;
  warehouse_id?: number | null;
  expected_date?: string | null;
  status?: ExpectedDeliveryStatus;
  notes?: string | null;
}

export interface ExpectedDeliveryFilters {
  skip?: number;
  limit?: number;
  warehouse_id?: number;
  status?: ExpectedDeliveryStatus;
  /** Only deliveries still open (pending or partial). */
  open_only?: boolean;
}

/** The server refuses to delete an accessory line (or change its item) once
    packs were received on it; pages show `accLineHasPacks` for it. */
export const isLineHasPacksError = (e: unknown) =>
  e instanceof Error && e.message.startsWith("Packs were already received");

export const expectedDeliveryApi = {
  getAll: (filters?: ExpectedDeliveryFilters) => {
    const params = new URLSearchParams();
    if (filters?.skip !== undefined) params.append('skip', String(filters.skip));
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));
    if (filters?.warehouse_id !== undefined) params.append('warehouse_id', String(filters.warehouse_id));
    if (filters?.status) params.append('status', filters.status);
    if (filters?.open_only) params.append('open_only', 'true');
    const qs = params.toString();
    return api.request<ExpectedDelivery[]>(qs ? `/expected-deliveries?${qs}` : '/expected-deliveries');
  },

  getById: (id: number) =>
    api.request<ExpectedDelivery>(`/expected-deliveries/${id}`),

  // The server records the logged-in user as the creator.
  create: (delivery: ExpectedDeliveryCreate) =>
    api.request<ExpectedDelivery>('/expected-deliveries', 'POST', delivery),

  update: (id: number, delivery: ExpectedDeliveryUpdate) =>
    api.request<ExpectedDelivery>(`/expected-deliveries/${id}`, 'PUT', delivery),

  delete: (id: number) =>
    api.request<void>(`/expected-deliveries/${id}`, 'DELETE'),

  addItem: (deliveryId: number, item: ExpectedDeliveryItemCreate) =>
    api.request<ExpectedDeliveryItem>(`/expected-deliveries/${deliveryId}/items`, 'POST', item),

  updateItem: (itemId: number, item: ExpectedDeliveryItemUpdate) =>
    api.request<ExpectedDeliveryItem>(`/expected-deliveries/items/${itemId}`, 'PUT', item),

  deleteItem: (itemId: number) =>
    api.request<void>(`/expected-deliveries/items/${itemId}`, 'DELETE'),
};
