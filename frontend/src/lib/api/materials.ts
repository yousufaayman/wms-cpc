import { api } from './client';

export interface Material {
  id: number;
  name: string;
}

export const materialApi = {
  getAll: () => api.request<Material[]>('/materials/'),
  create: (name: string) =>
    api.request<Material>('/materials/', 'POST', { name }),
};
