import { api } from "./api";

export interface UserRole {
  id: number;
  user_id: number;
  system_id: number;
  role: string;
}

export interface CurrentUser {
  id: number;
  username: string;
  user_roles: UserRole[];
}

export async function getCurrentUser(): Promise<CurrentUser> {
  return api.request<CurrentUser>("/auth/me");
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const body = new URLSearchParams();
  body.append("username", username);
  body.append("password", password);

  const response = await fetch(`${(api as any)["baseUrl"] || "http://localhost:8000/api/v1"}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    let message = `Login failed (${response.status})`;
    try {
      const data = await response.json();
      message = (data as any)?.detail || message;
    } catch (_) {}
    throw new Error(message);
  }

  return (await response.json()) as LoginResponse;
}

export function saveToken(token: string) {
  localStorage.setItem("access_token", token);
}

export function clearToken() {
  localStorage.removeItem("access_token");
}

export function getToken(): string | null {
  return localStorage.getItem("access_token");
}


