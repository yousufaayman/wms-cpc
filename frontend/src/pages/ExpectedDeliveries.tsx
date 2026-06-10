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
import { PackageOpen, Plus, Eye, Trash2, Loader2, ChevronsUpDown, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { expectedDeliveryApi, type ExpectedDelivery, type ExpectedDeliveryStatus } from "@/lib/api";
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
  const { user } = useCurrentUser();

  const [deliveries, setDeliveries] = useState<ExpectedDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSupplier, setNewSupplier] = useState("");
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

  const uniqueSuppliers = Array.from(new Set(deliveries.map(d => d.supplier))).sort();

  const filtered = deliveries.filter(d => {
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    if (supplierFilter !== "all" && d.supplier !== supplierFilter) return false;
    if (dateFrom || dateTo) {
      const date = d.expected_date ? d.expected_date.slice(0, 10) : null;
      if (!date) return false;
      if (dateFrom && date < dateFrom) return false;
      if (dateTo && date > dateTo) return false;
    }
    return true;
  });

  const handleCreate = async () => {
    if (!newSupplier.trim()) return;
    setCreating(true);
    try {
      const created = await expectedDeliveryApi.create(
        {
          supplier: newSupplier.trim(),
          warehouse_id: warehouseId ? Number(warehouseId) : null,
          expected_date: newDate || null,
          notes: newNotes.trim() || null,
        },
        user?.id,
      );
      toast.success("Expected delivery created");
      setCreateOpen(false);
      setNewSupplier(""); setNewDate(""); setNewNotes("");
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
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t("newExpectedDelivery")}
            </Button>
          </div>

          {/* Filters */}
          <div className="flex gap-3 flex-wrap items-end">
            {/* Supplier searchable dropdown */}
            <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" aria-expanded={supplierOpen} className="w-56 justify-between font-normal">
                  {supplierFilter === "all" ? t("allSuppliers") : supplierFilter}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-0" align="start">
                <Command>
                  <CommandInput placeholder={`${t("supplierName")}…`} />
                  <CommandEmpty>No supplier found.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem value="all" onSelect={() => { setSupplierFilter("all"); setSupplierOpen(false); }}>
                      <Check className={cn("mr-2 h-4 w-4", supplierFilter === "all" ? "opacity-100" : "opacity-0")} />
                      {t("allSuppliers")}
                    </CommandItem>
                    {uniqueSuppliers.map(s => (
                      <CommandItem key={s} value={s} onSelect={() => { setSupplierFilter(s); setSupplierOpen(false); }}>
                        <Check className={cn("mr-2 h-4 w-4", supplierFilter === s ? "opacity-100" : "opacity-0")} />
                        {s}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Status filter */}
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

            {/* Expected date range */}
            <div className="flex items-end gap-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("dateFrom")}</p>
                <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="w-36" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("dateTo")}</p>
                <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="w-36" />
              </div>
            </div>
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
                      <TableHead>Created</TableHead>
                      <TableHead className="w-24">{t("actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((d, idx) => (
                      <TableRow
                        key={d.id}
                        className={`cursor-pointer ${idx % 2 === 0 ? "bg-background" : "bg-muted/40"}`}
                        onClick={() => navigate(`/expected-deliveries/${d.id}?warehouse=${warehouseId}`)}
                      >
                        <TableCell className="font-mono text-sm font-medium">#{d.id}</TableCell>
                        <TableCell className="font-medium">{d.supplier}</TableCell>
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
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive hover:text-destructive"
                              title={t("deleteDelivery")}
                              onClick={() => setDeleteId(d.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
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
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("createExpectedDelivery")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>{t("supplierName")} *</Label>
              <Input
                value={newSupplier}
                onChange={e => setNewSupplier(e.target.value)}
                placeholder="e.g. Textile Mills Ltd."
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("expectedDate")}</Label>
              <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
                rows={2}
                placeholder="Optional notes…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("cancel")}</Button>
            <Button onClick={handleCreate} disabled={!newSupplier.trim() || creating}>
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
