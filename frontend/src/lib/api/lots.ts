import { api } from './client';

export interface Lot {
  id: number;
  client_fabric_code_id: number;
  lot_number: string;
}

export interface LotCreate {
  client_fabric_code_id: number;
  lot_number: string;
}

export const lotApi = {
  getByFabricCode: (client_fabric_code_id: number) =>
    api.request<Lot[]>(`/lots/?client_fabric_code_id=${client_fabric_code_id}`),

  getOrCreate: (body: LotCreate) =>
    api.request<Lot>('/lots/get-or-create', 'POST', body),
};
