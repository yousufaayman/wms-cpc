import { api } from './client';
import type { UomConversion } from './accessory-setup';

/**
 * Accessory items (item 8). The server makes the code on create:
 * `<client code | GEN>-<category>-<number>`, e.g. UR-ELS-0007. Category and
 * client are part of the code, so they can't be changed afterwards (a wrong one
 * = switch the item off and create a new one). Items are switched off, never
 * deleted. Reading is open to every WMS role; create/edit needs
 * `manage_accessory_items`. 404 while FEATURE_ACCESSORIES is off.
 *
 * References (item 9): the client's / supplier's own codes for an item. A new
 * item needs at least one. A code is unique per client / per supplier, compared
 * without case, spaces or - . / _ (so "ab 01" = "AB-01"), but supplier A's 01
 * and supplier B's 01 are different references.
 *
 * Templates + variants (item 10): an item with variable lines (`fields`, e.g.
 * Price, PO number) is a template and is never stocked. Each variant is one
 * combination of values (+ color, size), coded `<template code>-001`, and takes
 * category, client, base unit and conversions from its template. The same
 * combination can exist only once (`checkVariant` finds it). A variant's own
 * references are optional: the template's apply.
 */

export type FieldType = 'text' | 'number' | 'money' | 'date';

/** One variable line of a template. `field_key` never changes. */
export interface AccessoryItemField {
  id: number;
  accessory_item_id: number;
  field_key: string;
  label_en: string;
  label_ar: string;
  field_type: FieldType;
  required: boolean;
  print_order: number;
}

export type AccessoryItemFieldCreate = Omit<AccessoryItemField, 'id' | 'accessory_item_id' | 'field_key'>;
export type AccessoryItemFieldUpdate = Partial<AccessoryItemFieldCreate>;

/** A variant's value with its line's labels, in print order. */
export interface AccessoryValueLine {
  field_key: string;
  label_en: string;
  label_ar: string;
  value: string;
}

/** "Price: 34.99 · PO number: 45127" in the page's language. */
export const valueSummary = (lines: AccessoryValueLine[], language: string) =>
  lines.map((l) => `${language === 'ar' ? l.label_ar : l.label_en}: ${l.value}`).join(' · ');

export interface AccessoryVariantCreate {
  values: Record<string, string | null>;
  color?: string | null;
  size?: string | null;
  description?: string | null; // default: the template's
  refs?: AccessoryItemRefCreate[]; // optional
}

export interface AccessoryItemRef {
  id: number;
  accessory_item_id: number;
  client_id: number | null; // exactly one of client_id / supplier_id is set
  supplier_id: number | null; // a supplier logical location
  ref_code: string; // as they write it
  ref_description: string | null;
  created_at: string;
}

/** A reference to add: set exactly one of client_id / supplier_id. */
export interface AccessoryItemRefCreate {
  client_id?: number | null;
  supplier_id?: number | null;
  ref_code: string;
  ref_description?: string | null;
}

export type AccessoryItemRefUpdate = Partial<Pick<AccessoryItemRef, 'ref_code' | 'ref_description'>>;

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
  refs: AccessoryItemRef[];
  is_template: boolean;
  fields: AccessoryItemField[]; // a template's lines
  variant_count: number; // a base item's variants (item 11)
  parent_template_id: number | null; // set = this is a variant
  template_code: string | null;
  variable_values: Record<string, string> | null;
  value_lines: AccessoryValueLine[];
}

export interface AccessoryItemCreate {
  category_id: number;
  client_id: number | null;
  description: string;
  color?: string | null;
  size?: string | null;
  base_uom_id: number;
  refs: AccessoryItemRefCreate[]; // at least one
}

/** Category and client aren't editable. Send color/size as null to clear them. */
export type AccessoryItemUpdate = Partial<Pick<AccessoryItem, 'description' | 'color' | 'size' | 'base_uom_id' | 'active'>> & {
  variable_values?: Record<string, string | null>; // variants only: the full new set
};

export type AccessoryItemKind = 'plain' | 'template' | 'variant';

/** List filters (item 11); every one given must match. Text filters are "contains", ignoring case. */
export interface AccessoryItemQuery {
  q?: string; // quick search: each word found in our code, a client/supplier code, description, color, size or a line value
  code?: string;
  description?: string;
  color?: string;
  size?: string;
  ref_code?: string; // ignoring case, spaces and - . / _
  ref_client_id?: number; // limit ref_code to this client (alone: any code from it)
  ref_supplier_id?: number;
  base_uom_id?: number;
  line_value?: string; // any line value contains this
  line?: string[]; // one template line each: "po_number:451"
  category_id?: number;
  client_id?: number;
  generic_only?: boolean;
  active_only?: boolean; // server default: true
  kind?: AccessoryItemKind;
  template_id?: number;
  sort?: 'code' | 'newest';
  group_variants?: boolean; // fold variants under their base (a base is listed when one of its variants matches)
  limit?: number;
  offset?: number;
}

/** What the New item form sends to find look-alikes. */
export interface SimilarItemQuery {
  category_id: number;
  client_id?: number; // none = generic
  description: string;
  color?: string;
  size?: string;
  exclude_id?: number; // the item being edited
}

/** A unit a quantity of an item can be typed in: 1 of it = `factor` base units. */
export interface AccessoryItemUnit {
  uom_id: number;
  code: string;
  name_en: string;
  name_ar: string;
  allows_decimals: boolean;
  factor: string; // decimal as text
  is_base: boolean;
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

export type QueryValue = string | number | boolean | undefined;

/** `?a=1&b=x`; empty values are left out, a list repeats its key (`line=a:1&line=b:2`). */
export const toQuery = (params: Record<string, QueryValue | QueryValue[]>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    values.forEach((v) => {
      if (v !== undefined && v !== '') search.append(key, String(v));
    });
  });
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const accessoryItemApi = {
  search: (params: AccessoryItemQuery = {}) =>
    api.request<AccessoryItemPage>(`/accessory-items/${toQuery({ ...params })}`),
  /** Items that look like the same trim (same category, client, description, color, size). */
  similar: (params: SimilarItemQuery) =>
    api.request<AccessoryItem[]>(`/accessory-items/similar${toQuery({ ...params })}`),
  get: (id: number) => api.request<AccessoryItem>(`/accessory-items/${id}`),
  create: (item: AccessoryItemCreate) => api.request<AccessoryItem>('/accessory-items/', 'POST', item),
  update: (id: number, changes: AccessoryItemUpdate) =>
    api.request<AccessoryItem>(`/accessory-items/${id}`, 'PATCH', changes),

  /** Units a quantity of this item can be typed in, base unit first (item 15). */
  units: (id: number) => api.request<AccessoryItemUnit[]>(`/accessory-items/${id}/units`),
  getConversions: (id: number) => api.request<UomConversion[]>(`/accessory-items/${id}/conversions`),
  createConversion: (id: number, conv: ItemConversionCreate) =>
    api.request<UomConversion>(`/accessory-items/${id}/conversions`, 'POST', conv),
  deleteConversion: (id: number, conversionId: number) =>
    api.request<void>(`/accessory-items/${id}/conversions/${conversionId}`, 'DELETE'),

  /** The item that already carries this client's / supplier's code, or null. */
  lookupRef: (code: string, party: { client_id?: number; supplier_id?: number }) =>
    api.request<AccessoryItem | null>(`/accessory-items/refs/lookup${toQuery({ code, ...party })}`),
  addRef: (id: number, ref: AccessoryItemRefCreate) =>
    api.request<AccessoryItemRef>(`/accessory-items/${id}/refs`, 'POST', ref),
  updateRef: (id: number, refId: number, changes: AccessoryItemRefUpdate) =>
    api.request<AccessoryItemRef>(`/accessory-items/${id}/refs/${refId}`, 'PATCH', changes),
  deleteRef: (id: number, refId: number) => api.request<void>(`/accessory-items/${id}/refs/${refId}`, 'DELETE'),

  addField: (id: number, field: AccessoryItemFieldCreate) =>
    api.request<AccessoryItemField>(`/accessory-items/${id}/fields`, 'POST', field),
  updateField: (id: number, fieldId: number, changes: AccessoryItemFieldUpdate) =>
    api.request<AccessoryItemField>(`/accessory-items/${id}/fields/${fieldId}`, 'PATCH', changes),
  deleteField: (id: number, fieldId: number) =>
    api.request<void>(`/accessory-items/${id}/fields/${fieldId}`, 'DELETE'),

  getVariants: (id: number, activeOnly = false) =>
    api.request<AccessoryItem[]>(`/accessory-items/${id}/variants${toQuery({ active_only: activeOnly || undefined })}`),
  /** The variant that already has this combination, or null. Saves nothing. */
  checkVariant: (id: number, variant: AccessoryVariantCreate) =>
    api.request<AccessoryItem | null>(`/accessory-items/${id}/variants/check`, 'POST', variant),
  createVariant: (id: number, variant: AccessoryVariantCreate) =>
    api.request<AccessoryItem>(`/accessory-items/${id}/variants`, 'POST', variant),
};
