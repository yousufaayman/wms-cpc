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
  /** Accessory issues (item 20): the job order the trims go to. */
  job_order_id?: number | null;
  job_order_number?: string | null;
  /** Accessory issues: lines past their requirement's remaining (D-2). */
  over_issue_count?: number;
}

export interface InternalReceiptCreate {
  source_warehouse_id: number;
  target_logical_location_id: number;
  /** Required in Accessory warehouses, not allowed elsewhere. */
  job_order_id?: number | null;
}

export interface InternalReceiptUpdate {
  source_warehouse_id?: number;
  target_logical_location_id?: number;
  job_order_id?: number | null;
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

  // The server records the logged-in user as issuer/closer/confirmer.
  create: (receipt: InternalReceiptCreate) =>
    api.request<InternalReceipt>(`/internal-receipts`, 'POST', receipt),

  update: (id: number, receipt: InternalReceiptUpdate) =>
    api.request<InternalReceipt>(`/internal-receipts/${id}`, 'PUT', receipt),

  confirm: (id: number) =>
    api.request<InternalReceipt>(`/internal-receipts/${id}/confirm`, 'POST'),

  close: (id: number) =>
    api.request<InternalReceipt>(`/internal-receipts/${id}/close`, 'POST'),

  open: (id: number) =>
    api.request<InternalReceipt>(`/internal-receipts/${id}/open`, 'POST'),

  delete: (id: number) =>
    api.request<void>(`/internal-receipts/${id}`, 'DELETE'),
};
