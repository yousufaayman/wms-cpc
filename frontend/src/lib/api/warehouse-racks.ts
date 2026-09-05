import { api } from './client';
import { Warehouse } from './warehouses';

// Warehouse Rack types
export interface WarehouseRack {
  id: number;
  warehouse_id: number;
  rack_code: string;
  warehouse?: Warehouse;
}

export interface WarehouseRackCreate {
  warehouse_id: number;
  rack_code: string;
}

export interface WarehouseRackUpdate {
  warehouse_id?: number;
  rack_code?: string;
}

// ── Rack contents (scan quick-view) types ────────────────────────────────────

export interface RackDyedGroup {
  client_fabric_code_id: number;
  fabric_code?: string | null;
  client_name: string;
  material_name: string;
  color_name: string;
  lot_number?: string | null;
  roll_count: number;
  total_weight: number;
  total_length?: number | null;
}

export interface RackUndyedGroup {
  client_id: number;
  client_name: string;
  material_id: number;
  material_name: string;
  lot_number?: string | null;
  roll_count: number;
  total_weight: number;
  total_length?: number | null;
}

export interface RackContents {
  rack_id: number;
  rack_code: string;
  warehouse_id: number;
  roll_count: number;
  total_weight: number;
  dyed_groups: RackDyedGroup[];
  undyed_groups: RackUndyedGroup[];
}

// Warehouse Rack API functions
export const warehouseRackApi = {
  getAll: (warehouse_id?: number, skip?: number, limit?: number) => {
    const params = new URLSearchParams();
    if (warehouse_id !== undefined) params.append("warehouse_id", String(warehouse_id));
    if (skip !== undefined) params.append("skip", String(skip));
    if (limit !== undefined) params.append("limit", String(limit));
    const query = params.toString();
    return api.request<WarehouseRack[]>(`/warehouse-racks${query ? `?${query}` : ""}`);
  },
  getById: (id: number) => api.request<WarehouseRack>(`/warehouse-racks/${id}`),
  getContents: (id: number) => api.request<RackContents>(`/warehouse-racks/${id}/contents`),
  searchByCode: (rack_code: string, warehouse_id?: number) => {
    const params = new URLSearchParams({ rack_code });
    if (warehouse_id !== undefined) params.append("warehouse_id", String(warehouse_id));
    return api.request<WarehouseRack[]>(`/warehouse-racks/search?${params}`);
  },
  create: (rack: WarehouseRackCreate) => api.request<WarehouseRack>("/warehouse-racks", "POST", rack),
  update: (id: number, rack: WarehouseRackUpdate) => api.request<WarehouseRack>(`/warehouse-racks/${id}`, "PUT", rack),
  delete: (id: number) => api.request<WarehouseRack>(`/warehouse-racks/${id}`, "DELETE"),
};
