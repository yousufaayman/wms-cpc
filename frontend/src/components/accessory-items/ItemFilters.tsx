/**
 * Search and filters of the Accessory Items list (item 11).
 *
 * - `useItemFilters()`: the filters live in the page link (?q=…&color=…), so
 *   Back / Forward and a shared link keep them. The `warehouse` parameter is
 *   left alone. Changing any filter goes back to page 1.
 * - `ItemFilterBar`: the quick search box (each word must match somewhere),
 *   Sort, Clear all and the "Advanced search" button. The panel adds fields
 *   that all must match (AND): item code, reference code + its client /
 *   supplier, description, color, size, base unit, any line value, a template
 *   (then one box per line of that template), category, client, kind, inactive.
 * - `ItemPager`: Previous / Next and "Page 2 of 7 · 312 items".
 * The server does the matching: see `crud/accessory_items.py` → `list_items`.
 */
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type {
  AccessoryCategory, AccessoryItem, AccessoryItemKind, AccessoryItemQuery, Client, LogicalLocation, Uom,
} from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";

export const ALL = "all";
export const GENERIC = "generic";

export type ItemFilters = {
  q: string;
  code: string;
  description: string;
  color: string;
  size: string;
  refCode: string;
  party: string; // ALL, "c:<client id>" or "s:<supplier id>"
  unit: string; // ALL or a unit id
  lineValue: string;
  template: string; // ALL or a template id
  lines: Record<string, string>; // line key → text, for the chosen template
  category: string; // ALL or a category id
  client: string; // ALL, GENERIC or a client id
  kind: AccessoryItemKind | typeof ALL;
  inactive: boolean;
  sort: "code" | "newest";
  page: number; // from 1
};

const EMPTY: ItemFilters = {
  q: "", code: "", description: "", color: "", size: "", refCode: "", party: ALL, unit: ALL,
  lineValue: "", template: ALL, lines: {}, category: ALL, client: ALL, kind: ALL, inactive: false,
  sort: "code", page: 1,
};

// Filter → name in the page link. Template lines are "l.<line key>".
const TEXT_KEYS = {
  q: "q", code: "code", description: "desc", color: "color", size: "size", refCode: "ref",
  party: "party", unit: "unit", lineValue: "val", template: "tpl", category: "cat", client: "client", kind: "kind",
} as const;
const LINE_PREFIX = "l.";

function readFilters(params: URLSearchParams): ItemFilters {
  const f: ItemFilters = { ...EMPTY, lines: {} };
  for (const [field, key] of Object.entries(TEXT_KEYS)) {
    const value = params.get(key);
    if (value) (f as Record<string, unknown>)[field] = value;
  }
  params.forEach((value, key) => {
    if (key.startsWith(LINE_PREFIX) && value) f.lines[key.slice(LINE_PREFIX.length)] = value;
  });
  f.inactive = params.get("inactive") === "1";
  f.sort = params.get("sort") === "newest" ? "newest" : "code";
  f.page = Math.max(1, Number(params.get("page")) || 1);
  return f;
}

function writeFilters(prev: URLSearchParams, f: ItemFilters): URLSearchParams {
  const next = new URLSearchParams();
  const warehouse = prev.get("warehouse");
  if (warehouse) next.set("warehouse", warehouse);
  for (const [field, key] of Object.entries(TEXT_KEYS)) {
    const value = (f as Record<string, unknown>)[field] as string;
    if (value && value !== ALL) next.set(key, value);
  }
  if (f.template !== ALL) {
    Object.entries(f.lines).forEach(([line, value]) => value && next.set(`${LINE_PREFIX}${line}`, value));
  }
  if (f.inactive) next.set("inactive", "1");
  if (f.sort !== "code") next.set("sort", f.sort);
  if (f.page > 1) next.set("page", String(f.page));
  return next;
}

/** Filters that sit in the Advanced panel (they open it on a fresh page load). */
const advancedCount = (f: ItemFilters) =>
  [f.code, f.description, f.color, f.size, f.refCode, f.lineValue].filter((v) => v.trim()).length +
  [f.party, f.unit, f.template, f.category, f.client, f.kind].filter((v) => v !== ALL).length +
  Object.values(f.lines).filter((v) => v.trim()).length +
  (f.inactive ? 1 : 0);

export function useItemFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => readFilters(params), [params]);

  /** Change some filters; anything but the page itself goes back to page 1. */
  const update = (changes: Partial<ItemFilters>) =>
    setParams((prev) => writeFilters(prev, { ...readFilters(prev), page: 1, ...changes }), { replace: true });
  const clear = () => setParams((prev) => writeFilters(prev, EMPTY), { replace: true });

  return { filters, update, clear, advanced: advancedCount(filters) };
}

const text = (value: string) => value.trim() || undefined;
const id = (value: string) => (value === ALL ? undefined : Number(value));

/** The filters as the list endpoint's query. */
export function toItemQuery(f: ItemFilters, pageSize: number): AccessoryItemQuery {
  const party = f.party === ALL ? {} : f.party.startsWith("c:")
    ? { ref_client_id: Number(f.party.slice(2)) }
    : { ref_supplier_id: Number(f.party.slice(2)) };
  const lines = f.template === ALL ? [] : Object.entries(f.lines)
    .filter(([, value]) => value.trim())
    .map(([key, value]) => `${key}:${value.trim()}`);
  return {
    q: text(f.q),
    code: text(f.code),
    description: text(f.description),
    color: text(f.color),
    size: text(f.size),
    ref_code: text(f.refCode),
    ...party,
    base_uom_id: id(f.unit),
    line_value: text(f.lineValue),
    line: lines,
    template_id: id(f.template),
    category_id: id(f.category),
    client_id: f.client === GENERIC ? undefined : id(f.client),
    generic_only: f.client === GENERIC || undefined,
    kind: f.kind === ALL ? undefined : f.kind,
    active_only: !f.inactive,
    sort: f.sort === "code" ? undefined : f.sort,
    limit: pageSize,
    offset: (f.page - 1) * pageSize,
  };
}

type BarProps = {
  filters: ItemFilters;
  update: (changes: Partial<ItemFilters>) => void;
  clear: () => void;
  advanced: number;
  open: boolean;
  setOpen: (open: boolean) => void;
  categories: AccessoryCategory[];
  categoryName: (c: AccessoryCategory) => string;
  clients: Client[];
  suppliers: LogicalLocation[];
  uoms: Uom[];
  templates: AccessoryItem[];
};

export function ItemFilterBar({
  filters: f, update, clear, advanced, open, setOpen, categories, categoryName, clients, suppliers, uoms, templates,
}: BarProps) {
  const { t, language } = useTranslation();
  const template = f.template === ALL ? undefined : templates.find((x) => String(x.id) === f.template);
  const field = (label: string, value: string, key: keyof ItemFilters, ltr = false) => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input value={value} dir={ltr ? "ltr" : undefined} onChange={(e) => update({ [key]: e.target.value })} />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input className="max-w-md" placeholder={t("accItemSearch")} value={f.q}
          onChange={(e) => update({ q: e.target.value })} />
        <Button variant="outline" onClick={() => setOpen(!open)}>
          <SlidersHorizontal className="mr-2 h-4 w-4" />{t("accAdvancedSearch")}
          {advanced > 0 && <Badge variant="secondary" className="ml-2">{advanced}</Badge>}
          {open ? <ChevronUp className="ml-1 h-4 w-4" /> : <ChevronDown className="ml-1 h-4 w-4" />}
        </Button>
        <Select value={f.sort} onValueChange={(v) => update({ sort: v as ItemFilters["sort"] })}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="code">{`${t("accSortBy")}: ${t("accSortCode")}`}</SelectItem>
            <SelectItem value="newest">{`${t("accSortBy")}: ${t("accSortNewest")}`}</SelectItem>
          </SelectContent>
        </Select>
        {(advanced > 0 || f.q) && <Button variant="ghost" onClick={clear}>{t("clearAll")}</Button>}
      </div>

      {open && (
        <div className="grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2 lg:grid-cols-4">
          {field(t("accItemCode"), f.code, "code", true)}
          {field(t("accRefCode"), f.refCode, "refCode", true)}
          <div className="space-y-1">
            <Label className="text-xs">{t("accRefParty")}</Label>
            <Select value={f.party} onValueChange={(v) => update({ party: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("accAnyParty")}</SelectItem>
                <SelectGroup>
                  <SelectLabel>{t("accClients")}</SelectLabel>
                  {clients.map((c) => <SelectItem key={`c${c.id}`} value={`c:${c.id}`}>{c.name}</SelectItem>)}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel>{t("accSuppliers")}</SelectLabel>
                  {suppliers.map((s) => <SelectItem key={`s${s.id}`} value={`s:${s.id}`}>{s.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          {field(t("accDescription"), f.description, "description")}
          {field(t("color"), f.color, "color")}
          {field(t("accSize"), f.size, "size")}
          <div className="space-y-1">
            <Label className="text-xs">{t("accBaseUnit")}</Label>
            <Select value={f.unit} onValueChange={(v) => update({ unit: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("accAnyUnit")}</SelectItem>
                {uoms.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("accCategory")}</Label>
            <Select value={f.category} onValueChange={(v) => update({ category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("accAllCategories")}</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{categoryName(c)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("client")}</Label>
            <Select value={f.client} onValueChange={(v) => update({ client: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("accAllClients")}</SelectItem>
                <SelectItem value={GENERIC}>{t("accGenericOnly")}</SelectItem>
                {clients.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("accKind")}</Label>
            <Select value={f.kind} onValueChange={(v) => update({ kind: v as ItemFilters["kind"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("accKindAll")}</SelectItem>
                <SelectItem value="plain">{t("accKindPlain")}</SelectItem>
                <SelectItem value="template">{t("accKindTemplates")}</SelectItem>
                <SelectItem value="variant">{t("accKindVariants")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {field(t("accLineValue"), f.lineValue, "lineValue")}
          <div className="space-y-1">
            <Label className="text-xs">{t("accTemplate")}</Label>
            <Select value={f.template} onValueChange={(v) => update({ template: v, lines: {} })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("accAnyTemplate")}</SelectItem>
                {templates.map((x) => (
                  <SelectItem key={x.id} value={String(x.id)}>{`${x.code} · ${x.description}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {template?.fields.map((line) => (
            <div key={line.id} className="space-y-1">
              <Label className="text-xs">{language === "ar" ? line.label_ar : line.label_en}</Label>
              <Input value={f.lines[line.field_key] ?? ""}
                onChange={(e) => update({ lines: { ...f.lines, [line.field_key]: e.target.value } })} />
            </div>
          ))}
          <div className="flex items-center gap-2 self-end pb-2">
            <Switch id="inactive" checked={f.inactive} onCheckedChange={(v) => update({ inactive: v })} />
            <Label htmlFor="inactive">{t("accShowInactive")}</Label>
          </div>
        </div>
      )}
    </div>
  );
}

type PagerProps = { page: number; pageSize: number; total: number; onPage: (page: number) => void };

export function ItemPager({ page, pageSize, total, onPage }: PagerProps) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>{t("accPageOf", { page, pages, total })}</span>
      {pages > 1 && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            {t("previousPage")}
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            {t("nextPage")}
          </Button>
        </div>
      )}
    </div>
  );
}
