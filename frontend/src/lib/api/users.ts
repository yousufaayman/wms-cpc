import { api } from './client';

export interface User {
  id: number;
  username: string;
}

export interface UserCreate {
  username: string;
  password: string;
}

export const userApi = {
  getAll: () => api.request<User[]>("/users/"),
  create: (data: UserCreate) => api.request<User>("/users/", "POST", data),
};
