import { api } from './client';

/**
 * Accessory set-up lists (item 7): units of measure, unit conversions and trim
 * categories. Read by the item, receiving and issuing screens; edited on the
 * Units & Categories page (needs `manage_accessory_items`). The backend
 * returns 404 while FEATURE_ACCESSORIES is off.
 *
 * Stock is always kept in an item's base unit. A conversion says
 * 1 `from` = `factor` × `to` (1 DOZ = 12 PCS) and also works backwards.
 */

export interface Uom {
  id: number;
  code: string;
  name_en: string;
  name_ar: string; // printed on pack labels
  allows_decimals: boolean;
  active: boolean;
}

export interface UomCreate {
  code: string;
  name_en: string;
  name_ar: string;
  allows_decimals?: boolean;
}

/** The code can't be changed after creation. */
export type UomUpdate = Partial<Omit<Uom, 'id' | 'code'>>;

export interface UomConversion {
  id: number;
  from_uom_id: number;
  to_uom_id: number;
  factor: number;
}

export type UomConversionCreate = Omit<UomConversion, 'id'>;

export interface AccessoryCategory {
  id: number;
  code: string; // part of item codes (UA-ELS-0007), never changes
  name_en: string;
  name_ar: string;
  default_uom_id: number;
  default_client_specific: boolean;
  active: boolean;
}

export interface AccessoryCategoryCreate {
  code: string;
  name_en: string;
  name_ar: string;
  default_uom_id: number;
  default_client_specific?: boolean;
}

export type AccessoryCategoryUpdate = Partial<Omit<AccessoryCategory, 'id' | 'code'>>;

const activeParam = (activeOnly?: boolean) => (activeOnly ? '?active_only=true' : '');

export const uomApi = {
  getAll: (activeOnly?: boolean) => api.request<Uom[]>(`/uoms/${activeParam(activeOnly)}`),
  create: (uom: UomCreate) => api.request<Uom>('/uoms/', 'POST', uom),
  update: (id: number, changes: UomUpdate) => api.request<Uom>(`/uoms/${id}`, 'PATCH', changes),

  getConversions: () => api.request<UomConversion[]>('/uoms/conversions'),
  createConversion: (conv: UomConversionCreate) => api.request<UomConversion>('/uoms/conversions', 'POST', conv),
  updateConversion: (id: number, factor: number) =>
    api.request<UomConversion>(`/uoms/conversions/${id}`, 'PATCH', { factor }),
  deleteConversion: (id: number) => api.request<void>(`/uoms/conversions/${id}`, 'DELETE'),
};

export const accessoryCategoryApi = {
  getAll: (activeOnly?: boolean) =>
    api.request<AccessoryCategory[]>(`/accessory-categories/${activeParam(activeOnly)}`),
  create: (cat: AccessoryCategoryCreate) => api.request<AccessoryCategory>('/accessory-categories/', 'POST', cat),
  update: (id: number, changes: AccessoryCategoryUpdate) =>
    api.request<AccessoryCategory>(`/accessory-categories/${id}`, 'PATCH', changes),
};
