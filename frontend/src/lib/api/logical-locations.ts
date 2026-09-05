import { api } from './client';

/** Matches wms.logical_location_type */
export type LogicalLocationType = 'supplier' | 'internal';

// Logical Location types
export interface LogicalLocation {
  id: number;
  name: string;
  contact_name?: string;
  contact_number?: string;
  location_type?: LogicalLocationType;
  supplier_type?: string | null;
}

export interface LogicalLocationCreate {
  name: string;
  contact_name?: string;
  contact_number?: string;
  location_type?: LogicalLocationType;
  supplier_type?: string | null;
}

export interface LogicalLocationUpdate {
  name?: string;
  contact_name?: string;
  contact_number?: string;
  location_type?: LogicalLocationType;
  supplier_type?: string | null;
}

export interface LogicalLocationFilters {
  skip?: number;
  limit?: number;
}

// Logical Location API functions
export const logicalLocationApi = {
  getAll: (filters?: LogicalLocationFilters) => {
    const params = new URLSearchParams();
    if (filters?.skip !== undefined) params.append('skip', filters.skip.toString());
    if (filters?.limit !== undefined) params.append('limit', filters.limit.toString());
    
    const queryString = params.toString();
    const url = queryString ? `/logical-locations?${queryString}` : '/logical-locations';
    return api.request<LogicalLocation[]>(url);
  },
  
  getById: (id: number) => api.request<LogicalLocation>(`/logical-locations/${id}`),
  
  getByName: (name: string) => api.request<LogicalLocation>(`/logical-locations/name/${name}`),
  
  create: (location: LogicalLocationCreate) => 
    api.request<LogicalLocation>("/logical-locations", "POST", location),
  
  update: (id: number, location: LogicalLocationUpdate) => 
    api.request<LogicalLocation>(`/logical-locations/${id}`, "PUT", location),
  
  delete: (id: number) => 
    api.request<{ message: string }>(`/logical-locations/${id}`, "DELETE"),
};



