import { api } from './client';

export interface MRFNestedReceipt {
  id: number;
  source_warehouse_id: number;
  target_logical_location_id: number;
  status: string;
  issued_at: string;
}

export interface MaterialRequestFulfillment {
  id: number;
  material_request_id: number;
  internal_receipt_id: number | null;
  supplier_receipt_id: number | null;
  external_receipt_id: number | null;
  quantity_issued: number | null;
  measurement_scale: string | null;
  notes: string | null;
  created_at: string;
  internal_receipt?: MRFNestedReceipt | null;
}

export interface MaterialRequestFulfillmentCreate {
  material_request_id: number;
  internal_receipt_id?: number | null;
  supplier_receipt_id?: number | null;
  external_receipt_id?: number | null;
  quantity_issued?: number | null;
  measurement_scale?: string | null;
  notes?: string | null;
}

export interface MaterialRequestFulfillmentUpdate {
  quantity_issued?: number | null;
  measurement_scale?: string | null;
  notes?: string | null;
}

export interface MaterialRequestFulfillmentFilters {
  material_request_id?: number;
  internal_receipt_id?: number;
  supplier_receipt_id?: number;
  external_receipt_id?: number;
  skip?: number;
  limit?: number;
}

export const materialRequestFulfillmentApi = {
  getAll: (filters?: MaterialRequestFulfillmentFilters) => {
    const params = new URLSearchParams();
    if (filters?.material_request_id !== undefined) params.append('material_request_id', String(filters.material_request_id));
    if (filters?.internal_receipt_id !== undefined) params.append('internal_receipt_id', String(filters.internal_receipt_id));
    if (filters?.supplier_receipt_id !== undefined) params.append('supplier_receipt_id', String(filters.supplier_receipt_id));
    if (filters?.external_receipt_id !== undefined) params.append('external_receipt_id', String(filters.external_receipt_id));
    if (filters?.skip !== undefined) params.append('skip', String(filters.skip));
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));
    const qs = params.toString();
    return api.request<MaterialRequestFulfillment[]>(qs ? `/material-request-fulfillments?${qs}` : '/material-request-fulfillments');
  },

  getById: (id: number) =>
    api.request<MaterialRequestFulfillment>(`/material-request-fulfillments/${id}`),

  create: (data: MaterialRequestFulfillmentCreate) =>
    api.request<MaterialRequestFulfillment>('/material-request-fulfillments/', 'POST', data),

  patch: (id: number, data: MaterialRequestFulfillmentUpdate) =>
    api.request<MaterialRequestFulfillment>(`/material-request-fulfillments/${id}`, 'PATCH', data),

  // Recompute quantity_issued from the linked receipt's rolls (live progress)
  sync: (id: number) =>
    api.request<MaterialRequestFulfillment>(`/material-request-fulfillments/${id}/sync`, 'POST'),

  delete: (id: number) =>
    api.request<void>(`/material-request-fulfillments/${id}`, 'DELETE'),

  deleteByRequest: (materialRequestId: number) =>
    api.request<void>(`/material-request-fulfillments/by-request/${materialRequestId}`, 'DELETE'),
};
