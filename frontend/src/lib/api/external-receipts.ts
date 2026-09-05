import { api } from './client';

export interface ExternalReceipt {
  id: number;
  source_warehouse_id: number;
  receiver: string;
  closed: boolean;
  status: string;
  issued_by?: number | null;
  closed_by?: number | null;
  approved_by?: number | null;
  issued_at: string;
  closed_at?: string | null;
  approved: boolean;
}

export interface ExternalReceiptCreate {
  source_warehouse_id: number;
  receiver: string;
}

export interface ExternalReceiptUpdate {
  source_warehouse_id?: number;
  receiver?: string;
}

export interface ExternalReceiptFilters {
  skip?: number;
  limit?: number;
  warehouse_id?: number;
  closed?: boolean;
}

export const externalReceiptApi = {
  getAll: (filters?: ExternalReceiptFilters) => {
    const params = new URLSearchParams();
    if (filters?.skip !== undefined) params.append('skip', String(filters.skip));
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));
    if (filters?.warehouse_id !== undefined) params.append('warehouse_id', String(filters.warehouse_id));
    if (filters?.closed !== undefined) params.append('closed', String(filters.closed));
    const qs = params.toString();
    return api.request<ExternalReceipt[]>(qs ? `/external-receipts?${qs}` : '/external-receipts');
  },

  getById: (id: number) => api.request<ExternalReceipt>(`/external-receipts/${id}`),

  create: (receipt: ExternalReceiptCreate, issuedBy: number) =>
    api.request<ExternalReceipt>(`/external-receipts?issued_by=${issuedBy}`, 'POST', receipt),

  update: (id: number, receipt: ExternalReceiptUpdate) =>
    api.request<ExternalReceipt>(`/external-receipts/${id}`, 'PUT', receipt),

  close: (id: number, closedBy: number) =>
    api.request<ExternalReceipt>(`/external-receipts/${id}/close`, 'POST', { closed_by: closedBy }),

  open: (id: number) =>
    api.request<ExternalReceipt>(`/external-receipts/${id}/open`, 'POST'),

  approve: (id: number, approvedBy: number) =>
    api.request<ExternalReceipt>(`/external-receipts/${id}/approve?approved_by=${approvedBy}`, 'POST'),

  unapprove: (id: number) =>
    api.request<ExternalReceipt>(`/external-receipts/${id}/unapprove`, 'POST'),

  delete: (id: number) =>
    api.request<void>(`/external-receipts/${id}`, 'DELETE'),
};
