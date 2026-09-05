import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Eye,
  Filter,
  Layers,
  Loader2,
  Package,
  Recycle,
  Tag,
  Boxes,
  User,
  X,
} from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { useTranslation } from "@/hooks/useTranslation";
import {
  fabricRollApi,
  undyedFabricRollApi,
  type ClientInventoryGroup,
  type MaterialInventoryGroup,
  type FabricCodeInventory,
  type InventoryLotGroup,
  type InventoryRollDetail,
  type FabricRoll,
  type UndyedClientInventoryGroup,
  type UndyedMaterialInventory,
  type UndyedInventoryLotGroup,
} from "@/lib/api";

// ── Roll context (threaded down the component tree for the detail popup) ───────

interface RollContext {
  clientName?: string;
  materialName?: string;
  fabricCode?: string | null;
  colorName?: string;
  lotNumber?: string | null;
  supplier?: string | null;
}

// ── Dyed filter / flag types ───────────────────────────────────────────────────

interface DyedFilters {
  clientId: number | null;
  materialId: number | null;
  colorId: number | null;
  fabricCodeId: number | null;
  lot: string;
  rollId: string;
}

interface DyedForceOpenFlags {
  client: boolean;
  material: boolean;
  fabricCode: boolean;
  lotGroup: boolean;
}

// ── Undyed filter / flag types ─────────────────────────────────────────────────

interface UndyedFilters {
  clientId: number | null;
  materialId: number | null;
  lot: string;
  rollId: string;
}

interface UndyedForceOpenFlags {
  client: boolean;
  material: boolean;
  lotGroup: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function inc(haystack: string | null | undefined, needle: string): boolean {
  return !needle || (haystack ?? "").toLowerCase().includes(needle.toLowerCase());
}

// ── Combobox ──────────────────────────────────────────────────────────────────

interface ComboItem { id: number; label: string }

function Combobox({
  items, value, onSelect, placeholder, className = "w-full",
}: {
  items: ComboItem[];
  value: number | null;
  onSelect: (id: number | null) => void;
  placeholder: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const selected = items.find((i) => i.id === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className={`h-9 justify-between font-normal text-sm px-3 ${className}`}>
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-0" align="start">
        <Command>
          <CommandInput placeholder={t('search')} className="h-8 text-sm" />
          <CommandList>
            <CommandEmpty>{t('noResults')}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem key={item.id} value={item.label} onSelect={() => { onSelect(item.id); setOpen(false); }} className="text-sm">
                  <Check className={`mr-2 h-3.5 w-3.5 ${value === item.id ? "opacity-100" : "opacity-0"}`} />
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

// ── Shared stat badge ─────────────────────────────────────────────────────────

function StatBadge({ weight, length, rolls }: { weight: number; length?: number | null; rolls: number }) {
  const { t } = useTranslation();
  return (
    <div className="ml-auto flex items-center gap-3 text-sm flex-wrap justify-end shrink-0">
      <span className="text-muted-foreground whitespace-nowrap">
        <span className="font-semibold text-foreground">{fmt(weight, 3)}</span> kg
      </span>
      {length != null && (
        <span className="text-muted-foreground whitespace-nowrap">
          <span className="font-semibold text-foreground">{fmt(length)}</span> m
        </span>
      )}
      <Badge variant="secondary" className="whitespace-nowrap">
        <Package className="h-3 w-3 mr-1" />
        {rolls} {rolls === 1 ? t('rollUnit') : t('rollsUnit')}
      </Badge>
    </div>
  );
}

// ── Roll detail dialog ────────────────────────────────────────────────────────

function RollDetailDialog({
  roll, ctx, open, onClose,
}: {
  roll: InventoryRollDetail;
  ctx: RollContext;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [originalRoll, setOriginalRoll] = useState<FabricRoll | null>(null);
  const [originalRollLoading, setOriginalRollLoading] = useState(false);

  useEffect(() => {
    if (!open || roll.original_roll_id == null) {
      setOriginalRoll(null);
      return;
    }
    setOriginalRollLoading(true);
    fabricRollApi.getById(roll.original_roll_id)
      .then(setOriginalRoll)
      .catch(() => setOriginalRoll(null))
      .finally(() => setOriginalRollLoading(false));
  }, [open, roll.original_roll_id]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            {t('rollDetails')}
            <Badge variant="outline" className="font-mono text-sm ml-1">#{roll.id}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 pt-1">
          {/* Context */}
          <section className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('context')}</p>
            <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
              {ctx.clientName && (
                <>
                  <span className="text-muted-foreground">{t('client')}</span>
                  <span className="font-medium">{ctx.clientName}</span>
                </>
              )}
              {ctx.materialName && (
                <>
                  <span className="text-muted-foreground">{t('material')}</span>
                  <span className="font-medium">{ctx.materialName}</span>
                </>
              )}
              {ctx.colorName && (
                <>
                  <span className="text-muted-foreground">{t('color')}</span>
                  <span className="font-medium">{ctx.colorName}</span>
                </>
              )}
              {ctx.fabricCode && (
                <>
                  <span className="text-muted-foreground">{t('fabricCode')}</span>
                  <Badge className="font-mono text-xs w-fit">{ctx.fabricCode}</Badge>
                </>
              )}
              {ctx.lotNumber && (
                <>
                  <span className="text-muted-foreground">{t('lot')}</span>
                  <span className="font-medium">{ctx.lotNumber}</span>
                </>
              )}
              {ctx.supplier && (
                <>
                  <span className="text-muted-foreground">{t('supplier')}</span>
                  <span className="font-medium">{ctx.supplier}</span>
                </>
              )}
            </div>
          </section>

          <Separator />

          {/* Measurements */}
          <section className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('measurements')}</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('weight')}</span>
                <span className="font-medium">{fmt(roll.weight, 3)} kg</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('length')}</span>
                <span className="font-medium">{roll.length != null ? `${fmt(roll.length)} m` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('gsm')}</span>
                <span className="font-medium">{roll.gsm != null ? `${fmt(roll.gsm, 1)} g/m²` : "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('fabricWidth')}</span>
                <span className="font-medium">{roll.fabric_width != null ? `${fmt(roll.fabric_width, 1)} cm` : "—"}</span>
              </div>
            </div>
          </section>

          <Separator />

          {/* Quality & Status side by side */}
          <div className="grid grid-cols-2 gap-6">
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('quality')}</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('grade')}</span>
                  <span className="font-medium">{roll.quality_grade ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('defectPts')}</span>
                  <span className="font-medium">{roll.defect_points ?? "—"}</span>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('location')}</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t('status')}</span>
                  <Badge variant="secondary" className="text-xs">{roll.status}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t('rack')}</span>
                  {roll.rack_code
                    ? <Badge variant="outline" className="text-xs font-mono">{roll.rack_code}</Badge>
                    : <span className="font-medium">—</span>}
                </div>
              </div>
            </section>
          </div>

          <Separator />

          {/* Dates */}
          <section className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('dates')}</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('received')}</span>
                <span className="font-medium">{fmtDate(roll.received_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('issued')}</span>
                <span className="font-medium">{fmtDate(roll.issued_date)}</span>
              </div>
            </div>
          </section>

          {roll.remarks && (
            <>
              <Separator />
              <section className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('remarks')}</p>
                <p className="text-sm leading-relaxed">{roll.remarks}</p>
              </section>
            </>
          )}

          {roll.original_roll_id != null && (
            <>
              <Separator />
              <section className="space-y-2 rounded-md border border-orange-500/50 bg-orange-50 dark:bg-orange-950/30 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400 flex items-center gap-1">
                  <Recycle className="h-3 w-3" />
                  {t('remnantOfRoll', { id: String(roll.original_roll_id) })}
                </p>
                {originalRollLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('loading')}
                  </div>
                ) : originalRoll ? (
                  <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('weight')}</span>
                      <span className="font-medium">{fmt(originalRoll.weight, 3)} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('length')}</span>
                      <span className="font-medium">{originalRoll.length != null ? `${fmt(originalRoll.length)} m` : "—"}</span>
                    </div>
                    <div className="flex justify-between col-span-2">
                      <span className="text-muted-foreground">{t('supplier')}</span>
                      <span className="font-medium">{originalRoll.supplier ?? "—"}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </section>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Roll table (shared) ───────────────────────────────────────────────────────

function RollTable({ rolls, ctx }: { rolls: InventoryRollDetail[]; ctx: RollContext }) {
  const [selectedRoll, setSelectedRoll] = useState<InventoryRollDetail | null>(null);
  const { t } = useTranslation();

  return (
    <>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="w-16">ID</TableHead>
              <TableHead>{t('weightKg')}</TableHead>
              <TableHead>{t('lengthM')}</TableHead>
              <TableHead>{t('gsm')}</TableHead>
              <TableHead>{t('widthCm')}</TableHead>
              <TableHead>{t('rack')}</TableHead>
              <TableHead>{t('grade')}</TableHead>
              <TableHead>{t('defects')}</TableHead>
              <TableHead>{t('received')}</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rolls.map((roll) => (
              <TableRow key={roll.id}>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`font-mono text-xs ${roll.original_roll_id != null ? "border-orange-500/60 text-orange-600 dark:text-orange-400" : ""}`}
                    title={roll.original_roll_id != null ? t('remnantOfRoll', { id: String(roll.original_roll_id) }) : undefined}
                  >
                    #{roll.id}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">{fmt(roll.weight, 3)}</TableCell>
                <TableCell>{fmt(roll.length)}</TableCell>
                <TableCell>{fmt(roll.gsm, 1)}</TableCell>
                <TableCell>{fmt(roll.fabric_width, 1)}</TableCell>
                <TableCell>
                  {roll.rack_code
                    ? <Badge variant="secondary" className="text-xs">{roll.rack_code}</Badge>
                    : "—"}
                </TableCell>
                <TableCell>{roll.quality_grade ?? "—"}</TableCell>
                <TableCell>{roll.defect_points ?? "—"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDate(roll.received_date)}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => setSelectedRoll(roll)}
                    title={t('viewFullDetails')}
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {selectedRoll && (
        <RollDetailDialog
          roll={selectedRoll}
          ctx={ctx}
          open={true}
          onClose={() => setSelectedRoll(null)}
        />
      )}
    </>
  );
}

// ── Shared filter field wrapper ───────────────────────────────────────────────

function FilterField({ label, active, onClear, children }: { label: string; active: boolean; onClear: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</Label>
        {active && (
          <button onClick={onClear} className="flex items-center gap-0.5 text-xs text-primary hover:text-primary/70 transition-colors">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Dyed: Lot group row ───────────────────────────────────────────────────────

function DyedLotGroupRow({ group, flags, ctx }: { group: InventoryLotGroup; flags: DyedForceOpenFlags; ctx: RollContext }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const expanded = flags.lotGroup || open;
  const label = group.lot_number ? `${t('lot')}: ${group.lot_number}` : t('noLot');
  const fullCtx: RollContext = { ...ctx, lotNumber: group.lot_number, supplier: group.supplier };

  return (
    <div className="border rounded-md overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left">
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-sm">{label}</span>
        <span className="text-muted-foreground text-sm">·</span>
        <span className="text-sm text-muted-foreground">{group.supplier ?? t('unknownSupplier')}</span>
        <StatBadge weight={group.total_weight} length={group.total_length} rolls={group.roll_count} />
      </button>
      {expanded && (
        <div className="p-3 bg-background">
          <RollTable rolls={group.rolls} ctx={fullCtx} />
        </div>
      )}
    </div>
  );
}

// ── Dyed: Fabric code row ─────────────────────────────────────────────────────

function DyedFabricCodeRow({ item, flags, ctx }: { item: FabricCodeInventory; flags: DyedForceOpenFlags; ctx: RollContext }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const expanded = flags.fabricCode || open;
  const codeLabel = item.fabric_code ?? `#${item.client_fabric_code_id}`;
  const childCtx: RollContext = { ...ctx, fabricCode: item.fabric_code, colorName: item.color_name };

  return (
    <div className="border rounded-md overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-muted/20 transition-colors text-left">
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <Badge className="font-mono text-xs px-2 py-0.5 shrink-0">{codeLabel}</Badge>
        <span className="text-sm font-medium">{item.color_name}</span>
        <StatBadge weight={item.total_weight} length={item.total_length} rolls={item.roll_count} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2 bg-muted/5 space-y-2">
          {item.lot_groups.map((group, idx) => (
            <DyedLotGroupRow
              key={`${group.lot_id ?? "none"}-${group.supplier ?? "none"}-${idx}`}
              group={group}
              flags={flags}
              ctx={childCtx}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dyed: Material section ────────────────────────────────────────────────────

function DyedMaterialSection({ group, flags, ctx }: { group: MaterialInventoryGroup; flags: DyedForceOpenFlags; ctx: RollContext }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const expanded = flags.material || open;
  const childCtx: RollContext = { ...ctx, materialName: group.material_name };

  return (
    <div className="border rounded-md overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 bg-muted/10 hover:bg-muted/30 transition-colors text-left">
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <Boxes className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-semibold text-sm">{group.material_name}</span>
        <Badge variant="outline" className="text-xs shrink-0">
          {group.fabric_codes.length} {group.fabric_codes.length === 1 ? t('codeUnit') : t('codesUnit')}
        </Badge>
        <StatBadge weight={group.total_weight} length={group.total_length} rolls={group.roll_count} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2 bg-background space-y-2">
          {group.fabric_codes.map((fc) => (
            <DyedFabricCodeRow key={fc.client_fabric_code_id} item={fc} flags={flags} ctx={childCtx} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dyed: Client card ─────────────────────────────────────────────────────────

function DyedClientCard({ group, flags }: { group: ClientInventoryGroup; flags: DyedForceOpenFlags }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const expanded = flags.client || open;
  const ctx: RollContext = { clientName: group.client_name };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="cursor-pointer select-none px-5 py-4 hover:bg-muted/30 transition-colors" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-3 flex-wrap">
          {expanded ? <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
          <User className="h-5 w-5 shrink-0 text-primary" />
          <span className="text-base font-semibold">{group.client_name}</span>
          <Badge variant="outline" className="text-xs">
            {group.materials.length} {group.materials.length === 1 ? t('materialUnit') : t('materialsUnit')}
          </Badge>
          <StatBadge weight={group.total_weight} length={group.total_length} rolls={group.roll_count} />
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="px-5 pb-5 pt-0 space-y-2">
          <Separator className="mb-3" />
          {group.materials.map((mat) => (
            <DyedMaterialSection key={mat.material_id} group={mat} flags={flags} ctx={ctx} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

// ── Dyed: Filter bar ──────────────────────────────────────────────────────────

function DyedFilterBar({ filters, onChange, clientOptions, materialOptions, colorOptions, fabricCodeOptions }: {
  filters: DyedFilters;
  onChange: (f: DyedFilters) => void;
  clientOptions: ComboItem[];
  materialOptions: ComboItem[];
  colorOptions: ComboItem[];
  fabricCodeOptions: ComboItem[];
}) {
  const { t } = useTranslation();
  const set = <K extends keyof DyedFilters>(key: K, val: DyedFilters[K]) => onChange({ ...filters, [key]: val });
  const EMPTY: DyedFilters = { clientId: null, materialId: null, colorId: null, fabricCodeId: null, lot: "", rollId: "" };
  const activeCount = [filters.clientId, filters.materialId, filters.colorId, filters.fabricCodeId, filters.lot || null, filters.rollId || null].filter(Boolean).length;

  return (
    <Card>
      <CardHeader className="px-5 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">{t('filters')}</CardTitle>
            {activeCount > 0 && <Badge variant="secondary" className="text-xs px-1.5 py-0">{t('activeFilters', { count: String(activeCount) })}</Badge>}
          </div>
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground px-2" onClick={() => onChange(EMPTY)}>
              {t('clearAll')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-5 py-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <FilterField label={t('client')} active={filters.clientId !== null} onClear={() => set("clientId", null)}>
            <Combobox items={clientOptions} value={filters.clientId} onSelect={(id) => set("clientId", id)} placeholder={t('allClients')} />
          </FilterField>
          <FilterField label={t('material')} active={filters.materialId !== null} onClear={() => set("materialId", null)}>
            <Combobox items={materialOptions} value={filters.materialId} onSelect={(id) => set("materialId", id)} placeholder={t('allMaterials')} />
          </FilterField>
          <FilterField label={t('color')} active={filters.colorId !== null} onClear={() => set("colorId", null)}>
            <Combobox items={colorOptions} value={filters.colorId} onSelect={(id) => set("colorId", id)} placeholder={t('allColors')} />
          </FilterField>
          <FilterField label={t('fabricCode')} active={filters.fabricCodeId !== null} onClear={() => set("fabricCodeId", null)}>
            <Combobox items={fabricCodeOptions} value={filters.fabricCodeId} onSelect={(id) => set("fabricCodeId", id)} placeholder={t('allCodes')} />
          </FilterField>
          <FilterField label={t('lotNumber')} active={!!filters.lot} onClear={() => set("lot", "")}>
            <div className="relative">
              <Input className="h-9 pr-7 text-sm" placeholder={t('searchLots')} value={filters.lot} onChange={(e) => set("lot", e.target.value)} />
              {filters.lot && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => set("lot", "")}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </FilterField>
          <FilterField label={t('rollId')} active={!!filters.rollId} onClear={() => set("rollId", "")}>
            <div className="relative">
              <Input className="h-9 pr-7 text-sm" placeholder={t('searchRollId')} value={filters.rollId} onChange={(e) => set("rollId", e.target.value)} />
              {filters.rollId && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => set("rollId", "")}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </FilterField>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Undyed: Lot group row ─────────────────────────────────────────────────────

function UndyedLotGroupRow({ group, flags, ctx }: { group: UndyedInventoryLotGroup; flags: UndyedForceOpenFlags; ctx: RollContext }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const expanded = flags.lotGroup || open;
  const label = group.lot_number ? `${t('lot')}: ${group.lot_number}` : t('noLot');
  const fullCtx: RollContext = { ...ctx, lotNumber: group.lot_number, supplier: group.supplier };

  return (
    <div className="border rounded-md overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left">
        {expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-sm">{label}</span>
        <span className="text-muted-foreground text-sm">·</span>
        <span className="text-sm text-muted-foreground">{group.supplier ?? t('unknownSupplier')}</span>
        <StatBadge weight={group.total_weight} length={group.total_length} rolls={group.roll_count} />
      </button>
      {expanded && (
        <div className="p-3 bg-background">
          <RollTable rolls={group.rolls as InventoryRollDetail[]} ctx={fullCtx} />
        </div>
      )}
    </div>
  );
}

// ── Undyed: Material section ──────────────────────────────────────────────────

function UndyedMaterialSection({ group, flags, ctx }: { group: UndyedMaterialInventory; flags: UndyedForceOpenFlags; ctx: RollContext }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const expanded = flags.material || open;
  const childCtx: RollContext = { ...ctx, materialName: group.material_name };

  return (
    <div className="border rounded-md overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-3 px-4 py-3 bg-muted/10 hover:bg-muted/30 transition-colors text-left">
        {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <Boxes className="h-4 w-4 shrink-0 text-primary" />
        <span className="font-semibold text-sm">{group.material_name}</span>
        <Badge variant="outline" className="text-xs shrink-0">
          {group.lot_groups.length} {group.lot_groups.length === 1 ? t('lotUnit') : t('lotsUnit')}
        </Badge>
        <StatBadge weight={group.total_weight} length={group.total_length} rolls={group.roll_count} />
      </button>
      {expanded && (
        <div className="px-4 pb-4 pt-2 bg-background space-y-2">
          {group.lot_groups.map((lg, idx) => (
            <UndyedLotGroupRow
              key={`${lg.lot_number ?? "none"}-${lg.supplier ?? "none"}-${idx}`}
              group={lg}
              flags={flags}
              ctx={childCtx}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Undyed: Client card ───────────────────────────────────────────────────────

function UndyedClientCard({ group, flags }: { group: UndyedClientInventoryGroup; flags: UndyedForceOpenFlags }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const expanded = flags.client || open;
  const ctx: RollContext = { clientName: group.client_name };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="cursor-pointer select-none px-5 py-4 hover:bg-muted/30 transition-colors" onClick={() => setOpen((v) => !v)}>
        <div className="flex items-center gap-3 flex-wrap">
          {expanded ? <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
          <User className="h-5 w-5 shrink-0 text-primary" />
          <span className="text-base font-semibold">{group.client_name}</span>
          <Badge variant="outline" className="text-xs">
            {group.materials.length} {group.materials.length === 1 ? t('materialUnit') : t('materialsUnit')}
          </Badge>
          <StatBadge weight={group.total_weight} length={group.total_length} rolls={group.roll_count} />
        </div>
      </CardHeader>
      {expanded && (
        <CardContent className="px-5 pb-5 pt-0 space-y-2">
          <Separator className="mb-3" />
          {group.materials.map((mat) => (
            <UndyedMaterialSection key={mat.material_id} group={mat} flags={flags} ctx={ctx} />
          ))}
        </CardContent>
      )}
    </Card>
  );
}

// ── Undyed: Filter bar ────────────────────────────────────────────────────────

function UndyedFilterBar({ filters, onChange, clientOptions, materialOptions }: {
  filters: UndyedFilters;
  onChange: (f: UndyedFilters) => void;
  clientOptions: ComboItem[];
  materialOptions: ComboItem[];
}) {
  const { t } = useTranslation();
  const set = <K extends keyof UndyedFilters>(key: K, val: UndyedFilters[K]) => onChange({ ...filters, [key]: val });
  const EMPTY: UndyedFilters = { clientId: null, materialId: null, lot: "", rollId: "" };
  const activeCount = [filters.clientId, filters.materialId, filters.lot || null, filters.rollId || null].filter(Boolean).length;

  return (
    <Card>
      <CardHeader className="px-5 py-3 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">{t('filters')}</CardTitle>
            {activeCount > 0 && <Badge variant="secondary" className="text-xs px-1.5 py-0">{t('activeFilters', { count: String(activeCount) })}</Badge>}
          </div>
          {activeCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground px-2" onClick={() => onChange(EMPTY)}>
              {t('clearAll')}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-5 py-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <FilterField label={t('client')} active={filters.clientId !== null} onClear={() => set("clientId", null)}>
            <Combobox items={clientOptions} value={filters.clientId} onSelect={(id) => set("clientId", id)} placeholder={t('allClients')} />
          </FilterField>
          <FilterField label={t('material')} active={filters.materialId !== null} onClear={() => set("materialId", null)}>
            <Combobox items={materialOptions} value={filters.materialId} onSelect={(id) => set("materialId", id)} placeholder={t('allMaterials')} />
          </FilterField>
          <FilterField label={t('lotNumber')} active={!!filters.lot} onClear={() => set("lot", "")}>
            <div className="relative">
              <Input className="h-9 pr-7 text-sm" placeholder={t('searchLots')} value={filters.lot} onChange={(e) => set("lot", e.target.value)} />
              {filters.lot && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => set("lot", "")}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </FilterField>
          <FilterField label={t('rollId')} active={!!filters.rollId} onClear={() => set("rollId", "")}>
            <div className="relative">
              <Input className="h-9 pr-7 text-sm" placeholder={t('searchRollId')} value={filters.rollId} onChange={(e) => set("rollId", e.target.value)} />
              {filters.rollId && (
                <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => set("rollId", "")}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </FilterField>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Filtering logic ───────────────────────────────────────────────────────────

function applyDyedFilters(inventory: ClientInventoryGroup[], f: DyedFilters): ClientInventoryGroup[] {
  return inventory
    .filter((c) => !f.clientId || c.client_id === f.clientId)
    .map((c) => ({
      ...c,
      materials: c.materials
        .filter((m) => !f.materialId || m.material_id === f.materialId)
        .map((m) => ({
          ...m,
          fabric_codes: m.fabric_codes
            .filter((fc) => (!f.colorId || fc.color_id === f.colorId) && (!f.fabricCodeId || fc.client_fabric_code_id === f.fabricCodeId))
            .map((fc) => ({
              ...fc,
              lot_groups: (f.lot ? fc.lot_groups.filter((lg) => inc(lg.lot_number, f.lot)) : fc.lot_groups)
                .map((lg) => ({
                  ...lg,
                  rolls: f.rollId ? lg.rolls.filter((r) => String(r.id).includes(f.rollId)) : lg.rolls,
                }))
                .filter((lg) => !f.rollId || lg.rolls.length > 0),
            }))
            .filter((fc) => (!f.lot || fc.lot_groups.length > 0) && (!f.rollId || fc.lot_groups.length > 0)),
        }))
        .filter((m) => m.fabric_codes.length > 0),
    }))
    .filter((c) => c.materials.length > 0);
}

function applyUndyedFilters(inventory: UndyedClientInventoryGroup[], f: UndyedFilters): UndyedClientInventoryGroup[] {
  return inventory
    .filter((c) => !f.clientId || c.client_id === f.clientId)
    .map((c) => ({
      ...c,
      materials: c.materials
        .filter((m) => !f.materialId || m.material_id === f.materialId)
        .map((m) => ({
          ...m,
          lot_groups: (f.lot ? m.lot_groups.filter((lg) => inc(lg.lot_number, f.lot)) : m.lot_groups)
            .map((lg) => ({
              ...lg,
              rolls: f.rollId ? lg.rolls.filter((r) => String(r.id).includes(f.rollId)) : lg.rolls,
            }))
            .filter((lg) => !f.rollId || lg.rolls.length > 0),
        }))
        .filter((m) => (!f.lot || m.lot_groups.length > 0) && (!f.rollId || m.lot_groups.length > 0)),
    }))
    .filter((c) => c.materials.length > 0);
}

function uniqueSorted<T extends { id: number; label: string }>(items: T[]): ComboItem[] {
  const map = new Map<number, string>();
  items.forEach((i) => map.set(i.id, i.label));
  return Array.from(map.entries()).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_DYED: DyedFilters = { clientId: null, materialId: null, colorId: null, fabricCodeId: null, lot: "", rollId: "" };
const EMPTY_UNDYED: UndyedFilters = { clientId: null, materialId: null, lot: "", rollId: "" };

// ── Main page ─────────────────────────────────────────────────────────────────

const FabricInventory = () => {
  const { t } = useTranslation();

  // ── Dyed state ──────────────────────────────────────────────────────────────
  const [dyedInventory, setDyedInventory] = useState<ClientInventoryGroup[]>([]);
  const [dyedLoading, setDyedLoading] = useState(true);
  const [dyedError, setDyedError] = useState<string | null>(null);
  const [dyedFilters, setDyedFilters] = useState<DyedFilters>(EMPTY_DYED);

  // ── Undyed state ─────────────────────────────────────────────────────────────
  const [undyedInventory, setUndyedInventory] = useState<UndyedClientInventoryGroup[]>([]);
  const [undyedLoading, setUndyedLoading] = useState(true);
  const [undyedError, setUndyedError] = useState<string | null>(null);
  const [undyedFilters, setUndyedFilters] = useState<UndyedFilters>(EMPTY_UNDYED);

  const loadDyed = async () => {
    setDyedLoading(true); setDyedError(null);
    try { setDyedInventory(await fabricRollApi.getInventory()); }
    catch (e) { setDyedError(e instanceof Error ? e.message : t('failedToLoadDyedInventory')); }
    finally { setDyedLoading(false); }
  };

  const loadUndyed = async () => {
    setUndyedLoading(true); setUndyedError(null);
    try { setUndyedInventory(await undyedFabricRollApi.getInventory()); }
    catch (e) { setUndyedError(e instanceof Error ? e.message : t('failedToLoadUndyedInventory')); }
    finally { setUndyedLoading(false); }
  };

  useEffect(() => { loadDyed(); loadUndyed(); }, []);

  // ── Dyed: cascading options ──────────────────────────────────────────────────

  const dyedClientOptions = useMemo(
    () => uniqueSorted(dyedInventory.map((c) => ({ id: c.client_id, label: c.client_name }))),
    [dyedInventory],
  );
  const dyedMaterialOptions = useMemo(() => {
    const base = dyedFilters.clientId ? dyedInventory.filter((c) => c.client_id === dyedFilters.clientId) : dyedInventory;
    return uniqueSorted(base.flatMap((c) => c.materials.map((m) => ({ id: m.material_id, label: m.material_name }))));
  }, [dyedInventory, dyedFilters.clientId]);
  const dyedColorOptions = useMemo(() => {
    const fcs = dyedInventory
      .filter((c) => !dyedFilters.clientId || c.client_id === dyedFilters.clientId)
      .flatMap((c) => c.materials)
      .filter((m) => !dyedFilters.materialId || m.material_id === dyedFilters.materialId)
      .flatMap((m) => m.fabric_codes);
    return uniqueSorted(fcs.map((fc) => ({ id: fc.color_id, label: fc.color_name })));
  }, [dyedInventory, dyedFilters.clientId, dyedFilters.materialId]);
  const dyedFabricCodeOptions = useMemo(() => {
    const fcs = dyedInventory
      .filter((c) => !dyedFilters.clientId || c.client_id === dyedFilters.clientId)
      .flatMap((c) => c.materials)
      .filter((m) => !dyedFilters.materialId || m.material_id === dyedFilters.materialId)
      .flatMap((m) => m.fabric_codes)
      .filter((fc) => !dyedFilters.colorId || fc.color_id === dyedFilters.colorId);
    return uniqueSorted(fcs.map((fc) => ({ id: fc.client_fabric_code_id, label: fc.fabric_code ?? `#${fc.client_fabric_code_id}` })));
  }, [dyedInventory, dyedFilters.clientId, dyedFilters.materialId, dyedFilters.colorId]);

  // ── Undyed: cascading options ────────────────────────────────────────────────

  const undyedClientOptions = useMemo(
    () => uniqueSorted(undyedInventory.map((c) => ({ id: c.client_id, label: c.client_name }))),
    [undyedInventory],
  );
  const undyedMaterialOptions = useMemo(() => {
    const base = undyedFilters.clientId ? undyedInventory.filter((c) => c.client_id === undyedFilters.clientId) : undyedInventory;
    return uniqueSorted(base.flatMap((c) => c.materials.map((m) => ({ id: m.material_id, label: m.material_name }))));
  }, [undyedInventory, undyedFilters.clientId]);

  // ── Dyed: filter + flags ─────────────────────────────────────────────────────

  const isDyedFiltering = dyedFilters.clientId !== null || dyedFilters.materialId !== null || dyedFilters.colorId !== null || dyedFilters.fabricCodeId !== null || dyedFilters.lot !== "" || dyedFilters.rollId !== "";
  const dyedFlags: DyedForceOpenFlags = {
    client:     isDyedFiltering,
    material:   !!(dyedFilters.materialId || dyedFilters.colorId || dyedFilters.fabricCodeId || dyedFilters.lot || dyedFilters.rollId),
    fabricCode: !!(dyedFilters.colorId || dyedFilters.fabricCodeId || dyedFilters.lot || dyedFilters.rollId),
    lotGroup:   !!(dyedFilters.lot || dyedFilters.rollId),
  };
  const filteredDyed = useMemo(
    () => isDyedFiltering ? applyDyedFilters(dyedInventory, dyedFilters) : dyedInventory,
    [dyedInventory, dyedFilters, isDyedFiltering],
  );

  // ── Undyed: filter + flags ───────────────────────────────────────────────────

  const isUndyedFiltering = undyedFilters.clientId !== null || undyedFilters.materialId !== null || undyedFilters.lot !== "" || undyedFilters.rollId !== "";
  const undyedFlags: UndyedForceOpenFlags = {
    client:   isUndyedFiltering,
    material: !!(undyedFilters.materialId || undyedFilters.lot || undyedFilters.rollId),
    lotGroup: !!(undyedFilters.lot || undyedFilters.rollId),
  };
  const filteredUndyed = useMemo(
    () => isUndyedFiltering ? applyUndyedFilters(undyedInventory, undyedFilters) : undyedInventory,
    [undyedInventory, undyedFilters, isUndyedFiltering],
  );

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-8 space-y-6 overflow-auto">

          {/* Header */}
          <div className="flex items-center gap-3">
            <Layers className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-primary">{t('fabricInventory')}</h1>
          </div>

          <Tabs defaultValue="dyed">

            {/* ── Tab bar ────────────────────────────────────────────────────── */}
            <TabsList className="h-12 p-1.5 bg-muted/60 border rounded-xl gap-1 w-auto inline-flex">
              <TabsTrigger
                value="dyed"
                className="h-9 rounded-lg px-5 gap-2.5 font-medium text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shrink-0" />
                {t('dyedFabric')}
              </TabsTrigger>
              <TabsTrigger
                value="undyed"
                className="h-9 rounded-lg px-5 gap-2.5 font-medium text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" />
                {t('undyedFabric')}
              </TabsTrigger>
            </TabsList>

            {/* ── Dyed tab ───────────────────────────────────────────────────── */}
            <TabsContent value="dyed" className="space-y-5 mt-5">

              {!dyedLoading && !dyedError && dyedInventory.length > 0 && (
                <DyedFilterBar
                  filters={dyedFilters} onChange={setDyedFilters}
                  clientOptions={dyedClientOptions} materialOptions={dyedMaterialOptions}
                  colorOptions={dyedColorOptions} fabricCodeOptions={dyedFabricCodeOptions}
                />
              )}

              {dyedLoading && (
                <div className="flex items-center gap-2 text-muted-foreground py-8">
                  <Loader2 className="h-5 w-5 animate-spin" /> {t('loadingDyedInventory')}
                </div>
              )}
              {dyedError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{dyedError}</div>
              )}
              {!dyedLoading && !dyedError && filteredDyed.length === 0 && (
                <div className="rounded-md border px-6 py-12 text-center text-muted-foreground">
                  {isDyedFiltering ? t('noResultsMatchFilters') : t('noDyedFabricRolls')}
                </div>
              )}
              {!dyedLoading && !dyedError && filteredDyed.length > 0 && (
                <div className="space-y-3">
                  {filteredDyed.map((client) => (
                    <DyedClientCard key={client.client_id} group={client} flags={dyedFlags} />
                  ))}
                </div>
              )}
            </TabsContent>

            {/* ── Undyed tab ─────────────────────────────────────────────────── */}
            <TabsContent value="undyed" className="space-y-5 mt-5">

              {!undyedLoading && !undyedError && undyedInventory.length > 0 && (
                <UndyedFilterBar
                  filters={undyedFilters} onChange={setUndyedFilters}
                  clientOptions={undyedClientOptions} materialOptions={undyedMaterialOptions}
                />
              )}

              {undyedLoading && (
                <div className="flex items-center gap-2 text-muted-foreground py-8">
                  <Loader2 className="h-5 w-5 animate-spin" /> {t('loadingUndyedInventory')}
                </div>
              )}
              {undyedError && (
                <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{undyedError}</div>
              )}
              {!undyedLoading && !undyedError && filteredUndyed.length === 0 && (
                <div className="rounded-md border px-6 py-12 text-center text-muted-foreground">
                  {isUndyedFiltering ? t('noResultsMatchFilters') : t('noUndyedFabricRolls')}
                </div>
              )}
              {!undyedLoading && !undyedError && filteredUndyed.length > 0 && (
                <div className="space-y-3">
                  {filteredUndyed.map((client) => (
                    <UndyedClientCard key={client.client_id} group={client} flags={undyedFlags} />
                  ))}
                </div>
              )}
            </TabsContent>

          </Tabs>
        </main>
      </div>
    </PageTransition>
  );
};

export default FabricInventory;
