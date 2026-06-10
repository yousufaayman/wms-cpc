import { useEffect, useRef, useState, useMemo, Fragment } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Loader2, ScanLine, CheckCircle, Undo2, Trash2, ClipboardList, ChevronsUpDown, Check } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import LanguageToggle from "@/components/LanguageToggle";
import {
  supplierReceiptApi,
  internalReceiptApi,
  externalReceiptApi,
  warehouseApi, type Warehouse,
  logicalLocationApi, type LogicalLocation,
  fabricRollApi, type FabricRollDetail,
  fabricReceiptItemApi, type ReceiptKind,
  materialRequestApi, type MaterialRequest,
  materialRequestFulfillmentApi, type MaterialRequestFulfillment,
} from "@/lib/api";
import { buildMaterialGroups, fmt, type RollSummary, type MaterialGroup } from "@/lib/receiptAggregation";

// ── Types ─────────────────────────────────────────────────────────────────────

type Kind = "supplier" | "internal" | "external";

interface ScannedRoll extends RollSummary {
  roll_id: number;
  item_id: number;
  lot_number: string | null;
  status: string;
  client_fabric_code_id: number;
}

// Per-fabric-code scan limit derived from selected material requests
interface LimitEntry {
  fabric_code_id: number;
  material_name: string;
  color_name: string;
  job_orders: string;   // comma-separated job order numbers
  panel_types: string;  // comma-separated panel types
  allowed: number;
  useWeight: boolean;
  scale: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocationFilter(kind: Kind): string {
  if (kind === "supplier") return "supplier";
  if (kind === "internal") return "internal";
  return "";
}

function isKgScale(scale: string): boolean {
  return ["kg", "kgs", "kilogram", "kilograms"].includes(scale.toLowerCase());
}

const ISSUED_BY = 1;

async function createReceiptByKind(
  kind: Kind,
  sourceWarehouseId: number,
  targetLocationId: number | null,
  receiver: string,
  remarks: string,
): Promise<number> {
  if (kind === "supplier") {
    const r = await supplierReceiptApi.create(
      { source_warehouse_id: sourceWarehouseId, target_logical_location_id: targetLocationId!, remarks: remarks || null },
      ISSUED_BY,
    );
    return r.id;
  }
  if (kind === "internal") {
    const r = await internalReceiptApi.create(
      { source_warehouse_id: sourceWarehouseId, target_logical_location_id: targetLocationId! },
      ISSUED_BY,
    );
    return r.id;
  }
  const r = await externalReceiptApi.create(
    { source_warehouse_id: sourceWarehouseId, receiver: receiver.trim() },
    ISSUED_BY,
  );
  return r.id;
}

async function fetchReceiptInfoByKind(kind: Kind, rid: number): Promise<{ source_warehouse_id: number; receiver?: string }> {
  if (kind === "supplier") return supplierReceiptApi.getById(rid);
  if (kind === "internal") return internalReceiptApi.getById(rid);
  return externalReceiptApi.getById(rid);
}

// ── Searchable filter combobox ────────────────────────────────────────────────

function FilterCombobox({ value, onChange, options, placeholder }: Readonly<{
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}>) {
  const [open, setOpen] = useState(false);
  const label = value || placeholder;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-xs ring-offset-background",
            "hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            !value && "text-muted-foreground"
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} className="h-8 text-xs" />
          <CommandList>
            <CommandEmpty>—</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__all__" onSelect={() => { onChange(""); setOpen(false); }}>
                <Check className={cn("mr-2 h-3 w-3", !value ? "opacity-100" : "opacity-0")} />
                {placeholder}
              </CommandItem>
              {options.map(o => (
                <CommandItem key={o} value={o} onSelect={() => { onChange(o); setOpen(false); }}>
                  <Check className={cn("mr-2 h-3 w-3", value === o ? "opacity-100" : "opacity-0")} />
                  {o}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Material Request Selection Dialog ─────────────────────────────────────────

interface MaterialRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentSelected: MaterialRequest[];
  onConfirm: (selected: MaterialRequest[]) => void;
  t: (k: string) => string;
}

function MaterialRequestDialog({ open, onOpenChange, currentSelected, onConfirm, t }: Readonly<MaterialRequestDialogProps>) {
  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [localSelectedIds, setLocalSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [filterMaterial, setFilterMaterial] = useState("");
  const [filterColor, setFilterColor] = useState("");
  const [filterCode, setFilterCode] = useState("");

  useEffect(() => {
    if (!open) return;
    setLocalSelectedIds(new Set(currentSelected.map(r => r.id)));
    setSearch("");
    setFilterClient("");
    setFilterMaterial("");
    setFilterColor("");
    setFilterCode("");
    setLoading(true);
    materialRequestApi.getAll({ fulfilled: false, limit: 500 })
      .then(setRequests)
      .finally(() => setLoading(false));
  }, [open]);

  // Unique option lists derived from loaded data
  const clientOptions = useMemo(() => {
    const seen = new Set<string>();
    return requests
      .map(r => r.job_order?.client?.name ?? r.fabric_code?.client?.name)
      .filter((v): v is string => !!v && !seen.has(v) && !!seen.add(v))
      .sort();
  }, [requests]);

  const materialOptions = useMemo(() => {
    const seen = new Set<string>();
    return requests
      .map(r => r.fabric_code?.material?.name)
      .filter((v): v is string => !!v && !seen.has(v) && !!seen.add(v))
      .sort();
  }, [requests]);

  const colorOptions = useMemo(() => {
    const seen = new Set<string>();
    return requests
      .map(r => r.fabric_code?.color?.name)
      .filter((v): v is string => !!v && !seen.has(v) && !!seen.add(v))
      .sort();
  }, [requests]);

  const codeOptions = useMemo(() => {
    const seen = new Set<string>();
    return requests
      .map(r => r.fabric_code?.fabric_code)
      .filter((v): v is string => !!v && !seen.has(v) && !!seen.add(v))
      .sort();
  }, [requests]);

  const filtered = useMemo(() => {
    return requests.filter(r => {
      const clientName = r.job_order?.client?.name ?? r.fabric_code?.client?.name ?? "";
      if (filterClient && clientName !== filterClient) return false;
      if (filterMaterial && (r.fabric_code?.material?.name ?? "") !== filterMaterial) return false;
      if (filterColor && (r.fabric_code?.color?.name ?? "") !== filterColor) return false;
      if (filterCode && (r.fabric_code?.fabric_code ?? "") !== filterCode) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = [
          r.job_order?.job_order_number ?? "",
          clientName,
          r.fabric_code?.material?.name ?? "",
          r.fabric_code?.color?.name ?? "",
          r.fabric_code?.fabric_code ?? "",
          r.panel_type,
        ].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [requests, search, filterClient, filterMaterial, filterColor, filterCode]);

  function toggleRow(id: number) {
    setLocalSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleConfirm() {
    onConfirm(requests.filter(r => localSelectedIds.has(r.id)));
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[70vw] max-w-none h-[70vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle>{t("unfulfilledMaterialRequests")}</DialogTitle>
          <DialogDescription>{t("materialRequestsForReceipt")}</DialogDescription>
        </DialogHeader>

        {/* Filters */}
        <div className="px-6 pb-2 shrink-0 grid grid-cols-4 gap-2">
          <FilterCombobox value={filterClient} onChange={setFilterClient} options={clientOptions} placeholder={t("allClients")} />
          <FilterCombobox value={filterMaterial} onChange={setFilterMaterial} options={materialOptions} placeholder={t("allMaterials")} />
          <FilterCombobox value={filterColor} onChange={setFilterColor} options={colorOptions} placeholder={t("allColors")} />
          <FilterCombobox value={filterCode} onChange={setFilterCode} options={codeOptions} placeholder={t("allCodes")} />
        </div>

        {/* Search */}
        <div className="px-6 pb-2 shrink-0">
          <Input
            className="h-8 text-sm"
            placeholder={t("search")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {/* Table — fills remaining height */}
        <div className="flex-1 min-h-0 border-t overflow-hidden">
          <ScrollArea className="h-full">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-center text-sm text-muted-foreground py-16">
                {t("noUnfulfilledRequests")}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>{t("jobOrderNumber")}</TableHead>
                    <TableHead>{t("client")}</TableHead>
                    <TableHead>{t("fabricCode")}</TableHead>
                    <TableHead>{t("color")}</TableHead>
                    <TableHead>{t("material")}</TableHead>
                    <TableHead>{t("panelType")}</TableHead>
                    <TableHead className="text-right">{t("quantity")} / {t("measurementScale")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={() => toggleRow(r.id)}
                    >
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={localSelectedIds.has(r.id)}
                          onCheckedChange={() => toggleRow(r.id)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-sm">{r.job_order?.job_order_number ?? "—"}</TableCell>
                      <TableCell className="text-sm">{r.job_order?.client?.name ?? r.fabric_code?.client?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        <span className="font-mono">{r.fabric_code?.fabric_code ?? "—"}</span>
                        <span className="block text-xs text-muted-foreground">#{r.fabric_code_id}</span>
                      </TableCell>
                      <TableCell className="text-sm">{r.fabric_code?.color?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{r.fabric_code?.material?.name ?? "—"}</TableCell>
                      <TableCell className="text-sm">{r.panel_type}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {r.quantity != null ? `${r.quantity} ${r.measurement_scale}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>
        </div>

        <div className="px-6 py-4 border-t shrink-0">
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
            <Button onClick={handleConfirm}>
              {t("confirmSelection")} ({localSelectedIds.size})
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── SetupView ─────────────────────────────────────────────────────────────────

interface SetupProps {
  kind: Kind;
  warehouses: Warehouse[];
  locations: LogicalLocation[];
  sourceWarehouseId: number | null;
  setSourceWarehouseId: (id: number | null) => void;
  targetLocationId: number | null;
  setTargetLocationId: (id: number | null) => void;
  receiver: string;
  setReceiver: (v: string) => void;
  remarks: string;
  setRemarks: (v: string) => void;
  onProcess: () => void;
  processing: boolean;
  hasExistingReceipt: boolean;
  // Material request selection (internal receipts only)
  selectedMaterialRequests: MaterialRequest[];
  onSelectMaterialRequests: (reqs: MaterialRequest[]) => void;
  t: (k: string) => string;
}

function SetupView({
  kind, warehouses, locations,
  sourceWarehouseId, setSourceWarehouseId,
  targetLocationId, setTargetLocationId,
  receiver, setReceiver,
  remarks, setRemarks,
  onProcess, processing, hasExistingReceipt,
  selectedMaterialRequests, onSelectMaterialRequests,
  t,
}: Readonly<SetupProps>) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const locationType = getLocationFilter(kind);
  const filteredLocations = locationType
    ? locations.filter(l => l.location_type === locationType)
    : locations;

  const canProcess = sourceWarehouseId !== null &&
    (kind === "external" ? receiver.trim().length > 0 : targetLocationId !== null);

  const sourceWarehouseName = warehouses.find(w => w.id === sourceWarehouseId)?.name;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {kind === "supplier" ? t("newSupplierReceipt") : kind === "internal" ? t("newInternalReceipt") : t("newExternalReceipt")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>{t("sourceWarehouse")} *</Label>
            {sourceWarehouseName ? (
              <Input value={sourceWarehouseName} disabled className="bg-muted" />
            ) : (
              <Select
                value={sourceWarehouseId ? String(sourceWarehouseId) : ""}
                onValueChange={v => setSourceWarehouseId(Number(v))}
              >
                <SelectTrigger><SelectValue placeholder={t("selectSourceWarehouse")} /></SelectTrigger>
                <SelectContent>
                  {warehouses.map(w => <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {kind !== "external" && (
            <div>
              <Label>{t("targetLocation")} *</Label>
              <Select
                value={targetLocationId ? String(targetLocationId) : ""}
                onValueChange={v => setTargetLocationId(Number(v))}
              >
                <SelectTrigger><SelectValue placeholder={t("selectTargetLocation")} /></SelectTrigger>
                <SelectContent>
                  {filteredLocations.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          {kind === "external" && (
            <div>
              <Label>{t("receiverName")} *</Label>
              <Input
                placeholder={t("enterReceiverName")}
                value={receiver}
                onChange={e => setReceiver(e.target.value)}
              />
            </div>
          )}

          {kind === "supplier" && (
            <div>
              <Label>{t("receiptRemarks")}</Label>
              <Textarea
                placeholder={t("enterRemarks")}
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                rows={2}
              />
            </div>
          )}

          {kind === "internal" && (
            <div>
              <Label>{t("selectMaterialRequests")}</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                onClick={() => setDialogOpen(true)}
              >
                <ClipboardList className="h-4 w-4 mr-2 flex-shrink-0" />
                {selectedMaterialRequests.length > 0
                  ? t("requestsSelected").replace("{{count}}", String(selectedMaterialRequests.length))
                  : t("selectMaterialRequests")}
              </Button>
            </div>
          )}

          <Button onClick={onProcess} disabled={(!canProcess && !hasExistingReceipt) || processing} className="w-full">
            {processing
              ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
              : <ScanLine className="h-4 w-4 mr-2" />}
            {hasExistingReceipt ? t("resumeScanning") : t("processReceipt")}
          </Button>
        </CardContent>
      </Card>

      <MaterialRequestDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentSelected={selectedMaterialRequests}
        onConfirm={onSelectMaterialRequests}
        t={t}
      />
    </>
  );
}

// ── ScanView ──────────────────────────────────────────────────────────────────

interface ScanProps {
  kind: Kind;
  receiptId: number;
  sourceLabel: string;
  targetLabel: string;
  scannedRolls: ScannedRoll[];
  materialGroups: MaterialGroup[];
  selectedMaterialRequests: MaterialRequest[];
  priorIssuedByCode: Map<number, number>;
  onScan: (input: string) => Promise<void>;
  onUndo: () => Promise<void>;
  onRemove: (itemId: number) => Promise<void>;
  onDone: () => void;
  onBack: () => void;
  onLinkMaterialRequests: (reqs: MaterialRequest[]) => Promise<void>;
  t: (k: string) => string;
}

function ScanView({
  kind, receiptId, sourceLabel, targetLabel,
  scannedRolls, materialGroups, selectedMaterialRequests, priorIssuedByCode,
  onScan, onUndo, onRemove, onDone, onBack, onLinkMaterialRequests, t,
}: Readonly<ScanProps>) {
  const [input, setInput] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [undoLoading, setUndoLoading] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [mrDialogOpen, setMrDialogOpen] = useState(false);
  const [linkingMrs, setLinkingMrs] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Compute per-fabric-code limits from selected material requests
  const limitEntries = useMemo<LimitEntry[]>(() => {
    const byCode = new Map<number, LimitEntry>();
    for (const mr of selectedMaterialRequests) {
      if (!byCode.has(mr.fabric_code_id)) {
        byCode.set(mr.fabric_code_id, {
          fabric_code_id: mr.fabric_code_id,
          material_name: mr.fabric_code?.material?.name ?? "—",
          color_name: mr.fabric_code?.color?.name ?? "—",
          job_orders: "",
          panel_types: "",
          allowed: 0,
          useWeight: isKgScale(mr.measurement_scale),
          scale: mr.measurement_scale,
        });
      }
      const entry = byCode.get(mr.fabric_code_id)!;
      entry.allowed += mr.quantity ?? 0;
      const joNum = mr.job_order?.job_order_number ?? "";
      if (joNum && !entry.job_orders.split(", ").includes(joNum))
        entry.job_orders = entry.job_orders ? `${entry.job_orders}, ${joNum}` : joNum;
      if (mr.panel_type && !entry.panel_types.split(", ").includes(mr.panel_type))
        entry.panel_types = entry.panel_types ? `${entry.panel_types}, ${mr.panel_type}` : mr.panel_type;
    }
    return Array.from(byCode.values());
  }, [selectedMaterialRequests]);

  // Scanned totals per fabric code (for limit display) — includes amounts issued in other receipts
  const scannedByCode = useMemo(() => {
    const m = new Map<number, number>(priorIssuedByCode);
    for (const roll of scannedRolls) {
      const entry = limitEntries.find(e => e.fabric_code_id === roll.client_fabric_code_id);
      if (entry) {
        const val = entry.useWeight ? roll.weight : (roll.length ?? 0);
        m.set(roll.client_fabric_code_id, (m.get(roll.client_fabric_code_id) ?? 0) + val);
      }
    }
    return m;
  }, [scannedRolls, limitEntries, priorIssuedByCode]);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!scanLoading && !undoLoading) inputRef.current?.focus();
  }, [scanLoading, undoLoading]);

  function handleBlur() {
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function triggerScan(value: string) {
    if (!value.trim() || scanLoading) return;
    setScanLoading(true);
    setScanError(null);
    try {
      await onScan(value.trim());
    } catch (err) {
      setScanError(err instanceof Error ? err.message : t("rollNotFound"));
    } finally {
      setInput("");
      setScanLoading(false);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setScanError(null);
    if (val.endsWith("F")) {
      triggerScan(val.slice(0, -1));
      return;
    }
    setInput(val);
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setInput("");
      setScanError(null);
      return;
    }
    if (e.key === "Enter") triggerScan(input);
  }

  async function handleMrConfirm(reqs: MaterialRequest[]) {
    setLinkingMrs(true);
    try {
      await onLinkMaterialRequests(reqs);
    } finally {
      setLinkingMrs(false);
    }
  }

  async function handleUndo() {
    setUndoLoading(true);
    try { await onUndo(); }
    finally { setUndoLoading(false); }
  }

  const grandWeight = scannedRolls.reduce((s, r) => s + r.weight, 0);
  const hasLength = scannedRolls.some(r => r.length !== null);
  const grandLength = hasLength ? scannedRolls.reduce((s, r) => s + (r.length ?? 0), 0) : null;

  return (
    <div className="space-y-4">
      {/* Full-width header strip */}
      <Card>
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="ghost" size="sm" onClick={onBack} className="p-1 h-auto">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Badge variant="secondary" className="capitalize">{kind}</Badge>
              <span className="text-sm font-medium">#{receiptId}</span>
              <span className="text-muted-foreground text-sm">{sourceLabel}</span>
              {targetLabel && <>
                <span className="text-muted-foreground">→</span>
                <span className="text-sm font-medium">{targetLabel}</span>
              </>}
              <Badge variant="outline">{scannedRolls.length} {t("rollsCount")}</Badge>
              {selectedMaterialRequests.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <ClipboardList className="h-3 w-3" />
                  {t("requestsSelected").replace("{{count}}", String(selectedMaterialRequests.length))}
                </Badge>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {kind === "internal" && (
                <Button size="sm" variant="outline" onClick={() => setMrDialogOpen(true)} disabled={linkingMrs}>
                  {linkingMrs
                    ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    : <ClipboardList className="h-4 w-4 mr-1" />}
                  {t("selectMaterialRequests")}
                </Button>
              )}
              {scannedRolls.length > 0 && (
                <Button size="sm" variant="outline" onClick={handleUndo} disabled={undoLoading}>
                  {undoLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Undo2 className="h-4 w-4 mr-1" />}
                  {t("undoLastScan")}
                </Button>
              )}
              <Button size="sm" onClick={onDone}>
                <CheckCircle className="h-4 w-4 mr-1" />{t("doneScanning")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

        {/* Left — scanner + limit tracker + scanned roll list */}
        <div className="space-y-4">

          {/* Fulfillment tracking card — updates dynamically on each scan */}
          {limitEntries.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" />
                  {t("fulfillmentHistory")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 pb-2">
                <div className="divide-y">
                  {limitEntries.map(entry => {
                    const scanned = scannedByCode.get(entry.fabric_code_id) ?? 0;
                    const pct = entry.allowed > 0 ? Math.min(scanned / entry.allowed, 1) : 0;
                    const atLimit = scanned >= entry.allowed && entry.allowed > 0;
                    const nearLimit = pct >= 0.9 && !atLimit;
                    const barColor = atLimit
                      ? "bg-destructive"
                      : nearLimit
                        ? "bg-orange-500"
                        : "bg-primary";
                    return (
                      <div key={entry.fabric_code_id} className="px-4 py-3 space-y-1.5">
                        {/* Row 1: fabric info */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap min-w-0">
                            <span className="font-medium text-sm">{entry.material_name}</span>
                            <span className="text-muted-foreground text-xs">/ {entry.color_name}</span>
                            {entry.job_orders && (
                              <Badge variant="outline" className="text-xs font-mono">{entry.job_orders}</Badge>
                            )}
                            {entry.panel_types && (
                              <Badge variant="secondary" className="text-xs">{entry.panel_types}</Badge>
                            )}
                          </div>
                          <span className={`font-mono text-sm whitespace-nowrap ${atLimit ? "text-destructive font-bold" : nearLimit ? "text-orange-500" : ""}`}>
                            {fmt(scanned)} / {fmt(entry.allowed)} {entry.scale}
                          </span>
                        </div>
                        {/* Row 2: progress bar */}
                        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                            style={{ width: `${pct * 100}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-4 space-y-2">
              <Label className="text-base font-semibold">{t("scanningMode")}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    ref={inputRef}
                    className="pl-9 text-lg h-12"
                    placeholder={t("scanRollId")}
                    value={input}
                    onChange={handleChange}
                    onKeyDown={handleKey}
                    onBlur={handleBlur}
                    disabled={scanLoading}
                  />
                </div>
                {scanLoading && <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" />}
              </div>
              {scanError && <p className="text-destructive text-sm">{scanError}</p>}
            </CardContent>
          </Card>

          {scannedRolls.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">{t("recentlyScanned")}</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">{t("rollId")}</TableHead>
                      <TableHead>{t("material")}</TableHead>
                      <TableHead>{t("color")}</TableHead>
                      <TableHead>{t("lotNumber")}</TableHead>
                      <TableHead className="text-right">{t("weightKg")}</TableHead>
                      <TableHead className="text-right">{t("lengthM")}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...scannedRolls].reverse().map(roll => (
                      <TableRow key={roll.item_id}>
                        <TableCell className="pl-4 font-mono text-sm">#{roll.roll_id}</TableCell>
                        <TableCell>{roll.material_name}</TableCell>
                        <TableCell>{roll.color_name}</TableCell>
                        <TableCell className="text-muted-foreground">{roll.lot_number ?? "—"}</TableCell>
                        <TableCell className="text-right">{fmt(roll.weight)}</TableCell>
                        <TableCell className="text-right">{fmt(roll.length)}</TableCell>
                        <TableCell className="pr-4 text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            disabled={removingId === roll.item_id}
                            onClick={async () => {
                              setRemovingId(roll.item_id);
                              try { await onRemove(roll.item_id); }
                              finally { setRemovingId(null); }
                            }}
                          >
                            {removingId === roll.item_id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right — aggregated overview */}
        {materialGroups.length > 0 && (
          <Card>
            <CardHeader><CardTitle>{t("scannedItems")}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("material")} / {t("color")}</TableHead>
                    <TableHead className="text-right">{t("rollsCount")}</TableHead>
                    <TableHead className="text-right">{t("lengthM")}</TableHead>
                    <TableHead className="text-right">{t("weightKg")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {materialGroups.map(mat => (
                    <Fragment key={mat.material_name}>
                      <TableRow className="bg-muted/40 font-semibold">
                        <TableCell>{mat.material_name}</TableCell>
                        <TableCell className="text-right">{mat.count}</TableCell>
                        <TableCell className="text-right">{fmt(mat.total_length)}</TableCell>
                        <TableCell className="text-right">{fmt(mat.total_weight)}</TableCell>
                      </TableRow>
                      {mat.colors.map(col => (
                        <TableRow key={`${mat.material_name}-${col.color_name}`} className="text-sm">
                          <TableCell className="pl-8 text-muted-foreground">{col.color_name}</TableCell>
                          <TableCell className="text-right">{col.count}</TableCell>
                          <TableCell className="text-right">{fmt(col.total_length)}</TableCell>
                          <TableCell className="text-right">{fmt(col.total_weight)}</TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  ))}
                  <TableRow className="border-t-2 font-bold">
                    <TableCell>{t("overallTotal")}</TableCell>
                    <TableCell className="text-right">{scannedRolls.length}</TableCell>
                    <TableCell className="text-right">{fmt(grandLength)}</TableCell>
                    <TableCell className="text-right">{fmt(grandWeight)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

      </div>

      {/* Material request linking dialog — accessible during scanning */}
      <MaterialRequestDialog
        open={mrDialogOpen}
        onOpenChange={setMrDialogOpen}
        currentSelected={selectedMaterialRequests}
        onConfirm={handleMrConfirm}
        t={t}
      />
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const CreateReceipt = () => {
  const { kind } = useParams<{ kind: Kind }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const resolvedKind = (kind ?? "vendor") as Kind;
  const warehouseQuery = searchParams.get("warehouse") ? `?warehouse=${searchParams.get("warehouse")}` : "";

  // Reference data
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<LogicalLocation[]>([]);
  const [refLoading, setRefLoading] = useState(true);

  // Setup form state
  const warehouseParam = searchParams.get("warehouse");
  const receiptIdParam = searchParams.get("receipt_id");
  const [sourceWarehouseId, setSourceWarehouseId] = useState<number | null>(null);
  const [targetLocationId, setTargetLocationId] = useState<number | null>(null);
  const [receiver, setReceiver] = useState("");
  const [remarks, setRemarks] = useState("");
  const [processing, setProcessing] = useState(false);

  // Material request selection (internal receipts only)
  const [selectedMaterialRequests, setSelectedMaterialRequests] = useState<MaterialRequest[]>([]);
  // Maps materialRequest.id → fulfillment.id so we can PATCH quantity_issued after each scan
  const [mrFulfillmentMap, setMrFulfillmentMap] = useState<Map<number, number>>(new Map());
  // Quantity already issued in receipts OTHER than the current one, keyed by fabric_code_id
  const [priorIssuedByCode, setPriorIssuedByCode] = useState<Map<number, number>>(new Map());

  // Scan mode
  const [scanning, setScanning] = useState(false);
  const [receiptId, setReceiptId] = useState<number | null>(receiptIdParam ? parseInt(receiptIdParam) : null);
  const [scannedRolls, setScannedRolls] = useState<ScannedRoll[]>([]);

  async function loadExistingReceipt(rid: number) {
    const info = await fetchReceiptInfoByKind(resolvedKind, rid);

    const [existingItems, thisReceiptFulfillments] = await Promise.all([
      fabricReceiptItemApi.list(resolvedKind as ReceiptKind, rid),
      resolvedKind === "internal"
        ? materialRequestFulfillmentApi.getAll({ internal_receipt_id: rid })
        : Promise.resolve([] as MaterialRequestFulfillment[]),
    ]);

    const dyedRollIds = existingItems
      .filter(i => i.item_type === "FabricRoll" && i.dyed_roll_id != null)
      .map(i => ({ item_id: i.id, dyed_roll_id: i.dyed_roll_id! }));

    // Run roll-detail fetches, MR fetches, and cross-receipt fulfillment fetches all in parallel
    const [detailResults, materialRequests, allFulfillments] = await Promise.all([
      Promise.allSettled(dyedRollIds.map(({ dyed_roll_id }) => fabricRollApi.getDetail(dyed_roll_id))),
      thisReceiptFulfillments.length > 0
        ? Promise.all(thisReceiptFulfillments.map(f => materialRequestApi.getById(f.material_request_id)))
        : Promise.resolve([] as MaterialRequest[]),
      thisReceiptFulfillments.length > 0
        ? Promise.all(
            thisReceiptFulfillments.map(f =>
              materialRequestFulfillmentApi.getAll({ material_request_id: f.material_request_id }),
            ),
          ).then(arrays => arrays.flat())
        : Promise.resolve([] as MaterialRequestFulfillment[]),
    ]);

    // Build mrFulfillmentMap (this receipt only)
    const mrFulfillmentMapData = new Map<number, number>();
    thisReceiptFulfillments.forEach(f => mrFulfillmentMapData.set(f.material_request_id, f.id));

    // Compute prior issued from receipts other than this one
    const mrToFabricCode = new Map(materialRequests.map(mr => [mr.id, mr.fabric_code_id]));
    const priorMap = new Map<number, number>();
    for (const f of allFulfillments) {
      if (f.internal_receipt_id === rid || f.quantity_issued == null) continue;
      const fabricCodeId = mrToFabricCode.get(f.material_request_id);
      if (fabricCodeId === undefined) continue;
      priorMap.set(fabricCodeId, (priorMap.get(fabricCodeId) ?? 0) + f.quantity_issued);
    }

    // Build scanned rolls
    const rolls: ScannedRoll[] = [];
    detailResults.forEach((result, idx) => {
      if (result.status === "fulfilled") {
        const d: FabricRollDetail = result.value;
        rolls.push({
          roll_id: dyedRollIds[idx].dyed_roll_id,
          item_id: dyedRollIds[idx].item_id,
          material_name: d.material_name,
          color_name: d.color_name,
          weight: d.weight,
          length: d.length ?? null,
          lot_number: d.lot_number ?? null,
          status: d.status,
          client_fabric_code_id: d.client_fabric_code_id,
        });
      }
    });

    // All data ready — flush every state update in one synchronous block so React
    // batches them into a single render before setScanning(true) fires.
    setSourceWarehouseId(info.source_warehouse_id);
    if (info.receiver) setReceiver(info.receiver);
    setSelectedMaterialRequests(materialRequests);
    setMrFulfillmentMap(mrFulfillmentMapData);
    setPriorIssuedByCode(priorMap);
    setScannedRolls(rolls);
  }

  useEffect(() => {
    const rid = receiptIdParam ? parseInt(receiptIdParam) : null;
    Promise.all([warehouseApi.getAll(), logicalLocationApi.getAll({ limit: 500 })])
      .then(([ws, lls]) => {
        setWarehouses(ws);
        setLocations(lls);
        if (rid) {
          loadExistingReceipt(rid).then(() => setScanning(true));
        } else {
          const paramId = warehouseParam ? parseInt(warehouseParam) : null;
          if (paramId && ws.some(w => w.id === paramId)) {
            setSourceWarehouseId(paramId);
          }
        }
      })
      .finally(() => setRefLoading(false));
  }, []);

  const materialGroups = useMemo(
    () => buildMaterialGroups(scannedRolls),
    [scannedRolls],
  );

  async function handleProcess() {
    if (receiptId !== null) {
      setScanning(true);
      return;
    }
    if (!sourceWarehouseId) return;
    setProcessing(true);
    try {
      const id = await createReceiptByKind(resolvedKind, sourceWarehouseId, targetLocationId, receiver, remarks);
      setReceiptId(id);
      // Create fulfillment records for any material requests selected during setup
      if (resolvedKind === "internal" && selectedMaterialRequests.length > 0) {
        const created = await Promise.all(
          selectedMaterialRequests.map(mr =>
            materialRequestFulfillmentApi.create({
              material_request_id: mr.id,
              internal_receipt_id: id,
              measurement_scale: mr.measurement_scale,
            }),
          ),
        );
        const map = new Map<number, number>();
        created.forEach(f => map.set(f.material_request_id, f.id));
        setMrFulfillmentMap(map);
      }
      setScanning(true);
    } finally {
      setProcessing(false);
    }
  }

  async function handleLinkFromScan(newReqs: MaterialRequest[]) {
    if (!receiptId) return;
    const existingIds = new Set(selectedMaterialRequests.map(r => r.id));
    const toCreate = newReqs.filter(r => !existingIds.has(r.id));
    if (toCreate.length > 0) {
      const created = await Promise.all(
        toCreate.map(mr =>
          materialRequestFulfillmentApi.create({
            material_request_id: mr.id,
            internal_receipt_id: receiptId,
            measurement_scale: mr.measurement_scale,
          }),
        ),
      );
      setMrFulfillmentMap(prev => {
        const next = new Map(prev);
        created.forEach(f => next.set(f.material_request_id, f.id));
        return next;
      });
    }
    setSelectedMaterialRequests(newReqs);
  }

  function updateFulfillmentQuantities(newRolls: ScannedRoll[]) {
    if (selectedMaterialRequests.length === 0 || mrFulfillmentMap.size === 0) return;
    const byCode = new Map<number, MaterialRequest[]>();
    for (const mr of selectedMaterialRequests) {
      const list = byCode.get(mr.fabric_code_id) ?? [];
      list.push(mr);
      byCode.set(mr.fabric_code_id, list);
    }
    const patches: Promise<unknown>[] = [];
    for (const [fabricCodeId, mrs] of byCode.entries()) {
      const useWeight = isKgScale(mrs[0].measurement_scale);
      const totalScanned = newRolls
        .filter(r => r.client_fabric_code_id === fabricCodeId)
        .reduce((s, r) => s + (useWeight ? r.weight : (r.length ?? 0)), 0);
      let remaining = totalScanned;
      for (const mr of mrs) {
        const fid = mrFulfillmentMap.get(mr.id);
        if (fid === undefined) continue;
        const allocated = mr.quantity !== null ? Math.min(remaining, mr.quantity) : remaining;
        remaining = Math.max(0, remaining - allocated);
        patches.push(materialRequestFulfillmentApi.patch(fid, { quantity_issued: allocated }));
      }
    }
    Promise.all(patches).catch(console.error);
  }

  async function handleScan(input: string) {
    if (!receiptId) return;
    const rollId = parseInt(input);
    if (isNaN(rollId)) throw new Error(t("rollNotFound"));
    if (scannedRolls.some(r => r.roll_id === rollId)) throw new Error(t("rollAlreadyScanned"));

    // Fetch roll details first so we can check limits before committing to the receipt
    const detail: FabricRollDetail = await fabricRollApi.getDetail(rollId);

    // ── Scan limit check (internal receipts with selected material requests) ──
    if (resolvedKind === "internal" && selectedMaterialRequests.length > 0) {
      const matchingReqs = selectedMaterialRequests.filter(
        mr => mr.fabric_code_id === detail.client_fabric_code_id,
      );
      if (matchingReqs.length > 0) {
        const useWeight = isKgScale(matchingReqs[0].measurement_scale);
        const totalAllowed = matchingReqs.reduce((s, mr) => s + (mr.quantity ?? 0), 0);
        const alreadyScanned = scannedRolls
          .filter(r => r.client_fabric_code_id === detail.client_fabric_code_id)
          .reduce((s, r) => s + (useWeight ? r.weight : (r.length ?? 0)), 0);
        const priorIssued = priorIssuedByCode.get(detail.client_fabric_code_id) ?? 0;
        if (alreadyScanned + priorIssued >= totalAllowed) {
          throw new Error(t("scanLimitExceeded"));
        }
      }
    }

    const added = await fabricReceiptItemApi.add(resolvedKind as ReceiptKind, receiptId, {
      item_type: "FabricRoll",
      dyed_roll_id: rollId,
    });
    const newRoll: ScannedRoll = {
      roll_id: rollId,
      item_id: added.id,
      material_name: detail.material_name,
      color_name: detail.color_name,
      weight: detail.weight,
      length: detail.length ?? null,
      lot_number: detail.lot_number ?? null,
      status: detail.status,
      client_fabric_code_id: detail.client_fabric_code_id,
    };
    const nextRolls = [...scannedRolls, newRoll];
    setScannedRolls(nextRolls);
    updateFulfillmentQuantities(nextRolls);
  }

  async function handleUndo() {
    if (scannedRolls.length === 0) return;
    const last = scannedRolls[scannedRolls.length - 1];
    await fabricReceiptItemApi.delete(last.item_id);
    const nextRolls = scannedRolls.slice(0, -1);
    setScannedRolls(nextRolls);
    updateFulfillmentQuantities(nextRolls);
  }

  async function handleRemove(itemId: number) {
    await fabricReceiptItemApi.delete(itemId);
    const nextRolls = scannedRolls.filter(r => r.item_id !== itemId);
    setScannedRolls(nextRolls);
    updateFulfillmentQuantities(nextRolls);
  }

  function handleBack() {
    if (receiptIdParam) {
      navigate(`/receipts/${resolvedKind}/${receiptId}${warehouseQuery}`);
    } else {
      setScanning(false);
    }
  }

  function handleDone() {
    navigate(`/receipts/${resolvedKind}/${receiptId}${warehouseQuery}`);
  }

  if (refLoading) {
    return (
      <PageTransition>
        <div className={`min-h-screen bg-background ltr`}>
          <div className="absolute top-4 right-4"><LanguageToggle /></div>
          <div className="flex items-center justify-center h-screen">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </div>
      </PageTransition>
    );
  }

  const sourceLabel = warehouses.find(w => w.id === sourceWarehouseId)?.name ?? "";
  const targetLabel = resolvedKind !== "external"
    ? (locations.find(l => l.id === targetLocationId)?.name ?? "")
    : receiver;

  return (
    <PageTransition>
      <div className={`min-h-screen bg-background flex ltr`}>
        {!scanning && <Sidebar />}
        <main className="flex-1 p-6">
          <div className={scanning ? "h-full space-y-4" : "max-w-3xl mx-auto space-y-6"}>
            {!scanning && (
              <Button variant="ghost" onClick={() => navigate(`/receipts${warehouseQuery}`)}>
                <ArrowLeft className="h-4 w-4 mr-2" />{t("receipts")}
              </Button>
            )}

            {scanning && receiptId !== null ? (
              <ScanView
                kind={resolvedKind}
                receiptId={receiptId}
                sourceLabel={sourceLabel}
                targetLabel={targetLabel}
                scannedRolls={scannedRolls}
                materialGroups={materialGroups}
                selectedMaterialRequests={selectedMaterialRequests}
                priorIssuedByCode={priorIssuedByCode}
                onScan={handleScan}
                onUndo={handleUndo}
                onRemove={handleRemove}
                onDone={handleDone}
                onBack={handleBack}
                onLinkMaterialRequests={handleLinkFromScan}
                t={t}
              />
            ) : (
              <SetupView
                kind={resolvedKind}
                warehouses={warehouses}
                locations={locations}
                sourceWarehouseId={sourceWarehouseId}
                setSourceWarehouseId={setSourceWarehouseId}
                targetLocationId={targetLocationId}
                setTargetLocationId={setTargetLocationId}
                receiver={receiver}
                setReceiver={setReceiver}
                remarks={remarks}
                setRemarks={setRemarks}
                onProcess={handleProcess}
                processing={processing}
                hasExistingReceipt={receiptId !== null}
                selectedMaterialRequests={selectedMaterialRequests}
                onSelectMaterialRequests={setSelectedMaterialRequests}
                t={t}
              />
            )}
          </div>
        </main>
      </div>
    </PageTransition>
  );
};

export default CreateReceipt;
