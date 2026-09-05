import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PackageOpen, Plus, Eye, Trash2, Loader2 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { Combobox } from "@/components/Combobox";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  clientApi, logicalLocationApi, expectedDeliveryApi,
  type Client, type LogicalLocation,
  type ExpectedDelivery, type ExpectedDeliveryStatus, type SupplierType,
} from "@/lib/api";
import { toast } from "sonner";

const STATUS_STYLE: Record<ExpectedDeliveryStatus, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  partial: "bg-blue-100 text-blue-800 border-blue-300",
  received: "bg-green-100 text-green-800 border-green-300",
  cancelled: "bg-gray-100 text-gray-500 border-gray-300",
};

function StatusBadge({ status, label }: Readonly<{ status: ExpectedDeliveryStatus; label: string }>) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[status]}`}>
      {label}
    </span>
  );
}

function fmtDate(ds: string | null | undefined) {
  if (!ds) return "—";
  return new Date(ds).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export default function ExpectedDeliveries() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouse");
  const { t } = useTranslation();
  useLanguage();
  const { user, can } = useCurrentUser();

  const [deliveries, setDeliveries] = useState<ExpectedDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierSearch, setSupplierSearch] = useState("");

  const [clients, setClients] = useState<Client[]>([]);
  const [logicalLocations, setLogicalLocations] = useState<LogicalLocation[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [supplierType, setSupplierType] = useState<SupplierType>("client");
  const [supplierClientId, setSupplierClientId] = useState<number | null>(null);
  const [supplierLocationId, setSupplierLocationId] = useState<number | null>(null);
  const [newDate, setNewDate] = useState("");
  const [newNotes, setNewNotes] = useState("");

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const statusLabel: Record<ExpectedDeliveryStatus, string> = {
    pending: t("statusPending"),
    partial: t("statusPartial"),
    received: t("statusReceived"),
    cancelled: t("statusCancelled"),
  };

  const load = () => {
    setLoading(true);
    expectedDeliveryApi
      .getAll(warehouseId ? { warehouse_id: Number(warehouseId), limit: 200 } : { limit: 200 })
      .then(setDeliveries)
      .catch(() => toast.error("Failed to load expected deliveries"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [warehouseId]);

  useEffect(() => {
    Promise.all([clientApi.getAll(), logicalLocationApi.getAll({ limit: 500 })])
      .then(([c, ll]) => { setClients(c); setLogicalLocations(ll); })
      .catch((e) => console.error("Failed to load reference data", e));
  }, []);

  const filtered = deliveries.filter(d => {
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    // Substring filter on the display name resolved by the API
    if (supplierSearch && !(d.supplier_name ?? "").toLowerCase().includes(supplierSearch.toLowerCase())) return false;
    return true;
  });

  const selectedSupplierId = supplierType === "client" ? supplierClientId : supplierLocationId;

  const resetCreateForm = () => {
    setSupplierType("client");
    setSupplierClientId(null);
    setSupplierLocationId(null);
    setNewDate("");
    setNewNotes("");
  };

  const handleCreate = async () => {
    if (selectedSupplierId == null) return;
    setCreating(true);
    try {
      const created = await expectedDeliveryApi.create(
        {
          client_supplier_id: selectedSupplierId,
          supplier_type: supplierType,
          warehouse_id: warehouseId ? Number(warehouseId) : null,
          expected_date: newDate || null,
          notes: newNotes.trim() || null,
        },
        user?.id,
      );
      toast.success("Expected delivery created");
      setCreateOpen(false);
      resetCreateForm();
      navigate(`/expected-deliveries/${created.id}?warehouse=${warehouseId}`);
    } catch {
      toast.error("Failed to create expected delivery");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId === null) return;
    setDeleting(true);
    try {
      await expectedDeliveryApi.delete(deleteId);
      toast.success("Deleted");
      setDeleteId(null);
      load();
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <PageTransition>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <PackageOpen className="h-6 w-6 text-primary" />
                {t("expectedDeliveries")}
              </h1>
              <p className="text-muted-foreground text-sm mt-1">{t("expectedDeliveriesDesc")}</p>
            </div>
            {can('manage_expected_deliveries') && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                {t("newExpectedDelivery")}
              </Button>
            )}
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap">
            <Input
              placeholder={t("searchSupplier")}
              value={supplierSearch}
              onChange={e => setSupplierSearch(e.target.value)}
              className="w-56"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder={t("filterByStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStatuses")}</SelectItem>
                <SelectItem value="pending">{t("statusPending")}</SelectItem>
                <SelectItem value="partial">{t("statusPartial")}</SelectItem>
                <SelectItem value="received">{t("statusReceived")}</SelectItem>
                <SelectItem value="cancelled">{t("statusCancelled")}</SelectItem>
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
                  <p className="text-muted-foreground font-medium">{t("noExpectedDeliveries")}</p>
                  <p className="text-sm text-muted-foreground">{t("createFirstDelivery")}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">{t("deliveryId")}</TableHead>
                      <TableHead>{t("supplierName")}</TableHead>
                      <TableHead>{t("deliveryStatus")}</TableHead>
                      <TableHead>{t("expectedDate")}</TableHead>
                      <TableHead className="text-center w-20">{t("itemCount")}</TableHead>
                      <TableHead>{t("created")}</TableHead>
                      <TableHead className="w-24">{t("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map(d => (
                      <TableRow
                        key={d.id}
                        className="cursor-pointer"
                        onClick={() => navigate(`/expected-deliveries/${d.id}?warehouse=${warehouseId}`)}
                      >
                        <TableCell className="font-mono text-sm font-medium">#{d.id}</TableCell>
                        <TableCell className="font-medium">{d.supplier_name ?? "—"}</TableCell>
                        <TableCell>
                          <StatusBadge status={d.status} label={statusLabel[d.status]} />
                        </TableCell>
                        <TableCell className="text-sm">{fmtDate(d.expected_date)}</TableCell>
                        <TableCell className="text-center text-sm">{d.items.length}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{fmtDate(d.created_at)}</TableCell>
                        <TableCell onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => navigate(`/expected-deliveries/${d.id}?warehouse=${warehouseId}`)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            {can('manage_expected_deliveries') && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                title={t("deleteDelivery")}
                                onClick={() => setDeleteId(d.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
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
        </main>
      </div>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) resetCreateForm(); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("createExpectedDelivery")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("supplierName")} *</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={supplierType === "client" ? "default" : "outline"}
                  onClick={() => { setSupplierType("client"); setSupplierLocationId(null); }}
                >
                  {t("client")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={supplierType === "logical_location" ? "default" : "outline"}
                  onClick={() => { setSupplierType("logical_location"); setSupplierClientId(null); }}
                >
                  {t("logicalLocation")}
                </Button>
              </div>
              {supplierType === "client" ? (
                <Combobox
                  items={clients.map(c => ({ id: c.id, label: c.name }))}
                  value={supplierClientId}
                  onSelect={setSupplierClientId}
                  placeholder={t("selectSupplierClient")}
                />
              ) : (
                <Combobox
                  items={logicalLocations.map(l => ({ id: l.id, label: l.name }))}
                  value={supplierLocationId}
                  onSelect={setSupplierLocationId}
                  placeholder={t("selectLogicalLocation")}
                />
              )}
            </div>
            <div className="space-y-1.5">
              <Label>{t("expectedDate")}</Label>
              <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("notes")}</Label>
              <Textarea
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
                rows={2}
                placeholder={t("notesPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleCreate} disabled={selectedSupplierId == null || creating}>
              {creating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("createExpectedDelivery")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={deleteId !== null} onOpenChange={open => !open && setDeleteId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteDelivery")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("confirmDeleteDelivery")}</p>
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
