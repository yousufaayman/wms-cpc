import { api } from './client';

// Box types
export interface Box {
  id: number;
  rack_id?: number;
  barcode: string;
  client_id: number;
  weight?: number;
  received: boolean;
  carton_number?: number;
  shipment_id?: number;
  // Resolved data from core tables
  client?: { id: number; name: string } | null;
  rack?: { id: number; rack_code: string; warehouse_id: number } | null;
}

export interface BoxCreate {
  rack_id?: number;
  barcode: string;
  client_id: number;
  weight?: number;
  received?: boolean;
  carton_number?: number;
  shipment_id?: number;
}

export interface BoxUpdate {
  rack_id?: number;
  barcode?: string;
  client_id?: number;
  weight?: number;
  received?: boolean;
  carton_number?: number;
  shipment_id?: number;
}

export interface BoxFilters {
  rack_id?: number;
  shipment_no?: string;
  received?: boolean;
}

// Box Aggregation types for database-level aggregations
export interface BoxAggregation {
  box_id: number;
  barcode: string;
  rack_id?: number;
  client_id: number;
  box_weight?: number;
  received: boolean;
  carton_number?: number;
  shipment_id?: number;
  rack_code?: string;
  client_name?: string;
  total_pieces: number;
  distinct_items: number;
  distinct_models: number;
  distinct_colors: number;
  distinct_sizes: number;
  model_names: string[];
  color_names: string[];
  size_values: string[];
  job_order_item_ids: number[];
  total_content_weight: number;
  max_piece_count?: number;
  min_piece_count?: number;
  avg_piece_count?: number;
}

export interface BoxAggregationFilters {
  warehouse_id?: number;
  search_term?: string;
  rack_code?: string;
  client_name?: string;
  model_name?: string;
  color_name?: string;
  size_value?: string;
  job_order_item_id?: number;
  received?: boolean;
  skip?: number;
  limit?: number;
}

// Box API functions
export const boxApi = {
  getAll: (filters?: BoxFilters) => {
    const params = new URLSearchParams();
    if (filters?.rack_id !== undefined) params.append('rack_id', filters.rack_id.toString());
    if (filters?.shipment_no) params.append('shipment_no', filters.shipment_no);
    if (filters?.received !== undefined) params.append('received', filters.received.toString());
    
    const queryString = params.toString();
    const url = queryString ? `/boxes?${queryString}` : '/boxes';
    return api.request<Box[]>(url);
  },
  getById: (id: number) => api.request<Box>(`/boxes/${id}`),
  getByBarcode: (barcode: string) => api.request<Box>(`/boxes/barcode/${barcode}`),
  create: (box: BoxCreate) => api.request<Box>("/boxes", "POST", box),
  update: (id: number, box: BoxUpdate) => api.request<Box>(`/boxes/${id}`, "PUT", box),
  delete: (id: number) => api.request<Box>(`/boxes/${id}`, "DELETE"),
  
  // New aggregated endpoints for inventory management
  getAggregated: (filters?: BoxAggregationFilters) => {
    const params = new URLSearchParams();
    if (filters?.warehouse_id !== undefined) params.append('warehouse_id', filters.warehouse_id.toString());
    if (filters?.search_term) params.append('search_term', filters.search_term);
    if (filters?.rack_code) params.append('rack_code', filters.rack_code);
    if (filters?.client_name) params.append('client_name', filters.client_name);
    if (filters?.model_name) params.append('model_name', filters.model_name);
    if (filters?.color_name) params.append('color_name', filters.color_name);
    if (filters?.size_value) params.append('size_value', filters.size_value);
    if (filters?.job_order_item_id !== undefined) params.append('job_order_item_id', filters.job_order_item_id.toString());
    if (filters?.received !== undefined) params.append('received', filters.received.toString());
    if (filters?.skip !== undefined) params.append('skip', filters.skip.toString());
    if (filters?.limit !== undefined) params.append('limit', filters.limit.toString());
    
    const queryString = params.toString();
    const url = queryString ? `/boxes/aggregated?${queryString}` : '/boxes/aggregated';
    return api.request<BoxAggregation[]>(url);
  },
  refreshAggregations: () => api.request<{ message: string }>("/boxes/refresh-aggregations", "POST"),
};


