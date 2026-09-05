import { api } from './client';

export interface Client {
  id: number;
  name: string;
}

export const clientApi = {
  getAll: () => api.request<Client[]>('/clients/'),
};
