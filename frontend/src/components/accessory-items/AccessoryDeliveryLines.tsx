/**
 * The lines of an expected delivery in an Accessory warehouse (item 15).
 *
 * Fabric deliveries keep their own table on ExpectedDeliveryDetail; this one
 * replaces it when the warehouse is an Accessory warehouse. Each line is an
 * accessory item + how many are expected, in the item's base unit. The
 * quantity can be typed in any unit that converts to it (e.g. 50 DOZ); the
 * server converts on save. "Received" comes from the server, worked out from
 * the packs received against the line, so this page never edits it.
 */
import { Fragment, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Minus, PackageOpen, Pencil, Plus, Search, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  accessoryItemApi, expectedDeliveryApi, isLineHasPacksError,
  type AccessoryClientRef, type AccessoryItem, type AccessoryItemUnit, type AccessoryValueLine, type ExpectedDelivery, type ExpectedDeliveryItem,
} from "@/lib/api";

const fmtQty = (q: string | number | null | undefined) =>
  q === null || q === undefined ? "—" : Number(q).toLocaleString("en-US", { maximumFractionDigits: 4 });

function Difference({ expected, received }: Readonly<{ expected: number; received: number }>) {
  const { t } = useTranslation();
  const diff = received - expected;
  if (Math.abs(diff) < 0.00005) {
    return <span className="inline-flex items-center gap-1 text-green-600 text-sm"><Minus className="h-3 w-3" /> {t("onTarget")}</span>;
  }
  const over = diff > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-medium ${over ? "text-blue-600" : "text-red-600"}`} dir="ltr">
      {over ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {over ? "+" : ""}{fmtQty(diff)}
    </span>
  );
}

// ─── Variants of one template, shown together ───────────────────────────────
// Lines (or search results) that are variants of the same template are listed
// under one header, so it's clear they are the same trim. Inside a group,
// the color / size / line values that differ between the variants are bold;
// the ones they all share are muted.

/** What a row needs to be grouped and told apart (a delivery line or an item). */
interface VariantInfo {
  templateId: number | null;
  color: string | null;
  size: string | null;
  values: AccessoryValueLine[];
}

const lineInfo = (l: ExpectedDeliveryItem): VariantInfo => ({
  templateId: l.template_id ?? null, color: l.item_color ?? null, size: l.item_size ?? null, values: l.value_lines ?? [],
});
const itemInfo = (i: AccessoryItem): VariantInfo => ({
  templateId: i.parent_template_id, color: i.color, size: i.size, values: i.value_lines,
});

/** Rows in their order, variants of one template pulled together where the first one appears. */
function groupByTemplate<T>(rows: T[], info: (r: T) => VariantInfo): { templateId: number | null; rows: T[] }[] {
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
function differing(infos: VariantInfo[]): Set<string> {
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

const tone = (differs: Set<string>, key: string, grouped: boolean) =>
  !grouped ? "" : differs.has(key) ? "font-semibold text-foreground" : "text-muted-foreground";

/** A variant's line values as small "label: value" chips. */
function ValueChips({ values, differs, grouped }: Readonly<{ values: AccessoryValueLine[]; differs: Set<string>; grouped: boolean }>) {
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
function ClientRefs({ refs, inline = false }: Readonly<{ refs: AccessoryClientRef[]; inline?: boolean }>) {
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
function QtyInUnit({ units, qty, setQty, uomId, setUomId }: Readonly<{
  units: AccessoryItemUnit[];
  qty: string; setQty: (v: string) => void;
  uomId: number | null; setUomId: (v: number) => void;
}>) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const unit = units.find((u) => u.uom_id === uomId);
  const base = units.find((u) => u.is_base);
  const n = Number(qty);
  return (
    <div className="space-y-1.5">
      <Label>{t("accExpectedQty")} *</Label>
      <div className="flex gap-2">
        <Input type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} className="flex-1" dir="ltr" />
        <Select value={uomId !== null ? String(uomId) : undefined} onValueChange={(v) => setUomId(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue placeholder={t("accSelectUnit")} /></SelectTrigger>
          <SelectContent>
            {units.map((u) => (
              <SelectItem key={u.uom_id} value={String(u.uom_id)}>
                {u.code} · {language === "ar" ? u.name_ar : u.name_en}
              </SelectItem>
            ))}
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

export default function AccessoryDeliveryLines({ delivery, canEdit, onChanged, onDelete }: Readonly<{
  delivery: ExpectedDelivery;
  canEdit: boolean;
  /** Reload the delivery after a change. */
  onChanged: () => void;
  /** Ask the page to confirm and delete a line. */
  onDelete: (lineId: number) => void;
}>) {
  const { t } = useTranslation();

  // ── Add line ──
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AccessoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<AccessoryItem | null>(null);
  const [units, setUnits] = useState<AccessoryItemUnit[]>([]);
  const [qty, setQty] = useState("");
  const [uomId, setUomId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // ── Edit line ──
  const [editLine, setEditLine] = useState<ExpectedDeliveryItem | null>(null);
  const [editUnits, setEditUnits] = useState<AccessoryItemUnit[]>([]);
  const [editQty, setEditQty] = useState("");
  const [editUomId, setEditUomId] = useState<number | null>(null);

  // Item search, 300 ms after typing stops. Templates are never received, so
  // they are left out (their variants are listed instead).
  useEffect(() => {
    if (!addOpen || picked) return;
    const q = search.trim();
    if (!q) { setResults([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      setSearching(true);
      accessoryItemApi.search({ q, limit: 20 })
        .then((page) => { if (!cancelled) setResults(page.items.filter((i) => !i.is_template).slice(0, 12)); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, addOpen, picked]);

  const loadUnits = (itemId: number, set: (u: AccessoryItemUnit[]) => void, setUom: (id: number) => void) =>
    accessoryItemApi.units(itemId).then((u) => { set(u); if (u.length) setUom(u[0].uom_id); }).catch(() => set([]));

  const pick = (item: AccessoryItem) => {
    setPicked(item);
    setUnits([]); setUomId(null);
    loadUnits(item.id, setUnits, setUomId);
  };

  const resetAdd = () => {
    setSearch(""); setResults([]); setPicked(null); setUnits([]); setQty(""); setUomId(null); setNotes("");
  };

  const handleAdd = async () => {
    if (!picked) { toast.error(t("accPickItem")); return; }
    if (!(Number(qty) > 0)) { toast.error(t("accEnterQty")); return; }
    setSaving(true);
    try {
      await expectedDeliveryApi.addItem(delivery.id, {
        accessory_item_id: picked.id, expected_qty: qty, uom_id: uomId, notes: notes.trim() || null,
      });
      toast.success(t("itemAdded"));
      setAddOpen(false);
      resetAdd();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("failedToAddItem"));
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (line: ExpectedDeliveryItem) => {
    setEditLine(line);
    setEditQty(line.expected_qty ? String(Number(line.expected_qty)) : "");
    setEditUnits([]); setEditUomId(null);
    if (line.accessory_item_id) loadUnits(line.accessory_item_id, setEditUnits, setEditUomId);
  };

  const handleEdit = async () => {
    if (!editLine) return;
    if (!(Number(editQty) > 0)) { toast.error(t("accEnterQty")); return; }
    setSaving(true);
    try {
      await expectedDeliveryApi.updateItem(editLine.id, { expected_qty: editQty, uom_id: editUomId });
      setEditLine(null);
      onChanged();
    } catch (e) {
      toast.error(isLineHasPacksError(e) ? t("accLineHasPacks") : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const colCount = 8 + (canEdit ? 1 : 0);

  /** One delivery line. In a template group the description is in the group
      header, so the row shows only what tells this variant apart. */
  const renderLine = (line: ExpectedDeliveryItem, differs: Set<string>, grouped: boolean) => {
    const received = Number(line.received_qty ?? 0);
    return (
      <TableRow key={line.id}>
        <TableCell className={`font-mono text-sm font-medium ${grouped ? "ps-8" : ""}`}>{line.item_code ?? "—"}</TableCell>
        <TableCell><ClientRefs refs={line.client_refs ?? []} /></TableCell>
        <TableCell className="text-sm">
          {!grouped && <div>{line.item_description ?? "—"}</div>}
          {!grouped && line.template_code && (
            <div className="text-xs text-muted-foreground">{t("accVariantOf", { code: line.template_code })}</div>
          )}
          <ValueChips values={line.value_lines ?? []} differs={differs} grouped={grouped} />
          {line.notes && <div className="text-xs text-muted-foreground italic">{line.notes}</div>}
        </TableCell>
        <TableCell className={`text-sm ${tone(differs, "color", grouped)}`}>{line.item_color ?? "—"}</TableCell>
        <TableCell className={`text-sm ${tone(differs, "size", grouped)}`}>{line.item_size ?? "—"}</TableCell>
        <TableCell className="text-right text-sm font-mono" dir="ltr">{fmtQty(line.expected_qty)} {line.uom_code}</TableCell>
        <TableCell className="text-right text-sm font-mono" dir="ltr">{fmtQty(received)} {line.uom_code}</TableCell>
        <TableCell className="text-center">
          <Difference expected={Number(line.expected_qty ?? 0)} received={received} />
        </TableCell>
        {canEdit && (
          <TableCell>
            <Button size="sm" variant="ghost" title={t("editDeliveryItem")} onClick={() => openEdit(line)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="sm" variant="ghost" className="text-destructive hover:text-destructive"
              title={received > 0 ? t("accLineHasPacks") : t("deleteDeliveryItem")}
              disabled={received > 0}
              onClick={() => onDelete(line.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </TableCell>
        )}
      </TableRow>
    );
  };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">{t("deliveryItems")} ({delivery.items.length})</CardTitle>
            {canEdit && (
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                {t("addDeliveryItem")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {delivery.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <PackageOpen className="h-10 w-10 text-muted-foreground" />
              <p className="text-muted-foreground">{t("noDeliveryItems")}</p>
              <p className="text-sm text-muted-foreground">{t("addFirstDeliveryItem")}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("accItemCode")}</TableHead>
                    <TableHead>{t("accRefs")}</TableHead>
                    <TableHead>{t("accDescription")}</TableHead>
                    <TableHead>{t("color")}</TableHead>
                    <TableHead>{t("accSize")}</TableHead>
                    <TableHead className="text-right">{t("accExpectedQty")}</TableHead>
                    <TableHead className="text-right">{t("accReceivedQty")}</TableHead>
                    <TableHead className="text-center">{t("accQtyDifference")}</TableHead>
                    {canEdit && <TableHead className="w-28">{t("actions")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupByTemplate(delivery.items, lineInfo).map((group) => {
                    if (group.rows.length < 2) return renderLine(group.rows[0], new Set(), false);
                    const differs = differing(group.rows.map(lineInfo));
                    const head = group.rows[0];
                    return (
                      <Fragment key={`tpl-${group.templateId}`}>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={colCount} className="py-2">
                            <span className="font-mono text-sm font-medium">{head.template_code}</span>{" "}
                            <span className="text-sm">{head.template_description}</span>{" "}
                            <Badge variant="secondary" className="ms-1">{t("accVariantCount", { n: group.rows.length })}</Badge>
                          </TableCell>
                        </TableRow>
                        {group.rows.map((line) => renderLine(line, differs, true))}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add line */}
      <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetAdd(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{t("addDeliveryItem")}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {picked ? (
              <div className="flex items-start justify-between gap-2 rounded-md border p-3">
                <div className="min-w-0">
                  <div className="font-mono text-sm font-medium">{picked.code}</div>
                  <div className="text-sm">{picked.description}</div>
                  {picked.template_code && (
                    <div className="text-xs text-muted-foreground">{t("accVariantOf", { code: picked.template_code })}</div>
                  )}
                  <div className="text-xs text-muted-foreground">{[picked.color, picked.size].filter(Boolean).join(" · ")}</div>
                  <ValueChips values={picked.value_lines} differs={new Set()} grouped={false} />
                  <ClientRefs refs={picked.client_refs ?? []} inline />
                </div>
                <Button size="sm" variant="ghost" onClick={() => { setPicked(null); setUnits([]); setUomId(null); }}>
                  {t("cancel")}
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("accSearchItem")} className="pl-8" />
                </div>
                {searching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {results.length > 0 && (
                  <div className="max-h-72 overflow-y-auto rounded-md border divide-y">
                    {groupByTemplate(results, itemInfo).map((group) => {
                      const grouped = group.rows.length > 1;
                      const differs = differing(group.rows.map(itemInfo));
                      const result = (item: AccessoryItem) => (
                        <button
                          key={item.id} type="button" onClick={() => pick(item)}
                          className={`w-full text-start py-2 pe-3 hover:bg-muted transition-colors ${grouped ? "ps-6" : "ps-3"}`}
                        >
                          <span className="font-mono text-sm font-medium">{item.code}</span>{" "}
                          {!grouped && <span className="text-sm">{item.description}</span>}
                          <div className="text-xs">
                            {item.color && <span className={tone(differs, "color", grouped) || "text-muted-foreground"}>{item.color}</span>}
                            {item.color && item.size && <span className="text-muted-foreground"> · </span>}
                            {item.size && <span className={tone(differs, "size", grouped) || "text-muted-foreground"}>{item.size}</span>}
                          </div>
                          <ValueChips values={item.value_lines} differs={differs} grouped={grouped} />
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
            )}

            {picked && units.length > 0 && (
              <QtyInUnit units={units} qty={qty} setQty={setQty} uomId={uomId} setUomId={setUomId} />
            )}

            <div className="space-y-1.5">
              <Label>{t("notes")}</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("notesPlaceholder")} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleAdd} disabled={saving || !picked}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("addDeliveryItem")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit line: the quantity */}
      <Dialog open={editLine !== null} onOpenChange={(open) => !open && setEditLine(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>{t("editDeliveryItem")}</DialogTitle></DialogHeader>
          {editLine && (
            <div className="space-y-3 py-2">
              <div>
                <div className="font-mono text-sm font-medium">{editLine.item_code}</div>
                <div className="text-sm text-muted-foreground">{editLine.item_description}</div>
              </div>
              {editUnits.length > 0 && (
                <QtyInUnit units={editUnits} qty={editQty} setQty={setEditQty} uomId={editUomId} setUomId={setEditUomId} />
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditLine(null)}>{t("cancel")}</Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("saveChanges")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
