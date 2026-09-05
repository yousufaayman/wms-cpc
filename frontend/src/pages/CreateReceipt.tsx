import { useEffect, useRef, useState, useMemo, Fragment } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Loader2, ScanLine, CheckCircle, Undo2, Trash2, ClipboardList } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import LanguageToggle from "@/components/LanguageToggle";
import { ReceiverField } from "@/components/ReceiverField";
import {
  supplierReceiptApi,
  internalReceiptApi,
  externalReceiptApi,
  clientApi, type Client,
  warehouseApi, type Warehouse,
  logicalLocationApi, type LogicalLocation,
  fabricRollApi, type FabricRollDetail,
  undyedFabricRollApi, type UndyedFabricRollDetail,
  fabricReceiptItemApi, type ReceiptKind,
  materialRequestApi, type MaterialRequest,
  materialRequestFulfillmentApi, type MaterialRequestFulfillment,
} from "@/lib/api";
import { buildMaterialGroups, fmt, type RollSummary, type MaterialGroup } from "@/lib/receiptAggregation";

// ── Types ─────────────────────────────────────────────────────────────────────

type Kind = "supplier" | "internal" | "external";

type RollType = "dyed" | "undyed";

interface ScannedRoll extends RollSummary {
  roll_id: number;
  item_id: number;
  roll_type: RollType;
  lot_number: string | null;
  status: string;
  client_fabric_code_id: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocationFilter(kind: Kind): string {
  if (kind === "supplier") return "supplier";
  if (kind === "internal") return "internal";
  return "";
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

// ── SetupView ─────────────────────────────────────────────────────────────────

interface SetupProps {
  kind: Kind;
  warehouses: Warehouse[];
  locations: LogicalLocation[];
  clients: Client[];
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
  t: (k: string) => string;
}

function SetupView({
  kind, warehouses, locations, clients,
  sourceWarehouseId, setSourceWarehouseId,
  targetLocationId, setTargetLocationId,
  receiver, setReceiver,
  remarks, setRemarks,
  onProcess, processing, hasExistingReceipt, t,
}: Readonly<SetupProps>) {
  const locationType = getLocationFilter(kind);
  const filteredLocations = locationType
    ? locations.filter(l => l.location_type === locationType)
    : locations;

  const canProcess = sourceWarehouseId !== null &&
    (kind === "external" ? receiver.trim().length > 0 : targetLocationId !== null);

  const sourceWarehouseName = warehouses.find(w => w.id === sourceWarehouseId)?.name;

  return (
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
          <ReceiverField clients={clients} value={receiver} onChange={setReceiver} />
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

        <Button onClick={onProcess} disabled={(!canProcess && !hasExistingReceipt) || processing} className="w-full">
          {processing
            ? <Loader2 className="h-4 w-4 animate-spin mr-2" />
            : <ScanLine className="h-4 w-4 mr-2" />}
          {hasExistingReceipt ? t("resumeScanning") : t("processReceipt")}
        </Button>
      </CardContent>
    </Card>
  );
}

// ── FulfillmentPanel ──────────────────────────────────────────────────────────

function FulfillmentPanel({
  request, fulfillment, t,
}: Readonly<{
  request: MaterialRequest;
  fulfillment: MaterialRequestFulfillment;
  t: (k: string) => string;
}>) {
  const requested = request.quantity;
  const issued = fulfillment.quantity_issued ?? 0;
  const scale = fulfillment.measurement_scale ?? request.measurement_scale;
  const pct = requested != null && requested > 0 ? Math.min(100, (issued / requested) * 100) : null;
  const remaining = requested != null ? Math.max(0, requested - issued) : null;
  const complete = pct !== null && pct >= 100;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            {t("fulfillmentProgress")}
          </CardTitle>
          {complete && (
            <Badge className="bg-green-100 text-green-800 border-green-300" variant="outline">
              {t("statusFulfilled")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("jobOrderNumber")}</span>
            <span className="font-semibold">{request.job_order?.job_order_number ?? `#${request.job_order_id}`}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("fabricCode")}</span>
            <span className="font-mono font-semibold">{request.fabric_code?.fabric_code ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("panelType")}</span>
            <span>{request.panel_type}</span>
          </div>
        </div>
        {pct !== null && <Progress value={pct} />}
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div>
            <p className="text-muted-foreground text-xs">{t("requestedQty")}</p>
            <p className="font-semibold">{requested != null ? `${fmt(requested)} ${scale}` : "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("totalIssued")}</p>
            <p className="font-semibold">{fmt(issued)} {scale}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t("remaining")}</p>
            <p className={`font-semibold ${complete ? "text-green-600" : ""}`}>
              {remaining != null ? `${fmt(remaining)} ${scale}` : "—"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
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
  onScan: (input: string, rollType: RollType) => Promise<void>;
  onUndo: () => Promise<void>;
  onRemove: (itemId: number) => Promise<void>;
  onDone: () => void;
  onBack: () => void;
  fulfillmentPanel?: React.ReactNode;
  t: (k: string) => string;
}

function ScanView({
  kind, receiptId, sourceLabel, targetLabel,
  scannedRolls, materialGroups, onScan, onUndo, onRemove, onDone, onBack, fulfillmentPanel, t,
}: Readonly<ScanProps>) {
  const [input, setInput] = useState("");
  const [scanLoading, setScanLoading] = useState(false);
  const [undoLoading, setUndoLoading] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Defer initial focus so the DOM is fully painted (avoids race with transitions)
  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, []);

  // Re-focus after loading clears — the input is disabled while loading so blur won't fire
  useEffect(() => {
    if (!scanLoading && !undoLoading) inputRef.current?.focus();
  }, [scanLoading, undoLoading]);

  // Always keep focus on the scanner input; setTimeout(0) lets button clicks register first
  function handleBlur() {
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  async function triggerScan(value: string, rollType: RollType) {
    if (!value.trim() || scanLoading) return;
    setScanLoading(true);
    setScanError(null);
    try {
      await onScan(value.trim(), rollType);
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
    // Roll barcodes: `<rollId>*F` = dyed, `<rollId>*K` = undyed — the suffix
    // terminates the scan.
    if (val.endsWith("*F")) {
      triggerScan(val.slice(0, -2), "dyed");
      return;
    }
    if (val.endsWith("*K")) {
      triggerScan(val.slice(0, -2), "undyed");
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
    // Manual entry (bare id + Enter) has no suffix — treat as dyed.
    if (e.key === "Enter") triggerScan(input, "dyed");
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
            </div>
            <div className="flex gap-2">
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

        {/* Left — scanner + scanned roll list */}
        <div className="space-y-4">
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

        {/* Right — fulfillment progress + aggregated overview */}
        <div className="space-y-4">
        {fulfillmentPanel}
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

      </div>
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
  const [clients, setClients] = useState<Client[]>([]);
  const [refLoading, setRefLoading] = useState(true);

  // Setup form state
  const warehouseParam = searchParams.get("warehouse");
  const receiptIdParam = searchParams.get("receipt_id");
  const [sourceWarehouseId, setSourceWarehouseId] = useState<number | null>(null);
  const [targetLocationId, setTargetLocationId] = useState<number | null>(null);
  const [receiver, setReceiver] = useState("");
  const [remarks, setRemarks] = useState("");
  const [processing, setProcessing] = useState(false);

  // Scan mode
  const [scanning, setScanning] = useState(false);
  const [receiptId, setReceiptId] = useState<number | null>(receiptIdParam ? parseInt(receiptIdParam) : null);
  const [scannedRolls, setScannedRolls] = useState<ScannedRoll[]>([]);

  // Material request fulfillment tracking: any receipt opened in the scan
  // view is checked for material request links (via fulfillments) — a receipt
  // can carry several requests, whether created from the Material Requests
  // page or linked to an existing receipt later.
  const [fulfillments, setFulfillments] = useState<MaterialRequestFulfillment[]>([]);
  const [requestsById, setRequestsById] = useState<Map<number, MaterialRequest>>(new Map());

  useEffect(() => {
    if (!receiptId) {
      setFulfillments([]);
      setRequestsById(new Map());
      return;
    }
    const filters =
      resolvedKind === "internal" ? { internal_receipt_id: receiptId }
      : resolvedKind === "supplier" ? { supplier_receipt_id: receiptId }
      : { external_receipt_id: receiptId };
    materialRequestFulfillmentApi.getAll(filters)
      .then(async fs => {
        setFulfillments(fs);
        const ids = [...new Set(fs.map(f => f.material_request_id))];
        const reqs = await Promise.allSettled(ids.map(id => materialRequestApi.getById(id)));
        const map = new Map<number, MaterialRequest>();
        reqs.forEach((res, idx) => {
          if (res.status === "fulfilled") map.set(ids[idx], res.value);
        });
        setRequestsById(map);
      })
      .catch(e => console.error("Failed to check material request links", e));
  }, [receiptId, resolvedKind]);

  // Live progress: recompute issued quantities from the receipt's rolls
  // after every scan/undo/remove (the sync endpoint reads the receipt items).
  useEffect(() => {
    if (fulfillments.length === 0) return;
    const synced = fulfillments.map(f => f.id);
    Promise.allSettled(synced.map(id => materialRequestFulfillmentApi.sync(id)))
      .then(results => {
        const updated = new Map<number, MaterialRequestFulfillment>();
        results.forEach((res, idx) => {
          if (res.status === "fulfilled") updated.set(synced[idx], res.value);
        });
        setFulfillments(prev => prev.map(f => updated.get(f.id) ?? f));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedRolls.length, fulfillments.length]);

  async function loadExistingReceipt(rid: number) {
    const info = await fetchReceiptInfoByKind(resolvedKind, rid);
    setSourceWarehouseId(info.source_warehouse_id);
    if (info.receiver) setReceiver(info.receiver);

    const existingItems = await fabricReceiptItemApi.list(resolvedKind as ReceiptKind, rid);
    const rollRefs = existingItems.flatMap<{ item_id: number; roll_id: number; roll_type: RollType }>(i => {
      if (i.item_type === "FabricRoll" && i.dyed_roll_id != null) {
        return [{ item_id: i.id, roll_id: i.dyed_roll_id, roll_type: "dyed" }];
      }
      if (i.item_type === "UndyedFabricRoll" && i.undyed_roll_id != null) {
        return [{ item_id: i.id, roll_id: i.undyed_roll_id, roll_type: "undyed" }];
      }
      return [];
    });

    const details = await Promise.allSettled(
      rollRefs.map(ref => ref.roll_type === "dyed"
        ? fabricRollApi.getDetail(ref.roll_id)
        : undyedFabricRollApi.getDetail(ref.roll_id)),
    );

    const rolls: ScannedRoll[] = [];
    details.forEach((result, idx) => {
      if (result.status !== "fulfilled") return;
      const ref = rollRefs[idx];
      if (ref.roll_type === "dyed") {
        const d = result.value as FabricRollDetail;
        rolls.push({
          roll_id: ref.roll_id,
          item_id: ref.item_id,
          roll_type: "dyed",
          material_name: d.material_name,
          color_name: d.color_name,
          weight: d.weight,
          length: d.length ?? null,
          lot_number: d.lot_number ?? null,
          status: d.status,
          client_fabric_code_id: d.client_fabric_code_id,
        });
      } else {
        const d = result.value as UndyedFabricRollDetail;
        rolls.push({
          roll_id: ref.roll_id,
          item_id: ref.item_id,
          roll_type: "undyed",
          material_name: d.material_name,
          color_name: t("undyedLabel"),
          weight: d.weight,
          length: d.length ?? null,
          lot_number: d.lot_number ?? null,
          status: d.status,
          client_fabric_code_id: null,
        });
      }
    });
    setScannedRolls(rolls);
  }

  useEffect(() => {
    const rid = receiptIdParam ? parseInt(receiptIdParam) : null;
    Promise.all([warehouseApi.getAll(), logicalLocationApi.getAll({ limit: 500 }), clientApi.getAll()])
      .then(([ws, lls, cs]) => {
        setWarehouses(ws);
        setLocations(lls);
        setClients(cs);
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
      setScanning(true);
    } finally {
      setProcessing(false);
    }
  }

  async function handleScan(input: string, rollType: RollType) {
    if (!receiptId) return;
    const rollId = parseInt(input);
    if (isNaN(rollId)) throw new Error(t("rollNotFound"));
    // Dyed and undyed ids are independent sequences — dedupe per type.
    if (scannedRolls.some(r => r.roll_id === rollId && r.roll_type === rollType)) {
      throw new Error(t("rollAlreadyScanned"));
    }

    // Receipt assigned to material requests: only rolls matching one of the
    // requests' fabric codes may be scanned (undyed rolls carry no code).
    const linkedRequests = [...requestsById.values()];
    const allowedCodes = linkedRequests
      .map(r => r.fabric_code?.fabric_code ?? `#${r.fabric_code_id}`)
      .join(", ");
    if (linkedRequests.length > 0 && rollType === "undyed") {
      throw new Error(t("rollFabricCodeMismatch", { code: allowedCodes }));
    }

    if (rollType === "undyed") {
      const detail: UndyedFabricRollDetail = await undyedFabricRollApi.getDetail(rollId);
      if (detail.status !== "in") throw new Error(t("rollNotInStock"));
      const added = await fabricReceiptItemApi.add(resolvedKind as ReceiptKind, receiptId, {
        item_type: "UndyedFabricRoll",
        undyed_roll_id: rollId,
      });
      setScannedRolls(prev => [...prev, {
        roll_id: rollId,
        item_id: added.id,
        roll_type: "undyed",
        material_name: detail.material_name,
        color_name: t("undyedLabel"),
        weight: detail.weight,
        length: detail.length ?? null,
        lot_number: detail.lot_number ?? null,
        status: detail.status,
        client_fabric_code_id: null,
      }]);
      return;
    }

    const detail: FabricRollDetail = await fabricRollApi.getDetail(rollId);
    if (detail.status !== "in") throw new Error(t("rollNotInStock"));
    if (
      linkedRequests.length > 0 &&
      !linkedRequests.some(r => r.fabric_code_id === detail.client_fabric_code_id)
    ) {
      throw new Error(t("rollFabricCodeMismatch", { code: allowedCodes }));
    }
    const added = await fabricReceiptItemApi.add(resolvedKind as ReceiptKind, receiptId, {
      item_type: "FabricRoll",
      dyed_roll_id: rollId,
    });
    setScannedRolls(prev => [...prev, {
      roll_id: rollId,
      item_id: added.id,
      roll_type: "dyed",
      material_name: detail.material_name,
      color_name: detail.color_name,
      weight: detail.weight,
      length: detail.length ?? null,
      lot_number: detail.lot_number ?? null,
      status: detail.status,
      client_fabric_code_id: detail.client_fabric_code_id,
    }]);
  }

  async function handleUndo() {
    if (scannedRolls.length === 0) return;
    const last = scannedRolls[scannedRolls.length - 1];
    await fabricReceiptItemApi.delete(last.item_id);
    setScannedRolls(prev => prev.slice(0, -1));
  }

  async function handleRemove(itemId: number) {
    await fabricReceiptItemApi.delete(itemId);
    setScannedRolls(prev => prev.filter(r => r.item_id !== itemId));
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
        <div className="min-h-screen bg-background">
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
      <div className="min-h-screen bg-background flex">
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
                onScan={handleScan}
                onUndo={handleUndo}
                onRemove={handleRemove}
                onDone={handleDone}
                onBack={handleBack}
                fulfillmentPanel={
                  fulfillments.length > 0 ? (
                    <>
                      {fulfillments.map(f => {
                        const req = requestsById.get(f.material_request_id);
                        return req ? (
                          <FulfillmentPanel key={f.id} request={req} fulfillment={f} t={t} />
                        ) : null;
                      })}
                    </>
                  ) : undefined
                }
                t={t}
              />
            ) : (
              <SetupView
                kind={resolvedKind}
                warehouses={warehouses}
                locations={locations}
                clients={clients}
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
