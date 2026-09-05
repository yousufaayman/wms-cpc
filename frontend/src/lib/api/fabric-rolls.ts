import { api } from './client';

// ── Inventory view types ──────────────────────────────────────────────────────

export interface InventoryRollDetail {
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
  /** Another dyed roll this one was split/re-ingested from, if any. */
  original_roll_id?: number | null;
}

export interface InventoryLotGroup {
  lot_id?: number | null;
  lot_number?: string | null;
  supplier?: string | null;
  total_weight: number;
  total_length?: number | null;
  roll_count: number;
  rolls: InventoryRollDetail[];
}

export interface FabricCodeInventory {
  client_fabric_code_id: number;
  fabric_code?: string | null;
  color_id: number;
  color_name: string;
  total_weight: number;
  total_length?: number | null;
  roll_count: number;
  lot_groups: InventoryLotGroup[];
}

export interface MaterialInventoryGroup {
  material_id: number;
  material_name: string;
  total_weight: number;
  total_length?: number | null;
  roll_count: number;
  fabric_codes: FabricCodeInventory[];
}

export interface ClientInventoryGroup {
  client_id: number;
  client_name: string;
  total_weight: number;
  total_length?: number | null;
  roll_count: number;
  materials: MaterialInventoryGroup[];
}

// ── Roll flow analytics types (per day, direction, counterparty, identity) ────

export interface RollFlowEntryBase {
  /** ISO day (YYYY-MM-DD); null when the roll is missing the relevant date. */
  date: string | null;
  direction: 'ingested' | 'digested';
  /** Ingested: the roll's supplier (a client or an actual supplier);
      digested: who received the roll. Null when unknown. */
  counterparty?: string | null;
  client_id: number;
  client_name: string;
  material_id: number;
  material_name: string;
  total_weight: number;
  total_length: number;
  roll_count: number;
}

export interface DyedRollFlowEntry extends RollFlowEntryBase {
  client_fabric_code_id: number;
  fabric_code?: string | null;
  color_id: number;
  color_name: string;
}

// ── FabricRollDetail type ─────────────────────────────────────────────────────

export interface FabricRollDetail {
  id: number;
  weight: number;
  length?: number | null;
  status: string;
  material_name: string;
  color_name: string;
  lot_number?: string | null;
  client_fabric_code_id: number;
  fabric_code?: string | null;
  client_name?: string | null;
  gsm?: number | null;
  fabric_width?: number | null;
  rack_code?: string | null;
  supplier?: string | null;
  received_date?: string | null;
}

// ── FabricRoll types ──────────────────────────────────────────────────────────

export interface FabricRoll {
  id: number;
  client_fabric_code_id: number;
  lot_id?: number | null;
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
  /** Another dyed roll this one was split/re-ingested from, if any. */
  original_roll_id?: number | null;
}

export interface FabricRollCreate {
  client_fabric_code_id: number;
  lot_id?: number | null;
  gsm?: number | null;
  fabric_width?: number | null;
  weight: number;
  length?: number | null;
  status?: string;
  rack_id?: number | null;
  supplier?: string | null;
  received_date?: string | null;
  remarks?: string | null;
  original_roll_id?: number | null;
}

export const fabricRollApi = {
  getInventory: () =>
    api.request<ClientInventoryGroup[]>('/dyed-fabric-rolls/inventory'),

  getFlowAnalytics: () =>
    api.request<DyedRollFlowEntry[]>('/dyed-fabric-rolls/analytics/flow'),

  getAll: (filters?: { client_fabric_code_id?: number; lot_id?: number }) => {
    const params = new URLSearchParams();
    if (filters?.client_fabric_code_id !== undefined)
      params.append('client_fabric_code_id', String(filters.client_fabric_code_id));
    if (filters?.lot_id !== undefined)
      params.append('lot_id', String(filters.lot_id));
    const qs = params.toString();
    return api.request<FabricRoll[]>(qs ? `/dyed-fabric-rolls/?${qs}` : '/dyed-fabric-rolls/');
  },

  getById: (rollId: number) =>
    api.request<FabricRoll>(`/dyed-fabric-rolls/${rollId}`),

  getDetail: (rollId: number) =>
    api.request<FabricRollDetail>(`/dyed-fabric-rolls/${rollId}/detail`),

  create: (roll: FabricRollCreate) =>
    api.request<FabricRoll>('/dyed-fabric-rolls/', 'POST', roll),

  delete: (rollId: number) =>
    api.request<void>(`/dyed-fabric-rolls/${rollId}`, 'DELETE'),
};
