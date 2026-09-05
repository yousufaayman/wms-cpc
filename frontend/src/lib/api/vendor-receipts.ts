import { api } from './client';

export interface SupplierReceipt {
  id: number;
  source_warehouse_id: number;
  target_logical_location_id: number;
  closed: boolean;
  status: string;
  issued_by?: number | null;
  closed_by?: number | null;
  approved_by?: number | null;
  issued_at: string;
  closed_at?: string | null;
  approved: boolean;
  remarks?: string | null;
}

export interface SupplierReceiptCreate {
  source_warehouse_id: number;
  target_logical_location_id: number;
  remarks?: string | null;
}

export interface SupplierReceiptUpdate {
  source_warehouse_id?: number;
  target_logical_location_id?: number;
  remarks?: string | null;
}

export interface SupplierReceiptFilters {
  skip?: number;
  limit?: number;
  warehouse_id?: number;
  closed?: boolean;
}

export const supplierReceiptApi = {
  getAll: (filters?: SupplierReceiptFilters) => {
    const params = new URLSearchParams();
    if (filters?.skip !== undefined) params.append('skip', String(filters.skip));
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));
    if (filters?.warehouse_id !== undefined) params.append('warehouse_id', String(filters.warehouse_id));
    if (filters?.closed !== undefined) params.append('closed', String(filters.closed));
    const qs = params.toString();
    return api.request<SupplierReceipt[]>(qs ? `/supplier-receipts?${qs}` : '/supplier-receipts');
  },

  getById: (id: number) => api.request<SupplierReceipt>(`/supplier-receipts/${id}`),

  create: (receipt: SupplierReceiptCreate, issuedBy: number) =>
    api.request<SupplierReceipt>(`/supplier-receipts?issued_by=${issuedBy}`, 'POST', receipt),

  update: (id: number, receipt: SupplierReceiptUpdate) =>
    api.request<SupplierReceipt>(`/supplier-receipts/${id}`, 'PUT', receipt),

  close: (id: number, closedBy: number) =>
    api.request<SupplierReceipt>(`/supplier-receipts/${id}/close`, 'POST', { closed_by: closedBy }),

  open: (id: number) =>
    api.request<SupplierReceipt>(`/supplier-receipts/${id}/open`, 'POST'),

  approve: (id: number, approvedBy: number) =>
    api.request<SupplierReceipt>(`/supplier-receipts/${id}/approve?approved_by=${approvedBy}`, 'POST'),

  unapprove: (id: number) =>
    api.request<SupplierReceipt>(`/supplier-receipts/${id}/unapprove`, 'POST'),

  delete: (id: number) =>
    api.request<void>(`/supplier-receipts/${id}`, 'DELETE'),

  // backward-compat alias — kept so callers that still import vendorReceiptApi continue to compile
};

/** @deprecated Use supplierReceiptApi */
export const vendorReceiptApi = supplierReceiptApi;
/** @deprecated Use SupplierReceipt */
export type VendorReceipt = SupplierReceipt;
