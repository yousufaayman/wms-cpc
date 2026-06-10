import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ClipboardList, Loader2, Search, CheckCircle2, Circle, Eye } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { materialRequestApi, type MaterialRequest, type RequestBulkMetrics } from "@/lib/api";
import { toast } from "sonner";

function FulfilledToggle({ fulfilled, toggling, label, onClick, isAdmin }: Readonly<{
  fulfilled: boolean;
  toggling: boolean;
  label: string;
  onClick: () => void;
  isAdmin: boolean;
}>) {
  const disabled = toggling || !isAdmin;
  return (
    <button
      onClick={isAdmin ? onClick : undefined}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded p-1 transition-colors ${
        isAdmin ? "hover:bg-muted" : "cursor-default"
      } disabled:opacity-50`}
      title={label}
    >
      {toggling && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
      {!toggling && fulfilled && <CheckCircle2 className="h-5 w-5 text-green-600" />}
      {!toggling && !fulfilled && <Circle className="h-5 w-5 text-muted-foreground" />}
    </button>
  );
}

export default function MaterialRequests() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  useLanguage();
  const { isAdmin } = useCurrentUser();

  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [metricsMap, setMetricsMap] = useState<Map<number, RequestBulkMetrics>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<MaterialRequest | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await materialRequestApi.getAll({ limit: 500 });
      setRequests(data);
      if (data.length > 0) {
        const bulk = await materialRequestApi.getBulkMetrics(data.map(r => r.id));
        setMetricsMap(new Map(bulk.map(m => [m.id, m])));
      }
    } catch {
      toast.error(t("failedToLoadMaterialRequests"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [searchParams.get("warehouse")]);

  const handleConfirmToggle = async () => {
    if (!confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    setTogglingId(target.id);
    try {
      await materialRequestApi.forceSetFulfilled(target.id, !target.fulfilled);
      toast.success(t("materialRequestStatusUpdated"));
      await load();
    } catch {
      toast.error(t("failedToUpdateMaterialRequestStatus"));
    } finally {
      setTogglingId(null);
    }
  };

  const filtered = requests.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const fields = [
      String(r.job_order_id),
      r.job_order?.job_order_number ?? "",
      r.panel_type,
      r.measurement_scale,
      r.fabric_code?.fabric_code ?? "",
      r.fabric_code?.material?.name ?? "",
      r.fabric_code?.color?.name ?? "",
      r.fabric_code?.client?.name ?? "",
    ];
    return fields.some(f => f.toLowerCase().includes(q));
  }).sort((a, b) => {
    if (a.fulfilled === b.fulfilled) return a.id - b.id;
    return a.fulfilled ? 1 : -1;
  });

  return (
    <PageTransition>
      <div className="flex h-screen bg-background overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col p-6 gap-6 min-w-0 overflow-hidden">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <ClipboardList className="h-6 w-6 text-primary" />
                {t("materialRequests")}
              </h1>
              <p className="text-muted-foreground text-sm mt-1">{t("materialRequestsDesc")}</p>
            </div>
          </div>

          {/* Search */}
          <div className="flex gap-3 items-center">
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder={t("search")}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {search && (
              <span className="text-sm text-muted-foreground">
                {filtered.length} / {requests.length}
              </span>
            )}
          </div>

          {/* Table */}
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CardContent className="p-0 flex-1 overflow-auto min-h-0">
              {loading && (
                <div className="flex justify-center items-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <ClipboardList className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground font-medium">{t("noMaterialRequests")}</p>
                  <p className="text-sm text-muted-foreground">{t("createFirstRequest")}</p>
                </div>
              )}
              {!loading && filtered.length > 0 && (
                <Table className="min-w-[1100px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">#</TableHead>
                      <TableHead>{t("jobOrderNumber")}</TableHead>
                      <TableHead>{t("client")}</TableHead>
                      <TableHead>{t("panelType")}</TableHead>
                      <TableHead>{t("fabricCode")}</TableHead>
                      <TableHead>{t("material")}</TableHead>
                      <TableHead>{t("color")}</TableHead>
                      <TableHead className="text-right">{t("consumption")}</TableHead>
                      <TableHead className="text-right whitespace-nowrap">{t("quantity")}</TableHead>
                      <TableHead className="text-right whitespace-nowrap">{t("issued")}</TableHead>
                      <TableHead className="text-right whitespace-nowrap">{t("remaining")}</TableHead>
                      <TableHead className="text-center w-28">{t("statusFulfilled")}</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <TableRow
                        key={r.id}
                        className={r.fulfilled ? "bg-green-50 dark:bg-green-950/20 opacity-50 line-through-none" : ""}
                      >
                        <TableCell className="font-mono text-sm text-muted-foreground">{r.id}</TableCell>
                        <TableCell className="font-medium font-mono">
                          {r.job_order?.job_order_number ?? `#${r.job_order_id}`}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.fabric_code?.client?.name ?? r.job_order?.client?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">{r.panel_type}</TableCell>
                        <TableCell className="text-sm font-mono">
                          {r.fabric_code?.fabric_code ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.fabric_code?.material?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.fabric_code?.color?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {r.consumption} {r.measurement_scale}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                          {r.quantity != null ? `${r.quantity} ${r.measurement_scale}` : "—"}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                          {(() => {
                            const m = metricsMap.get(r.id);
                            return m ? `${m.total_issued} ${r.measurement_scale}` : "—";
                          })()}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                          {(() => {
                            const m = metricsMap.get(r.id);
                            if (!m || m.remaining == null) return <span className="text-muted-foreground">—</span>;
                            const color = m.remaining <= 0
                              ? "text-green-600"
                              : m.remaining < (r.quantity ?? Infinity) * 0.2
                                ? "text-amber-600"
                                : "text-foreground";
                            return <span className={color}>{m.remaining} {r.measurement_scale}</span>;
                          })()}
                        </TableCell>
                        <TableCell className="text-center">
                          <FulfilledToggle
                            fulfilled={r.fulfilled}
                            toggling={togglingId === r.id}
                            label={r.fulfilled ? t("statusFulfilled") : t("statusPending")}
                            onClick={() => setConfirmTarget(r)}
                            isAdmin={isAdmin}
                          />
                        </TableCell>
                        <TableCell>
                          <button
                            onClick={() => {
                              const wh = searchParams.get("warehouse");
                              navigate(`/material-requests/${r.id}${wh ? `?warehouse=${wh}` : ""}`);
                            }}
                            className="inline-flex items-center justify-center rounded p-1 hover:bg-muted transition-colors"
                            title={t("viewDetails")}
                          >
                            <Eye className="h-4 w-4 text-muted-foreground" />
                          </button>
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

      {/* Confirmation dialog */}
      <Dialog open={confirmTarget !== null} onOpenChange={open => { if (!open) setConfirmTarget(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {confirmTarget?.fulfilled ? t("forceUnfulfill") : t("forceFulfill")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirmTarget?.fulfilled
              ? t("confirmForceUnfulfill")
              : t("confirmForceFulfill")}
          </p>
          <p className="text-xs text-muted-foreground font-mono">
            {confirmTarget?.job_order?.job_order_number ?? `#${confirmTarget?.job_order_id}`}
            {" — "}
            {confirmTarget?.panel_type}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>{t("cancel")}</Button>
            <Button
              variant={confirmTarget?.fulfilled ? "outline" : "default"}
              onClick={handleConfirmToggle}
            >
              {confirmTarget?.fulfilled ? t("forceUnfulfill") : t("forceFulfill")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
