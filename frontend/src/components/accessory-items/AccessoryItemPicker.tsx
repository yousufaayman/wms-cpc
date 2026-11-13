/**
 * Shared pieces for picking and showing accessory items (items 15 and 17).
 *
 * Used by the delivery lines (AccessoryDeliveryLines) and by Receive Packs:
 * - `ItemSearch`: a search box + result list. The search finds items by code,
 *   description, color / size, any reference code (client or supplier) and
 *   any variable value. Templates are left out (only real items hold stock);
 *   variants of one template are listed together under its header.
 * - `PickedItem`: the card shown once an item is chosen.
 * - `ValueChips`, `ClientRefs`: a variant's values and the clients' own codes.
 * - `QtyInUnit`: a quantity box + unit picker with the "= N base" preview.
 * - `groupByTemplate` / `differing` / `tone`: how variants are grouped and
 *   what tells them apart (bold = differs inside the group, muted = shared).
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Search } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  accessoryItemApi,
  type AccessoryClientRef, type AccessoryItem, type AccessoryItemUnit, type AccessoryValueLine, type ExpectedDeliveryItem,
} from "@/lib/api";

export const fmtQty = (q: string | number | null | undefined) =>
  q === null || q === undefined ? "—" : Number(q).toLocaleString("en-US", { maximumFractionDigits: 4 });

// ─── Variants of one template, shown together ───────────────────────────────

/** What a row needs to be grouped and told apart (a delivery line or an item). */
export interface VariantInfo {
  templateId: number | null;
  color: string | null;
  size: string | null;
  values: AccessoryValueLine[];
}

export const lineInfo = (l: ExpectedDeliveryItem): VariantInfo => ({
  templateId: l.template_id ?? null, color: l.item_color ?? null, size: l.item_size ?? null, values: l.value_lines ?? [],
});
export const itemInfo = (i: AccessoryItem): VariantInfo => ({
  templateId: i.parent_template_id, color: i.color, size: i.size, values: i.value_lines,
});

/** Rows in their order, variants of one template pulled together where the first one appears. */
export function groupByTemplate<T>(rows: T[], info: (r: T) => VariantInfo): { templateId: number | null; rows: T[] }[] {
  const groups: { templateId: number | null; rows: T[] }[] = [];
  const byTemplate = new Map<number, { templateId: number | null; rows: T[] }>();
  for (const row of rows) {
    const tid = info(row).templateId;
    const existing = tid !== null ? byTemplate.get(tid) : undefined;
    if (existing) { existing.rows.push(row); continue; }
    const group = { templateId: tid, rows: [row] };
    groups.push(group);
    if (tid !== null) byTemplate.set(tid, group);
  }
  return groups;
}

/** Which attributes differ inside a group: "color", "size" and line field keys. */
export function differing(infos: VariantInfo[]): Set<string> {
  const out = new Set<string>();
  if (infos.length < 2) return out;
  const seen = new Map<string, Set<string>>();
  const note = (key: string, value: string | null | undefined) => {
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key)!.add((value ?? "").trim().toLowerCase());
  };
  const keys = new Set(infos.flatMap((i) => i.values.map((v) => v.field_key)));
  for (const i of infos) {
    note("color", i.color);
    note("size", i.size);
    for (const k of keys) note(k, i.values.find((v) => v.field_key === k)?.value);
  }
  for (const [key, values] of seen) if (values.size > 1) out.add(key);
  return out;
}

export const tone = (differs: Set<string>, key: string, grouped: boolean) =>
  !grouped ? "" : differs.has(key) ? "font-semibold text-foreground" : "text-muted-foreground";

/** A variant's line values as small "label: value" chips. */
export function ValueChips({ values, differs = new Set(), grouped = false }: Readonly<{
  values: AccessoryValueLine[]; differs?: Set<string>; grouped?: boolean;
}>) {
  const { language } = useLanguage();
  if (!values.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-0.5">
      {values.map((v) => (
        <span key={v.field_key} className={`rounded border px-1.5 py-0.5 text-xs ${tone(differs, v.field_key, grouped)}`}>
          <span className="opacity-70">{language === "ar" ? v.label_ar : v.label_en}:</span> {v.value}
        </span>
      ))}
    </div>
  );
}

/** Clients' own codes for the item, e.g. "UR 4512-BLK" (client code, then their code). */
export function ClientRefs({ refs, inline = false }: Readonly<{ refs: AccessoryClientRef[]; inline?: boolean }>) {
  if (!refs.length) return inline ? null : <span className="text-muted-foreground">—</span>;
  return (
    <div className={inline ? "flex flex-wrap gap-x-3 text-xs" : "space-y-0.5 text-sm"}>
      {refs.map((r) => (
        <div key={`${r.client_id}-${r.ref_code}`} title={r.client_name ?? undefined}>
          <span className="text-muted-foreground">{r.client_code ?? `#${r.client_id}`} </span>
          <span className="font-mono" dir="ltr">{r.ref_code}</span>
        </div>
      ))}
    </div>
  );
}

/** Quantity box + unit picker. `units` = the item's units, base first. */
export function QtyInUnit({ label, units, qty, setQty, uomId, setUomId, extraUnits, inputRef, onEnter }: Readonly<{
  label: string;
  units: AccessoryItemUnit[];
  qty: string; setQty: (v: string) => void;
  uomId: number | null; setUomId: (v: number) => void;
  /** More choices after the units (Receive Packs: the on-the-fly conversion, value -1). */
  extraUnits?: ReactNode;
  inputRef?: React.Ref<HTMLInputElement>;
  onEnter?: () => void;
}>) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const unit = units.find((u) => u.uom_id === uomId);
  const base = units.find((u) => u.is_base);
  const n = Number(qty);
  return (
    <div className="space-y-1.5">
      <Label>{label} *</Label>
      <div className="flex gap-2">
        <Input
          ref={inputRef} type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()} className="flex-1" dir="ltr"
        />
        <Select value={uomId !== null ? String(uomId) : undefined} onValueChange={(v) => setUomId(Number(v))}>
          <SelectTrigger className="w-44"><SelectValue placeholder={t("accSelectUnit")} /></SelectTrigger>
          <SelectContent>
            {units.map((u) => (
              <SelectItem key={u.uom_id} value={String(u.uom_id)}>
                {u.code} · {language === "ar" ? u.name_ar : u.name_en}
              </SelectItem>
            ))}
            {extraUnits}
          </SelectContent>
        </Select>
      </div>
      {unit && base && !unit.is_base && n > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("accEqualsBase", { qty: fmtQty(n * Number(unit.factor)), unit: base.code })}
        </p>
      )}
    </div>
  );
}

/** The chosen item: code, description, template, color / size, values, client codes. */
export function PickedItem({ item, onClear, children }: Readonly<{
  item: AccessoryItem; onClear?: () => void; children?: ReactNode;
}>) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start justify-between gap-2 rounded-md border p-3">
      <div className="min-w-0">
        <div className="font-mono text-sm font-medium">{item.code}</div>
        <div className="text-sm">{item.description}</div>
        {item.template_code && (
          <div className="text-xs text-muted-foreground">{t("accVariantOf", { code: item.template_code })}</div>
        )}
        <div className="text-xs text-muted-foreground">{[item.color, item.size].filter(Boolean).join(" · ")}</div>
        <ValueChips values={item.value_lines} />
        <ClientRefs refs={item.client_refs ?? []} inline />
        {children}
      </div>
      {onClear && <Button size="sm" variant="ghost" onClick={onClear}>{t("cancel")}</Button>}
    </div>
  );
}

/** Search box + results (debounced 300 ms). Wide rows: code, description,
    color / size, every value and the client codes are all shown. */
export function ItemSearch({ onPick, active = true }: Readonly<{ onPick: (item: AccessoryItem) => void; active?: boolean }>) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AccessoryItem[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!active) return;
    const q = search.trim();
    if (!q) { setResults([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      accessoryItemApi.search({ q, limit: 30 })
        .then((page) => { if (!cancelled) setResults(page.items.filter((i) => !i.is_template).slice(0, 20)); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, active]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("accSearchItemRefs")} className="ps-8" />
      </div>
      {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {results.length > 0 && (
        <div className="max-h-[60vh] overflow-y-auto rounded-md border divide-y">
          {groupByTemplate(results, itemInfo).map((group) => {
            const grouped = group.rows.length > 1;
            const differs = differing(group.rows.map(itemInfo));
            const result = (item: AccessoryItem) => (
              <button
                key={item.id} type="button" onClick={() => onPick(item)}
                className={`w-full text-start py-2 pe-3 hover:bg-muted transition-colors grid gap-x-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] ${grouped ? "ps-6" : "ps-3"}`}
              >
                <div className="min-w-0">
                  <span className="font-mono text-sm font-medium">{item.code}</span>{" "}
                  {!grouped && <span className="text-sm">{item.description}</span>}
                  <div className="text-xs">
                    {item.color && <span className={tone(differs, "color", grouped) || "text-muted-foreground"}>{item.color}</span>}
                    {item.color && item.size && <span className="text-muted-foreground"> · </span>}
                    {item.size && <span className={tone(differs, "size", grouped) || "text-muted-foreground"}>{item.size}</span>}
                  </div>
                  <ValueChips values={item.value_lines} differs={differs} grouped={grouped} />
                </div>
                <ClientRefs refs={item.client_refs ?? []} inline />
              </button>
            );
            if (!grouped) return result(group.rows[0]);
            const first = group.rows[0];
            return (
              <div key={`tpl-${group.templateId}`}>
                <div className="px-3 py-1.5 bg-muted/40 text-xs">
                  <span className="font-medium">{t("accVariantOf", { code: first.template_code ?? "" })}</span>{" "}
                  <span className="text-muted-foreground">{first.description}</span>{" "}
                  <span className="text-muted-foreground">· {t("accVariantCount", { n: group.rows.length })}</span>
                </div>
                <div className="divide-y">{group.rows.map(result)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
