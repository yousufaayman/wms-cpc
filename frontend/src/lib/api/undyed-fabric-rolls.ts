import { api } from './client';
import type { RollFlowEntryBase } from './fabric-rolls';

// ── Undyed roll flow analytics (same shape as the shared base) ────────────────

export type UndyedRollFlowEntry = RollFlowEntryBase;

// ── Undyed inventory view types ───────────────────────────────────────────────

export interface UndyedInventoryRollDetail {
  id: number;
  weight: number;
  length?: number | null;
  gsm?: number | null;
  fabric_width?: number | null;
  status: string;
  received_date?: string | null;
  issued_date?: string | null;
  rack_id?: number | null;
  rack_code?: string | null;
  quality_grade?: string | null;
  defect_points?: number | null;
  remarks?: string | null;
}

export interface UndyedInventoryLotGroup {
  lot_number?: string | null;
  supplier?: string | null;
  total_weight: number;
  total_length?: number | null;
  roll_count: number;
  rolls: UndyedInventoryRollDetail[];
}

export interface UndyedMaterialInventory {
  material_id: number;
  material_name: string;
  total_weight: number;
  total_length?: number | null;
  roll_count: number;
  lot_groups: UndyedInventoryLotGroup[];
}

export interface UndyedClientInventoryGroup {
  client_id: number;
  client_name: string;
  total_weight: number;
  total_length?: number | null;
  roll_count: number;
  materials: UndyedMaterialInventory[];
}

// ── UndyedFabricRoll types ────────────────────────────────────────────────────

export interface UndyedFabricRoll {
  id: number;
  client_id: number;
  material_id: number;
  lot_number?: string | null;
  gsm?: number | null;
  fabric_width?: number | null;
  weight: number;
  length?: number | null;
  status: string;
  rack_id?: number | null;
  supplier?: string | null;
  received_date?: string | null;
  remarks?: string | null;
  /** Expected-delivery item this roll was auto-matched to, if any. */
  expected_delivery_item_id?: number | null;
  /** Delivery the roll was matched to on creation (transient, create response only). */
  matched_delivery_id?: number | null;
  /** User who ingested this roll — set server-side, never client-supplied. */
  ingested_by?: number | null;
}

export interface UndyedFabricRollCreate {
  client_id: number;
  material_id: number;
  lot_number?: string | null;
  gsm?: number | null;
  fabric_width?: number | null;
  weight: number;
  length?: number | null;
  status?: string;
  rack_id?: number | null;
  supplier?: string | null;
  received_date?: string | null;
  remarks?: string | null;
}

/** Scan-lookup projection mirroring FabricRollDetail (no color / fabric code). */
export interface UndyedFabricRollDetail {
  id: number;
  weight: number;
  length?: number | null;
  status: string;
  material_name: string;
  lot_number?: string | null;
  client_id: number;
  material_id: number;
  client_name?: string | null;
  gsm?: number | null;
  fabric_width?: number | null;
  rack_code?: string | null;
  supplier?: string | null;
  received_date?: string | null;
}

export const undyedFabricRollApi = {
  getInventory: () =>
    api.request<UndyedClientInventoryGroup[]>('/undyed-fabric-rolls/inventory'),

  getFlowAnalytics: () =>
    api.request<UndyedRollFlowEntry[]>('/undyed-fabric-rolls/analytics/flow'),

  getDetail: (rollId: number) =>
    api.request<UndyedFabricRollDetail>(`/undyed-fabric-rolls/${rollId}/detail`),

  getAll: (filters?: { client_id?: number; material_id?: number }) => {
    const params = new URLSearchParams();
    if (filters?.client_id !== undefined)
      params.append('client_id', String(filters.client_id));
    if (filters?.material_id !== undefined)
      params.append('material_id', String(filters.material_id));
    const qs = params.toString();
    return api.request<UndyedFabricRoll[]>(qs ? `/undyed-fabric-rolls/?${qs}` : '/undyed-fabric-rolls/');
  },

  create: (roll: UndyedFabricRollCreate) =>
    api.request<UndyedFabricRoll>('/undyed-fabric-rolls/', 'POST', roll),

  delete: (rollId: number) =>
    api.request<void>(`/undyed-fabric-rolls/${rollId}`, 'DELETE'),
};
