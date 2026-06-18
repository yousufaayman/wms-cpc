import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  ArrowLeft, PackageOpen, Loader2, Plus, Trash2, Check, ChevronsUpDown,
  TrendingUp, TrendingDown, Minus, Pencil,
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

  // Edit item state
  const [editItem, setEditItem] = useState<ExpectedDeliveryItem | null>(null);
  const [editExpWeight, setEditExpWeight] = useState("");
  const [editExpLength, setEditExpLength] = useState("");
  const [editExpGsm, setEditExpGsm] = useState("");
  const [editLotRef, setEditLotRef] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editFabricCodePlanned, setEditFabricCodePlanned] = useState<boolean | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

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
  const [addFabricCodePlanned, setAddFabricCodePlanned] = useState<boolean | null>(true);
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

  // ── Open edit dialog ──────────────────────────────────────────────────────

  const openEditItem = (item: ExpectedDeliveryItem) => {
    setEditItem(item);
    setEditExpWeight(item.expected_weight_kg != null ? String(item.expected_weight_kg) : "");
    setEditExpLength(item.expected_length_m != null ? String(item.expected_length_m) : "");
    setEditExpGsm(item.expected_gsm != null ? String(item.expected_gsm) : "");
    setEditLotRef(item.lot_reference ?? "");
    setEditNotes(item.notes ?? "");
    setEditFabricCodePlanned(item.fabric_code_planned ?? null);
  };

  const handleSaveEdit = async () => {
    if (!editItem) return;
    if (editExpWeight === "" && editExpLength === "") {
      toast.error(t("weightOrLengthRequired"));
      return;
    }
    setSavingEdit(true);
    try {
      await expectedDeliveryApi.updateItem(editItem.id, {
        lot_reference: editItem.client_fabric_code_id == null ? (editLotRef.trim() || null) : undefined,
        expected_weight_kg: editExpWeight !== "" ? Number(editExpWeight) : null,
        expected_length_m: editExpLength !== "" ? Number(editExpLength) : null,
        expected_gsm: editExpGsm !== "" ? Number(editExpGsm) : null,
        notes: editNotes.trim() || null,
        fabric_code_planned: editItem.client_fabric_code_id != null ? editFabricCodePlanned : undefined,
      });
      toast.success(t("saveChanges"));
      setEditItem(null);
      loadDelivery();
    } catch {
      toast.error("Failed to save changes");
    } finally {
      setSavingEdit(false);
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
    setAddFabricCodePlanned(true);
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
    if (addExpWeight === "" && addExpLength === "") {
      toast.error(t("weightOrLengthRequired"));
      return;
    }

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
      fabric_code_planned: addType === "dyed" ? addFabricCodePlanned : null,
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
                    <TableHead className="w-[14%] text-center">{t("fabricCodePlanned")}</TableHead>
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
                const renderRow = (item: ExpectedDeliveryItem, idx: number) => {
                  const isDyed = item.client_fabric_code_id != null;
                  const cfc = item.client_fabric_code;
                  const material = isDyed
                    ? materials.find(m => m.id === cfc?.material_id)
                    : materials.find(m => m.id === item.material_id) ?? item.material;
                  const color = isDyed ? colors.find(c => c.id === cfc?.color_id) : null;
                  return (
                    <TableRow key={item.id} className={idx % 2 === 0 ? "bg-background" : "bg-muted/40"}>
                      <TableCell className="font-medium text-sm">
                        {cfc?.fabric_code ?? "—"}
                      </TableCell>
                      <TableCell className="text-center text-xs">
                        {item.client_fabric_code_id != null ? (
                          item.fabric_code_planned === true ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-200 font-medium">{t("fabricCodePlannedYes")}</span>
                          ) : item.fabric_code_planned === false ? (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 font-medium">{t("fabricCodePlannedNo")}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {material?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {color?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {isDyed ? (item.lot?.lot_number ?? "—") : (item.lot_reference ?? "—")}
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
                          <div className="flex items-center gap-1">
                            <Button size="sm" variant="ghost" title={t("editDeliveryItem")}
                              onClick={() => openEditItem(item)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                              title={t("deleteDeliveryItem")} onClick={() => setDeleteItemId(item.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
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
                          <TableBody>{dyedItems.map((item, idx) => renderRow(item, idx))}</TableBody>
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
                          <TableBody>{undyedItems.map((item, idx) => renderRow(item, idx))}</TableBody>
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
        <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 shrink-0 border-b">
            <DialogTitle className="text-lg">{t("addDeliveryItem")}</DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

            {/* Step 1 — Fabric type */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">1</span>
                <span className="text-sm font-semibold">{t("fabricType")}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => { setAddType("dyed"); setAddMaterialId(""); }}
                  className={`rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors text-left ${
                    addType === "dyed"
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />
                    {t("dyedFabric")}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => { setAddType("undyed"); setAddClientId(null); setAddDyedMaterialId(null); setAddColorId(null); setResolvedCfc(null); }}
                  className={`rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors text-left ${
                    addType === "undyed"
                      ? "border-amber-500 bg-amber-500/5 text-amber-700"
                      : "border-border bg-card text-muted-foreground hover:border-amber-400/40 hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
                    {t("undyedFabric")}
                  </div>
                </button>
              </div>
            </div>

            {/* Step 2 — Fabric identification */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">2</span>
                <span className="text-sm font-semibold">{addType === "dyed" ? t("fabricCode") : t("material")}</span>
              </div>

              {addType === "dyed" && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">{t("client")} <span className="text-destructive">*</span></Label>
                    <Combobox
                      items={clients.map(c => ({ id: c.id, label: c.name }))}
                      value={addClientId}
                      onSelect={id => { setAddClientId(id); setResolvedCfc(null); }}
                      placeholder={t("selectClient")}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">{t("material")} <span className="text-destructive">*</span></Label>
                      <Combobox
                        items={materials.map(m => ({ id: m.id, label: m.name }))}
                        value={addDyedMaterialId}
                        onSelect={id => { setAddDyedMaterialId(id); setResolvedCfc(null); }}
                        placeholder={t("selectMaterial")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground uppercase tracking-wide">{t("color")} <span className="text-destructive">*</span></Label>
                      <Combobox
                        items={colors.map(c => ({ id: c.id, label: c.name }))}
                        value={addColorId}
                        onSelect={id => { setAddColorId(id); setResolvedCfc(null); }}
                        placeholder={t("selectColor")}
                      />
                    </div>
                  </div>
                  {cfcResolving && (
                    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> {t("resolvingFabricCode")}
                    </div>
                  )}
                  {resolvedCfc && !cfcResolving && (
                    <>
                      <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-700">
                        <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                        <span>{t("fabricCodeColon")}</span>
                        <span className="font-semibold">{resolvedCfc.fabric_code ?? `#${resolvedCfc.id}`}</span>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground uppercase tracking-wide">{t("fabricCodePlanned")}</Label>
                        <div className="flex gap-2">
                          {([true, false, null] as const).map(val => (
                            <button
                              key={String(val)}
                              type="button"
                              onClick={() => setAddFabricCodePlanned(val)}
                              className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                                addFabricCodePlanned === val
                                  ? val === true
                                    ? "border-green-500 bg-green-50 text-green-700"
                                    : val === false
                                    ? "border-orange-500 bg-orange-50 text-orange-700"
                                    : "border-primary bg-primary/5 text-primary"
                                  : "border-border bg-card text-muted-foreground hover:border-primary/40"
                              }`}
                            >
                              {val === true ? t("fabricCodePlannedYes") : val === false ? t("fabricCodePlannedNo") : t("fabricCodePlannedUnset")}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}

              {addType === "undyed" && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">{t("material")} <span className="text-destructive">*</span></Label>
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
            </div>

            {/* Step 3 — Lot */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">3</span>
                <span className="text-sm font-semibold">{t("lotSelection")}</span>
                <span className="text-xs text-muted-foreground">({t("optional") ?? "optional"})</span>
              </div>

              {addType === "dyed" ? (
                <div className="space-y-2">
                  <div className="flex gap-2 flex-wrap">
                    {(["none", "existing", "new"] as const).map(mode => (
                      <Button key={mode} size="sm"
                        variant={addLotMode === mode ? "secondary" : "outline"}
                        disabled={mode === "existing" && cfcLots.length === 0}
                        className={addLotMode === mode ? "border-primary/30" : ""}
                        onClick={() => { setAddLotMode(mode); setAddLotId(null); setAddNewLotNumber(""); }}
                      >
                        {mode === "none" ? t("noLotLinked") : mode === "existing" ? t("existingLots") : t("newLot")}
                        {mode === "existing" && cfcLots.length > 0 && (
                          <span className="ml-1.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">{cfcLots.length}</span>
                        )}
                      </Button>
                    ))}
                  </div>
                  {addLotMode === "existing" && (
                    cfcLotsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading lots…
                      </div>
                    ) : (
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
                <Input value={addLotRef} onChange={e => setAddLotRef(e.target.value)} placeholder="e.g. LOT-A1" />
              )}
            </div>

            {/* Step 4 — Quantities */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">4</span>
                <span className="text-sm font-semibold">{t("expectedQuantities") ?? "Expected Quantities"}</span>
              </div>
              <div className={`rounded-lg border p-4 space-y-3 ${addExpWeight === "" && addExpLength === "" ? "border-destructive/50 bg-destructive/5" : "bg-muted/30"}`}>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                      {t("expectedWeightKg")}
                      {addExpLength === "" && <span className="text-destructive ml-0.5">*</span>}
                    </Label>
                    <div className="relative">
                      <Input
                        type="number" min="0" step="0.01"
                        value={addExpWeight}
                        onChange={e => setAddExpWeight(e.target.value)}
                        placeholder="0.00"
                        className={`pr-8 ${addExpWeight === "" && addExpLength === "" ? "border-destructive focus-visible:ring-destructive" : ""}`}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">kg</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                      {t("expectedLengthM")}
                      {addExpWeight === "" && <span className="text-destructive ml-0.5">*</span>}
                    </Label>
                    <div className="relative">
                      <Input
                        type="number" min="0" step="0.01"
                        value={addExpLength}
                        onChange={e => setAddExpLength(e.target.value)}
                        placeholder="0.00"
                        className={`pr-6 ${addExpWeight === "" && addExpLength === "" ? "border-destructive focus-visible:ring-destructive" : ""}`}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">m</span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">{t("expectedGsm")}</Label>
                    <div className="relative">
                      <Input
                        type="number" min="0" step="0.01"
                        value={addExpGsm}
                        onChange={e => setAddExpGsm(e.target.value)}
                        placeholder="0.00"
                        className="pr-10"
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">gsm</span>
                    </div>
                  </div>
                </div>
                {addExpWeight === "" && addExpLength === "" && (
                  <p className="text-xs text-destructive">{t("weightOrLengthRequired")}</p>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">Notes</Label>
              <Input
                value={addNotes}
                onChange={e => setAddNotes(e.target.value)}
                placeholder="Optional notes…"
              />
            </div>

          </div>

          <DialogFooter className="px-6 py-4 border-t shrink-0 bg-muted/20">
            <Button variant="outline" onClick={() => setAddOpen(false)}>{t("cancel")}</Button>
            <Button
              onClick={handleAddItem}
              disabled={addingItem || (addType === "dyed" ? !resolvedCfc : !addMaterialId) || (addExpWeight === "" && addExpLength === "")}
            >
              {addingItem && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              <Plus className="h-4 w-4 mr-1.5" />
              {t("addDeliveryItem")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit item dialog */}
      <Dialog open={editItem !== null} onOpenChange={open => !open && setEditItem(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("editDeliveryItem")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {editItem?.client_fabric_code_id != null && editItem.lot?.lot_number && (
              <div className="space-y-1.5">
                <Label>{t("lotReference")}</Label>
                <Input value={editItem.lot.lot_number} disabled className="bg-muted text-muted-foreground" />
              </div>
            )}
            {editItem?.client_fabric_code_id == null && (
              <div className="space-y-1.5">
                <Label>{t("lotReference")}</Label>
                <Input value={editLotRef} onChange={e => setEditLotRef(e.target.value)} placeholder="e.g. LOT-A1" />
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>
                  {t("expectedWeightKg")}
                  {editExpLength === "" && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={editExpWeight}
                  onChange={e => setEditExpWeight(e.target.value)}
                  placeholder="0.00"
                  className={editExpWeight === "" && editExpLength === "" ? "border-destructive" : ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  {t("expectedLengthM")}
                  {editExpWeight === "" && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={editExpLength}
                  onChange={e => setEditExpLength(e.target.value)}
                  placeholder="0.00"
                  className={editExpWeight === "" && editExpLength === "" ? "border-destructive" : ""}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("expectedGsm")}</Label>
                <Input
                  type="number" min="0" step="0.01"
                  value={editExpGsm}
                  onChange={e => setEditExpGsm(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            </div>
            {editExpWeight === "" && editExpLength === "" && (
              <p className="text-xs text-destructive">{t("weightOrLengthRequired")}</p>
            )}
            {editItem?.client_fabric_code_id != null && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground uppercase tracking-wide">{t("fabricCodePlanned")}</Label>
                <div className="flex gap-2">
                  {([true, false, null] as const).map(val => (
                    <button
                      key={String(val)}
                      type="button"
                      onClick={() => setEditFabricCodePlanned(val)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                        editFabricCodePlanned === val
                          ? val === true
                            ? "border-green-500 bg-green-50 text-green-700"
                            : val === false
                            ? "border-orange-500 bg-orange-50 text-orange-700"
                            : "border-primary bg-primary/5 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40"
                      }`}
                    >
                      {val === true ? t("fabricCodePlannedYes") : val === false ? t("fabricCodePlannedNo") : t("fabricCodePlannedUnset")}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Optional notes…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditItem(null)}>{t("cancel")}</Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit || (editExpWeight === "" && editExpLength === "")}>
              {savingEdit && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {t("saveChanges")}
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
