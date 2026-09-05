export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiClientOptions {
  baseUrl?: string;
  getToken?: () => string | null;
}

export class ApiClient {
  private baseUrl: string;
  private getToken?: () => string | null;

  constructor(options?: ApiClientOptions) {
    this.baseUrl = options?.baseUrl || (import.meta as any).env?.VITE_API_BASE_URL || "/api/v1";
    this.getToken = options?.getToken;
  }

  async request<T>(path: string, method: HttpMethod = "GET", body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const token = this.getToken?.();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const data = await response.json();
        message = (data as any)?.detail || message;
      } catch (_) {
        // ignore
      }
      throw new Error(message);
    }

    if (response.status === 204) return undefined as unknown as T;
    return (await response.json()) as T;
  }

  /** Downloads a binary response (e.g. an Excel export) and triggers a
      browser save using the filename from Content-Disposition, if present. */
  async downloadFile(path: string, fallbackFilename: string): Promise<void> {
    const headers: Record<string, string> = {};
    const token = this.getToken?.();
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(`${this.baseUrl}${path}`, { headers });

    if (!response.ok) {
      let message = `Request failed with status ${response.status}`;
      try {
        const data = await response.json();
        message = (data as any)?.detail || message;
      } catch (_) {
        // ignore
      }
      throw new Error(message);
    }

    const disposition = response.headers.get("Content-Disposition") || "";
    const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/.exec(disposition);
    const filename = match ? decodeURIComponent(match[1] || match[2]) : fallbackFilename;

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

export const api = new ApiClient({
  getToken: () => (typeof localStorage !== "undefined" ? localStorage.getItem("access_token") : null),
});
