/**
 * Receive Packs (item 17): accessories arriving in an Accessory warehouse.
 *
 * Works like fabric roll ingestion, in three steps:
 * 1. Supplier and item, two ways:
 *    - "Load expected delivery": pick an open delivery, then one of its lines.
 *      That fills the supplier and item (nothing locks; they can still be
 *      changed). Every pack added goes to that line. "Next line" moves on.
 *    - "Search item": pick the supplier and search the item. The server puts
 *      each pack on the oldest open line for that item from that supplier
 *      (or on no delivery). A panel shows what's still expected.
 * 2. Rack (optional: no rack = put away later) and printer, then Lock.
 *    These stay set while going from line to line.
 * 3. Number of packs × quantity per pack, in any of the item's units, or in
 *    an on-the-fly conversion for this delivery (e.g. weigh: 100 g = 10 PCS).
 *    That conversion is only used here to work out the quantity; only the
 *    result (in the base unit) is saved. Add saves the packs with their
 *    ledger rows and prints their labels.
 *
 * The session table lists each Add with its packs, the delivery (batch) each
 * went to, Reprint, and Undo (the server allows it while the packs are unused).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Check, ChevronRight, Loader2, Lock, LockOpen, Plus, Printer, ScanBarcode, Search, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { Combobox, type ComboItem } from "@/components/Combobox";
import {
  ClientRefs, ItemSearch, PickedItem, QtyInUnit, ValueChips, fmtQty,
} from "@/components/accessory-items/AccessoryItemPicker";
import { useWarehouse } from "@/hooks/useWarehouse";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  accessoryItemApi, accessoryPackApi, clientApi, expectedDeliveryApi, logicalLocationApi, uomApi, warehouseRackApi,
  type AccessoryItem, type AccessoryItemUnit, type AccessoryPack, type Client, type ExpectedDelivery,
  type ExpectedDeliveryItem, type LogicalLocation, type SupplierType, type Uom, type WarehouseRack,
} from "@/lib/api";
import { generateAccessoryPackLabels, sendZplToDevice, type AccessoryPackLabelData } from "@/lib/zpl";

type Mode = "delivery" | "search";

/** The unit-select value for "Conversion for this delivery". */
const CONVERSION = -1;
/** The conversion's "from" side: a unit id, or grams (no unit row; for weighing). */
const GRAM = "g";

/** One Add of this session. */
interface Batch {
  postingId: number;
  packs: AccessoryPack[];
  item: AccessoryItem;
  uomAr: string;
  undone: boolean;
}

const remaining = (line: ExpectedDeliveryItem) =>
  Math.max(0, Number(line.expected_qty ?? 0) - Number(line.received_qty ?? 0));
const lineDone = (line: ExpectedDeliveryItem) => remaining(line) <= 0;
const accessoryLines = (d: ExpectedDelivery) => d.items.filter((i) => i.accessory_item_id != null);
const supplierKey = (type: SupplierType | null | undefined, id: number | null | undefined) =>
  type && id != null ? `${type}:${id}` : null;

const ReceivePacks = () => {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { warehouseId } = useWarehouse();

  // ── Reference data ──
  const [clients, setClients] = useState<Client[]>([]);
  const [suppliers, setSuppliers] = useState<LogicalLocation[]>([]);
  const [allUoms, setAllUoms] = useState<Uom[]>([]);
  const [deliveries, setDeliveries] = useState<ExpectedDelivery[]>([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);

  // ── Step 1 ──
  const [mode, setMode] = useState<Mode>("delivery");
  const [delivery, setDelivery] = useState<ExpectedDelivery | null>(null);
  const [lineId, setLineId] = useState<number | null>(null);
  const [supplier, setSupplier] = useState<string | null>(null); // "client:3" | "logical_location:7"
  const [item, setItem] = useState<AccessoryItem | null>(null);
  const [units, setUnits] = useState<AccessoryItemUnit[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Step 2 ──
  const [rackInput, setRackInput] = useState("");
  const [rack, setRack] = useState<WarehouseRack | null>(null);
  const [rackError, setRackError] = useState<string | null>(null);
  const [rackLoading, setRackLoading] = useState(false);
  const [printers, setPrinters] = useState<BrowserPrint.Device[]>([]);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [printer, setPrinter] = useState<BrowserPrint.Device | null>(null);
  const [labelCopies, setLabelCopies] = useState("1");
  const [locked, setLocked] = useState(false);

  // ── Step 3 ──
  const [packCount, setPackCount] = useState("1");
  const [qty, setQty] = useState("");
  const [uomId, setUomId] = useState<number | null>(null);
  const [convFromQty, setConvFromQty] = useState("");
  const [convFromUnit, setConvFromUnit] = useState<string>(GRAM);
  const [convToQty, setConvToQty] = useState("");
  const [adding, setAdding] = useState(false);
  const [printError, setPrintError] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const qtyRef = useRef<HTMLInputElement>(null);

  // ── Loading ──
  useEffect(() => {
    clientApi.getAll().then((c) => setClients([...c].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
    logicalLocationApi.getAll({ limit: 1000 })
      .then((l) => setSuppliers(l.filter((x) => x.location_type === "supplier").sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
    uomApi.getAll(true).then(setAllUoms).catch(() => {});
    if (typeof BrowserPrint === "undefined") return;
    setPrintersLoading(true);
    BrowserPrint.getLocalDevices(
      (devices) => { setPrinters(devices as BrowserPrint.Device[]); setPrintersLoading(false); },
      () => setPrintersLoading(false),
      "printer",
    );
  }, []);

  const loadDeliveries = useCallback(async () => {
    if (warehouseId === null) return [];
    setDeliveriesLoading(true);
    try {
      const list = await expectedDeliveryApi.getAll({ warehouse_id: warehouseId, open_only: true, limit: 500 });
      const withLines = list.filter((d) => accessoryLines(d).length > 0);
      setDeliveries(withLines);
      return withLines;
    } catch {
      setDeliveries([]);
      return [];
    } finally {
      setDeliveriesLoading(false);
    }
  }, [warehouseId]);

  useEffect(() => { loadDeliveries(); }, [loadDeliveries]);

  const loadUnits = (itemId: number) => {
    setUnits([]); setUomId(null);
    accessoryItemApi.units(itemId).then((u) => { setUnits(u); if (u.length) setUomId(u[0].uom_id); }).catch(() => setUnits([]));
  };

  const chooseItem = (picked: AccessoryItem) => {
    setItem(picked);
    loadUnits(picked.id);
    // A different item than the line's: the line no longer applies (auto-match takes over).
    const line = delivery?.items.find((l) => l.id === lineId);
    if (line && line.accessory_item_id !== picked.id) setLineId(null);
  };

  // ── Step 1: delivery mode ──
  const chooseLine = async (d: ExpectedDelivery, line: ExpectedDeliveryItem) => {
    setDelivery(d);
    setLineId(line.id);
    setSupplier(supplierKey(d.supplier_type, d.client_supplier_id));
    setPackCount("1");
    setQty(remaining(line) > 0 ? String(remaining(line)) : "");
    if (line.accessory_item_id !== item?.id) {
      try {
        chooseItem(await accessoryItemApi.get(line.accessory_item_id!));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("error"));
      }
    }
    qtyRef.current?.focus();
  };

  const openLine = delivery?.items.find((l) => l.id === lineId) ?? null;

  const nextLine = () => {
    if (!delivery) return;
    const lines = accessoryLines(delivery);
    const at = lines.findIndex((l) => l.id === lineId);
    const next = [...lines.slice(at + 1), ...lines.slice(0, Math.max(0, at))].find((l) => !lineDone(l));
    if (next) chooseLine(delivery, next);
  };

  const pickDelivery = (id: number) => {
    const d = deliveries.find((x) => x.id === id) ?? null;
    setDelivery(d);
    setLineId(null);
    const first = d ? accessoryLines(d).find((l) => !lineDone(l)) : undefined;
    if (d && first) chooseLine(d, first);
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setLineId(null);
    if (m === "search") setDelivery(null);
  };

  // ── Supplier picker: suppliers with open deliveries first ──
  const supplierItems = useMemo((): ComboItem<string>[] => {
    const open = new Set(deliveries.map((d) => supplierKey(d.supplier_type, d.client_supplier_id)).filter(Boolean));
    const all: ComboItem<string>[] = [
      ...suppliers.map((s) => ({ id: `logical_location:${s.id}`, label: s.name })),
      ...clients.map((c) => ({ id: `client:${c.id}`, label: `${c.name} (${t("client")})` })),
    ];
    return [
      ...all.filter((x) => open.has(x.id)).map((x) => ({ ...x, group: t("rpWithOpenDeliveries") })),
      ...all.filter((x) => !open.has(x.id)).map((x) => ({ ...x, group: t("rpOtherSuppliers") })),
    ];
  }, [deliveries, suppliers, clients, t]);

  const [supplierType, supplierId] = supplier
    ? [supplier.split(":")[0] as SupplierType, Number(supplier.split(":")[1])]
    : [null, null];

  // Search mode: this supplier's open lines for the item (what the server will match to).
  const expectedLines = useMemo(() => {
    if (!item || !supplier) return [];
    return deliveries
      .filter((d) => supplierKey(d.supplier_type, d.client_supplier_id) === supplier)
      .flatMap((d) => d.items.filter((l) => l.accessory_item_id === item.id).map((l) => ({ d, l })));
  }, [deliveries, supplier, item]);

  // ── Step 2: rack ──
  const resolveRack = async (lookup: () => Promise<WarehouseRack | undefined>) => {
    setRackLoading(true); setRackError(null);
    try {
      const found = await lookup();
      if (!found) throw new Error(t("error"));
      setRack(found);
      setRackInput("");
    } catch (e) {
      setRackError(e instanceof Error ? e.message : t("error"));
    } finally {
      setRackLoading(false);
    }
  };
  const rackByCode = () => {
    const code = rackInput.trim();
    if (code) resolveRack(async () => (await warehouseRackApi.searchByCode(code, warehouseId ?? undefined))[0]);
  };
  const onRackInput = (val: string) => {
    if (val.endsWith("*R")) { // scanned rack label
      const id = Number.parseInt(val.slice(0, -2), 10);
      if (!Number.isNaN(id)) { resolveRack(() => warehouseRackApi.getById(id)); return; }
    }
    setRackInput(val);
  };

  // ── Step 3: quantity in base units ──
  const base = units.find((u) => u.is_base) ?? null;
  const usingConversion = uomId === CONVERSION;
  const perPackBase = useMemo((): { value: number; rounded: boolean } | null => {
    const n = Number(qty);
    if (!(n > 0) || !base) return null;
    let value: number;
    if (usingConversion) {
      const from = Number(convFromQty);
      const to = Number(convToQty);
      if (!(from > 0) || !(to > 0)) return null;
      value = (n * to) / from;
    } else {
      const unit = units.find((u) => u.uom_id === uomId);
      if (!unit) return null;
      value = n * Number(unit.factor);
    }
    if (!base.allows_decimals && usingConversion) {
      const whole = Math.round(value);
      return { value: whole, rounded: whole !== value };
    }
    return { value: Math.round(value * 10000) / 10000, rounded: false };
  }, [qty, base, usingConversion, convFromQty, convToQty, units, uomId]);

  const count = Math.max(0, Math.floor(Number(packCount) || 0));

  const labelData = (pack: AccessoryPack, of: AccessoryItem, uomAr: string): AccessoryPackLabelData => ({
    packId: pack.id,
    quantity: fmtQty(pack.quantity),
    uomAr,
    itemCode: pack.item_code,
    clientRef: of.client_refs?.[0]?.ref_code ?? null,
    supplierRef: (of.refs.find((r) => r.supplier_id != null && r.supplier_id === pack.client_supplier_id)
      ?? of.refs.find((r) => r.supplier_id != null))?.ref_code ?? null,
    color: pack.item_color,
    size: pack.item_size,
    description: pack.item_description,
    variantLines: pack.value_lines.map((v) => ({ label: v.label_en, value: v.value })),
    batchNo: pack.batch_no,
  });

  const print = (packs: AccessoryPack[], of: AccessoryItem, uomAr: string) => {
    if (!printer) return;
    const copies = Math.max(1, Number.parseInt(labelCopies, 10) || 1);
    const labels = packs.flatMap((p) => Array.from({ length: copies }, () => labelData(p, of, uomAr)));
    setPrintError(false);
    sendZplToDevice(printer, generateAccessoryPackLabels(labels)).catch((err) => {
      console.error("Pack label print failed", err);
      setPrintError(true);
    });
  };

  /** After an Add or Undo: fresh received numbers for the lines and the panel. */
  const refreshDeliveries = async () => {
    const list = await loadDeliveries();
    if (delivery) {
      const fresh = list.find((d) => d.id === delivery.id)
        ?? await expectedDeliveryApi.getById(delivery.id).catch(() => delivery);
      setDelivery(fresh);
    }
  };

  const handleAdd = async () => {
    if (!item || !base || warehouseId === null || adding) return;
    if (usingConversion && !(Number(convFromQty) > 0 && Number(convToQty) > 0)) { toast.error(t("rpSetConversion")); return; }
    if (!perPackBase || count < 1) { toast.error(t("accEnterQty")); return; }
    setAdding(true);
    try {
      const out = await accessoryPackApi.receive({
        warehouse_id: warehouseId,
        accessory_item_id: item.id,
        supplier_type: supplierType,
        client_supplier_id: supplierId,
        rack_id: rack?.id ?? null,
        expected_delivery_item_id: mode === "delivery" ? lineId : null,
        pack_count: count,
        qty_per_pack: usingConversion ? String(perPackBase.value) : qty,
        uom_id: usingConversion ? null : uomId,
      });
      const uomAr = base.name_ar;
      setBatches((prev) => [{ postingId: out.posting_id, packs: out.packs, item, uomAr, undone: false }, ...prev]);
      print(out.packs, item, uomAr);
      toast.success(t("rpReceivedToast", { count: String(out.packs.length) }));
      setQty("");
      setPackCount("1");
      await refreshDeliveries();
      qtyRef.current?.focus();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("error"));
    } finally {
      setAdding(false);
    }
  };

  const handleUndo = async (batch: Batch) => {
    try {
      await accessoryPackApi.undoReceive(batch.postingId);
      setBatches((prev) => prev.map((b) => (b.postingId === batch.postingId ? { ...b, undone: true } : b)));
      toast.success(t("rpUndone"));
      await refreshDeliveries();
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : t("error"));
    }
  };

  const handleReset = () => {
    setDelivery(null); setLineId(null); setSupplier(null); setItem(null); setUnits([]);
    setRack(null); setRackInput(""); setRackError(null); setLocked(false);
    setPackCount("1"); setQty(""); setUomId(null); setConvFromQty(""); setConvToQty(""); setConvFromUnit(GRAM);
    setBatches([]); setPrintError(false);
  };

  const packTotal = batches.filter((b) => !b.undone).reduce((n, b) => n + b.packs.length, 0);
  const unitName = (u: { name_en: string; name_ar: string }) => (language === "ar" ? u.name_ar : u.name_en);

  // ── Rendering ──
  const deliveryLabel = (d: ExpectedDelivery) =>
    [`#${d.id}`, d.supplier_name ?? "—", d.expected_date ? new Date(d.expected_date).toLocaleDateString() : null,
      t("rpLineCount", { count: String(accessoryLines(d).length) })].filter(Boolean).join(" · ");

  const lineRows = (d: ExpectedDelivery) => (
    <div className="rounded-md border divide-y">
      {accessoryLines(d).map((line) => {
        const active = line.id === lineId;
        const done = lineDone(line);
        return (
          <button
            key={line.id} type="button" onClick={() => chooseLine(d, line)}
            className={`w-full text-start px-3 py-2 grid gap-x-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] items-center transition-colors ${
              active ? "bg-primary/10 ring-1 ring-primary" : "hover:bg-muted"}`}
          >
            <div className="min-w-0">
              <span className="font-mono text-sm font-medium">{line.item_code}</span>{" "}
              <span className="text-sm">{line.item_description}</span>
              <div className="text-xs text-muted-foreground">{[line.item_color, line.item_size].filter(Boolean).join(" · ")}</div>
              <ValueChips values={line.value_lines ?? []} />
              <ClientRefs refs={line.client_refs ?? []} inline />
            </div>
            <div className="text-xs font-mono space-y-0.5" dir="ltr">
              <div>{t("accExpectedQty")}: {fmtQty(line.expected_qty)} {line.uom_code}</div>
              <div>{t("accReceivedQty")}: {fmtQty(line.received_qty ?? 0)} {line.uom_code}</div>
              <div className={done ? "" : "font-semibold"}>{t("rpStillDue")}: {fmtQty(remaining(line))} {line.uom_code}</div>
            </div>
            <div>
              {done && (
                <Badge variant="outline" className="gap-1 text-green-700 border-green-400">
                  <Check className="h-3 w-3" /> {t("rpLineDone")}
                </Badge>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-8 min-w-0">
          <div className="space-y-6 max-w-6xl">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h1 className="text-3xl font-bold tracking-tight">{t("receivePacks")}</h1>
              <div className="flex gap-2">
                {warehouseId !== null && (
                  <Button variant="outline" asChild>
                    <Link to={`/accessory-inventory?warehouse=${warehouseId}`}>{t("rpOpenInventory")}</Link>
                  </Button>
                )}
                <Button variant="outline" onClick={handleReset}>{t("resetSession")}</Button>
              </div>
            </div>

            {/* ── STEP 1: supplier + item ───────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <CardTitle className="text-base">{t("rpStep1")}</CardTitle>
                  <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)}>
                    <TabsList>
                      <TabsTrigger value="delivery">{t("rpModeDelivery")}</TabsTrigger>
                      <TabsTrigger value="search">{t("rpModeSearch")}</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {mode === "delivery" && (
                  <>
                    <div className="space-y-1.5 max-w-xl">
                      <Label>{t("rpPickDelivery")}</Label>
                      {deliveriesLoading && deliveries.length === 0 ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : deliveries.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t("rpNoOpenDeliveries")}</p>
                      ) : (
                        <Combobox
                          items={deliveries.map((d) => ({ id: d.id, label: deliveryLabel(d) }))}
                          value={delivery?.id ?? null} onSelect={pickDelivery} placeholder={t("rpPickDelivery")}
                        />
                      )}
                    </div>
                    {delivery && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">{t("rpDeliveryLines", { id: String(delivery.id) })}</p>
                          <Button size="sm" variant="outline" onClick={nextLine}
                            disabled={!accessoryLines(delivery).some((l) => !lineDone(l) && l.id !== lineId)}>
                            {t("rpNextLine")} <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                          </Button>
                        </div>
                        {lineRows(delivery)}
                      </div>
                    )}
                  </>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>{t("supplier")}{mode === "search" ? " *" : ""}</Label>
                    <Combobox
                      items={supplierItems} value={supplier} placeholder={t("supplier")}
                      onSelect={(id) => { setSupplier(id); if (openLine) setLineId(null); }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("accessory")} *</Label>
                    {item ? (
                      <PickedItem item={item} onClear={() => { setItem(null); setUnits([]); setLineId(null); }} />
                    ) : (
                      <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setPickerOpen(true)}>
                        <Search className="h-4 w-4" /> {t("accSearchItemRefs")}
                      </Button>
                    )}
                    {item && (
                      <Button size="sm" variant="link" className="px-0" onClick={() => setPickerOpen(true)}>
                        <Search className="h-3 w-3 me-1" /> {t("rpModeSearch")}
                      </Button>
                    )}
                  </div>
                </div>

                {openLine && delivery && (
                  <p className="text-sm text-green-700 flex items-center gap-1">
                    <Check className="h-4 w-4" /> {t("rpLinkedLine", { id: String(delivery.id) })}
                  </p>
                )}

                {mode === "search" && item && supplier && (
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium">{t("rpOpenLines")}</p>
                    {expectedLines.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("rpNoOpenLines")}</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("linkedDelivery")}</TableHead>
                            <TableHead className="text-right">{t("accExpectedQty")}</TableHead>
                            <TableHead className="text-right">{t("accReceivedQty")}</TableHead>
                            <TableHead className="text-right">{t("rpStillDue")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {expectedLines.map(({ d, l }) => (
                            <TableRow key={l.id}>
                              <TableCell>
                                {t("matchedToDelivery", { id: String(d.id) })}
                                {d.expected_date && <span className="text-xs text-muted-foreground"> · {new Date(d.expected_date).toLocaleDateString()}</span>}
                              </TableCell>
                              <TableCell className="text-right font-mono" dir="ltr">{fmtQty(l.expected_qty)} {l.uom_code}</TableCell>
                              <TableCell className="text-right font-mono" dir="ltr">{fmtQty(l.received_qty ?? 0)} {l.uom_code}</TableCell>
                              <TableCell className="text-right font-mono font-semibold" dir="ltr">{fmtQty(remaining(l))} {l.uom_code}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── STEP 2: rack + printer ─────────────────────────────────── */}
            <Card className={locked ? "border-green-500/50 bg-green-50/30 dark:bg-green-950/10" : ""}>
              <CardHeader className="pb-3"><CardTitle className="text-base">{t("rpStep2")}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1"><ScanBarcode className="h-4 w-4" /> {t("rpRackOptional")}</Label>
                  {rack ? (
                    <div className="flex items-center gap-2">
                      <Badge className="text-sm px-3 py-1">{rack.rack_code}</Badge>
                      {!locked && (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setRack(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        placeholder={t("enterRackCode")} value={rackInput} disabled={locked} className="max-w-xs"
                        onChange={(e) => onRackInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rackByCode()}
                      />
                      <Button variant="outline" onClick={rackByCode} disabled={locked || rackLoading || !rackInput.trim()}>
                        {rackLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : t("confirm")}
                      </Button>
                    </div>
                  )}
                  {rackError && <p className="text-sm text-destructive">{rackError}</p>}
                </div>

                <div className="flex items-end gap-2 flex-wrap">
                  <div className="space-y-1">
                    <Label className="flex items-center gap-1 text-sm"><Printer className="h-3.5 w-3.5" /> {t("selectPrinter")}</Label>
                    <Select value={printer?.uid ?? ""} disabled={locked}
                      onValueChange={(uid) => setPrinter(printers.find((p) => p.uid === uid) ?? null)}>
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder={printersLoading ? t("loadingPrinters") : t("selectPrinter")} />
                      </SelectTrigger>
                      <SelectContent>
                        {printers.map((p) => <SelectItem key={p.uid} value={p.uid}>{p.name}</SelectItem>)}
                        {!printersLoading && printers.length === 0 && (
                          <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("noPrintersFound")}</div>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-sm">{t("rpLabelsPerPack")}</Label>
                    <Input type="number" min={1} value={labelCopies} disabled={locked}
                      onChange={(e) => setLabelCopies(e.target.value)} className="w-24" />
                  </div>
                  {locked ? (
                    <Button variant="outline" onClick={() => setLocked(false)} className="gap-2">
                      <LockOpen className="h-4 w-4" /> {t("unlockDetails")}
                    </Button>
                  ) : (
                    <Button onClick={() => setLocked(true)} className="gap-2">
                      <Lock className="h-4 w-4" /> {t("lockDetails")}
                    </Button>
                  )}
                </div>
                {!printer && <p className="text-xs text-muted-foreground">{t("noPrinterSelectedHint")}</p>}
              </CardContent>
            </Card>

            {/* ── STEP 3: add packs ──────────────────────────────────────── */}
            {locked && item && base && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2"><Plus className="h-4 w-4" /> {t("rpStep3")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-[8rem_minmax(0,1fr)]">
                    <div className="space-y-1.5">
                      <Label>{t("rpPackCount")} *</Label>
                      <Input type="number" min={1} max={200} value={packCount} dir="ltr"
                        onChange={(e) => setPackCount(e.target.value)} />
                    </div>
                    <QtyInUnit
                      label={t("rpQtyPerPack")} units={units} qty={qty} setQty={setQty} uomId={uomId} setUomId={setUomId}
                      inputRef={qtyRef} onEnter={handleAdd}
                      extraUnits={<SelectItem value={String(CONVERSION)}>{t("rpConversion")}…</SelectItem>}
                    />
                  </div>

                  {usingConversion && (
                    <div className="rounded-md border p-3 space-y-2">
                      <Label>{t("rpConversion")}</Label>
                      <div className="flex items-center gap-2 flex-wrap" dir="ltr">
                        <Input type="number" min="0" step="any" value={convFromQty} className="w-28"
                          onChange={(e) => setConvFromQty(e.target.value)} />
                        <Select value={convFromUnit} onValueChange={setConvFromUnit}>
                          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={GRAM}>g · {t("rpGram")}</SelectItem>
                            {allUoms.filter((u) => u.id !== base.uom_id).map((u) => (
                              <SelectItem key={u.id} value={String(u.id)}>{u.code} · {unitName(u)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span>=</span>
                        <Input type="number" min="0" step="any" value={convToQty} className="w-28"
                          onChange={(e) => setConvToQty(e.target.value)} />
                        <span className="text-sm">{base.code} · {unitName(base)}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{t("rpConversionHint")}</p>
                    </div>
                  )}

                  {perPackBase && (usingConversion || uomId !== base.uom_id) && (
                    <p className="text-sm text-muted-foreground" dir="ltr">
                      {perPackBase.rounded
                        ? t("rpRounded", { qty: fmtQty(perPackBase.value), unit: base.code })
                        : t("accEqualsBase", { qty: fmtQty(perPackBase.value), unit: base.code })}
                    </p>
                  )}
                  {printError && <p className="text-sm text-amber-600">{t("rpPrintFailed")}</p>}

                  <Button onClick={handleAdd} disabled={adding || !perPackBase || count < 1 || (mode === "search" && !supplier)} className="gap-2">
                    {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {t("rpAddPacks", { count: String(count || 0) })}
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ── Session ────────────────────────────────────────────────── */}
            {batches.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">{t("rpPacksThisSession", { count: String(packTotal) })}</CardTitle>
                </CardHeader>
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("accInvPack")}</TableHead>
                        <TableHead>{t("accItemCode")}</TableHead>
                        <TableHead className="text-right">{t("quantity")}</TableHead>
                        <TableHead>{t("rack")}</TableHead>
                        <TableHead>{t("linkedDelivery")}</TableHead>
                        <TableHead>{t("accBatch")}</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {batches.map((b) => b.packs.map((p, i) => (
                        <TableRow key={p.id} className={b.undone ? "opacity-50 line-through" : ""}>
                          <TableCell className="font-mono" dir="ltr">{p.id}</TableCell>
                          <TableCell className="font-mono">{p.item_code}</TableCell>
                          <TableCell className="text-right font-mono" dir="ltr">{fmtQty(p.quantity)} {p.uom_code}</TableCell>
                          <TableCell>{p.rack_code ?? <span className="text-muted-foreground">{t("accInvWaitingPutaway")}</span>}</TableCell>
                          <TableCell>
                            {p.delivery_id != null ? (
                              <Badge variant="outline" className="gap-1 text-green-700 border-green-400">
                                <Check className="h-3 w-3" /> {t("matchedToDelivery", { id: String(p.delivery_id) })}
                              </Badge>
                            ) : <span className="text-muted-foreground">{t("rpNoDelivery")}</span>}
                          </TableCell>
                          <TableCell className="font-mono" dir="ltr">{p.batch_no ?? "—"}</TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1"
                                disabled={!printer || b.undone} title={!printer ? t("noPrinterSelectedHint") : undefined}
                                onClick={() => print([p], b.item, b.uomAr)}>
                                <Printer className="h-3 w-3" /> {t("reprintLabel")}
                              </Button>
                              {i === 0 && !b.undone && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive">
                                      <Undo2 className="h-3 w-3" /> {t("rpUndo")}
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        {t("rpUndoTitle", { ids: b.packs.map((x) => x.id).join(", ") })}
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>{t("rpUndoDesc")}</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                      <AlertDialogAction
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        onClick={() => handleUndo(b)}
                                      >
                                        {t("rpUndo")}
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      )))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>

      {/* Item search: wide, so values and client codes fit */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader><DialogTitle>{t("rpModeSearch")}</DialogTitle></DialogHeader>
          <ItemSearch active={pickerOpen} onPick={(picked) => { chooseItem(picked); setPickerOpen(false); }} />
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
};

export default ReceivePacks;
