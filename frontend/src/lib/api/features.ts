// Which optional modules are switched on for this deployment.
// Backend: GET /api/v1/features (backend/api/v1/endpoints/features.py).
import { api } from "./client";

export interface Features {
  accessories: boolean;
  needles: boolean;
}

export const featureApi = {
  get: () => api.request<Features>("/features/"),
};
