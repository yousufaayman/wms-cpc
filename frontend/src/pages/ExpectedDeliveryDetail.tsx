import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, PackageOpen, Loader2, Plus, Trash2, Check,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  expectedDeliveryApi,
  materialApi, colorApi, clientFabricCodeApi,
  type ExpectedDelivery, type ExpectedDeliveryItem, type ExpectedDeliveryStatus,
  type ExpectedDeliveryItemCreate,
  type Material, type Color, type ClientFabricCode,
} from "@/lib/api";
import { toast } from "sonner";

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_STYLE: Record<ExpectedDeliveryStatus, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  partial: "bg-blue-100 text-blue-800 border-blue-300",
  received: "bg-green-100 text-green-800 border-green-300",
  cancelled: "bg-gray-100 text-gray-500 border-gray-300",
};

function StatusBadge({ status, label }: Readonly<{ status: ExpectedDeliveryStatus; label: string }>) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-medium border ${STATUS_STYLE[status]}`}>
      {label}
    </span>
  );
}

function fmtDate(ds: string | null | undefined) {
  if (!ds) return "—";
  return new Date(ds).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtNum(n: number | null | undefined, decimals = 2) {
  if (n === null || n === undefined) return "—";
  return Number(n).toFixed(decimals);
}

// ─── Variance cell ───────────────────────────────────────────────────────────

function VarianceCell({ expected, received, t }: Readonly<{
  expected: number | null | undefined;
  received: number;
  t: (k: string) => string;
}>) {
  if (expected === null || expected === undefined) return <span className="text-muted-foreground text-xs">N/A</span>;
  const diff = received - expected;
  if (Math.abs(diff) < 0.001) {
    return (
      <span className="flex items-center gap-1 text-green-600 text-sm">
        <Minus className="h-3 w-3" /> {t("onTarget")}
      </span>
    );
  }
  if (diff > 0) {
    return (
      <span className="flex items-center gap-1 text-blue-600 text-sm font-medium">
        <TrendingUp className="h-3 w-3" /> +{fmtNum(diff)}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-red-600 text-sm font-medium">
      <TrendingDown className="h-3 w-3" /> {fmtNum(diff)}
    </span>
  );
}

// ─── Item label helpers ───────────────────────────────────────────────────────

function itemLabel(item: ExpectedDeliveryItem, materials: Material[], colors: Color[]) {
  if (item.client_fabric_code_id && item.client_fabric_code) {
    const cfc = item.client_fabric_code;
    const material = materials.find(m => m.id === cfc.material_id);
    const color = colors.find(c => c.id === cfc.color_id);
    const parts = [cfc.fabric_code, material?.name, color?.name].filter(Boolean);
    return parts.join(" / ") || `CFC #${item.client_fabric_code_id}`;
  }
  if (item.material_id) {
    const mat = materials.find(m => m.id === item.material_id) ?? item.material;
    return mat?.name ?? `Material #${item.material_id}`;
  }
  return "—";
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ExpectedDeliveryDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouse");
  const { t } = useTranslation();
  useLanguage();

  const [delivery, setDelivery] = useState<ExpectedDelivery | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [cfcs, setCfcs] = useState<ClientFabricCode[]>([]);
  const [loading, setLoading] = useState(true);

  // Delete item state
  const [deleteItemId, setDeleteItemId] = useState<number | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);

  // Status update state
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Add item form state
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<"dyed" | "undyed">("dyed");
  const [addCfcId, setAddCfcId] = useState("");
  const [addMaterialId, setAddMaterialId] = useState("");
  const [addLotRef, setAddLotRef] = useState("");
  const [addExpWeight, setAddExpWeight] = useState("");
  const [addExpLength, setAddExpLength] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  const statusLabel: Record<ExpectedDeliveryStatus, string> = {
    pending: t("statusPending"),
    partial: t("statusPartial"),
    received: t("statusReceived"),
    cancelled: t("statusCancelled"),
  };

  const loadDelivery = useCallback(() => {
    if (!id) return;
    expectedDeliveryApi
      .getById(Number(id))
      .then(setDelivery)
      .catch(() => toast.error("Failed to load delivery"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadDelivery();
    Promise.all([
      materialApi.getAll(),
      colorApi.getAll(),
      clientFabricCodeApi.getAll(),
    ]).then(([mats, cols, cfcList]) => {
      setMaterials(mats);
      setColors(cols);
      setCfcs(cfcList);
    });
  }, [loadDelivery]);

  // ── Status change ──────────────────────────────────────────────────────────

  const changeStatus = async (newStatus: ExpectedDeliveryStatus) => {
    if (!delivery) return;
    setUpdatingStatus(true);
    try {
      const updated = await expectedDeliveryApi.update(delivery.id, { status: newStatus });
      setDelivery(updated);
      toast.success(`Status updated to ${statusLabel[newStatus]}`);
    } catch {
      toast.error("Failed to update status");
    } finally {
      setUpdatingStatus(false);
    }
  };

  // ── Delete item ────────────────────────────────────────────────────────────

  const handleDeleteItem = async () => {
    if (deleteItemId === null) return;
    setDeletingItem(true);
    try {
      await expectedDeliveryApi.deleteItem(deleteItemId);
      setDeleteItemId(null);
      loadDelivery();
      toast.success("Item removed");
    } catch {
      toast.error("Failed to delete item");
    } finally {
      setDeletingItem(false);
    }
  };

  // ── Add item ───────────────────────────────────────────────────────────────

  const resetAddForm = () => {
    setAddType("dyed"); setAddCfcId(""); setAddMaterialId("");
    setAddLotRef(""); setAddExpWeight(""); setAddExpLength(""); setAddNotes("");
  };

  const handleAddItem = async () => {
    if (!delivery) return;
    if (addType === "dyed" && !addCfcId) return;
    if (addType === "undyed" && !addMaterialId) return;

    const payload: ExpectedDeliveryItemCreate = {
      client_fabric_code_id: addType === "dyed" ? Number(addCfcId) : null,
      material_id: addType === "undyed" ? Number(addMaterialId) : null,
      lot_reference: addLotRef.trim() || null,
      expected_weight_kg: addExpWeight !== "" ? Number(addExpWeight) : null,
      expected_length_m: addExpLength !== "" ? Number(addExpLength) : null,
      notes: addNotes.trim() || null,
    };

    setAddingItem(true);
    try {
      await expectedDeliveryApi.addItem(delivery.id, payload);
      toast.success("Item added");
      setAddOpen(false);
      resetAddForm();
      loadDelivery();
    } catch {
      toast.error("Failed to add item");
    } finally {
      setAddingItem(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </main>
      </div>
    );
  }

  if (!delivery) {
    return (
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 p-6">
          <p className="text-muted-foreground">Delivery not found.</p>
        </main>
      </div>
    );
  }

  const canEdit = delivery.status !== "cancelled" && delivery.status !== "received";

  return (
    <PageTransition>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <main className="flex-1 p-6 space-y-6">

          {/* Back + title */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/expected-deliveries?warehouse=${warehouseId}`)}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              {t("expectedDeliveries")}
            </Button>
          </div>

          {/* Header card */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-3">
                    <PackageOpen className="h-5 w-5 text-primary" />
                    <CardTitle className="text-xl">
                      {t("deliveryId")}{delivery.id} — {delivery.supplier}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1">
                    <span>{t("expectedDate")}: <span className="text-foreground">{fmtDate(delivery.expected_date)}</span></span>
                    <span>Created: <span className="text-foreground">{fmtDate(delivery.created_at)}</span></span>
                  </div>
                  {delivery.notes && (
                    <p className="text-sm text-muted-foreground pt-1">{delivery.notes}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <StatusBadge status={delivery.status} label={statusLabel[delivery.status]} />
                  {/* Status action buttons */}
                  {delivery.status !== "cancelled" && delivery.status !== "received" && (
                    <div className="flex gap-2 flex-wrap justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => changeStatus("partial")}
                        disabled={updatingStatus || delivery.status === "partial"}
                      >
                        {updatingStatus ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        {t("markAsPartial")}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => changeStatus("received")}
                        disabled={updatingStatus}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {updatingStatus ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        <Check className="h-3 w-3 mr-1" />
                        {t("markAsReceived")}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => changeStatus("cancelled")}
                        disabled={updatingStatus}
                      >
                        {t("markAsCancelled")}
                      </Button>
                    </div>
                  )}
                  {(delivery.status === "received" || delivery.status === "cancelled") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => changeStatus("pending")}
                      disabled={updatingStatus}
                    >
                      {t("reopenDelivery")}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Items section */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t("deliveryItems")} ({delivery.items.length})</CardTitle>
                {canEdit && (
                  <Button size="sm" onClick={() => setAddOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    {t("addDeliveryItem")}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {delivery.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                  <PackageOpen className="h-10 w-10 text-muted-foreground" />
                  <p className="text-muted-foreground">{t("noDeliveryItems")}</p>
                  <p className="text-sm text-muted-foreground">{t("addFirstDeliveryItem")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("fabricType")}</TableHead>
                        <TableHead>Material / Fabric Code</TableHead>
                        <TableHead>{t("lotReference")}</TableHead>
                        <TableHead className="text-right">{t("expectedWeightKg")}</TableHead>
                        <TableHead className="text-right">{t("expectedLengthM")}</TableHead>
                        <TableHead className="text-right">{t("receivedWeightKg")}</TableHead>
                        <TableHead className="text-right">{t("receivedLengthM")}</TableHead>
                        <TableHead className="text-center">{t("weightVariance")}</TableHead>
                        <TableHead className="text-center">{t("lengthVariance")}</TableHead>
                        {canEdit && <TableHead className="w-28">{t("actions")}</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {delivery.items.map(item => {
                        const isDyed = item.client_fabric_code_id != null;
                        return (
                          <TableRow key={item.id}>
                            <TableCell>
                              <Badge variant={isDyed ? "default" : "secondary"}>
                                {isDyed ? t("dyedFabric") : t("undyedFabric")}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium text-sm">
                              {itemLabel(item, materials, colors)}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {item.lot_reference ?? "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm font-mono">
                              {fmtNum(item.expected_weight_kg)}
                            </TableCell>
                            <TableCell className="text-right text-sm font-mono">
                              {fmtNum(item.expected_length_m)}
                            </TableCell>
                            <TableCell className="text-right text-sm font-mono">
                              {fmtNum(item.received_weight_kg)}
                            </TableCell>
                            <TableCell className="text-right text-sm font-mono">
                              {fmtNum(item.received_length_m)}
                            </TableCell>
                            <TableCell className="text-center">
                              <VarianceCell
                                expected={item.expected_weight_kg}
                                received={item.received_weight_kg}
                                t={t}
                              />
                            </TableCell>
                            <TableCell className="text-center">
                              <VarianceCell
                                expected={item.expected_length_m}
                                received={item.received_length_m}
                                t={t}
                              />
                            </TableCell>
                            {canEdit && (
                              <TableCell>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  title={t("deleteDeliveryItem")}
                                  onClick={() => setDeleteItemId(item.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>

      {/* Add item dialog */}
      <Dialog open={addOpen} onOpenChange={open => { setAddOpen(open); if (!open) resetAddForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("addDeliveryItem")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Fabric type toggle */}
            <div className="space-y-1.5">
              <Label>{t("fabricType")}</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={addType === "dyed" ? "default" : "outline"}
                  onClick={() => { setAddType("dyed"); setAddMaterialId(""); }}
                >
                  {t("dyedFabric")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={addType === "undyed" ? "default" : "outline"}
                  onClick={() => { setAddType("undyed"); setAddCfcId(""); }}
                >
                  {t("undyedFabric")}
                </Button>
              </div>
            </div>

            {/* Dyed: fabric code select */}
            {addType === "dyed" && (
              <div className="space-y-1.5">
                <Label>{t("selectFabricCode")} *</Label>
                <Select value={addCfcId} onValueChange={setAddCfcId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("selectFabricCode")} />
                  </SelectTrigger>
                  <SelectContent>
                    {cfcs.map(cfc => {
                      const mat = materials.find(m => m.id === cfc.material_id);
                      const col = colors.find(c => c.id === cfc.color_id);
                      const label = [cfc.fabric_code, mat?.name, col?.name].filter(Boolean).join(" / ") || `CFC #${cfc.id}`;
                      return <SelectItem key={cfc.id} value={String(cfc.id)}>{label}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Undyed: material select */}
            {addType === "undyed" && (
              <div className="space-y-1.5">
                <Label>{t("selectMaterial")} *</Label>
                <Select value={addMaterialId} onValueChange={setAddMaterialId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("selectMaterial")} />
                  </SelectTrigger>
                  <SelectContent>
                    {materials.map(m => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <Separator />

            <div className="space-y-1.5">
              <Label>{t("lotReference")}</Label>
              <Input
                value={addLotRef}
                onChange={e => setAddLotRef(e.target.value)}
                placeholder="e.g. LOT-A1"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>{t("expectedWeightKg")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addExpWeight}
                  onChange={e => setAddExpWeight(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("expectedLengthM")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addExpLength}
                  onChange={e => setAddExpLength(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                value={addNotes}
                onChange={e => setAddNotes(e.target.value)}
                placeholder="Optional notes…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("cancel")}</Button>
            <Button
              onClick={handleAddItem}
              disabled={addingItem || (addType === "dyed" ? !addCfcId : !addMaterialId)}
            >
              {addingItem && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("addDeliveryItem")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete item confirm */}
      <Dialog open={deleteItemId !== null} onOpenChange={open => !open && setDeleteItemId(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteDeliveryItem")}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t("confirmDeleteDeliveryItem")}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteItemId(null)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={handleDeleteItem} disabled={deletingItem}>
              {deletingItem && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageTransition>
  );
}
