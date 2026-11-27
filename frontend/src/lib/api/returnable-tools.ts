import { api } from './client';
import { toQuery } from './accessory-items';

/**
 * Returnable tools (item 33): folders, presser feet, machine equipment.
 * Never used up: a tool is in the warehouse or out with a worker. Items in a
 * `tracked` category are tools; `individual` ones get one label per piece,
 * the others are kept in tracked packs with a quantity. Label barcode =
 * `<id>*TL`. Numbers: owned = added − retired, out = with workers,
 * in_stock = owned − out (all whole pieces, decimal text from the server).
 * Reading is open to every WMS role; adding needs `receive_accessories`.
 * Check-out / check-in and retire come in item 34.
 */

export interface ReturnableUnit {
  id: number;
  barcode: string; // "57*TL"
  accessory_item_id: number;
  item_code: string;
  item_description: string;
  item_color: string | null;
  item_size: string | null;
  uom_code: string;
  is_individual: boolean; // a piece (quantity 1) or a tracked pack
  warehouse_id: number;
  rack_id: number | null;
  rack_code: string | null;
  supplier_type: 'client' | 'logical_location' | null;
  client_supplier_id: number | null;
  supplier_name: string | null;
  serial_no: string | null;
  remarks: string | null;
  created_by: number;
  created_at: string;
  owned: string;
  in_stock: string;
  out: string;
  retired: string;
}

export interface ReturnableAddIn {
  warehouse_id: number;
  accessory_item_id: number;
  count?: number; // pieces (individual items)
  qty?: number; // a new tracked pack
  serial_nos?: (string | null)[];
  rack_id?: number | null;
  supplier_type?: 'client' | 'logical_location' | null;
  client_supplier_id?: number | null;
  remarks?: string | null;
}

/** What one Add made; `movement_id` is what Undo cancels. */
export interface ReturnableAdded {
  movement_id: number;
  unit: ReturnableUnit;
}

export interface ReturnableSummaryRow {
  accessory_item_id: number;
  item_code: string;
  item_description: string;
  item_color: string | null;
  item_size: string | null;
  uom_code: string;
  is_individual: boolean;
  labels: number;
  owned: string;
  in_stock: string;
  out: string;
  retired: string;
}

export const returnableToolApi = {
  summary: (warehouseId: number, q?: string) =>
    api.request<ReturnableSummaryRow[]>(`/returnable-tools/summary${toQuery({ warehouse_id: warehouseId, q })}`),
  units: (warehouseId: number, itemId?: number) =>
    api.request<ReturnableUnit[]>(
      `/returnable-tools/units${toQuery({ warehouse_id: warehouseId, accessory_item_id: itemId })}`,
    ),
  get: (id: number) => api.request<ReturnableUnit>(`/returnable-tools/${id}`),
  scan: (barcode: string) =>
    api.request<ReturnableUnit>(`/returnable-tools/scan${toQuery({ barcode })}`),
  add: (body: ReturnableAddIn) => api.request<ReturnableAdded[]>('/returnable-tools/add', 'POST', body),
  topUp: (unitId: number, qty: number) =>
    api.request<ReturnableAdded>(`/returnable-tools/units/${unitId}/add`, 'POST', { qty }),
  undoAdd: (movementId: number) =>
    api.request<void>(`/returnable-tools/movements/${movementId}`, 'DELETE'),
};
