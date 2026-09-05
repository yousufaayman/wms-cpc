import { api } from './client';

// WMS is system_id 1 in the shared core.systems table. Other systems (OPS,
// PLAN, ...) share the same users/roles tables but must never be touched here.
export const WMS_SYSTEM_ID = 1;

export type WmsRole = "admin" | "gen_ops" | "W_Manager" | "W_Worker" | "Viewer";

export interface UserRole {
  id: number;
  user_id: number;
  system_id: number;
  role: string;
}

export interface UserRoleCreate {
  user_id: number;
  system_id: number;
  role: WmsRole;
}

export const userRoleApi = {
  getBySystem: (systemId: number) => api.request<UserRole[]>(`/user-roles/system/${systemId}`),
  create: (data: UserRoleCreate) => api.request<UserRole>("/user-roles/", "POST", data),
  update: (id: number, role: WmsRole) => api.request<UserRole>(`/user-roles/${id}`, "PUT", { role }),
  delete: (id: number) => api.request<UserRole>(`/user-roles/${id}`, "DELETE"),
};
