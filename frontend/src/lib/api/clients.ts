import { api } from './client';

export interface Client {
  id: number;
  name: string;
}

export const clientApi = {
  getAll: () => api.request<Client[]>('/clients/'),
  create: (name: string) =>
    api.request<Client>('/clients/', 'POST', { name }),
};
