import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ChevronsUpDown, Lock, LockOpen, Plus, Loader2, Scissors, ScanBarcode, X, Printer } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  clientApi, colorApi, materialApi, logicalLocationApi,
  clientFabricCodeApi, lotApi, fabricRollApi, warehouseRackApi,
  type Client, type Color, type Material, type LogicalLocation,
  type ClientFabricCode, type Lot, type FabricRoll, type WarehouseRack,
} from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type SupplierSource = "client" | "logical_location";

interface LockedDetails {
  lotId: number | null;
  lotNumber: string | null;
  fabricWidth: string;
  gsm: string;
  lengthUnit: "m" | "yd";
}

// ─── Combobox helper ──────────────────────────────────────────────────────────

interface ComboItem { id: number; label: string }

function Combobox({
  items, value, onSelect, placeholder, disabled = false,
}: {
  items: ComboItem[];
  value: number | null;
  onSelect: (id: number) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const selected = items.find((i) => i.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          {selected ? selected.label : placeholder}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" align="start">
        <Command>
          <CommandInput placeholder={t('search')} />
          <CommandList>
            <CommandEmpty>{t('noResults')}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.label}
                  onSelect={() => { onSelect(item.id); setOpen(false); }}
                >
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

// ─── Main component ───────────────────────────────────────────────────────────

const FabricRolls = () => {
  const [searchParams] = useSearchParams();
  const warehouseIdParam = searchParams.get("warehouse");
  const warehouseId = warehouseIdParam ? parseInt(warehouseIdParam) : undefined;
  const { t } = useTranslation();
  const { language } = useLanguage();

  // ── Reference data ──────────────────────────────────────────────────────────
  const [clients, setClients] = useState<Client[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [logicalLocations, setLogicalLocations] = useState<LogicalLocation[]>([]);
  const [refLoading, setRefLoading] = useState(true);

  // ── Step 1 – initialisation ──────────────────────────────────────────────────
  const [clientId, setClientId] = useState<number | null>(null);
  const [materialId, setMaterialId] = useState<number | null>(null);
  const [colorId, setColorId] = useState<number | null>(null);
  const [fabricCode, setFabricCode] = useState<ClientFabricCode | null>(null);
  const [cfcLoading, setCfcLoading] = useState(false);

  // Supplier
  const [supplierSource, setSupplierSource] = useState<SupplierSource>("client");
  const [supplierClientId, setSupplierClientId] = useState<number | null>(null);
  const [supplierLocationId, setSupplierLocationId] = useState<number | null>(null);

  // ── Step 2 – lock details ────────────────────────────────────────────────────
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [selectedLotId, setSelectedLotId] = useState<number | null>(null);
  const [newLotNumber, setNewLotNumber] = useState("");
  const [lotMode, setLotMode] = useState<"existing" | "new" | "none">("none");
  const [fabricWidthInput, setFabricWidthInput] = useState("");
  const [gsmInput, setGsmInput] = useState("");
  const [lengthUnit, setLengthUnit] = useState<"m" | "yd">("m");
  const [locked, setLocked] = useState(false);
  const [lockedDetails, setLockedDetails] = useState<LockedDetails | null>(null);
  const [lockLoading, setLockLoading] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  // ── Printer ──────────────────────────────────────────────────────────────────
  const [printers, setPrinters] = useState<BrowserPrint.Device[]>([]);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [selectedPrinter, setSelectedPrinter] = useState<BrowserPrint.Device | null>(null);

  // ── Step 3 – roll entry ──────────────────────────────────────────────────────
  const [weightInput, setWeightInput] = useState("");
  const [lengthInput, setLengthInput] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [sessionRolls, setSessionRolls] = useState<FabricRoll[]>([]);
  const [rollRackNames, setRollRackNames] = useState<Record<number, string>>({});

  // Rack entry
  const [rackInput, setRackInput] = useState("");
  const [resolvedRack, setResolvedRack] = useState<WarehouseRack | null>(null);
  const [rackLoading, setRackLoading] = useState(false);
  const [rackError, setRackError] = useState<string | null>(null);

  // ── Load reference data ──────────────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      setRefLoading(true);
      try {
        const [c, col, mat, ll] = await Promise.all([
          clientApi.getAll(),
          colorApi.getAll(),
          materialApi.getAll(),
          logicalLocationApi.getAll({ limit: 500 }),
        ]);
        setClients(c);
        setColors(col);
        setMaterials(mat);
        setLogicalLocations(ll);
      } catch (e) {
        console.error("Failed to load reference data", e);
      } finally {
        setRefLoading(false);
      }
    };
    load();
  }, []);

  // ── Load printers on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (typeof BrowserPrint === "undefined") return;
    setPrintersLoading(true);
    BrowserPrint.getLocalDevices(
      (devices) => { setPrinters(devices as BrowserPrint.Device[]); setPrintersLoading(false); },
      () => setPrintersLoading(false),
      "printer",
    );
  }, []);

  // ── Resolve / create ClientFabricCode when all 3 are set ────────────────────
  useEffect(() => {
    if (!clientId || !materialId || !colorId) {
      setFabricCode(null);
      return;
    }
    const resolve = async () => {
      setCfcLoading(true);
      try {
        const cfc = await clientFabricCodeApi.getOrCreate({ client_id: clientId, material_id: materialId, color_id: colorId });
        setFabricCode(cfc);
        setLots([]);
        setSelectedLotId(null);
        setNewLotNumber("");
        setLotMode("none");
        setLocked(false);
        setLockedDetails(null);
        setSessionRolls([]);
      } catch (e) {
        console.error("Failed to resolve fabric code", e);
        setFabricCode(null);
      } finally {
        setCfcLoading(false);
      }
    };
    resolve();
  }, [clientId, materialId, colorId]);

  // ── Load lots when fabric code changes ──────────────────────────────────────
  useEffect(() => {
    if (!fabricCode) return;
    const load = async () => {
      setLotsLoading(true);
      try {
        const data = await lotApi.getByFabricCode(fabricCode.id);
        setLots(data);
      } catch (e) {
        console.error("Failed to load lots", e);
      } finally {
        setLotsLoading(false);
      }
    };
    load();
  }, [fabricCode]);

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const supplierName = (): string | null => {
    if (supplierSource === "client") {
      const c = clients.find((x) => x.id === supplierClientId);
      return c ? c.name : null;
    }
    const ll = logicalLocations.find((x) => x.id === supplierLocationId);
    return ll ? ll.name : null;
  };

  const canLock =
    fabricCode != null &&
    supplierName() != null &&
    !locked &&
    (lotMode !== "existing" || selectedLotId != null) &&
    (lotMode !== "new" || newLotNumber.trim() !== "");

  const handleLockDetails = async () => {
    if (!fabricCode) return;
    setLockLoading(true);
    setLockError(null);
    try {
      let resolvedLotId: number | null = null;
      let resolvedLotNumber: string | null = null;

      if (lotMode === "existing" && selectedLotId != null) {
        resolvedLotId = selectedLotId;
        resolvedLotNumber = lots.find((l) => l.id === selectedLotId)?.lot_number ?? null;
      } else if (lotMode === "new" && newLotNumber.trim()) {
        const lot = await lotApi.getOrCreate({
          client_fabric_code_id: fabricCode.id,
          lot_number: newLotNumber.trim(),
        });
        resolvedLotId = lot.id;
        resolvedLotNumber = lot.lot_number;
        setLots((prev) => (prev.some((l) => l.id === lot.id) ? prev : [...prev, lot]));
      }

      setLockedDetails({
        lotId: resolvedLotId,
        lotNumber: resolvedLotNumber,
        fabricWidth: fabricWidthInput,
        gsm: gsmInput,
        lengthUnit,
      });
      setLocked(true);
    } catch (e) {
      setLockError(e instanceof Error ? e.message : t('error'));
    } finally {
      setLockLoading(false);
    }
  };

  const handleRackByCode = async () => {
    const val = rackInput.trim();
    if (!val) return;
    setRackLoading(true);
    setRackError(null);
    setResolvedRack(null);
    try {
      const results = await warehouseRackApi.searchByCode(val, warehouseId);
      setResolvedRack(results[0]);
      setRackInput("");
    } catch (e) {
      setRackError(e instanceof Error ? e.message : t('error'));
    } finally {
      setRackLoading(false);
    }
  };

  const handleRackById = async (id: number) => {
    setRackLoading(true);
    setRackError(null);
    setResolvedRack(null);
    try {
      const rack = await warehouseRackApi.getById(id);
      setResolvedRack(rack);
      setRackInput("");
    } catch (e) {
      setRackError(e instanceof Error ? e.message : t('error'));
    } finally {
      setRackLoading(false);
    }
  };

  const handleAddRoll = async () => {
    if (!fabricCode || !lockedDetails) return;
    const weight = parseFloat(weightInput);
    if (isNaN(weight) || weight <= 0) {
      setAddError(t('error'));
      return;
    }
    setAddLoading(true);
    setAddError(null);
    try {
      const roll = await fabricRollApi.create({
        client_fabric_code_id: fabricCode.id,
        lot_id: lockedDetails.lotId ?? undefined,
        gsm: lockedDetails.gsm ? parseFloat(lockedDetails.gsm) : undefined,
        fabric_width: lockedDetails.fabricWidth ? parseFloat(lockedDetails.fabricWidth) : undefined,
        weight,
        length: lengthInput
          ? (lockedDetails.lengthUnit === "yd"
              ? parseFloat(lengthInput) * 0.9144
              : parseFloat(lengthInput))
          : undefined,
        supplier: supplierName() ?? undefined,
        received_date: new Date().toISOString(),
        rack_id: resolvedRack?.id ?? undefined,
      });
      setSessionRolls((prev) => [roll, ...prev]);
      if (resolvedRack) {
        setRollRackNames((prev) => ({ ...prev, [roll.id]: resolvedRack.rack_code }));
      }
      setWeightInput("");
      setLengthInput("");
    } catch (e) {
      setAddError(e instanceof Error ? e.message : t('error'));
    } finally {
      setAddLoading(false);
    }
  };

  const handleReset = () => {
    setClientId(null);
    setMaterialId(null);
    setColorId(null);
    setFabricCode(null);
    setSupplierClientId(null);
    setSupplierLocationId(null);
    setSelectedLotId(null);
    setNewLotNumber("");
    setLotMode("none");
    setFabricWidthInput("");
    setGsmInput("");
    setLengthUnit("m");
    setLocked(false);
    setLockedDetails(null);
    setWeightInput("");
    setLengthInput("");
    setSessionRolls([]);
    setLockError(null);
    setAddError(null);
    setRackInput("");
    setResolvedRack(null);
    setRackError(null);
    setRollRackNames({});
    setSelectedPrinter(null);
  };

  // ── Derived combobox items ────────────────────────────────────────────────────
  const clientItems = clients.map((c) => ({ id: c.id, label: c.name }));
  const colorItems = colors.map((c) => ({ id: c.id, label: c.name }));
  const materialItems = materials.map((m) => ({ id: m.id, label: m.name }));
  const locationItems = logicalLocations.map((l) => ({ id: l.id, label: l.name }));
  const lotItems = lots.map((l) => ({ id: l.id, label: l.lot_number }));

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex" dir={language === 'ar' ? 'rtl' : 'ltr'}>
        <Sidebar />
        <main className="flex-1 p-8 space-y-6 overflow-auto">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Scissors className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold text-primary">{t('dyedFabricRollProcessing')}</h1>
            </div>
            <Button variant="outline" onClick={handleReset}>{t('resetSession')}</Button>
          </div>

          {refLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('loadingReferenceData')}
            </div>
          ) : (
            <>
              {/* ── STEP 1: Initialisation ─────────────────────────────────── */}
              {locked ? (
                <Card className="border-muted/60">
                  <CardContent className="py-3 px-4">
                    <p className="text-xs text-muted-foreground mb-2">{t('step1IdentifyFabric')}</p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="font-medium">{clients.find(c => c.id === clientId)?.name ?? "—"}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-medium">{materials.find(m => m.id === materialId)?.name ?? "—"}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="font-medium">{colors.find(c => c.id === colorId)?.name ?? "—"}</span>
                      {fabricCode?.fabric_code && (
                        <Badge variant="secondary" className="text-xs">{fabricCode.fabric_code}</Badge>
                      )}
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">{t('supplier')}:</span>
                      <span className="font-medium">{supplierName() ?? "—"}</span>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('step1IdentifyFabric')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label>{t('client')} *</Label>
                        <Combobox items={clientItems} value={clientId} onSelect={setClientId} placeholder={t('selectClient')} />
                      </div>
                      <div className="space-y-1">
                        <Label>{t('material')} *</Label>
                        <Combobox items={materialItems} value={materialId} onSelect={setMaterialId} placeholder={t('selectMaterial')} />
                      </div>
                      <div className="space-y-1">
                        <Label>{t('color')} *</Label>
                        <Combobox items={colorItems} value={colorId} onSelect={setColorId} placeholder={t('selectColor')} />
                      </div>
                    </div>

                    {cfcLoading && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> {t('resolvingFabricCode')}
                      </div>
                    )}
                    {fabricCode && !cfcLoading && (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">{t('fabricCodeColon')}</span>
                        <Badge variant="secondary">
                          {fabricCode.fabric_code ?? `#${fabricCode.id} ${t('noCodeAssigned')}`}
                        </Badge>
                      </div>
                    )}

                    <Separator />

                    <div className="space-y-3">
                      <Label>{t('supplier')} *</Label>
                      <div className="flex gap-2">
                        <Button size="sm" variant={supplierSource === "client" ? "default" : "outline"}
                          onClick={() => { setSupplierSource("client"); setSupplierLocationId(null); }}>
                          {t('client')}
                        </Button>
                        <Button size="sm" variant={supplierSource === "logical_location" ? "default" : "outline"}
                          onClick={() => { setSupplierSource("logical_location"); setSupplierClientId(null); }}>
                          {t('logicalLocation')}
                        </Button>
                      </div>
                      {supplierSource === "client" ? (
                        <Combobox items={clientItems} value={supplierClientId} onSelect={setSupplierClientId} placeholder={t('selectSupplierClient')} />
                      ) : (
                        <Combobox items={locationItems} value={supplierLocationId} onSelect={setSupplierLocationId} placeholder={t('selectLogicalLocation')} />
                      )}
                      {supplierName() && (
                        <p className="text-sm text-muted-foreground">
                          {t('supplier')}: <span className="font-medium text-foreground">{supplierName()}</span>
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ── STEP 2: Lock Details ───────────────────────────────────── */}
              {fabricCode && (locked && lockedDetails ? (
                <Card className="border-green-500/50 bg-green-50/30">
                  <CardContent className="py-3 px-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Lock className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      <span className="text-xs text-muted-foreground">{t('step2BatchDetails')}</span>
                      {lockedDetails.lotNumber && <Badge variant="outline" className="text-xs">{t('lotBadge', { lotNumber: lockedDetails.lotNumber })}</Badge>}
                      {lockedDetails.fabricWidth && <Badge variant="outline" className="text-xs">{t('widthBadge', { width: lockedDetails.fabricWidth })}</Badge>}
                      {lockedDetails.gsm && <Badge variant="outline" className="text-xs">{t('gsmBadge', { gsm: lockedDetails.gsm })}</Badge>}
                      <Badge variant="outline" className="text-xs">{t('lengthUnitLabel')}: {lockedDetails.lengthUnit === "yd" ? t('yardsShort') : t('metersShort')}</Badge>
                      <Badge variant="outline" className="text-xs">{t('supplierBadge', { supplier: supplierName() ?? '' })}</Badge>
                      {selectedPrinter && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <Printer className="h-3 w-3" />{selectedPrinter.name}
                        </Badge>
                      )}
                      {resolvedRack && (
                        <Badge variant="outline" className="text-xs gap-1">
                          <ScanBarcode className="h-3 w-3" />{resolvedRack.rack_code}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setLocked(false); setLockedDetails(null); setResolvedRack(null); setRackInput(""); setRackError(null); }}
                        className="ml-auto h-7 text-xs flex items-center gap-1"
                      >
                        <LockOpen className="h-3 w-3" />
                        {t('unlockDetails')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{t('step2BatchDetails')}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Lot */}
                    <div className="space-y-2">
                      <Label>{t('lotNumberOptional')}</Label>
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant={lotMode === "none" ? "default" : "outline"}
                          onClick={() => setLotMode("none")}
                          disabled={locked}
                        >
                          {t('noLot')}
                        </Button>
                        <Button
                          size="sm"
                          variant={lotMode === "existing" ? "default" : "outline"}
                          onClick={() => setLotMode("existing")}
                          disabled={locked || lots.length === 0}
                        >
                          {t('existingLots')} {lots.length > 0 && `(${lots.length})`}
                        </Button>
                        <Button
                          size="sm"
                          variant={lotMode === "new" ? "default" : "outline"}
                          onClick={() => setLotMode("new")}
                          disabled={locked}
                        >
                          {t('newLot')}
                        </Button>
                      </div>

                      {lotMode === "existing" && (
                        lotsLoading ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> {t('loadingLots')}
                          </div>
                        ) : (
                          <Combobox
                            items={lotItems}
                            value={selectedLotId}
                            onSelect={setSelectedLotId}
                            placeholder={t('selectLot')}
                            disabled={locked}
                          />
                        )
                      )}

                      {lotMode === "new" && (
                        <Input
                          placeholder={t('enterNewLotNumber')}
                          value={newLotNumber}
                          onChange={(e) => setNewLotNumber(e.target.value)}
                          disabled={locked}
                        />
                      )}
                    </div>

                    {/* Width, GSM & Length Unit */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-1">
                        <Label>{t('fabricWidthCm')}</Label>
                        <Input
                          type="number"
                          placeholder="e.g. 150"
                          value={fabricWidthInput}
                          onChange={(e) => setFabricWidthInput(e.target.value)}
                          disabled={locked}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>{t('gsmLabel')}</Label>
                        <Input
                          type="number"
                          placeholder="e.g. 220"
                          value={gsmInput}
                          onChange={(e) => setGsmInput(e.target.value)}
                          disabled={locked}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>{t('lengthUnitLabel')}</Label>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant={lengthUnit === "m" ? "default" : "outline"}
                            onClick={() => setLengthUnit("m")}
                            disabled={locked}
                          >
                            {t('metersShort')}
                          </Button>
                          <Button
                            size="sm"
                            variant={lengthUnit === "yd" ? "default" : "outline"}
                            onClick={() => setLengthUnit("yd")}
                            disabled={locked}
                          >
                            {t('yardsShort')}
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Rack */}
                    <div className="space-y-2">
                      <Label className="flex items-center gap-1">
                        <ScanBarcode className="h-4 w-4" />
                        {t('rack')}
                      </Label>
                      {resolvedRack ? (
                        <div className="flex items-center gap-2">
                          <Badge className="text-sm px-3 py-1">{resolvedRack.rack_code}</Badge>
                          <span className="text-xs text-muted-foreground">ID #{resolvedRack.id}</span>
                          <Button variant="ghost" size="sm" onClick={() => { setResolvedRack(null); setRackError(null); setRackInput(""); }} className="h-6 w-6 p-0">
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Input
                            placeholder={t('enterRackCode')}
                            value={rackInput}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val.endsWith("*R")) {
                                const id = parseInt(val.slice(0, -2));
                                if (!isNaN(id)) handleRackById(id);
                              } else {
                                setRackInput(val);
                              }
                            }}
                            onKeyDown={(e) => e.key === "Enter" && handleRackByCode()}
                            className="max-w-xs"
                          />
                          <Button variant="outline" onClick={handleRackByCode} disabled={rackLoading || !rackInput.trim()}>
                            {rackLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('confirm')}
                          </Button>
                        </div>
                      )}
                      {rackError && <p className="text-sm text-destructive">{rackError}</p>}
                    </div>

                    {lockError && (
                      <p className="text-sm text-destructive">{lockError}</p>
                    )}

                    {!locked && (
                      <div className="flex items-end gap-2 flex-wrap">
                        <div className="space-y-1">
                          <Label className="flex items-center gap-1 text-sm">
                            <Printer className="h-3.5 w-3.5" />
                            {t('selectPrinter')}
                          </Label>
                          <Select
                            value={selectedPrinter?.uid ?? ""}
                            onValueChange={(uid) => setSelectedPrinter(printers.find(p => p.uid === uid) ?? null)}
                          >
                            <SelectTrigger className="w-48">
                              <SelectValue placeholder={printersLoading ? t('loadingPrinters') : t('selectPrinter')} />
                            </SelectTrigger>
                            <SelectContent>
                              {printers.map(p => (
                                <SelectItem key={p.uid} value={p.uid}>{p.name}</SelectItem>
                              ))}
                              {!printersLoading && printers.length === 0 && (
                                <div className="px-2 py-1.5 text-sm text-muted-foreground">{t('noPrintersFound')}</div>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          onClick={handleLockDetails}
                          disabled={!canLock || lockLoading}
                          className="flex items-center gap-2"
                        >
                          {lockLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                          {t('lockDetails')}
                        </Button>
                      </div>
                    )}

                  </CardContent>
                </Card>
              ))}

              {/* ── STEP 3: Add Rolls ──────────────────────────────────────── */}
              {locked && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      {t('step3AddRolls')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
                      <div className="space-y-1">
                        <Label>{t('weightKgRequired')}</Label>
                        <Input
                          type="number"
                          placeholder="e.g. 24.500"
                          value={weightInput}
                          onChange={(e) => setWeightInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleAddRoll()}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>
                          {t('length')} ({lockedDetails.lengthUnit === "yd" ? t('yardsShort') : t('metersShort')})
                          {lockedDetails.lengthUnit === "yd" && (
                            <span className="ml-1 text-xs text-muted-foreground">→ saved as m</span>
                          )}
                        </Label>
                        <Input
                          type="number"
                          placeholder="e.g. 80.00"
                          value={lengthInput}
                          onChange={(e) => setLengthInput(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleAddRoll()}
                        />
                      </div>
                    </div>

                    {addError && (
                      <p className="text-sm text-destructive">{addError}</p>
                    )}

                    <Button
                      onClick={handleAddRoll}
                      disabled={addLoading || !weightInput}
                      className="flex items-center gap-2"
                    >
                      {addLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                      {t('addRoll')}
                    </Button>

                    {/* Session rolls table */}
                    {sessionRolls.length > 0 && (
                      <div className="mt-4 space-y-2">
                        <p className="text-sm font-medium">
                          {t('rollsAddedThisSession', { count: String(sessionRolls.length) })}
                        </p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t('rollId')}</TableHead>
                              <TableHead>{t('weightKg')}</TableHead>
                              <TableHead>{t('length')} (m)</TableHead>
                              <TableHead>{t('rack')}</TableHead>
                              <TableHead>{t('status')}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sessionRolls.map((roll) => (
                              <TableRow key={roll.id}>
                                <TableCell>
                                  <Badge variant="outline">#{roll.id}</Badge>
                                </TableCell>
                                <TableCell>{roll.weight}</TableCell>
                                <TableCell>{roll.length ?? "—"}</TableCell>
                                <TableCell>
                                  {rollRackNames[roll.id] ? (
                                    <Badge variant="outline">{rollRackNames[roll.id]}</Badge>
                                  ) : "—"}
                                </TableCell>
                                <TableCell>
                                  <Badge variant="secondary">{roll.status}</Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </main>
      </div>

    </PageTransition>
  );
};

export default FabricRolls;
