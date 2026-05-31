import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowLeft, PackageOpen, Loader2, Plus, Trash2, Check, ChevronsUpDown,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  expectedDeliveryApi,
  clientApi, materialApi, colorApi, clientFabricCodeApi, lotApi,
  type ExpectedDelivery, type ExpectedDeliveryItem, type ExpectedDeliveryStatus,
  type ExpectedDeliveryItemCreate, type Lot,
  type Client, type Material, type Color, type ClientFabricCode,
} from "@/lib/api";
import { toast } from "sonner";

// ─── Combobox ────────────────────────────────────────────────────────────────

interface ComboItem { id: number; label: string }

function Combobox({ items, value, onSelect, placeholder, disabled = false }: Readonly<{
  items: ComboItem[];
  value: number | null;
  onSelect: (id: number) => void;
  placeholder: string;
  disabled?: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const selected = items.find(i => i.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="w-full justify-between font-normal" disabled={disabled}>
          {selected ? selected.label : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder={t("search")} />
          <CommandList>
            <CommandEmpty>{t("noResults")}</CommandEmpty>
            <CommandGroup>
              {items.map(item => (
                <CommandItem key={item.id} value={item.label} onSelect={() => { onSelect(item.id); setOpen(false); }}>
                  <Check className={`mr-2 h-4 w-4 ${value === item.id ? "opacity-100" : "opacity-0"}`} />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

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


// ─── Main component ──────────────────────────────────────────────────────────

export default function ExpectedDeliveryDetail() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouse");
  const { t } = useTranslation();
  useLanguage();

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

  // Add item form state
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState<"dyed" | "undyed">("dyed");
  // Dyed: resolved via client + material + color
  const [addClientId, setAddClientId] = useState<number | null>(null);
  const [addDyedMaterialId, setAddDyedMaterialId] = useState<number | null>(null);
  const [addColorId, setAddColorId] = useState<number | null>(null);
  const [resolvedCfc, setResolvedCfc] = useState<ClientFabricCode | null>(null);
  const [cfcResolving, setCfcResolving] = useState(false);
  // Undyed
  const [addMaterialId, setAddMaterialId] = useState("");
  const [addLotMode, setAddLotMode] = useState<"none" | "existing" | "new">("none");
  const [addLotId, setAddLotId] = useState<number | null>(null);
  const [addNewLotNumber, setAddNewLotNumber] = useState("");
  const [cfcLots, setCfcLots] = useState<{ id: number; lot_number: string }[]>([]);
  const [cfcLotsLoading, setCfcLotsLoading] = useState(false);
  const [addLotRef, setAddLotRef] = useState("");
  const [addExpWeight, setAddExpWeight] = useState("");
  const [addExpLength, setAddExpLength] = useState("");
  const [addExpGsm, setAddExpGsm] = useState("");
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
      clientApi.getAll(),
      materialApi.getAll(),
      colorApi.getAll(),
    ]).then(([cls, mats, cols]) => {
      setClients(cls);
      setMaterials(mats);
      setColors(cols);
    });
  }, [loadDelivery]);

  // ── Auto-resolve CFC when client + material + color are all set ────────────
  useEffect(() => {
    if (!addClientId || !addDyedMaterialId || !addColorId) {
      setResolvedCfc(null);
      return;
    }
    setCfcResolving(true);
    clientFabricCodeApi
      .getOrCreate({ client_id: addClientId, material_id: addDyedMaterialId, color_id: addColorId })
      .then(cfc => { setResolvedCfc(cfc); })
      .catch(() => setResolvedCfc(null))
      .finally(() => setCfcResolving(false));
  }, [addClientId, addDyedMaterialId, addColorId]);

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
    setAddType("dyed");
    setAddClientId(null); setAddDyedMaterialId(null); setAddColorId(null); setResolvedCfc(null);
    setAddMaterialId("");
    setAddLotMode("none"); setAddLotId(null); setAddNewLotNumber("");
    setCfcLots([]); setAddLotRef(""); setAddExpWeight(""); setAddExpLength(""); setAddExpGsm(""); setAddNotes("");
  };

  // Load lots when resolved CFC changes
  useEffect(() => {
    if (addType !== "dyed" || !resolvedCfc) { setCfcLots([]); setAddLotMode("none"); setAddLotId(null); return; }
    setCfcLotsLoading(true);
    lotApi.getByFabricCode(resolvedCfc.id)
      .then((lots: Lot[]) => setCfcLots(lots))
      .catch(() => setCfcLots([]))
      .finally(() => setCfcLotsLoading(false));
  }, [resolvedCfc, addType]);

  const handleAddItem = async () => {
    if (!delivery) return;
    if (addType === "dyed" && !resolvedCfc) return;
    if (addType === "undyed" && !addMaterialId) return;

    let resolvedLotId: number | null = addLotId;
    if (addType === "dyed" && addLotMode === "new" && addNewLotNumber.trim() && resolvedCfc) {
      const lot = await lotApi.getOrCreate({ client_fabric_code_id: resolvedCfc.id, lot_number: addNewLotNumber.trim() });
      resolvedLotId = lot.id;
    }

    const payload: ExpectedDeliveryItemCreate = {
      client_fabric_code_id: addType === "dyed" ? resolvedCfc!.id : null,
      material_id: addType === "undyed" ? Number(addMaterialId) : null,
      lot_id: addType === "dyed" ? resolvedLotId : null,
      lot_reference: addType === "undyed" ? (addLotRef.trim() || null) : null,
      expected_weight_kg: addExpWeight !== "" ? Number(addExpWeight) : null,
      expected_length_m: addExpLength !== "" ? Number(addExpLength) : null,
      expected_gsm: addExpGsm !== "" ? Number(addExpGsm) : null,
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
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden p-6 gap-4">

          {/* Back button */}
          <div className="shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/expected-deliveries?warehouse=${warehouseId}`)}
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              {t("expectedDeliveries")}
            </Button>
          </div>

          {/* Header card — title + meta only */}
          <Card className="shrink-0">
            <CardHeader className="pb-3">
              <div className="flex items-start gap-3">
                <PackageOpen className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                <div className="space-y-1 min-w-0">
                  <CardTitle className="text-xl">
                    {t("deliveryId")}{delivery.id} — {delivery.supplier}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span>{t("expectedDate")}: <span className="text-foreground">{fmtDate(delivery.expected_date)}</span></span>
                    <span>Created: <span className="text-foreground">{fmtDate(delivery.created_at)}</span></span>
                    <StatusBadge status={delivery.status} label={statusLabel[delivery.status]} />
                  </div>
                  {delivery.notes && (
                    <p className="text-sm text-muted-foreground">{delivery.notes}</p>
                  )}
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Action buttons row */}
          <div className="shrink-0 flex flex-wrap items-center gap-2">
            {delivery.status !== "cancelled" && delivery.status !== "received" && (
              <>
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
              </>
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

          {/* Items section — fills remaining height and scrolls internally */}
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <CardHeader className="pb-3 shrink-0">
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
            <CardContent className="p-0 flex-1 min-h-0 overflow-auto">
              {delivery.items.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
                  <PackageOpen className="h-10 w-10 text-muted-foreground" />
                  <p className="text-muted-foreground">{t("noDeliveryItems")}</p>
                  <p className="text-sm text-muted-foreground">{t("addFirstDeliveryItem")}</p>
                </div>
              ) : (() => {
                const dyedItems = delivery.items.filter(i => i.client_fabric_code_id != null);
                const undyedItems = delivery.items.filter(i => i.client_fabric_code_id == null);
                const itemCols = (
                  <TableRow>
                    <TableHead className="w-[12%]">{t("fabricCode")}</TableHead>
                    <TableHead className="w-[12%]">{t("material")}</TableHead>
                    <TableHead className="w-[12%]">{t("color")}</TableHead>
                    <TableHead>{t("lotReference")}</TableHead>
                    <TableHead className="text-right">{t("expectedWeightKg")}</TableHead>
                    <TableHead className="text-right">{t("expectedLengthM")}</TableHead>
                    <TableHead className="text-right">{t("expectedGsm")}</TableHead>
                    <TableHead className="text-right">{t("receivedWeightKg")}</TableHead>
                    <TableHead className="text-right">{t("receivedLengthM")}</TableHead>
                    <TableHead className="text-center">{t("weightVariance")}</TableHead>
                    <TableHead className="text-center">{t("lengthVariance")}</TableHead>
                    {canEdit && <TableHead className="w-16">{t("actions")}</TableHead>}
                  </TableRow>
                );
                const renderRow = (item: ExpectedDeliveryItem) => {
                  const isDyed = item.client_fabric_code_id != null;
                  const cfc = item.client_fabric_code;
                  const material = isDyed
                    ? materials.find(m => m.id === cfc?.material_id)
                    : materials.find(m => m.id === item.material_id) ?? item.material;
                  const color = isDyed ? colors.find(c => c.id === cfc?.color_id) : null;
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-sm">
                        {cfc?.fabric_code ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {material?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {color?.name ?? "—"}
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
                        {fmtNum(item.expected_gsm)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {fmtNum(item.received_weight_kg)}
                      </TableCell>
                      <TableCell className="text-right text-sm font-mono">
                        {fmtNum(item.received_length_m)}
                      </TableCell>
                      <TableCell className="text-center">
                        <VarianceCell expected={item.expected_weight_kg} received={item.received_weight_kg} t={t} />
                      </TableCell>
                      <TableCell className="text-center">
                        <VarianceCell expected={item.expected_length_m} received={item.received_length_m} t={t} />
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                            title={t("deleteDeliveryItem")} onClick={() => setDeleteItemId(item.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                };
                return (
                  <>
                    {dyedItems.length > 0 && (
                      <div>
                        <div className="px-4 py-2.5 bg-primary/10 border-y border-primary/20 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-primary inline-block" />
                          <span className="text-xs font-semibold uppercase tracking-wider text-primary">{t("dyedFabric")}</span>
                          <span className="text-xs text-primary/60 ml-1">({dyedItems.length})</span>
                        </div>
                        <Table>
                          <TableHeader>{itemCols}</TableHeader>
                          <TableBody>{dyedItems.map(renderRow)}</TableBody>
                        </Table>
                      </div>
                    )}
                    {undyedItems.length > 0 && (
                      <div>
                        <div className="px-4 py-2.5 bg-amber-500/10 border-y border-amber-500/20 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />
                          <span className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">{t("undyedFabric")}</span>
                          <span className="text-xs text-amber-700/60 dark:text-amber-400/60 ml-1">({undyedItems.length})</span>
                        </div>
                        <Table>
                          <TableHeader>{itemCols}</TableHeader>
                          <TableBody>{undyedItems.map(renderRow)}</TableBody>
                        </Table>
                      </div>
                    )}
                  </>
                );
              })()}
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
                  onClick={() => { setAddType("undyed"); setAddClientId(null); setAddDyedMaterialId(null); setAddColorId(null); setResolvedCfc(null); }}
                >
                  {t("undyedFabric")}
                </Button>
              </div>
            </div>

            {/* Dyed: client + material + color → auto-resolve CFC */}
            {addType === "dyed" && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3">
                  <div className="space-y-1">
                    <Label>{t("client")} *</Label>
                    <Combobox
                      items={clients.map(c => ({ id: c.id, label: c.name }))}
                      value={addClientId}
                      onSelect={id => { setAddClientId(id); setResolvedCfc(null); }}
                      placeholder={t("selectClient")}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>{t("material")} *</Label>
                      <Combobox
                        items={materials.map(m => ({ id: m.id, label: m.name }))}
                        value={addDyedMaterialId}
                        onSelect={id => { setAddDyedMaterialId(id); setResolvedCfc(null); }}
                        placeholder={t("selectMaterial")}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("color")} *</Label>
                      <Combobox
                        items={colors.map(c => ({ id: c.id, label: c.name }))}
                        value={addColorId}
                        onSelect={id => { setAddColorId(id); setResolvedCfc(null); }}
                        placeholder={t("selectColor")}
                      />
                    </div>
                  </div>
                </div>
                {cfcResolving && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> {t("resolvingFabricCode")}
                  </div>
                )}
                {resolvedCfc && !cfcResolving && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="h-3 w-3 text-green-600" />
                    {t("fabricCodeColon")} <span className="font-medium text-foreground">{resolvedCfc.fabric_code ?? `#${resolvedCfc.id}`}</span>
                  </div>
                )}
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

            {/* Lot selection — dyed: link to actual lot; undyed: free-text reference */}
            {addType === "dyed" ? (
              <div className="space-y-2">
                <Label>{t("lotSelection")}</Label>
                <div className="flex gap-2 flex-wrap">
                  {(["none", "existing", "new"] as const).map(mode => (
                    <Button key={mode} size="sm"
                      variant={addLotMode === mode ? "default" : "outline"}
                      disabled={mode === "existing" && cfcLots.length === 0}
                      onClick={() => { setAddLotMode(mode); setAddLotId(null); setAddNewLotNumber(""); }}
                    >
                      {mode === "none" ? t("noLotLinked") : mode === "existing" ? t("existingLots") : t("newLot")}
                      {mode === "existing" && cfcLots.length > 0 && ` (${cfcLots.length})`}
                    </Button>
                  ))}
                </div>
                {addLotMode === "existing" && (
                  cfcLotsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <Select value={addLotId ? String(addLotId) : ""} onValueChange={v => setAddLotId(Number(v))}>
                      <SelectTrigger><SelectValue placeholder={t("selectLot")} /></SelectTrigger>
                      <SelectContent>
                        {cfcLots.map(l => <SelectItem key={l.id} value={String(l.id)}>{l.lot_number}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )
                )}
                {addLotMode === "new" && (
                  <Input placeholder={t("enterNewLotNumber")} value={addNewLotNumber} onChange={e => setAddNewLotNumber(e.target.value)} />
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>{t("lotReference")}</Label>
                <Input value={addLotRef} onChange={e => setAddLotRef(e.target.value)} placeholder="e.g. LOT-A1" />
              </div>
            )}

            <div className="grid grid-cols-3 gap-3">
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
              <div className="space-y-1.5">
                <Label>{t("expectedGsm")}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={addExpGsm}
                  onChange={e => setAddExpGsm(e.target.value)}
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
              disabled={addingItem || (addType === "dyed" ? !resolvedCfc : !addMaterialId)}
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
