import { api } from './client';

export interface Color {
  id: number;
  name: string;
}

export const colorApi = {
  getAll: () => api.request<Color[]>('/colors/'),
};
