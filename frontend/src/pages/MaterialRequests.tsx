import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckCircle2, ClipboardList, Loader2, PackageOpen, ReceiptText, Trash2, Undo2 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { Combobox } from "@/components/Combobox";
import { ReceiverField } from "@/components/ReceiverField";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  materialRequestApi, type MaterialRequest,
  materialRequestFulfillmentApi,
  warehouseApi, type Warehouse,
  logicalLocationApi, type LogicalLocation,
  clientApi, type Client,
  internalReceiptApi, supplierReceiptApi, externalReceiptApi,
  type ReceiptKind,
} from "@/lib/api";
import { toast } from "sonner";

function FulfilledBadge({ fulfilled, label }: Readonly<{ fulfilled: boolean; label: string }>) {
  const style = fulfilled
    ? "bg-green-100 text-green-800 border-green-300"
    : "bg-amber-100 text-amber-800 border-amber-300";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${style}`}>
      {label}
    </span>
  );
}

function fmtQty(value: number | null | undefined) {
  if (value == null) return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 });
}

const PAGE_SIZE = 25;

export default function MaterialRequests() {
  const { t } = useTranslation();
  useLanguage();
  const { user, isAdmin } = useCurrentUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseParam = searchParams.get("warehouse");
  const fulfillParam = searchParams.get("fulfill");

  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobOrderSearch, setJobOrderSearch] = useState("");
  const [fulfilledFilter, setFulfilledFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  // Issue-receipt modal
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<LogicalLocation[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [issueFor, setIssueFor] = useState<MaterialRequest | null>(null);
  const [receiptKind, setReceiptKind] = useState<ReceiptKind>("internal");
  const [sourceWarehouseId, setSourceWarehouseId] = useState<number | null>(
    warehouseParam ? Number(warehouseParam) : null,
  );
  const [targetLocationId, setTargetLocationId] = useState<number | null>(null);
  const [receiver, setReceiver] = useState("");
  const [creatingReceipt, setCreatingReceipt] = useState(false);
  const [receiptMode, setReceiptMode] = useState<"new" | "existing">("new");
  const [existingReceipts, setExistingReceipts] = useState<{ id: number; label: string; warehouseId: number }[]>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);

  useEffect(() => {
    setLoading(true);
    // The API returns requests sorted by job order priority (most urgent first)
    materialRequestApi
      .getAll({ limit: 500 })
      .then(setRequests)
      .catch(() => toast.error(t("failedToLoadMaterialRequests")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = requests.filter(r => {
    if (fulfilledFilter === "fulfilled" && !r.fulfilled) return false;
    if (fulfilledFilter === "unfulfilled" && r.fulfilled) return false;
    if (jobOrderSearch) {
      const q = jobOrderSearch.toLowerCase();
      const number = r.job_order?.job_order_number?.toLowerCase() ?? "";
      const client = r.job_order?.client?.name?.toLowerCase() ?? "";
      if (!number.includes(q) && !client.includes(q)) return false;
    }
    return true;
  });

  // Fulfilled requests sink to the bottom; the stable sort keeps the server's
  // priority order within each group.
  filtered.sort((a, b) => Number(a.fulfilled) - Number(b.fulfilled));

  useEffect(() => {
    Promise.all([warehouseApi.getAll(), logicalLocationApi.getAll({ limit: 500 }), clientApi.getAll()])
      .then(([ws, lls, cs]) => { setWarehouses(ws); setLocations(lls); setClients(cs); })
      .catch(e => console.error("Failed to load reference data", e));
  }, []);

  // Deep link (?fulfill=<id>, e.g. from the dashboard widget): open the
  // issue-receipt dialog for that request once the list has loaded, then strip
  // the param so closing the dialog doesn't re-trigger it.
  useEffect(() => {
    if (loading || !fulfillParam) return;
    const target = requests.find(r => r.id === Number(fulfillParam) && !r.fulfilled);
    if (target) setIssueFor(target);
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("fulfill");
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, fulfillParam]);

  const resetIssueForm = () => {
    setReceiptKind("internal");
    setTargetLocationId(null);
    setReceiver("");
    setReceiptMode("new");
    setSelectedReceiptId(null);
  };

  // Existing-receipt mode: load the open receipts of the selected kind
  useEffect(() => {
    if (!issueFor || receiptMode !== "existing") return;
    setLoadingReceipts(true);
    setSelectedReceiptId(null);
    const filters = {
      closed: false,
      limit: 200,
      ...(sourceWarehouseId != null ? { warehouse_id: sourceWarehouseId } : {}),
    };
    const locName = (id: number) => locations.find(l => l.id === id)?.name ?? `#${id}`;
    const load = async () => {
      if (receiptKind === "internal") {
        const rs = await internalReceiptApi.getAll(filters);
        return rs.map(r => ({ id: r.id, label: `#${r.id} → ${locName(r.target_logical_location_id)}`, warehouseId: r.source_warehouse_id }));
      }
      if (receiptKind === "supplier") {
        const rs = await supplierReceiptApi.getAll(filters);
        return rs.map(r => ({ id: r.id, label: `#${r.id} → ${locName(r.target_logical_location_id)}`, warehouseId: r.source_warehouse_id }));
      }
      const rs = await externalReceiptApi.getAll(filters);
      return rs.map(r => ({ id: r.id, label: `#${r.id} → ${r.receiver}`, warehouseId: r.source_warehouse_id }));
    };
    load()
      .then(rs => setExistingReceipts(rs.sort((a, b) => b.id - a.id)))
      .catch(() => toast.error(t("failedToLoadReceipts")))
      .finally(() => setLoadingReceipts(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueFor, receiptMode, receiptKind, sourceWarehouseId, locations]);

  // internal/supplier receipts target a logical location of the matching type
  const filteredLocations = locations.filter(l =>
    receiptKind === "supplier" ? l.location_type === "supplier" : l.location_type === "internal",
  );

  const canIssue =
    issueFor !== null &&
    (receiptMode === "existing"
      ? selectedReceiptId !== null
      : sourceWarehouseId !== null &&
        (receiptKind === "external" ? receiver.trim().length > 0 : targetLocationId !== null));

  const linkRequestToReceipt = async (receiptId: number) => {
    await materialRequestFulfillmentApi.create({
      material_request_id: issueFor!.id,
      internal_receipt_id: receiptKind === "internal" ? receiptId : undefined,
      supplier_receipt_id: receiptKind === "supplier" ? receiptId : undefined,
      external_receipt_id: receiptKind === "external" ? receiptId : undefined,
      measurement_scale: issueFor!.measurement_scale,
      quantity_issued: 0,
    });
  };

  const handleIssueReceipt = async () => {
    if (!issueFor || !canIssue) return;
    setCreatingReceipt(true);
    try {
      if (receiptMode === "existing") {
        const receipt = existingReceipts.find(r => r.id === selectedReceiptId);
        if (!receipt) return;
        // A request may fulfill alongside others, but not twice on one receipt
        const kindFilter =
          receiptKind === "internal" ? { internal_receipt_id: receipt.id }
          : receiptKind === "supplier" ? { supplier_receipt_id: receipt.id }
          : { external_receipt_id: receipt.id };
        const linked = await materialRequestFulfillmentApi.getAll(kindFilter);
        if (linked.some(f => f.material_request_id === issueFor.id)) {
          toast.error(t("requestAlreadyLinked"));
          return;
        }
        await linkRequestToReceipt(receipt.id);
        navigate(`/receipts/create/${receiptKind}?receipt_id=${receipt.id}&warehouse=${receipt.warehouseId}`);
        return;
      }
      const issuedBy = user?.id ?? 1;
      let receiptId: number;
      if (receiptKind === "internal") {
        receiptId = (await internalReceiptApi.create(
          { source_warehouse_id: sourceWarehouseId!, target_logical_location_id: targetLocationId! },
          issuedBy,
        )).id;
      } else if (receiptKind === "supplier") {
        receiptId = (await supplierReceiptApi.create(
          { source_warehouse_id: sourceWarehouseId!, target_logical_location_id: targetLocationId!, remarks: null },
          issuedBy,
        )).id;
      } else {
        receiptId = (await externalReceiptApi.create(
          { source_warehouse_id: sourceWarehouseId!, receiver: receiver.trim() },
          issuedBy,
        )).id;
      }
      await linkRequestToReceipt(receiptId);
      // The scan view discovers the material request link from the receipt
      // itself, so only the receipt id needs to travel in the URL.
      navigate(`/receipts/create/${receiptKind}?receipt_id=${receiptId}&warehouse=${sourceWarehouseId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failedToCreateReceipt"));
    } finally {
      setCreatingReceipt(false);
    }
  };

  const handleToggleFulfilled = async (id: number, fulfilled: boolean) => {
    setTogglingId(id);
    try {
      const updated = await materialRequestApi.forceSetFulfilled(id, fulfilled);
      setRequests(prev => prev.map(r => (r.id === updated.id ? updated : r)));
      toast.success(t("materialRequestStatusUpdated"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failedToUpdateMaterialRequestStatus"));
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    setDeleting(true);
    try {
      await materialRequestApi.delete(deleteId);
      setRequests(prev => prev.filter(r => r.id !== deleteId));
      setDeleteId(null);
      toast.success(t("materialRequestDeleted"));
    } catch {
      toast.error(t("failedToDeleteMaterialRequest"));
    } finally {
      setDeleting(false);
    }
  };

  // Clamp instead of storing the page so filter changes can never leave the
  // view on an empty page.
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const showingFrom = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(currentPage * PAGE_SIZE, filtered.length);

  return (
    <PageTransition>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        {/* min-w-0 lets the requests table scroll inside its own overflow
            wrapper instead of widening the whole page */}
        <main className="flex-1 min-w-0 p-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <ClipboardList className="h-6 w-6 text-primary" />
              {t("materialRequests")}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{t("materialRequestsDesc")}</p>
          </div>

          <Tabs defaultValue="job-orders">
            <TabsList>
              <TabsTrigger value="job-orders">{t("jobOrdersTab")}</TabsTrigger>
              <TabsTrigger value="others">{t("othersTab")}</TabsTrigger>
            </TabsList>

            <TabsContent value="job-orders" className="space-y-4 mt-4">
              {/* Filters */}
              <div className="flex gap-3 flex-wrap">
                <Input
                  placeholder={t("searchJobOrder")}
                  value={jobOrderSearch}
                  onChange={e => { setJobOrderSearch(e.target.value); setPage(1); }}
                  className="w-56"
                />
                <Select value={fulfilledFilter} onValueChange={v => { setFulfilledFilter(v); setPage(1); }}>
                  <SelectTrigger className="w-44">
                    <SelectValue placeholder={t("filterByStatus")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("allStatuses")}</SelectItem>
                    <SelectItem value="unfulfilled">{t("statusUnfulfilled")}</SelectItem>
                    <SelectItem value="fulfilled">{t("statusFulfilled")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Table */}
              <Card>
                <CardContent className="p-0">
                  {loading ? (
                    <div className="flex justify-center items-center py-16">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                      <PackageOpen className="h-12 w-12 text-muted-foreground" />
                      <p className="text-muted-foreground font-medium">{t("noMaterialRequests")}</p>
                    </div>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-20 text-center">{t("priority")}</TableHead>
                          <TableHead>{t("jobOrderNumber")}</TableHead>
                          <TableHead>{t("panelType")}</TableHead>
                          <TableHead>{t("fabricCode")}</TableHead>
                          <TableHead>{t("color")}</TableHead>
                          <TableHead className="text-right">{t("consumption")}</TableHead>
                          <TableHead className="text-right">{t("quantity")}</TableHead>
                          <TableHead>{t("requestStatus")}</TableHead>
                          <TableHead className="w-28">{t("actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pageRows.map(r => (
                          <TableRow key={r.id} className={r.fulfilled ? "line-through text-muted-foreground opacity-60" : ""}>
                            <TableCell className="text-center font-mono text-sm">
                              {r.job_order?.priority ?? "—"}
                            </TableCell>
                            <TableCell className={`font-semibold ${r.fulfilled ? "" : "text-primary"}`}>
                              {r.job_order?.job_order_number ?? `#${r.job_order_id}`}
                            </TableCell>
                            <TableCell className="text-sm">{r.panel_type}</TableCell>
                            <TableCell className={`font-mono font-semibold ${r.fulfilled ? "" : "text-primary"}`}>
                              {r.fabric_code?.fabric_code ?? "—"}
                            </TableCell>
                            <TableCell className="text-sm">{r.fabric_code?.color?.name ?? "—"}</TableCell>
                            <TableCell className="text-right text-sm">{fmtQty(r.consumption)}</TableCell>
                            <TableCell className="text-right text-sm">
                              {r.quantity == null ? "—" : `${fmtQty(r.quantity)} ${r.measurement_scale}`}
                            </TableCell>
                            <TableCell>
                              <FulfilledBadge
                                fulfilled={r.fulfilled}
                                label={r.fulfilled ? t("statusFulfilled") : t("statusUnfulfilled")}
                              />
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                {!r.fulfilled && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    title={t("issueReceiptForRequest")}
                                    onClick={() => { resetIssueForm(); setIssueFor(r); }}
                                  >
                                    <ReceiptText className="h-4 w-4" />
                                  </Button>
                                )}
                                {isAdmin && (
                                  <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    title={r.fulfilled ? t("forceUnfulfill") : t("markAsFulfilled")}
                                    disabled={togglingId === r.id}
                                    onClick={() => handleToggleFulfilled(r.id, !r.fulfilled)}
                                  >
                                    {togglingId === r.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : r.fulfilled ? (
                                      <Undo2 className="h-4 w-4" />
                                    ) : (
                                      <CheckCircle2 className="h-4 w-4" />
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="text-destructive hover:text-destructive"
                                    title={t("deleteRequest")}
                                    onClick={() => setDeleteId(r.id)}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              {/* Pagination */}
              {!loading && filtered.length > 0 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {t("paginationShowing", { from: showingFrom, to: showingTo, total: filtered.length })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage <= 1}
                      onClick={() => setPage(currentPage - 1)}
                    >
                      {t("previousPage")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage(currentPage + 1)}
                    >
                      {t("nextPage")}
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="others" className="mt-4">
              <Card>
                <CardContent className="p-0">
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                    <ClipboardList className="h-12 w-12 text-muted-foreground" />
                    <p className="text-muted-foreground font-medium">{t("othersTabPlaceholder")}</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </main>
      </div>

      {/* Issue receipt modal */}
      <Dialog open={issueFor !== null} onOpenChange={open => { if (!open) { setIssueFor(null); resetIssueForm(); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("issueReceiptForRequest")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {issueFor && (
              <p className="text-sm text-muted-foreground">
                {issueFor.job_order?.job_order_number ?? `#${issueFor.job_order_id}`}
                {" · "}
                <span className="font-mono">{issueFor.fabric_code?.fabric_code ?? "—"}</span>
                {issueFor.quantity != null && ` · ${fmtQty(issueFor.quantity)} ${issueFor.measurement_scale}`}
              </p>
            )}
            <div className="space-y-1.5">
              <Label>{t("receiptType")} *</Label>
              <Select
                value={receiptKind}
                onValueChange={v => { setReceiptKind(v as ReceiptKind); setTargetLocationId(null); setReceiver(""); }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">{t("receiptTypeInternal")}</SelectItem>
                  <SelectItem value="external">{t("receiptTypeExternal")}</SelectItem>
                  <SelectItem value="supplier">{t("receiptTypeSupplier")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Tabs value={receiptMode} onValueChange={v => setReceiptMode(v as "new" | "existing")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="new">{t("newReceiptTab")}</TabsTrigger>
                <TabsTrigger value="existing">{t("existingReceiptTab")}</TabsTrigger>
              </TabsList>
              <TabsContent value="new" className="space-y-4 mt-3">
                {sourceWarehouseId === null && (
                  <div className="space-y-1.5">
                    <Label>{t("sourceWarehouse")} *</Label>
                    <Combobox
                      items={warehouses.map(w => ({ id: w.id, label: w.name }))}
                      value={sourceWarehouseId}
                      onSelect={setSourceWarehouseId}
                      placeholder={t("selectSourceWarehouse")}
                    />
                  </div>
                )}
                {receiptKind !== "external" ? (
                  <div className="space-y-1.5">
                    <Label>{t("targetLocation")} *</Label>
                    <Combobox
                      items={filteredLocations.map(l => ({ id: l.id, label: l.name }))}
                      value={targetLocationId}
                      onSelect={setTargetLocationId}
                      placeholder={t("selectTargetLocation")}
                    />
                  </div>
                ) : (
                  <ReceiverField clients={clients} value={receiver} onChange={setReceiver} />
                )}
              </TabsContent>
              <TabsContent value="existing" className="space-y-1.5 mt-3">
                <Label>{t("selectReceipt")} *</Label>
                {loadingReceipts ? (
                  <div className="flex justify-center py-3">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <Combobox
                      items={existingReceipts.map(r => ({ id: r.id, label: r.label }))}
                      value={selectedReceiptId}
                      onSelect={setSelectedReceiptId}
                      placeholder={t("selectReceipt")}
                    />
                    {existingReceipts.length === 0 && (
                      <p className="text-sm text-muted-foreground">{t("noOpenReceipts")}</p>
                    )}
                  </>
                )}
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setIssueFor(null); resetIssueForm(); }}>{t("cancel")}</Button>
            <Button onClick={handleIssueReceipt} disabled={!canIssue || creatingReceipt}>
              {creatingReceipt && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {receiptMode === "existing" ? t("addToReceiptAndScan") : t("createReceiptAndScan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteRequest")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("confirmDeleteRequest")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
