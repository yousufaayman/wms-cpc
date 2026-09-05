import { useEffect, useState, useMemo, Fragment } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, FileText, Calendar, User, Loader2, CheckCircle, XCircle, Plus, Trash2 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import LanguageToggle from "@/components/LanguageToggle";
import {
  supplierReceiptApi, type SupplierReceipt,
  internalReceiptApi, type InternalReceipt,
  externalReceiptApi, type ExternalReceipt,
  warehouseApi, type Warehouse,
  logicalLocationApi, type LogicalLocation,
  fabricReceiptItemApi, type FabricReceiptItem, type ReceiptKind,
  fabricRollApi, type FabricRollDetail,
  undyedFabricRollApi, type UndyedFabricRollDetail,
} from "@/lib/api";
import { buildMaterialGroups, fmt, type RollSummary, type MaterialGroup } from "@/lib/receiptAggregation";

type AnyReceipt = SupplierReceipt | InternalReceipt | ExternalReceipt;

const CURRENT_USER_ID = 1;

function formatDate(ds: string) {
  return new Date(ds).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function ClosedBadge({ closed, t }: Readonly<{ closed: boolean; t: (k: string) => string }>) {
  return <Badge variant={closed ? "destructive" : "default"}>{closed ? t("closedReceipt") : t("openReceipt")}</Badge>;
}

async function fetchReceiptByKind(kind: ReceiptKind, id: number): Promise<AnyReceipt> {
  if (kind === "supplier") return supplierReceiptApi.getById(id);
  if (kind === "internal") return internalReceiptApi.getById(id);
  return externalReceiptApi.getById(id);
}

async function closeReceiptByKind(kind: ReceiptKind, id: number): Promise<void> {
  if (kind === "supplier") { await supplierReceiptApi.close(id, CURRENT_USER_ID); return; }
  if (kind === "internal") { await internalReceiptApi.close(id, CURRENT_USER_ID); return; }
  await externalReceiptApi.close(id, CURRENT_USER_ID);
}

async function openReceiptByKind(kind: ReceiptKind, id: number): Promise<void> {
  if (kind === "supplier") { await supplierReceiptApi.open(id); return; }
  if (kind === "internal") { await internalReceiptApi.open(id); return; }
  await externalReceiptApi.open(id);
}

async function deleteReceiptByKind(kind: ReceiptKind, id: number): Promise<void> {
  if (kind === "supplier") { await supplierReceiptApi.delete(id); return; }
  if (kind === "internal") { await internalReceiptApi.delete(id); return; }
  await externalReceiptApi.delete(id);
}

function getKindLabel(kind: ReceiptKind | undefined, t: (key: string) => string): string {
  if (kind === "internal") return t("internalReceipts");
  if (kind === "external") return t("externalReceipts");
  return t("supplierReceipts");
}

interface RollDetail extends RollSummary {
  roll_id: number;
}

async function fetchItemsWithDetails(
  kind: ReceiptKind,
  receiptId: number,
): Promise<{
  items: FabricReceiptItem[];
  rollDetails: Map<number, FabricRollDetail>;
  undyedRollDetails: Map<number, UndyedFabricRollDetail>;
}> {
  const items = await fabricReceiptItemApi.list(kind, receiptId);
  const dyedRollIds = items
    .filter((i): i is FabricReceiptItem & { dyed_roll_id: number } =>
      i.item_type === "FabricRoll" && i.dyed_roll_id != null)
    .map(i => i.dyed_roll_id);
  const undyedRollIds = items
    .filter((i): i is FabricReceiptItem & { undyed_roll_id: number } =>
      i.item_type === "UndyedFabricRoll" && i.undyed_roll_id != null)
    .map(i => i.undyed_roll_id);
  const [dyedResults, undyedResults] = await Promise.all([
    Promise.allSettled(dyedRollIds.map(rid => fabricRollApi.getDetail(rid))),
    Promise.allSettled(undyedRollIds.map(rid => undyedFabricRollApi.getDetail(rid))),
  ]);
  const rollDetails = new Map<number, FabricRollDetail>();
  dyedResults.forEach((res, idx) => {
    if (res.status === "fulfilled") rollDetails.set(dyedRollIds[idx], res.value);
  });
  const undyedRollDetails = new Map<number, UndyedFabricRollDetail>();
  undyedResults.forEach((res, idx) => {
    if (res.status === "fulfilled") undyedRollDetails.set(undyedRollIds[idx], res.value);
  });
  return { items, rollDetails, undyedRollDetails };
}

function ItemsContent({
  itemsLoading, fabricGroups, fabricSummaries, grandLength, grandWeight, t,
}: Readonly<{
  itemsLoading: boolean;
  fabricGroups: MaterialGroup[];
  fabricSummaries: RollDetail[];
  grandLength: number | null;
  grandWeight: number;
  t: (k: string) => string;
}>) {
  if (itemsLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (fabricGroups.length === 0) {
    return <p className="text-muted-foreground text-sm text-center py-4">{t("noItemsFound")}</p>;
  }
  return (
    <div className="overflow-x-auto">
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
          {fabricGroups.map(mat => (
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
            <TableCell className="text-right">{fabricSummaries.length}</TableCell>
            <TableCell className="text-right">{fmt(grandLength)}</TableCell>
            <TableCell className="text-right">{fmt(grandWeight)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

const ReceiptDetail = () => {
  const { kind, id } = useParams<{ kind: ReceiptKind; id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { isAdmin, can } = useCurrentUser();

  const warehouseParam = searchParams.get("warehouse");
  const warehouseQuery = warehouseParam ? `?warehouse=${warehouseParam}` : "";

  const [receipt, setReceipt] = useState<AnyReceipt | null>(null);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [logicalLocations, setLogicalLocations] = useState<LogicalLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [items, setItems] = useState<FabricReceiptItem[]>([]);
  const [rollDetails, setRollDetails] = useState<Map<number, FabricRollDetail>>(new Map());
  const [undyedRollDetails, setUndyedRollDetails] = useState<Map<number, UndyedFabricRollDetail>>(new Map());
  const [itemsLoading, setItemsLoading] = useState(false);

  async function loadItems(receiptId: number) {
    if (!kind) return;
    setItemsLoading(true);
    try {
      const result = await fetchItemsWithDetails(kind, receiptId);
      setItems(result.items);
      setRollDetails(result.rollDetails);
      setUndyedRollDetails(result.undyedRollDetails);
    } finally {
      setItemsLoading(false);
    }
  }

  async function loadReceipt() {
    if (!id || !kind) return;
    setLoading(true);
    setError(null);
    try {
      const rid = parseInt(id);
      const [ws, lls] = await Promise.all([
        warehouseApi.getAll(),
        logicalLocationApi.getAll({ limit: 500 }),
      ]);
      setWarehouses(ws);
      setLogicalLocations(lls);
      const data = await fetchReceiptByKind(kind, rid);
      setReceipt(data);
      await loadItems(rid);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load receipt");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadReceipt(); }, [id, kind]);

  async function handleAction(op: () => Promise<void>) {
    setActionLoading(true);
    try { await op(); loadReceipt(); }
    finally { setActionLoading(false); }
  }

  const fabricSummaries = useMemo<RollDetail[]>(() => {
    return items.reduce<RollDetail[]>((acc, i) => {
      if (i.item_type === "FabricRoll" && i.dyed_roll_id != null) {
        const d = rollDetails.get(i.dyed_roll_id);
        if (d) {
          acc.push({ roll_id: i.dyed_roll_id, material_name: d.material_name, color_name: d.color_name, weight: d.weight, length: d.length ?? null });
        }
      } else if (i.item_type === "UndyedFabricRoll" && i.undyed_roll_id != null) {
        const d = undyedRollDetails.get(i.undyed_roll_id);
        if (d) {
          acc.push({ roll_id: i.undyed_roll_id, material_name: d.material_name, color_name: t("undyedLabel"), weight: d.weight, length: d.length ?? null });
        }
      }
      return acc;
    }, []);
  }, [items, rollDetails, undyedRollDetails, t]);

  const fabricGroups = useMemo<MaterialGroup[]>(
    () => buildMaterialGroups(fabricSummaries),
    [fabricSummaries],
  );

  const grandWeight = fabricSummaries.reduce((s, r) => s + r.weight, 0);
  const hasLength = fabricSummaries.some(r => r.length !== null);
  const grandLength = hasLength ? fabricSummaries.reduce((s, r) => s + (r.length ?? 0), 0) : null;

  const kindLabel = getKindLabel(kind, t);

  if (loading) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background">
          <div className="absolute top-4 right-4"><LanguageToggle /></div>
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-primary">{t("loading")}</h1>
            </div>
          </div>
        </div>
      </PageTransition>
    );
  }

  if (error || !receipt) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background flex">
          <Sidebar />
          <main className="flex-1 p-8 flex items-center justify-center">
            <div className="text-center">
              <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h1 className="text-2xl font-bold mb-2">{t("receiptNotFound")}</h1>
              <p className="text-muted-foreground mb-4">{error}</p>
              <Button onClick={() => navigate(`/receipts${warehouseQuery}`)}><ArrowLeft className="h-4 w-4 mr-2" />{t("back")}</Button>
            </div>
          </main>
        </div>
      </PageTransition>
    );
  }

  const warehouseName = (wid: number) => warehouses.find(w => w.id === wid)?.name ?? `#${wid}`;
  const locationName = (lid: number) => logicalLocations.find(l => l.id === lid)?.name ?? `#${lid}`;

  const internalReceipt = kind === "internal" ? (receipt as InternalReceipt) : null;
  const supplierReceipt = kind === "supplier" ? (receipt as SupplierReceipt) : null;
  const externalReceipt = kind === "external" ? (receipt as ExternalReceipt) : null;

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          <div className="space-y-4">
            {/* Page header */}
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={() => navigate(`/receipts${warehouseQuery}`)} className="p-1 h-auto">
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <FileText className="h-6 w-6 text-primary" />
              <div>
                <h1 className="text-2xl font-bold text-primary leading-tight">Receipt #{receipt.id}</h1>
                <p className="text-muted-foreground text-sm">{kindLabel}</p>
              </div>
            </div>

            {/* Details — full width */}
            <Card>
              <CardHeader><CardTitle>{t("details")}</CardTitle></CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-x-8 gap-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm">{t("status")}</span>
                    <ClosedBadge closed={receipt.closed} t={t} />
                  </div>
                  {internalReceipt && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">{t("workflow")}</span>
                      <Badge variant={internalReceipt.status === "confirmed" ? "default" : "secondary"}>
                        {internalReceipt.status}
                      </Badge>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-sm">{t("sourceWarehouse")}</span>
                    <span className="font-medium">{warehouseName(receipt.source_warehouse_id)}</span>
                  </div>
                  {(supplierReceipt || internalReceipt) && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">{t("targetLocation")}</span>
                      <span className="font-medium">
                        {locationName((supplierReceipt ?? internalReceipt)!.target_logical_location_id)}
                      </span>
                    </div>
                  )}
                  {externalReceipt && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">{t("receiver")}</span>
                      <span className="font-medium">{externalReceipt.receiver}</span>
                    </div>
                  )}
                  {supplierReceipt?.remarks && (
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground text-sm">{t("receiptRemarks")}</span>
                      <span className="font-medium">{supplierReceipt.remarks}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Timeline — full width, one row */}
            <Card>
              <CardContent className="pt-4">
                <div className="flex flex-wrap gap-x-8 gap-y-2">
                  {receipt.issued_by != null && (
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{t("issuedBy")}</span>
                      <span className="text-sm font-medium">User #{receipt.issued_by}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{t("issuedAt")}</span>
                    <span className="text-sm font-medium">{formatDate(receipt.issued_at)}</span>
                  </div>
                  {internalReceipt?.confirmed_by != null && (
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{t("confirmedBy")}</span>
                      <span className="text-sm font-medium">User #{internalReceipt.confirmed_by}</span>
                    </div>
                  )}
                  {receipt.closed_by != null && (
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{t("closedBy")}</span>
                      <span className="text-sm font-medium">User #{receipt.closed_by}</span>
                    </div>
                  )}
                  {(supplierReceipt?.closed_at || externalReceipt?.closed_at) && (
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">{t("closedAt")}</span>
                      <span className="text-sm font-medium">
                        {formatDate(supplierReceipt?.closed_at ?? externalReceipt?.closed_at ?? "")}
                      </span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Actions — no header, one row */}
            <div className="flex flex-wrap items-center gap-2 px-1">
              {internalReceipt && internalReceipt.status === "issued" && can('confirm_receipts') && (
                <Button onClick={() => handleAction(() => internalReceiptApi.confirm(receipt.id, CURRENT_USER_ID))} disabled={actionLoading}>
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  {t("confirmReceipt")}
                </Button>
              )}
              {receipt.closed && isAdmin && (
                <Button variant="outline" onClick={() => handleAction(() => openReceiptByKind(kind, receipt.id))} disabled={actionLoading}>
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
                  {t("reopenReceipt")}
                </Button>
              )}
              {!receipt.closed && can('create_receipts') && (
                <Button variant="destructive" onClick={() => handleAction(() => closeReceiptByKind(kind, receipt.id))} disabled={actionLoading}>
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4 mr-2" />}
                  {t("closeReceipt")}
                </Button>
              )}
              {can('delete_receipts') && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={actionLoading}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      {t("deleteReceipt")}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{t("confirmDeleteReceiptTitle")}</AlertDialogTitle>
                      <AlertDialogDescription>{t("confirmDeleteReceiptDesc")}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          setActionLoading(true);
                          try {
                            await deleteReceiptByKind(kind, receipt.id);
                            navigate(`/receipts${warehouseQuery}`);
                          } finally {
                            setActionLoading(false);
                          }
                        }}
                      >
                        {t("delete")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>

            {/* Receipt items — full width */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{t("receiptItems")}</CardTitle>
                  {!receipt.closed && can('create_receipts') && (
                    <Button
                      size="sm"
                      onClick={() =>
                        navigate(`/receipts/create/${kind}?receipt_id=${receipt.id}&warehouse=${receipt.source_warehouse_id}`)
                      }
                    >
                      <Plus className="h-4 w-4 mr-1" />{t("addItem")}
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <ItemsContent
                  itemsLoading={itemsLoading}
                  fabricGroups={fabricGroups}
                  fabricSummaries={fabricSummaries}
                  grandLength={grandLength}
                  grandWeight={grandWeight}
                  t={t}
                />
              </CardContent>
            </Card>

          </div>{/* end space-y-4 */}
        </main>
      </div>
    </PageTransition>
  );
};

export default ReceiptDetail;
