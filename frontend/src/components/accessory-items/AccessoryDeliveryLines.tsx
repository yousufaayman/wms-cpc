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
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  accessoryItemApi, expectedDeliveryApi, isLineHasPacksError, valueSummary,
  type AccessoryItem, type AccessoryItemUnit, type ExpectedDelivery, type ExpectedDeliveryItem,
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
  const { language } = useLanguage();

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
        .then((page) => { if (!cancelled) setResults(page.items.filter((i) => !i.is_template).slice(0, 8)); })
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

  const itemExtra = (line: ExpectedDeliveryItem) =>
    [line.item_color, line.item_size, valueSummary(line.value_lines ?? [], language)].filter(Boolean).join(" · ");

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
                    <TableHead>{t("accDescription")}</TableHead>
                    <TableHead className="text-right">{t("accExpectedQty")}</TableHead>
                    <TableHead className="text-right">{t("accReceivedQty")}</TableHead>
                    <TableHead className="text-center">{t("accQtyDifference")}</TableHead>
                    {canEdit && <TableHead className="w-28">{t("actions")}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {delivery.items.map((line) => {
                    const received = Number(line.received_qty ?? 0);
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono text-sm font-medium">{line.item_code ?? "—"}</TableCell>
                        <TableCell className="text-sm">
                          <div>{line.item_description ?? "—"}</div>
                          {itemExtra(line) && <div className="text-xs text-muted-foreground">{itemExtra(line)}</div>}
                          {line.notes && <div className="text-xs text-muted-foreground italic">{line.notes}</div>}
                        </TableCell>
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
                  <div className="text-xs text-muted-foreground">
                    {[picked.color, picked.size, valueSummary(picked.value_lines, language)].filter(Boolean).join(" · ")}
                  </div>
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
                  <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
                    {results.map((item) => (
                      <button
                        key={item.id} type="button" onClick={() => pick(item)}
                        className="w-full text-left px-3 py-2 hover:bg-muted transition-colors"
                      >
                        <span className="font-mono text-sm font-medium">{item.code}</span>{" "}
                        <span className="text-sm">{item.description}</span>
                        <div className="text-xs text-muted-foreground">
                          {[item.color, item.size, valueSummary(item.value_lines, language)].filter(Boolean).join(" · ")}
                        </div>
                      </button>
                    ))}
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
