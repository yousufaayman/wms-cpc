import { api } from './client';

// Warehouse types
export type WarehouseType = 'Fabric' | 'RMG' | 'Accessory';

export interface Warehouse {
  id: number;
  name: string;
  type: WarehouseType;
}

export interface WarehouseCreate {
  name: string;
  type: WarehouseType;
}

export interface WarehouseUpdate {
  name?: string;
  type?: WarehouseType;
}

// Warehouse API functions
export const warehouseApi = {
  getAll: () => api.request<Warehouse[]>("/warehouses"),
  getById: (id: number) => api.request<Warehouse>(`/warehouses/${id}`),
  create: (warehouse: WarehouseCreate) => api.request<Warehouse>("/warehouses", "POST", warehouse),
  update: (id: number, warehouse: WarehouseUpdate) => api.request<Warehouse>(`/warehouses/${id}`, "PUT", warehouse),
  delete: (id: number) => api.request<Warehouse>(`/warehouses/${id}`, "DELETE"),
};
