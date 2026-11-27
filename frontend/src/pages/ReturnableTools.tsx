/**
 * Returnable Tools (item 33): folders, presser feet, machine equipment.
 *
 * Tools are never used up: each one is in the warehouse or out with a worker.
 * An item is a tool when its category is "tracked" (Units & Categories).
 * Two tabs:
 *  - Tools: one row per tool item in this warehouse with owned / in stock /
 *    out / retired; open a row to see its pieces or packs (barcode, serial
 *    no., rack, supplier) and reprint a label.
 *  - Add tools: pick a tool item. "One barcode per piece" items: enter how
 *    many pieces (+ serial numbers), one label each. Other tools are kept in
 *    tracked packs: make a new pack with a quantity (one label), or scan an
 *    existing pack and add more to it (no new label). What was added shows
 *    below with Undo, for this session only (leaving the page ends it).
 * Check-out / check-in to a worker and retire come in item 34.
 * Reading: every role. Adding needs `receive_accessories`.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronRight, Loader2, Plus, Printer, Undo2 } from "lucide-react";
import { toast } from "sonner";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, type ComboItem } from "@/components/Combobox";
import { ItemSearch, PickedItem, fmtQty } from "@/components/accessory-items/AccessoryItemPicker";
import { usePackLabelPrinter } from "@/hooks/usePackLabelPrinter";
import { useWarehouse } from "@/hooks/useWarehouse";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTranslation } from "@/hooks/useTranslation";
import {
  clientApi, logicalLocationApi, returnableToolApi, warehouseRackApi,
  type AccessoryItem, type Client, type LogicalLocation, type ReturnableAdded,
  type ReturnableSummaryRow, type ReturnableUnit, type WarehouseRack,
} from "@/lib/api";

type Tab = "list" | "add";
type Printing = ReturnType<typeof usePackLabelPrinter>;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

/** Suppliers and clients (a client can supply its own tools), as "type:id". */
function useSuppliers() {
  const { t } = useTranslation();
  const [clients, setClients] = useState<Client[]>([]);
  const [suppliers, setSuppliers] = useState<LogicalLocation[]>([]);
  useEffect(() => {
    clientApi.getAll().then((c) => setClients([...c].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
    logicalLocationApi.getAll({ limit: 1000 })
      .then((l) => setSuppliers(l.filter((x) => x.location_type === "supplier").sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => {});
  }, []);
  return useMemo((): ComboItem<string>[] => [
    ...suppliers.map((s) => ({ id: `logical_location:${s.id}`, label: s.name })),
    ...clients.map((c) => ({ id: `client:${c.id}`, label: `${c.name} (${t("client")})` })),
  ], [suppliers, clients, t]);
}

function Numbers({ row }: Readonly<{ row: Pick<ReturnableUnit, "owned" | "in_stock" | "out" | "retired"> }>) {
  return (
    <>
      <TableCell className="text-right tabular-nums">{fmtQty(row.owned)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtQty(row.in_stock)}</TableCell>
      <TableCell className="text-right tabular-nums">{fmtQty(row.out)}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{fmtQty(row.retired)}</TableCell>
    </>
  );
}

function NumberHeads() {
  const { t } = useTranslation();
  return (
    <>
      <TableHead className="text-right">{t("toolsOwned")}</TableHead>
      <TableHead className="text-right">{t("toolsInStock")}</TableHead>
      <TableHead className="text-right">{t("toolsOut")}</TableHead>
      <TableHead className="text-right">{t("toolsRetired")}</TableHead>
    </>
  );
}

/** The pieces / packs of one item, with a reprint button each. */
function UnitsTable({ units, printing, actions }: Readonly<{
  units: ReturnableUnit[]; printing: Printing; actions?: (u: ReturnableUnit) => React.ReactNode;
}>) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("toolsLabel")}</TableHead>
          <TableHead>{t("accItemCode")}</TableHead>
          <TableHead>{t("toolsSerialNo")}</TableHead>
          <TableHead>{t("rack")}</TableHead>
          <TableHead>{t("supplier")}</TableHead>
          <NumberHeads />
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {units.map((u, i) => (
          <TableRow key={`${u.id}-${i}`}>
            <TableCell className="font-mono">{u.barcode}</TableCell>
            <TableCell>
              <div className="font-mono text-xs">{u.item_code}</div>
              <div className="text-xs text-muted-foreground">{u.is_individual ? t("toolsPiece") : t("toolsPack")}</div>
            </TableCell>
            <TableCell>{u.serial_no ?? "-"}</TableCell>
            <TableCell>{u.rack_code ?? t("accInvNoRack")}</TableCell>
            <TableCell>{u.supplier_name ?? "-"}</TableCell>
            <Numbers row={u} />
            <TableCell className="text-right whitespace-nowrap">
              <Button size="sm" variant="ghost" onClick={() => printing.printTools([u])} title={t("reprintLabel")}>
                <Printer className="h-4 w-4" />
              </Button>
              {actions?.(u)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ToolsList({ warehouseId, printing }: Readonly<{ warehouseId: number; printing: Printing }>) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<ReturnableSummaryRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [units, setUnits] = useState<ReturnableUnit[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      returnableToolApi.summary(warehouseId, q.trim() || undefined).then(setRows).catch((e) => toast.error(errorText(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [warehouseId, q]);

  const toggle = (itemId: number) => {
    if (open === itemId) { setOpen(null); return; }
    setOpen(itemId);
    setUnits([]);
    returnableToolApi.units(warehouseId, itemId).then(setUnits).catch((e) => toast.error(errorText(e)));
  };

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="max-w-sm" />
        {rows === null ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("toolsNone")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>{t("accItemCode")}</TableHead>
                <TableHead>{t("accDescription")}</TableHead>
                <TableHead>{t("toolsKind")}</TableHead>
                <TableHead className="text-right">{t("toolsLabels")}</TableHead>
                <NumberHeads />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <Fragment key={r.accessory_item_id}>
                  <TableRow className="cursor-pointer" onClick={() => toggle(r.accessory_item_id)}>
                    <TableCell>
                      {open === r.accessory_item_id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 rtl:rotate-180" />}
                    </TableCell>
                    <TableCell className="font-mono">{r.item_code}</TableCell>
                    <TableCell>
                      {r.item_description}
                      {(r.item_color || r.item_size) && (
                        <span className="text-xs text-muted-foreground"> · {[r.item_color, r.item_size].filter(Boolean).join(" · ")}</span>
                      )}
                    </TableCell>
                    <TableCell><Badge variant="outline">{r.is_individual ? t("toolsPiece") : t("toolsPack")}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{r.labels}</TableCell>
                    <Numbers row={r} />
                  </TableRow>
                  {open === r.accessory_item_id && (
                    <TableRow>
                      <TableCell colSpan={9} className="bg-muted/30">
                        <UnitsTable units={units} printing={printing} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AddTools({ warehouseId, printing }: Readonly<{ warehouseId: number; printing: Printing }>) {
  const { t } = useTranslation();
  const racks = useRacks(warehouseId);
  const supplierItems = useSuppliers();
  const [item, setItem] = useState<AccessoryItem | null>(null);
  const [mode, setMode] = useState<"new" | "topup">("new");
  const [count, setCount] = useState("1");
  const [qty, setQty] = useState("");
  const [serials, setSerials] = useState<string[]>([]);
  const [rackId, setRackId] = useState<string>("none");
  const [supplier, setSupplier] = useState<string | null>(null);
  const [remarks, setRemarks] = useState("");
  const [scan, setScan] = useState("");
  const [target, setTarget] = useState<ReturnableUnit | null>(null);
  const [saving, setSaving] = useState(false);
  // This session's Adds, newest first: what Undo can cancel.
  const [session, setSession] = useState<(ReturnableAdded & { qty: string })[]>([]);

  const pieces = Boolean(item?.is_individual_tool);
  const n = Math.max(0, Math.min(500, Math.floor(Number(count) || 0)));

  const reset = () => { setCount("1"); setQty(""); setSerials([]); setTarget(null); setScan(""); };
  const pick = (picked: AccessoryItem) => { setItem(picked); setMode("new"); reset(); };

  const scanPack = async () => {
    if (!scan.trim() || !item) return;
    try {
      const unit = await returnableToolApi.scan(scan.trim());
      if (unit.accessory_item_id !== item.id || unit.is_individual) { toast.error(t("toolsOtherItem")); return; }
      if (unit.warehouse_id !== warehouseId) { toast.error(t("toolsOtherItem")); return; }
      setTarget(unit);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setScan("");
    }
  };

  const add = async () => {
    if (!item) return;
    setSaving(true);
    try {
      if (mode === "topup") {
        if (!target) return;
        const made = await returnableToolApi.topUp(target.id, Number(qty));
        setSession((s) => [{ ...made, qty }, ...s]);
        setTarget(made.unit);
      } else {
        const [supplierType, supplierId] = supplier ? supplier.split(":") : [null, null];
        const made = await returnableToolApi.add({
          warehouse_id: warehouseId,
          accessory_item_id: item.id,
          ...(pieces ? { count: n, serial_nos: serials.slice(0, n).map((s) => s.trim() || null) } : { qty: Number(qty) }),
          rack_id: rackId === "none" ? null : Number(rackId),
          supplier_type: supplierType as "client" | "logical_location" | null,
          client_supplier_id: supplierId === null ? null : Number(supplierId),
          remarks: remarks.trim() || null,
        });
        setSession((s) => [...made.map((m) => ({ ...m, qty: m.unit.owned })).reverse(), ...s]);
        await printing.printTools(made.map((m) => m.unit));
        reset();
      }
      toast.success(t("toolsAdded"));
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const undo = async (row: ReturnableAdded) => {
    try {
      await returnableToolApi.undoAdd(row.movement_id);
      setSession((s) => s.filter((x) => x.movement_id !== row.movement_id));
      toast.success(t("toolsUndone"));
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const canAdd = item !== null && !saving && (
    mode === "topup" ? target !== null && Number(qty) > 0 : pieces ? n >= 1 : Number(qty) > 0
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1.5">
            <Label>{t("toolsItem")} *</Label>
            {item
              ? <PickedItem item={item} onClear={() => { setItem(null); reset(); }} />
              : <ItemSearch tools onPick={pick} />}
          </div>

          {item && !pieces && (
            <div className="flex gap-2">
              <Button variant={mode === "new" ? "default" : "outline"} size="sm" onClick={() => { setMode("new"); reset(); }}>
                {t("toolsNewPack")}
              </Button>
              <Button variant={mode === "topup" ? "default" : "outline"} size="sm" onClick={() => { setMode("topup"); reset(); }}>
                {t("toolsTopUp")}
              </Button>
            </div>
          )}

          {item && mode === "topup" && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{t("toolsScanPack")}</Label>
                {target ? (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono">{target.barcode}</span>
                    <span className="text-muted-foreground">{t("toolsOwned")}: {fmtQty(target.owned)} {target.uom_code}</span>
                    <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>{t("cancel")}</Button>
                  </div>
                ) : (
                  <Input value={scan} autoFocus onChange={(e) => setScan(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && scanPack()} placeholder="57*TL" />
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t("toolsQtyToAdd")} *</Label>
                <Input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
            </div>
          )}

          {item && mode === "new" && (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {pieces ? (
                  <div className="space-y-1.5">
                    <Label>{t("toolsCount")} *</Label>
                    <Input type="number" min={1} max={500} step={1} value={count} onChange={(e) => setCount(e.target.value)} />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label>{t("toolsQtyInPack")} *</Label>
                    <Input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label>{t("rpRackOptional")}</Label>
                  <Select value={rackId} onValueChange={setRackId}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("accInvNoRack")}</SelectItem>
                      {racks.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.rack_code}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("supplier")} ({t("optional")})</Label>
                  <Combobox items={supplierItems} value={supplier} placeholder={t("supplier")} onSelect={setSupplier} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("remarks")}</Label>
                  <Input value={remarks} maxLength={500} onChange={(e) => setRemarks(e.target.value)} />
                </div>
              </div>
              {pieces && n > 0 && (
                <div className="space-y-1.5">
                  <Label>{t("toolsSerialNo")} ({t("toolsSerialHint")})</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6">
                    {Array.from({ length: Math.min(n, 100) }, (_, i) => (
                      <Input key={i} value={serials[i] ?? ""} maxLength={100} placeholder={`${i + 1}`}
                        onChange={(e) => setSerials((s) => { const next = [...s]; next[i] = e.target.value; return next; })} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {item && (
            <div className="flex justify-end">
              <Button onClick={add} disabled={!canAdd}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ms-1">{pieces ? t("toolsAddPieces", { count: String(n) }) : t("toolsAddButton")}</span>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {session.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t("toolsAddedNow")}</CardTitle></CardHeader>
          <CardContent>
            <UnitsTable
              units={session.map((s) => s.unit)}
              printing={printing}
              actions={(u) => {
                const row = session.find((s) => s.unit === u);
                return row && (
                  <Button size="sm" variant="ghost" onClick={() => undo(row)} title={t("rpUndo")}>
                    <Undo2 className="h-4 w-4" />
                  </Button>
                );
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function ReturnableTools() {
  const { t } = useTranslation();
  const { warehouseId } = useWarehouse();
  const { can } = useCurrentUser();
  const canAdd = can("receive_accessories");
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "add" && canAdd ? "add" : "list";
  const printing = usePackLabelPrinter();

  const setTab = useCallback((next: string) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  }, [params, setParams]);

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-4 md:p-8 min-w-0 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t("returnableTools")}</h1>
              <p className="text-muted-foreground text-sm">{t("toolsDesc")}</p>
            </div>
            <div className="w-full sm:w-64">
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
              <TabsList>
                <TabsTrigger value="list">{t("toolsTabList")}</TabsTrigger>
                {canAdd && <TabsTrigger value="add">{t("toolsTabAdd")}</TabsTrigger>}
              </TabsList>
              <TabsContent value="list"><ToolsList warehouseId={warehouseId} printing={printing} /></TabsContent>
              {canAdd && (
                <TabsContent value="add"><AddTools warehouseId={warehouseId} printing={printing} /></TabsContent>
              )}
            </Tabs>
          )}
        </main>
      </div>
    </PageTransition>
  );
}
