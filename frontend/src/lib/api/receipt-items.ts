import { api } from './client';

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

export interface AccessoryReceiptItem {
  id: number;
  supplier_receipt_id?: number | null;
  internal_receipt_id?: number | null;
  external_receipt_id?: number | null;
  accessory_item_id?: number | null;
}

export interface AccessoryReceiptItemCreate {
  accessory_item_id?: number | null;
}

export const accessoryReceiptItemApi = {
  list: (kind: ReceiptKind, receiptId: number, skip = 0, limit = 100) =>
    api.request<AccessoryReceiptItem[]>(`/receipts/${kind}/${receiptId}/accessory-items?skip=${skip}&limit=${limit}`),

  add: (kind: ReceiptKind, receiptId: number, item: AccessoryReceiptItemCreate) =>
    api.request<AccessoryReceiptItem>(`/receipts/${kind}/${receiptId}/accessory-items`, 'POST', item),

  delete: (itemId: number) =>
    api.request<void>(`/receipts/accessory-items/${itemId}`, 'DELETE'),
};
