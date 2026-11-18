import { api } from './client';
import type { AccessoryValueLine } from './accessory-items';

export type ReceiptKind = 'supplier' | 'internal' | 'external';

// ── Fabric receipt items ──────────────────────────────────────────────────────

export interface FabricReceiptItem {
  id: number;
  supplier_receipt_id?: number | null;
  internal_receipt_id?: number | null;
  external_receipt_id?: number | null;
  item_type: 'FabricRoll' | 'UndyedFabricRoll';
  dyed_roll_id?: number | null;
  undyed_roll_id?: number | null;
}

export interface FabricReceiptItemCreate {
  item_type: FabricReceiptItem['item_type'];
  dyed_roll_id?: number | null;
  undyed_roll_id?: number | null;
}

export const fabricReceiptItemApi = {
  list: (kind: ReceiptKind, receiptId: number, skip = 0, limit = 100) =>
    api.request<FabricReceiptItem[]>(`/receipts/${kind}/${receiptId}/fabric-items?skip=${skip}&limit=${limit}`),

  add: (kind: ReceiptKind, receiptId: number, item: FabricReceiptItemCreate) =>
    api.request<FabricReceiptItem>(`/receipts/${kind}/${receiptId}/fabric-items`, 'POST', item),

  delete: (itemId: number) =>
    api.request<void>(`/receipts/fabric-items/${itemId}`, 'DELETE'),
};

// ── Box receipt items ─────────────────────────────────────────────────────────

export interface BoxReceiptItem {
  id: number;
  supplier_receipt_id?: number | null;
  internal_receipt_id?: number | null;
  external_receipt_id?: number | null;
  box_id?: number | null;
}

export interface BoxReceiptItemCreate {
  box_id?: number | null;
}

export const boxReceiptItemApi = {
  list: (kind: ReceiptKind, receiptId: number, skip = 0, limit = 100) =>
    api.request<BoxReceiptItem[]>(`/receipts/${kind}/${receiptId}/box-items?skip=${skip}&limit=${limit}`),

  add: (kind: ReceiptKind, receiptId: number, item: BoxReceiptItemCreate) =>
    api.request<BoxReceiptItem>(`/receipts/${kind}/${receiptId}/box-items`, 'POST', item),

  delete: (itemId: number) =>
    api.request<void>(`/receipts/box-items/${itemId}`, 'DELETE'),
};

// ── Accessory receipt items ───────────────────────────────────────────────────

/**
 * A pack line of an accessory issue (item 20). `qty` is in the item's base
 * unit (`uom_code`), as decimal text. `posted` = taken out of stock (the
 * receipt is confirmed). `over_issue` = past the requirement's remaining,
 * allowed with `over_issue_reason` (D-2).
 */
export interface AccessoryReceiptItem {
  id: number;
  supplier_receipt_id: number | null;
  internal_receipt_id: number | null;
  external_receipt_id: number | null;
  pack_id: number;
  accessory_item_id: number;
  item_code: string;
  item_description: string;
  item_color: string | null;
  item_size: string | null;
  value_lines: AccessoryValueLine[];
  uom_code: string;
  qty: string;
  job_order_id: number | null;
  job_order_number: string | null;
  jo_requirement_id: number | null;
  over_issue: boolean;
  over_issue_reason: string | null;
  posted: boolean;
  reversed?: boolean; // item 22: an admin reversed it since
  created_by: number | null;
  created_at: string;
}

/** Scan a pack: its barcode (`1042*ACC`) or id, and the quantity in `uom_id` (default: base unit). */
export interface AccessoryReceiptItemCreate {
  barcode?: string;
  pack_id?: number;
  qty: string | number;
  uom_id?: number | null;
  over_issue_reason?: string | null;
}

export const accessoryReceiptItemApi = {
  list: (kind: ReceiptKind, receiptId: number) =>
    api.request<AccessoryReceiptItem[]>(`/receipts/${kind}/${receiptId}/accessory-items`),

  add: (kind: ReceiptKind, receiptId: number, item: AccessoryReceiptItemCreate) =>
    api.request<AccessoryReceiptItem>(`/receipts/${kind}/${receiptId}/accessory-items`, 'POST', item),

  delete: (itemId: number) =>
    api.request<void>(`/receipts/accessory-items/${itemId}`, 'DELETE'),
};
