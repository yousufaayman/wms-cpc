import { api } from './client';
import type { UomConversion } from './accessory-setup';

/**
 * Accessory items (item 8). The server makes the code on create:
 * `<client code | GEN>-<category>-<number>`, e.g. UR-ELS-0007. Category and
 * client are part of the code, so they can't be changed afterwards (a wrong one
 * = switch the item off and create a new one). Items are switched off, never
 * deleted. Reading is open to every WMS role; create/edit needs
 * `manage_accessory_items`. 404 while FEATURE_ACCESSORIES is off.
 */

export interface AccessoryItem {
  id: number;
  code: string;
  category_id: number;
  client_id: number | null; // null = generic
  description: string;
  color: string | null;
  size: string | null;
  base_uom_id: number;
  active: boolean;
  created_by: number;
  created_at: string;
  updated_at: string | null;
}

export interface AccessoryItemCreate {
  category_id: number;
  client_id: number | null;
  description: string;
  color?: string | null;
  size?: string | null;
  base_uom_id: number;
}

/** Category and client aren't editable. Send color/size as null to clear them. */
export type AccessoryItemUpdate = Partial<Pick<AccessoryItem, 'description' | 'color' | 'size' | 'base_uom_id' | 'active'>>;

export interface AccessoryItemQuery {
  q?: string; // part of the code, description, color or size
  category_id?: number;
  client_id?: number;
  generic_only?: boolean;
  active_only?: boolean; // server default: true
  limit?: number;
  offset?: number;
}

export interface AccessoryItemPage {
  items: AccessoryItem[];
  total: number;
}

/** An item's own conversion; one side is always the item's base unit. */
export interface ItemConversionCreate {
  from_uom_id: number;
  to_uom_id: number;
  factor: number;
}

const toQuery = (params: AccessoryItemQuery) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value));
  });
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const accessoryItemApi = {
  search: (params: AccessoryItemQuery = {}) =>
    api.request<AccessoryItemPage>(`/accessory-items/${toQuery(params)}`),
  get: (id: number) => api.request<AccessoryItem>(`/accessory-items/${id}`),
  create: (item: AccessoryItemCreate) => api.request<AccessoryItem>('/accessory-items/', 'POST', item),
  update: (id: number, changes: AccessoryItemUpdate) =>
    api.request<AccessoryItem>(`/accessory-items/${id}`, 'PATCH', changes),

  getConversions: (id: number) => api.request<UomConversion[]>(`/accessory-items/${id}/conversions`),
  createConversion: (id: number, conv: ItemConversionCreate) =>
    api.request<UomConversion>(`/accessory-items/${id}/conversions`, 'POST', conv),
  deleteConversion: (id: number, conversionId: number) =>
    api.request<void>(`/accessory-items/${id}/conversions/${conversionId}`, 'DELETE'),
};
