import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, PackageOpen, Loader2, Plus, Trash2, Check,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { Combobox } from "@/components/Combobox";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  expectedDeliveryApi,
  clientApi, materialApi, colorApi, clientFabricCodeApi,
  type ExpectedDelivery, type ExpectedDeliveryItem, type ExpectedDeliveryStatus,
  type ExpectedDeliveryItemCreate,
  type Client, type Material, type Color, type ClientFabricCode,
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

interface ItemDetails {
  badge: string;
  client?: string | null;
  material?: string | null;
  color?: string | null;
}

function itemDetails(
  item: ExpectedDeliveryItem,
  clients: Client[],
  materials: Material[],
  colors: Color[],
): ItemDetails {
  if (item.client_fabric_code_id && item.client_fabric_code) {
    const cfc = item.client_fabric_code;
    return {
      badge: cfc.fabric_code ?? `#${cfc.id}`,
      client: clients.find(c => c.id === cfc.client_id)?.name,
      material: materials.find(m => m.id === cfc.material_id)?.name,
      color: colors.find(c => c.id === cfc.color_id)?.name,
    };
  }
  if (item.material_id) {
    const material = materials.find(m => m.id === item.material_id)?.name ?? item.material?.name;
    return {
      badge: material ?? `#${item.material_id}`,
      client: item.client?.name ?? clients.find(c => c.id === item.client_id)?.name,
      material,
      color: null,
    };
  }
  return { badge: "—" };
}

function ItemCodeCell({ details, t }: Readonly<{
  details: ItemDetails;
  t: (k: string) => string;
}>) {
  // Badge doesn't forward refs, so the trigger itself carries the badge
  // styling (Radix needs a ref on the trigger to anchor the tooltip).
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger className={cn(badgeVariants({ variant: "secondary" }), "cursor-default font-mono")}>
        {details.badge}
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 text-xs">
          <div><span className="opacity-70">{t("client")}:</span> {details.client ?? "—"}</div>
          <div><span className="opacity-70">{t("material")}:</span> {details.material ?? "—"}</div>
          <div><span className="opacity-70">{t("color")}:</span> {details.color ?? "—"}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function ExpectedDeliveryDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouse");
  const { t } = useTranslation();
  useLanguage();
  const { isAdmin, can } = useCurrentUser();

  const [delivery, setDelivery] = useState<ExpectedDelivery | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [loading, setLoading] = useState(true);

  // Delete item state
  const [deleteItemId, setDeleteItemId] = useState<number | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);

  // Status update state
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Add item form state — same Client → Material → Color flow as roll ingestion
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<"dyed" | "undyed">("dyed");
  const [addClientId, setAddClientId] = useState<number | null>(null);
  const [addMaterialId, setAddMaterialId] = useState<number | null>(null);
  const [addColorId, setAddColorId] = useState<number | null>(null);
  const [addCfc, setAddCfc] = useState<ClientFabricCode | null>(null);
  const [addCfcLoading, setAddCfcLoading] = useState(false);
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
      .catch(() => toast.error(t("failedToLoadDelivery")))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    loadDelivery();
    Promise.all([
      clientApi.getAll(),
      materialApi.getAll(),
      colorApi.getAll(),
    ]).then(([cls, mats, cols]) => {
      setClients(cls);
      setMaterials(mats);
      setColors(cols);
    });
  }, [loadDelivery]);

  // Resolve / create the ClientFabricCode as soon as client + material + color
  // are all chosen (dyed path) — same get-or-create flow as roll ingestion.
  useEffect(() => {
    if (addType !== "dyed" || !addClientId || !addMaterialId || !addColorId) {
      setAddCfc(null);
      return;
    }
    let cancelled = false;
    setAddCfcLoading(true);
    clientFabricCodeApi
      .getOrCreate({ client_id: addClientId, material_id: addMaterialId, color_id: addColorId })
      .then(cfc => { if (!cancelled) setAddCfc(cfc); })
      .catch(e => { if (!cancelled) { setAddCfc(null); console.error("Failed to resolve fabric code", e); } })
      .finally(() => { if (!cancelled) setAddCfcLoading(false); });
    return () => { cancelled = true; };
  }, [addType, addClientId, addMaterialId, addColorId]);

  // ── Status change ──────────────────────────────────────────────────────────

  const changeStatus = async (newStatus: ExpectedDeliveryStatus) => {
    if (!delivery) return;
    setUpdatingStatus(true);
    try {
      const updated = await expectedDeliveryApi.update(delivery.id, { status: newStatus });
      setDelivery(updated);
      toast.success(t("statusUpdatedTo", { status: statusLabel[newStatus] }));
    } catch {
      toast.error(t("failedToUpdateStatus"));
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
      toast.success(t("itemRemoved"));
    } catch {
      toast.error(t("failedToDeleteItem"));
    } finally {
      setDeletingItem(false);
    }
  };

  // ── Add item ───────────────────────────────────────────────────────────────

  const resetAddForm = () => {
    setAddType("dyed"); setAddClientId(null); setAddMaterialId(null); setAddColorId(null);
    setAddCfc(null); setAddExpWeight(""); setAddExpLength(""); setAddNotes("");
  };

  // Dyed items need the resolved fabric code; undyed items need client + material.
  const addItemReady = addType === "dyed"
    ? addCfc != null && !addCfcLoading
    : addClientId != null && addMaterialId != null;

  const handleAddItem = async () => {
    if (!delivery || !addItemReady) return;

    const payload: ExpectedDeliveryItemCreate = addType === "dyed"
      ? {
          client_fabric_code_id: addCfc!.id,
          expected_weight_kg: addExpWeight !== "" ? Number(addExpWeight) : null,
          expected_length_m: addExpLength !== "" ? Number(addExpLength) : null,
          notes: addNotes.trim() || null,
        }
      : {
          client_id: addClientId,
          material_id: addMaterialId,
          expected_weight_kg: addExpWeight !== "" ? Number(addExpWeight) : null,
          expected_length_m: addExpLength !== "" ? Number(addExpLength) : null,
          notes: addNotes.trim() || null,
        };

    setAddingItem(true);
    try {
      await expectedDeliveryApi.addItem(delivery.id, payload);
      toast.success(t("itemAdded"));
      setAddOpen(false);
      resetAddForm();
      loadDelivery();
    } catch {
      toast.error(t("failedToAddItem"));
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
          <p className="text-muted-foreground">{t("deliveryNotFound")}</p>
        </main>
      </div>
    );
  }

  const canEdit = can('manage_expected_deliveries') && delivery.status !== "cancelled" && delivery.status !== "received";

  return (
    <PageTransition>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        {/* min-w-0 lets the items table scroll inside its own overflow wrapper
            instead of stretching the page past the viewport */}
        <main className="flex-1 min-w-0 p-6 space-y-6">

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
                      {t("deliveryId")}{delivery.id} — {delivery.supplier_name ?? "—"}
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground pt-1">
                    <span>{t("expectedDate")}: <span className="text-foreground">{fmtDate(delivery.expected_date)}</span></span>
                    <span>{t("created")}: <span className="text-foreground">{fmtDate(delivery.created_at)}</span></span>
                  </div>
                  {delivery.notes && (
                    <p className="text-sm text-muted-foreground pt-1">{delivery.notes}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <StatusBadge status={delivery.status} label={statusLabel[delivery.status]} />
                  {/* Status action buttons */}
                  {can('manage_expected_deliveries') && delivery.status !== "cancelled" && delivery.status !== "received" && (
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
                  {/* Reopening is admin-only — mirrors the backend gate on PUT */}
                  {(delivery.status === "received" || delivery.status === "cancelled") && isAdmin && (
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
                        <TableHead>{t("materialOrFabricCode")}</TableHead>
                        <TableHead>{t("color")}</TableHead>
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
                        const details = itemDetails(item, clients, materials, colors);
                        return (
                          <TableRow key={item.id}>
                            <TableCell>
                              <Badge variant={isDyed ? "default" : "secondary"}>
                                {isDyed ? t("dyedFabric") : t("undyedFabric")}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-medium text-sm">
                              <ItemCodeCell details={details} t={t} />
                            </TableCell>
                            <TableCell className="text-sm">
                              {details.color ?? "—"}
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
                  onClick={() => { setAddType("dyed"); }}
                >
                  {t("dyedFabric")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={addType === "undyed" ? "default" : "outline"}
                  onClick={() => { setAddType("undyed"); setAddColorId(null); setAddCfc(null); }}
                >
                  {t("undyedFabric")}
                </Button>
              </div>
            </div>

            {/* Client → Material → Color (color only for dyed) */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{t("client")} *</Label>
                <Combobox
                  items={clients.map(c => ({ id: c.id, label: c.name }))}
                  value={addClientId}
                  onSelect={setAddClientId}
                  placeholder={t("selectClient")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("material")} *</Label>
                <Combobox
                  items={materials.map(m => ({ id: m.id, label: m.name }))}
                  value={addMaterialId}
                  onSelect={setAddMaterialId}
                  placeholder={t("selectMaterial")}
                />
              </div>
              {addType === "dyed" && (
                <div className="space-y-1.5">
                  <Label>{t("color")} *</Label>
                  <Combobox
                    items={colors.map(c => ({ id: c.id, label: c.name }))}
                    value={addColorId}
                    onSelect={setAddColorId}
                    placeholder={t("selectColor")}
                  />
                </div>
              )}
              {addType === "dyed" && addCfcLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> {t("resolvingFabricCode")}
                </div>
              )}
              {addType === "dyed" && addCfc && !addCfcLoading && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{t("fabricCodeColon")}</span>
                  <Badge variant="secondary">
                    {addCfc.fabric_code ?? `#${addCfc.id} ${t("noCodeAssigned")}`}
                  </Badge>
                </div>
              )}
            </div>

            <Separator />

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
              <Label>{t("notes")}</Label>
              <Input
                value={addNotes}
                onChange={e => setAddNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("cancel")}</Button>
            <Button
              onClick={handleAddItem}
              disabled={addingItem || !addItemReady}
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
