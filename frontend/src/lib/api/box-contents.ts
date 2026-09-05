import { api } from './client';

export interface BoxContent {
  id: number;
  box_id: number;
  job_order_item_id?: number | null;
  model_id?: number | null;
  color_id?: number | null;
  size_id?: number | null;
  piece_count: number;
  weight?: number | null;
  // Resolved data from core tables
  model?: { id: number; name: string } | null;
  color?: { id: number; name: string } | null;
  size?: { id: number; value: string } | null;
  job_order_item?: { id: number; job_order_id: number; quantity: number; weight?: number } | null;
}

export interface BoxContentCreate {
  box_id: number;
  job_order_item_id?: number;
  model_id?: number;
  color_id?: number;
  size_id?: number;
  piece_count: number;
  weight?: number;
}

export interface BoxContentUpdate {
  job_order_item_id?: number;
  model_id?: number;
  color_id?: number;
  size_id?: number;
  piece_count?: number;
  weight?: number;
}

export const boxContentApi = {
  getAll: (skip = 0, limit = 100) => api.request<BoxContent[]>(`/box-contents?skip=${skip}&limit=${limit}`),
  getByBox: (boxId: number, skip = 0, limit = 100) => api.request<BoxContent[]>(`/box-contents/box/${boxId}?skip=${skip}&limit=${limit}`),
  getById: (id: number) => api.request<BoxContent>(`/box-contents/${id}`),
  create: (content: BoxContentCreate) => api.request<BoxContent>(`/box-contents`, 'POST', content),
  update: (id: number, content: BoxContentUpdate) => api.request<BoxContent>(`/box-contents/${id}`, 'PUT', content),
  delete: (id: number) => api.request<{ message: string }>(`/box-contents/${id}`, 'DELETE'),
};


