import { api } from './client';

export interface MaterialRequestFabricCode {
  id: number;
  fabric_code?: string | null;
  material_id: number;
  color_id: number;
  client_id: number;
  material?: { id: number; name: string } | null;
  color?: { id: number; name: string } | null;
  client?: { id: number; name: string } | null;
}

export interface MaterialRequestJobOrder {
  id: number;
  job_order_number: string;
  client_id: number;
  client?: { id: number; name: string } | null;
  notes?: string | null;
  date_created?: string | null;
  priority?: number | null;
}

export interface MaterialRequest {
  id: number;
  job_order_id: number;
  panel_type: string;
  consumption: number;
  quantity: number | null;
  measurement_scale: string;
  fabric_code_id: number;
  fulfilled: boolean; // computed from ledger on the server
  fabric_code?: MaterialRequestFabricCode | null;
  job_order?: MaterialRequestJobOrder | null;
}

export interface MaterialRequestCreate {
  job_order_id: number;
  panel_type: string;
  consumption: number;
  quantity?: number | null;
  measurement_scale: string;
  fabric_code_id: number;
}

export interface MaterialRequestFilters {
  job_order_id?: number;
  fulfilled?: boolean;
  skip?: number;
  limit?: number;
}

export interface MaterialRequestMetrics {
  measurement_scale: string;
  requested_quantity: number | null;
  issued_from_rolls: number;
  issued_manually: number;
  total_issued: number;
  remaining: number | null;
}

export interface RequestBulkMetrics {
  id: number;
  total_issued: number;
  remaining: number | null;
}

export const materialRequestApi = {
  getAll: (filters?: MaterialRequestFilters) => {
    const params = new URLSearchParams();
    if (filters?.job_order_id !== undefined) params.append('job_order_id', String(filters.job_order_id));
    if (filters?.fulfilled !== undefined) params.append('fulfilled', String(filters.fulfilled));
    if (filters?.skip !== undefined) params.append('skip', String(filters.skip));
    if (filters?.limit !== undefined) params.append('limit', String(filters.limit));
    const qs = params.toString();
    return api.request<MaterialRequest[]>(qs ? `/job-order-material-requests?${qs}` : '/job-order-material-requests');
  },

  getById: (id: number) =>
    api.request<MaterialRequest>(`/job-order-material-requests/${id}`),

  create: (data: MaterialRequestCreate) =>
    api.request<MaterialRequest>('/job-order-material-requests/', 'POST', data),

  getMetrics: (id: number) =>
    api.request<MaterialRequestMetrics>(`/job-order-material-requests/${id}/metrics`),

  getBulkMetrics: (ids: number[]) =>
    api.request<RequestBulkMetrics[]>(`/job-order-material-requests/bulk-metrics?ids=${ids.join(',')}`),

  delete: (id: number) =>
    api.request<void>(`/job-order-material-requests/${id}`, 'DELETE'),

  forceSetFulfilled: (id: number, fulfilled: boolean) =>
    api.request<MaterialRequest>(`/job-order-material-requests/${id}/force-fulfilled`, 'PATCH', { fulfilled }),
};
