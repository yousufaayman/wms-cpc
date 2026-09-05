import { api } from './client';

// ── Account flow (per logical location) types ─────────────────────────────────

export interface AccountFlowRoll {
  roll_id: number;
  roll_type: 'dyed' | 'undyed';
  /** ISO day (YYYY-MM-DD); null when the source timestamp is missing. */
  date: string | null;
  /** Set on digested rolls only. */
  receipt_kind?: 'supplier' | 'internal' | 'external' | null;
  receipt_id?: number | null;
  fabric_code?: string | null;
  client_fabric_code_id?: number | null;
  client_name: string;
  material_name: string;
  color_name?: string | null;
  weight: number;
  length?: number | null;
}

export type FlowAccountType = 'location' | 'client' | 'external';

export interface AccountFlow {
  /** Null for 'external' accounts — external receivers are identified by name. */
  account_id?: number | null;
  account_name: string;
  account_type: FlowAccountType;
  ingested: AccountFlowRoll[];
  digested: AccountFlowRoll[];
}

export interface FlowAccount {
  /** Null for 'external' accounts — external receivers are identified by name. */
  id?: number | null;
  name: string;
  account_type: FlowAccountType;
}

/** Excel workbook label language — mirrors the app's language toggle. */
export type ExportLang = 'en' | 'ar';

export const analyticsApi = {
  /** Logical locations with roll activity inside the optional date window. */
  getFlowAccounts: (dateFrom?: string, dateTo?: string) => {
    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    const qs = params.toString();
    return api.request<FlowAccount[]>(qs ? `/analytics/accounts?${qs}` : '/analytics/accounts');
  },

  getAccountFlow: (account: FlowAccount) => {
    const params = new URLSearchParams({ account_type: account.account_type });
    if (account.account_type === 'external') params.append('receiver', account.name);
    else params.append('account_id', String(account.id));
    return api.request<AccountFlow>(`/analytics/account-flow?${params.toString()}`);
  },

  /** Downloads an Excel workbook (Ingestion + Digestion sheets, dyed +
      undyed combined) for all roll traffic inside the date window. */
  exportRollFlow: (dateFrom?: string, dateTo?: string, lang: ExportLang = 'en') => {
    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    params.append('lang', lang);
    return api.downloadFile(`/analytics/roll-flow/export?${params.toString()}`, 'roll-flow.xlsx');
  },

  /** Downloads an Excel workbook for one account: a sheet with separate
      Ingestion and Digestion tables. */
  exportAccountFlow: (account: FlowAccount, dateFrom?: string, dateTo?: string, lang: ExportLang = 'en') => {
    const params = new URLSearchParams({ account_type: account.account_type });
    if (account.account_type === 'external') params.append('receiver', account.name);
    else params.append('account_id', String(account.id));
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    params.append('lang', lang);
    return api.downloadFile(
      `/analytics/account-flow/export?${params.toString()}`,
      `account-${account.name}.xlsx`,
    );
  },

  /** Downloads an Excel workbook with one sheet per account (with activity
      inside the date window), each holding separate Ingestion/Digestion
      tables. */
  exportAllAccounts: (dateFrom?: string, dateTo?: string, lang: ExportLang = 'en') => {
    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    params.append('lang', lang);
    return api.downloadFile(`/analytics/accounts/export?${params.toString()}`, 'accounts.xlsx');
  },
};
