/**
 * Pack Operations (item 21): the everyday corrections to packs. Four tabs:
 *
 * - Return from production: pick the job order → its requirement lines with
 *   stock still out ("can be returned" = issued − returned) → pick one, enter
 *   the quantity, where it came back from (defaults to where the issue went),
 *   and either scan a pack of the same item or make a new pack (label prints).
 * - Split pack: scan a pack → N new packs × quantity → labels print. The new
 *   packs' rack starts on the source pack's rack.
 * - Merge packs: scan the pack to keep, then scan the packs to empty into it.
 * - Reclassify (admins only): scan a pack → pick the new item (same base
 *   unit) → quantity (empty = everything free) and reason → a new pack of the
 *   new item, label prints.
 *
 * Split / merge / reclassify only move a pack's free quantity (what open
 * issues don't hold back). `?tab=return&jo=<id>` opens a tab directly (the
 * Return button in Material Requests). Rules live on the server
 * (`domains/accessories/pack_ops.py`); this page only collects the input.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, ScanBarcode, X } from "lucide-react";
import { toast } from "sonner";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { Combobox, type ComboItem } from "@/components/Combobox";
import { ItemSearch, PickedItem, QtyInUnit, fmtQty } from "@/components/accessory-items/AccessoryItemPicker";
import {
  accessoryItemApi, accessoryPackApi, accessoryRequirementApi, packOpsApi,
  warehouseRackApi,
  type AccessoryItem, type AccessoryItemUnit, type AccessoryPack, type PackFree,
  type RequirementJobOrder, type ReturnableLine, type WarehouseRack,
} from "@/lib/api";
import { generateAccessoryPackLabels, sendZplToDevice, type AccessoryPackLabelData } from "@/lib/zpl";
import { useWarehouse } from "@/hooks/useWarehouse";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTranslation } from "@/hooks/useTranslation";

type Tab = "return" | "split" | "merge" | "reclassify";
const TABS: Tab[] = ["return", "split", "merge", "reclassify"];
const NO_RACK = "none";

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

// ── Shared pieces ────────────────────────────────────────────────────────────

/** Racks of the warehouse, sorted by code. */
function useRacks(warehouseId: number | null) {
  const [racks, setRacks] = useState<WarehouseRack[]>([]);
  useEffect(() => {
    if (warehouseId === null) return;
    (async () => {
      const all: WarehouseRack[] = [];
      for (let skip = 0; ; skip += 100) {
        const batch = await warehouseRackApi.getAll(warehouseId, skip, 100);
        all.push(...batch);
        if (batch.length < 100) break;
      }
      setRacks(all.sort((a, b) => a.rack_code.localeCompare(b.rack_code)));
    })().catch(() => setRacks([]));
  }, [warehouseId]);
  return racks;
}

/** The units an item can be typed in; starts on its base unit. */
function useUnits(itemId: number | null) {
  const [units, setUnits] = useState<AccessoryItemUnit[]>([]);
  const [uomId, setUomId] = useState<number | null>(null);
  useEffect(() => {
    setUnits([]);
    setUomId(null);
    if (itemId === null) return;
    accessoryItemApi.units(itemId).then((u) => {
      setUnits(u);
      setUomId(u.find((x) => x.is_base)?.uom_id ?? null);
    }).catch(() => undefined);
  }, [itemId]);
  const unit = units.find((u) => u.uom_id === uomId);
  /** `qty` typed in the chosen unit → base units (for previews only; the server decides). */
  const toBase = (qty: string) => Number(qty) * Number(unit?.factor ?? 1);
  return { units, uomId, setUomId, toBase };
}

/** Prints labels for new packs (fetches each item once for its references). */
function usePrinter() {
  const { t } = useTranslation();
  const [printers, setPrinters] = useState<BrowserPrint.Device[]>([]);
  const [printer, setPrinter] = useState<BrowserPrint.Device | null>(null);
  useEffect(() => {
    if (typeof BrowserPrint === "undefined") return;
    BrowserPrint.getLocalDevices((d) => setPrinters(d as BrowserPrint.Device[]), () => undefined, "printer");
  }, []);

  const print = async (packs: AccessoryPack[]) => {
    if (packs.length === 0) return;
    if (!printer) { toast.warning(t("opsNoPrinter")); return; }
    const labels: AccessoryPackLabelData[] = [];
    const cache = new Map<number, [AccessoryItem, string]>();
    for (const pack of packs) {
      let entry = cache.get(pack.accessory_item_id);
      if (!entry) {
        const [item, units] = await Promise.all([
          accessoryItemApi.get(pack.accessory_item_id), accessoryItemApi.units(pack.accessory_item_id),
        ]);
        entry = [item, units.find((u) => u.is_base)?.name_ar ?? pack.uom_code];
        cache.set(pack.accessory_item_id, entry);
      }
      const [item, uomAr] = entry;
      labels.push({
        packId: pack.id,
        quantity: fmtQty(pack.quantity),
        uomAr,
        itemCode: pack.item_code,
        clientRef: item.client_refs?.[0]?.ref_code ?? null,
        supplierRef: (item.refs.find((r) => r.supplier_id != null && r.supplier_id === pack.client_supplier_id)
          ?? item.refs.find((r) => r.supplier_id != null))?.ref_code ?? null,
        color: pack.item_color,
        size: pack.item_size,
        description: pack.item_description,
        variantLines: pack.value_lines.map((v) => ({ label: v.label_en, value: v.value })),
        batchNo: pack.batch_no,
      });
    }
    await sendZplToDevice(printer, generateAccessoryPackLabels(labels)).catch(() => toast.warning(t("opsNoPrinter")));
  };
  return { printers, printer, setPrinter, print };
}

/** A scan box: Enter looks the pack up. */
function PackScan({ label, onPack, disabled }: Readonly<{
  label: string; onPack: (pack: AccessoryPack) => void; disabled?: boolean;
}>) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const scan = async () => {
    const value = code.trim();
    if (!value) return;
    setBusy(true);
    try {
      onPack(await accessoryPackApi.scan(value));
      setCode("");
    } catch (e) {
      toast.error(errorText(e, t("error")));
    } finally {
      setBusy(false);
      ref.current?.focus();
    }
  };
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input ref={ref} value={code} onChange={(e) => setCode(e.target.value)} disabled={disabled || busy} dir="ltr"
          placeholder={t("accIssueScanHint")} onKeyDown={(e) => e.key === "Enter" && scan()} autoFocus />
        <Button variant="outline" onClick={scan} disabled={disabled || busy || !code.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanBarcode className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

/** A scanned pack: item, on hand, free (and what open issues hold). */
function PackCard({ pack, free, onClear }: Readonly<{ pack: AccessoryPack; free?: PackFree | null; onClear?: () => void }>) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border p-3 text-sm flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <div className="font-medium">
          {t("accInvPack")} <span className="font-mono" dir="ltr">{pack.id}</span> · <span className="font-mono">{pack.item_code}</span>
        </div>
        <div className="text-muted-foreground">{pack.item_description}</div>
        <div dir="ltr" className="text-start">
          {fmtQty(pack.quantity)} {pack.uom_code} · {pack.rack_code ?? t("accInvWaitingPutaway")}
        </div>
        {free && (
          <div>
            {t("opsFree")}: <span className="font-medium" dir="ltr">{fmtQty(free.free)} {pack.uom_code}</span>
            {Number(free.held) > 0 && (
              <span className="text-amber-600 ml-2 rtl:ml-0 rtl:mr-2">{t("opsHeld", { qty: fmtQty(free.held) })}</span>
            )}
          </div>
        )}
      </div>
      {onClear && <Button variant="ghost" size="icon" onClick={onClear}><X className="h-4 w-4" /></Button>}
    </div>
  );
}

/** Rack for new packs; "waiting for put-away" = no rack. */
function RackChoice({ racks, rackId, setRackId }: Readonly<{
  racks: WarehouseRack[]; rackId: number | null; setRackId: (v: number | null) => void;
}>) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <Label>{t("opsRackOptional")}</Label>
      <Select value={rackId === null ? NO_RACK : String(rackId)} onValueChange={(v) => setRackId(v === NO_RACK ? null : Number(v))}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_RACK}>{t("accInvWaitingPutaway")}</SelectItem>
          {racks.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.rack_code}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function usePackWithFree() {
  const [pack, setPack] = useState<AccessoryPack | null>(null);
  const [free, setFree] = useState<PackFree | null>(null);
  const choose = (p: AccessoryPack | null) => {
    setPack(p);
    setFree(null);
    if (p) packOpsApi.free(p.id).then(setFree).catch(() => undefined);
  };
  return { pack, free, choose };
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PackOperations() {
  const { t } = useTranslation();
  const { warehouseId } = useWarehouse();
  const { isAdmin } = useCurrentUser();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) && (requested !== "reclassify" || isAdmin) ? requested : "return";
  const presetJo = params.get("jo") && /^\d+$/.test(params.get("jo")!) ? Number(params.get("jo")) : null;
  const racks = useRacks(warehouseId);
  const printing = usePrinter();

  const setTab = (next: string) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    p.delete("jo");
    setParams(p, { replace: true });
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-4 md:p-8 min-w-0 space-y-6 max-w-6xl">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t("packOps")}</h1>
              <p className="text-muted-foreground text-sm">{t("packOpsDesc")}</p>
            </div>
            <div className="w-64">
              <Select value={printing.printer?.uid ?? ""}
                onValueChange={(uid) => printing.setPrinter(printing.printers.find((p) => p.uid === uid) ?? null)}>
                <SelectTrigger><SelectValue placeholder={t("selectPrinter")} /></SelectTrigger>
                <SelectContent>
                  {printing.printers.map((p) => <SelectItem key={p.uid} value={p.uid}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {warehouseId !== null && (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="return">{t("opsTabReturn")}</TabsTrigger>
                <TabsTrigger value="split">{t("opsTabSplit")}</TabsTrigger>
                <TabsTrigger value="merge">{t("opsTabMerge")}</TabsTrigger>
                {isAdmin && <TabsTrigger value="reclassify">{t("opsTabReclassify")}</TabsTrigger>}
              </TabsList>
              <TabsContent value="return">
                <ReturnTab warehouseId={warehouseId} presetJo={presetJo} racks={racks} print={printing.print} />
              </TabsContent>
              <TabsContent value="split"><SplitTab racks={racks} print={printing.print} /></TabsContent>
              <TabsContent value="merge"><MergeTab /></TabsContent>
              {isAdmin && (
                <TabsContent value="reclassify"><ReclassifyTab racks={racks} print={printing.print} /></TabsContent>
              )}
            </Tabs>
          )}
        </main>
      </div>
    </PageTransition>
  );
}

type Print = (packs: AccessoryPack[]) => Promise<void>;

// ── Return from production ───────────────────────────────────────────────────

function ReturnTab({ warehouseId, presetJo, racks, print }: Readonly<{
  warehouseId: number; presetJo: number | null; racks: WarehouseRack[]; print: Print;
}>) {
  const { t } = useTranslation();
  const [jobOrders, setJobOrders] = useState<RequirementJobOrder[]>([]);
  const [joId, setJoId] = useState<number | null>(presetJo);
  const [lines, setLines] = useState<ReturnableLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [line, setLine] = useState<ReturnableLine | null>(null);

  useEffect(() => {
    accessoryRequirementApi.jobOrders().then(setJobOrders).catch(() => undefined);
  }, []);

  const load = (id: number | null) => {
    setLine(null);
    if (id === null) { setLines([]); return; }
    setLoading(true);
    packOpsApi.returnable(warehouseId, id).then(setLines).catch((e) => { setLines([]); toast.error(errorText(e, t("error"))); })
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(joId); }, [joId, warehouseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const joItems: ComboItem[] = useMemo(() => jobOrders.map((j) => ({
    id: j.job_order_id, label: j.client_name ? `${j.job_order_number} · ${j.client_name}` : j.job_order_number,
  })), [jobOrders]);

  return (
    <Card>
      <CardHeader><CardTitle>{t("opsTabReturn")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-md space-y-1.5">
          <Label>{t("accIssueJobOrder")}</Label>
          <Combobox items={joItems} value={joId} onSelect={setJoId} placeholder={t("opsPickJobOrder")} />
        </div>
        {joId !== null && (loading ? <Loader2 className="h-5 w-5 animate-spin" /> : lines.length === 0 ? (
          <p className="text-muted-foreground">{t("opsNothingToReturn")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("accItemCode")}</TableHead>
                <TableHead>{t("accDescription")}</TableHead>
                <TableHead className="text-right">{t("accReqIssued")}</TableHead>
                <TableHead className="text-right">{t("accReqReturned")}</TableHead>
                <TableHead className="text-right">{t("opsReturnable")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => (
                <TableRow key={l.jo_requirement_id}>
                  <TableCell className="font-mono">{l.item_code}</TableCell>
                  <TableCell>{l.item_description}</TableCell>
                  <TableCell className="text-right" dir="ltr">{fmtQty(l.issued)} {l.uom_code}</TableCell>
                  <TableCell className="text-right" dir="ltr">{fmtQty(l.returned)} {l.uom_code}</TableCell>
                  <TableCell className="text-right font-medium" dir="ltr">{fmtQty(l.out)} {l.uom_code}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" onClick={() => setLine(l)}>{t("opsReturnButton")}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ))}
      </CardContent>
      <ReturnDialog
        line={line} warehouseId={warehouseId} racks={racks} print={print}
        onClose={() => setLine(null)} onDone={() => load(joId)}
      />
    </Card>
  );
}

function ReturnDialog({ line, warehouseId, racks, print, onClose, onDone }: Readonly<{
  line: ReturnableLine | null; warehouseId: number; racks: WarehouseRack[];
  print: Print; onClose: () => void; onDone: () => void;
}>) {
  const { t } = useTranslation();
  const { units, uomId, setUomId } = useUnits(line?.accessory_item_id ?? null);
  const [qty, setQty] = useState("");
  const [fromId, setFromId] = useState<number | null>(null);
  const [newPack, setNewPack] = useState(false);
  const [pack, setPack] = useState<AccessoryPack | null>(null);
  const [rackId, setRackId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setQty(""); setPack(null); setNewPack(false); setRackId(null); setReason("");
    setFromId(line?.last_location_id ?? null);
  }, [line]);

  const scanned = (p: AccessoryPack) => {
    if (line && p.accessory_item_id !== line.accessory_item_id) { toast.error(t("opsScanSamePack")); return; }
    setPack(p);
  };

  const save = async () => {
    if (!line || fromId === null || !(Number(qty) > 0) || (!newPack && !pack)) return;
    setSaving(true);
    try {
      const out = await packOpsApi.returnTrims({
        warehouse_id: warehouseId, job_order_id: line.job_order_id, jo_requirement_id: line.jo_requirement_id,
        qty, uom_id: uomId, from_location_id: fromId, pack_id: newPack ? null : pack!.id,
        rack_id: newPack ? rackId : null, reason: reason.trim() || null,
      });
      const unit = units.find((u) => u.uom_id === uomId)?.code ?? line.uom_code;
      toast.success(t("opsReturnDone", { qty: fmtQty(qty), uom: unit, pack: out.pack.id }));
      if (out.created) await print([out.pack]);
      onClose();
      onDone();
    } catch (e) {
      toast.error(errorText(e, t("error")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={line !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        {line && <>
          <DialogHeader>
            <DialogTitle>{t("opsTabReturn")}: <span className="font-mono">{line.item_code}</span></DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm">{line.item_description} · {t("opsReturnable")}: <b dir="ltr">{fmtQty(line.out)} {line.uom_code}</b></p>
            <QtyInUnit label={t("opsReturnQty")} units={units} qty={qty} setQty={setQty} uomId={uomId} setUomId={setUomId} />
            <div className="space-y-1.5">
              <Label>{t("opsReturnedFrom")} *</Label>
              <Select value={fromId === null ? undefined : String(fromId)} onValueChange={(v) => setFromId(Number(v))}>
                <SelectTrigger><SelectValue placeholder={t("opsReturnedFrom")} /></SelectTrigger>
                <SelectContent>
                  {line.locations.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("opsIntoPack")}</Label>
              <div className="flex items-center gap-2">
                <Switch id="ops-new-pack" checked={newPack} onCheckedChange={setNewPack} />
                <Label htmlFor="ops-new-pack">{t("opsNewPack")}</Label>
              </div>
              {newPack
                ? <RackChoice racks={racks} rackId={rackId} setRackId={setRackId} />
                : pack
                  ? <PackCard pack={pack} onClear={() => setPack(null)} />
                  : <PackScan label={t("opsScanSamePack")} onPack={scanned} />}
            </div>
            <div className="space-y-1.5">
              <Label>{t("opsReasonOptional")}</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
              <Button onClick={save} disabled={saving || fromId === null || !(Number(qty) > 0) || (!newPack && !pack)}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5 rtl:mr-0 rtl:ml-1.5" />}{t("opsReturnButton")}
              </Button>
            </div>
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

// ── Split ────────────────────────────────────────────────────────────────────

function SplitTab({ racks, print }: Readonly<{ racks: WarehouseRack[]; print: Print }>) {
  const { t } = useTranslation();
  const { pack, free, choose } = usePackWithFree();
  const { units, uomId, setUomId, toBase } = useUnits(pack?.accessory_item_id ?? null);
  const [count, setCount] = useState("1");
  const [qty, setQty] = useState("");
  const [rackId, setRackId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRackId(pack?.rack_id ?? null), [pack?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = Math.max(0, Math.floor(Number(count) || 0));
  const left = pack ? Number(pack.quantity) - n * toBase(qty) : 0;

  const save = async () => {
    if (!pack || n < 1 || !(Number(qty) > 0)) return;
    setSaving(true);
    try {
      const out = await packOpsApi.split(pack.id, { pack_count: n, qty, uom_id: uomId, keep_rack: false, rack_id: rackId });
      toast.success(t("opsSplitDone", { n: out.packs.length }));
      await print(out.packs);
      choose(out.source);
      setQty("");
    } catch (e) {
      toast.error(errorText(e, t("error")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>{t("opsTabSplit")}</CardTitle></CardHeader>
      <CardContent className="space-y-4 max-w-xl">
        {pack ? <PackCard pack={pack} free={free} onClear={() => choose(null)} /> : <PackScan label={t("opsScanPack")} onPack={choose} />}
        {pack && <>
          <h3 className="font-semibold">{t("opsNewPacks")}</h3>
          <div className="space-y-1.5">
            <Label>{t("opsPackCount")}</Label>
            <Input type="number" min="1" max="100" value={count} onChange={(e) => setCount(e.target.value)} dir="ltr" className="w-32" />
          </div>
          <QtyInUnit label={t("opsQtyPerPack")} units={units} qty={qty} setQty={setQty} uomId={uomId} setUomId={setUomId} onEnter={save} />
          {Number(qty) > 0 && (
            <p className={`text-sm ${left < 0 ? "text-red-600" : "text-muted-foreground"}`}>
              {t("opsLeftInSource")}: <span dir="ltr">{fmtQty(left)} {pack.uom_code}</span>
            </p>
          )}
          <RackChoice racks={racks} rackId={rackId} setRackId={setRackId} />
          <Button onClick={save} disabled={saving || n < 1 || !(Number(qty) > 0)}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5 rtl:mr-0 rtl:ml-1.5" />}{t("opsTabSplit")}
          </Button>
        </>}
      </CardContent>
    </Card>
  );
}

// ── Merge ────────────────────────────────────────────────────────────────────

function MergeTab() {
  const { t } = useTranslation();
  const { pack: keep, free, choose } = usePackWithFree();
  const [sources, setSources] = useState<AccessoryPack[]>([]);
  const [saving, setSaving] = useState(false);

  const add = (p: AccessoryPack) => {
    if (!keep) return;
    if (p.id === keep.id || sources.some((s) => s.id === p.id)) return;
    if (p.accessory_item_id !== keep.accessory_item_id) { toast.error(t("opsSameItemOnly")); return; }
    setSources((list) => [...list, p]);
  };

  const save = async () => {
    if (!keep || sources.length === 0) return;
    setSaving(true);
    try {
      const out = await packOpsApi.merge(keep.id, sources.map((s) => s.id));
      toast.success(t("opsMergeDone", { n: sources.length, pack: keep.id }));
      setSources([]);
      choose(out.pack);
    } catch (e) {
      toast.error(errorText(e, t("error")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>{t("opsTabMerge")}</CardTitle></CardHeader>
      <CardContent className="space-y-4 max-w-xl">
        {keep
          ? <PackCard pack={keep} free={free} onClear={() => { choose(null); setSources([]); }} />
          : <PackScan label={t("opsKeepPack")} onPack={choose} />}
        {keep && <>
          <PackScan label={t("opsScanToEmpty")} onPack={add} />
          {sources.map((s) => (
            <PackCard key={s.id} pack={s} onClear={() => setSources((list) => list.filter((x) => x.id !== s.id))} />
          ))}
          <Button onClick={save} disabled={saving || sources.length === 0}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5 rtl:mr-0 rtl:ml-1.5" />}{t("opsTabMerge")}
          </Button>
        </>}
      </CardContent>
    </Card>
  );
}

// ── Reclassify (admin) ───────────────────────────────────────────────────────

function ReclassifyTab({ racks, print }: Readonly<{ racks: WarehouseRack[]; print: Print }>) {
  const { t } = useTranslation();
  const { pack, free, choose } = usePackWithFree();
  const { units, uomId, setUomId } = useUnits(pack?.accessory_item_id ?? null);
  const [target, setTarget] = useState<AccessoryItem | null>(null);
  const [picking, setPicking] = useState(false);
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [rackId, setRackId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setRackId(pack?.rack_id ?? null), [pack?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!pack || !target || !reason.trim()) return;
    setSaving(true);
    try {
      const out = await packOpsApi.reclassify(pack.id, {
        target_item_id: target.id, qty: Number(qty) > 0 ? qty : null, uom_id: uomId, reason: reason.trim(),
        keep_rack: false, rack_id: rackId,
      });
      toast.success(t("opsReclassifyDone", {
        qty: fmtQty(out.pack.quantity), uom: out.pack.uom_code, pack: out.pack.id, code: out.pack.item_code,
      }));
      await print([out.pack]);
      choose(out.source);
      setTarget(null); setQty(""); setReason("");
    } catch (e) {
      toast.error(errorText(e, t("error")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle>{t("opsTabReclassify")} <span className="text-sm font-normal text-muted-foreground">({t("opsAdminOnly")})</span></CardTitle></CardHeader>
      <CardContent className="space-y-4 max-w-xl">
        {pack ? <PackCard pack={pack} free={free} onClear={() => { choose(null); setTarget(null); }} /> : <PackScan label={t("opsScanPack")} onPack={choose} />}
        {pack && <>
          <div className="space-y-1.5">
            <Label>{t("opsTargetItem")} *</Label>
            {target
              ? <PickedItem item={target} onClear={() => setTarget(null)} />
              : <Button variant="outline" onClick={() => setPicking(true)}>{t("opsTargetItem")}</Button>}
            <p className="text-xs text-muted-foreground">{t("opsSameUnitOnly")} ({pack.uom_code})</p>
          </div>
          <QtyInUnit label={`${t("quantity")} (${t("opsFree")}: ${free ? fmtQty(free.free) : "…"})`} units={units}
            qty={qty} setQty={setQty} uomId={uomId} setUomId={setUomId} />
          <div className="space-y-1.5">
            <Label>{t("opsReasonRequired")}</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </div>
          <RackChoice racks={racks} rackId={rackId} setRackId={setRackId} />
          <Button onClick={save} disabled={saving || !target || !reason.trim()}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5 rtl:mr-0 rtl:ml-1.5" />}{t("opsTabReclassify")}
          </Button>
        </>}
      </CardContent>
      <Dialog open={picking} onOpenChange={setPicking}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader><DialogTitle>{t("opsTargetItem")}</DialogTitle></DialogHeader>
          <ItemSearch active={picking} onPick={(item) => { setTarget(item); setPicking(false); }} />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
