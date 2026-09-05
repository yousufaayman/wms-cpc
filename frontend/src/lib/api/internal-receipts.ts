import { api } from './client';

export type InternalReceiptStatus = 'issued' | 'confirmed';

export interface InternalReceipt {
  id: number;
  source_warehouse_id: number;
  target_logical_location_id: number;
  closed: boolean;
  status: InternalReceiptStatus;
  issued_by?: number | null;
  closed_by?: number | null;
  issued_at: string;
  confirmed_by?: number | null;
}

export interface InternalReceiptCreate {
  source_warehouse_id: number;
  target_logical_location_id: number;
}

export interface InternalReceiptUpdate {
  source_warehouse_id?: number;
  target_logical_location_id?: number;
}

export interface InternalReceiptFilters {
  skip?: number;
  limit?: number;
  warehouse_id?: number;
  status?: InternalReceiptStatus;
  closed?: boolean;
}

export const internalReceiptApi = {
  getAll: (filters?: InternalReceiptFilters) => {
    const params = new URLSearchParams();
    if (filters?.skip !== undefined) params.append('skip', String(filters.skip));
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));
    if (filters?.warehouse_id !== undefined) params.append('warehouse_id', String(filters.warehouse_id));
    if (filters?.status !== undefined) params.append('status', filters.status);
    if (filters?.closed !== undefined) params.append('closed', String(filters.closed));
    const qs = params.toString();
    return api.request<InternalReceipt[]>(qs ? `/internal-receipts?${qs}` : '/internal-receipts');
  },

  getById: (id: number) => api.request<InternalReceipt>(`/internal-receipts/${id}`),

  create: (receipt: InternalReceiptCreate, issuedBy: number) =>
    api.request<InternalReceipt>(`/internal-receipts?issued_by=${issuedBy}`, 'POST', receipt),

  update: (id: number, receipt: InternalReceiptUpdate) =>
    api.request<InternalReceipt>(`/internal-receipts/${id}`, 'PUT', receipt),

  confirm: (id: number, confirmedBy: number) =>
    api.request<InternalReceipt>(`/internal-receipts/${id}/confirm`, 'POST', { confirmed_by: confirmedBy }),

  close: (id: number, closedBy: number) =>
    api.request<InternalReceipt>(`/internal-receipts/${id}/close`, 'POST', { closed_by: closedBy }),

  open: (id: number) =>
    api.request<InternalReceipt>(`/internal-receipts/${id}/open`, 'POST'),

  delete: (id: number) =>
    api.request<void>(`/internal-receipts/${id}`, 'DELETE'),
};
