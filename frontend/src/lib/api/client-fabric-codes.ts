import { api } from './client';

export interface ClientFabricCode {
  id: number;
  client_id: number;
  material_id: number;
  color_id: number;
  fabric_code?: string | null;
}

export interface GetOrCreateCFCRequest {
  client_id: number;
  material_id: number;
  color_id: number;
  fabric_code?: string | null;
}

export interface FabricCodeLookupResult {
  client_fabric_code_id: number;
  fabric_code?: string | null;
  client_id: number;
  client_name: string;
  material_id: number;
  material_name: string;
  color_id: number;
  color_name: string;
  /** Currently in-stock dyed rolls for this fabric code (status 'in'). */
  in_stock_weight: number;
  in_stock_length?: number | null;
  in_stock_rolls: number;
}

export const clientFabricCodeApi = {
  getById: (id: number) => api.request<ClientFabricCode>(`/client-fabric-codes/${id}`),

  getAll: (filters?: { client_id?: number; material_id?: number; color_id?: number }) => {
    const params = new URLSearchParams();
    if (filters?.client_id !== undefined) params.append('client_id', String(filters.client_id));
    if (filters?.material_id !== undefined) params.append('material_id', String(filters.material_id));
    if (filters?.color_id !== undefined) params.append('color_id', String(filters.color_id));
    const qs = params.toString();
    return api.request<ClientFabricCode[]>(qs ? `/client-fabric-codes/?${qs}` : '/client-fabric-codes/');
  },

  getOrCreate: (body: GetOrCreateCFCRequest) =>
    api.request<ClientFabricCode>('/client-fabric-codes/get-or-create', 'POST', body),

  lookup: (q: string, limit = 20) =>
    api.request<FabricCodeLookupResult[]>(
      `/client-fabric-codes/lookup?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
};
