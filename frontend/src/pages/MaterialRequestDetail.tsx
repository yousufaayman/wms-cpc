import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ClipboardList, Loader2, Trash2, CheckCircle2, Circle } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  materialRequestApi,
  materialRequestFulfillmentApi,
  type MaterialRequest,
  type MaterialRequestFulfillment,
  type MaterialRequestMetrics,
} from "@/lib/api";
import { toast } from "sonner";

function DetailRow({ label, value }: Readonly<{ label: string; value: React.ReactNode }>) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value ?? "—"}</span>
    </div>
  );
}

function MetricCard({ label, value, unit, sub, highlight }: Readonly<{
  label: string;
  value: number | null;
  unit: string;
  sub?: string;
  highlight?: "green" | "amber" | "red";
}>) {
  const colorMap = {
    green: "text-green-700",
    amber: "text-amber-700",
    red: "text-red-600",
  };
  const color = highlight ? colorMap[highlight] : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className={`text-2xl font-bold tabular-nums ${color}`}>
          {value != null ? value.toFixed(2) : "—"}
          {value != null && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
        </p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

export default function MaterialRequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const warehouseParam = searchParams.get("warehouse");
  const { t } = useTranslation();
  useLanguage();

  const [request, setRequest] = useState<MaterialRequest | null>(null);
  const [fulfillments, setFulfillments] = useState<MaterialRequestFulfillment[]>([]);
  const [metrics, setMetrics] = useState<MaterialRequestMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MaterialRequestFulfillment | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [req, fulls, met] = await Promise.all([
        materialRequestApi.getById(Number(id)),
        materialRequestFulfillmentApi.getAll({ material_request_id: Number(id), limit: 500 }),
        materialRequestApi.getMetrics(Number(id)),
      ]);
      setRequest(req);
      setFulfillments(fulls);
      setMetrics(met);
    } catch {
      toast.error(t("failedToLoadMaterialRequests"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [id]);

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setConfirmDelete(null);
    setDeletingId(target.id);
    try {
      await materialRequestFulfillmentApi.delete(target.id);
      toast.success(t("fulfillmentDeleted"));
      await load();
    } catch {
      toast.error(t("failedToDeleteFulfillment"));
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return (
      <PageTransition>
        <div className="flex h-screen bg-background overflow-hidden">
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </main>
        </div>
      </PageTransition>
    );
  }

  if (!request) {
    return (
      <PageTransition>
        <div className="flex h-screen bg-background overflow-hidden">
          <Sidebar />
          <main className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">{t("noMaterialRequests")}</p>
          </main>
        </div>
      </PageTransition>
    );
  }

  const unit = request.measurement_scale;
  const progressPct = metrics && metrics.requested_quantity
    ? Math.min(100, (metrics.total_issued / metrics.requested_quantity) * 100)
    : null;
  const remainingHighlight = metrics?.remaining != null
    ? (metrics.remaining <= 0 ? "green" : metrics.remaining < (metrics.requested_quantity ?? Infinity) * 0.2 ? "amber" : undefined)
    : undefined;

  return (
    <PageTransition>
      <div className="flex h-screen bg-background overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col p-6 gap-6 min-w-0 overflow-y-auto">

          {/* Header */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/material-requests${warehouseParam ? `?warehouse=${warehouseParam}` : ""}`)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2 min-w-0">
              <ClipboardList className="h-5 w-5 text-primary shrink-0" />
              <h1 className="text-xl font-bold truncate">
                {t("requestDetails")} #{request.id}
              </h1>
              <Badge
                variant="outline"
                className={request.fulfilled
                  ? "border-green-400 text-green-700 bg-green-50"
                  : "border-amber-400 text-amber-700 bg-amber-50"}
              >
                {request.fulfilled
                  ? <><CheckCircle2 className="h-3 w-3 mr-1 inline" />{t("statusFulfilled")}</>
                  : <><Circle className="h-3 w-3 mr-1 inline" />{t("statusPending")}</>}
              </Badge>
            </div>
          </div>

          {/* Request details */}
          <Card>
            <CardContent className="p-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
              <DetailRow
                label={t("jobOrderNumber")}
                value={<span className="font-mono">{request.job_order?.job_order_number ?? `#${request.job_order_id}`}</span>}
              />
              <DetailRow label={t("client")} value={request.fabric_code?.client?.name ?? request.job_order?.client?.name} />
              <DetailRow label={t("panelType")} value={request.panel_type} />
              <DetailRow
                label={t("fabricCode")}
                value={<span className="font-mono">{request.fabric_code?.fabric_code}</span>}
              />
              <DetailRow label={t("material")} value={request.fabric_code?.material?.name} />
              <DetailRow label={t("color")} value={request.fabric_code?.color?.name} />
              <DetailRow label={t("consumption")} value={`${request.consumption} ${unit}`} />
              <DetailRow
                label={t("quantity")}
                value={request.quantity != null ? `${request.quantity} ${unit}` : "—"}
              />
            </CardContent>
          </Card>

          {/* Metrics */}
          {metrics && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <MetricCard
                  label={t("quantity")}
                  value={metrics.requested_quantity}
                  unit={unit}
                />
                <MetricCard
                  label={t("issuedFromRolls")}
                  value={metrics.issued_from_rolls}
                  unit={unit}
                  sub={unit.toUpperCase() === "KG" || unit.toUpperCase() === "KGS" ? t("weight") : t("length")}
                />
                <MetricCard
                  label={t("issuedManually")}
                  value={metrics.issued_manually}
                  unit={unit}
                />
                <MetricCard
                  label={t("remaining")}
                  value={metrics.remaining}
                  unit={unit}
                  highlight={remainingHighlight}
                />
              </div>
              {progressPct != null && (
                <div className="flex items-center gap-3">
                  <Progress value={progressPct} className="flex-1 h-2" />
                  <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">
                    {progressPct.toFixed(0)}%
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Fulfillment history */}
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CardHeader className="pb-3 shrink-0">
              <CardTitle className="text-base">{t("fulfillmentHistory")}</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-auto min-h-0">
              {fulfillments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <ClipboardList className="h-10 w-10 text-muted-foreground" />
                  <p className="text-muted-foreground text-sm">{t("noFulfillments")}</p>
                </div>
              ) : (
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>{t("linkedReceipt")}</TableHead>
                      <TableHead className="text-right whitespace-nowrap">{t("quantityIssued")}</TableHead>
                      <TableHead>{t("notes")}</TableHead>
                      <TableHead className="whitespace-nowrap">{t("createdAt")}</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fulfillments.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-sm text-muted-foreground">{f.id}</TableCell>
                        <TableCell className="text-sm font-mono">
                          {f.internal_receipt_id != null ? `#${f.internal_receipt_id}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                          {f.quantity_issued != null ? `${f.quantity_issued} ${unit}` : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{f.notes ?? "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {new Date(f.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            disabled={deletingId === f.id}
                            onClick={() => setConfirmDelete(f)}
                          >
                            {deletingId === f.id
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <Trash2 className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </main>
      </div>

      {/* Delete confirmation */}
      <Dialog open={confirmDelete !== null} onOpenChange={open => { if (!open) setConfirmDelete(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteFulfillment")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("confirmDeleteFulfillment")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleConfirmDelete}>{t("delete")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
