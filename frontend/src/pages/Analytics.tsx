import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronRight, Download, Loader2, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { Combobox } from "@/components/Combobox";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  fabricRollApi,
  undyedFabricRollApi,
  analyticsApi,
  type RollFlowEntryBase,
  type DyedRollFlowEntry,
  type UndyedRollFlowEntry,
  type AccountFlow,
  type AccountFlowRoll,
  type FlowAccount,
} from "@/lib/api";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n == null) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Today as a local ISO day (YYYY-MM-DD) — the default range for both tabs. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayLabel(key: string, locale: string): string {
  const d = new Date(`${key}T00:00:00`);
  return d.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

interface FlowStats {
  ingested_weight: number;
  ingested_length: number;
  ingested_rolls: number;
  digested_weight: number;
  digested_length: number;
  digested_rolls: number;
}

const EMPTY_STATS: FlowStats = {
  ingested_weight: 0, ingested_length: 0, ingested_rolls: 0,
  digested_weight: 0, digested_length: 0, digested_rolls: 0,
};

function addEntry(acc: FlowStats, e: RollFlowEntryBase): void {
  if (e.direction === "ingested") {
    acc.ingested_weight += e.total_weight;
    acc.ingested_length += e.total_length;
    acc.ingested_rolls += e.roll_count;
  } else {
    acc.digested_weight += e.total_weight;
    acc.digested_length += e.total_length;
    acc.digested_rolls += e.roll_count;
  }
}

interface DateRange {
  from: string;
  to: string;
}

/** Keep entries whose day falls inside the (optional) range. Unknown-date
    entries only survive when no range is active — a range can't place them. */
function filterByRange<T extends { date: string | null }>(entries: T[], range: DateRange): T[] {
  const { from, to } = range;
  if (!from && !to) return entries;
  return entries.filter((e) => {
    if (e.date == null) return false;
    if (from && e.date < from) return false;
    if (to && e.date > to) return false;
    return true;
  });
}

interface DayGroup<T extends RollFlowEntryBase> {
  /** ISO day; null = entries with an unknown date. */
  key: string | null;
  totals: FlowStats;
  ingested: T[];
  digested: T[];
}

/** One group per day (newest first; unknown-date group last), each split into
    its ingestion and digestion rows. */
function buildDayGroups<T extends RollFlowEntryBase>(entries: T[]): DayGroup<T>[] {
  const byDay = new Map<string | null, DayGroup<T>>();
  for (const e of entries) {
    let group = byDay.get(e.date);
    if (!group) {
      group = { key: e.date, totals: { ...EMPTY_STATS }, ingested: [], digested: [] };
      byDay.set(e.date, group);
    }
    addEntry(group.totals, e);
    (e.direction === "ingested" ? group.ingested : group.digested).push(e);
  }
  return [...byDay.values()].sort((a, b) => {
    if (a.key == null) return 1;
    if (b.key == null) return -1;
    return a.key < b.key ? 1 : -1;
  });
}

interface CounterpartyGroup<T> {
  key: string;
  counterparty: string | null;
  entries: T[];
  weight: number;
  length: number;
  count: number;
}

/** Group a direction's rows by counterparty (supplier for ingestion, receiver
    for digestion) — named counterparties first (alphabetical), unknown last. */
function groupByCounterparty<T extends RollFlowEntryBase>(entries: T[]): CounterpartyGroup<T>[] {
  const map = new Map<string, CounterpartyGroup<T>>();
  for (const e of entries) {
    const key = e.counterparty ?? "";
    let group = map.get(key);
    if (!group) {
      group = { key, counterparty: e.counterparty ?? null, entries: [], weight: 0, length: 0, count: 0 };
      map.set(key, group);
    }
    group.entries.push(e);
    group.weight += e.total_weight;
    group.length += e.total_length;
    group.count += e.roll_count;
  }
  return [...map.values()].sort((a, b) => {
    if (a.counterparty == null) return 1;
    if (b.counterparty == null) return -1;
    return a.counterparty.localeCompare(b.counterparty);
  });
}

function RollGroupTotalsBadge({ weight, length, count, cls }: { weight: number; length: number; count: number; cls: string }) {
  const { t } = useTranslation();
  return (
    <span className={`ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap shrink-0 ${cls}`}>
      <span className="font-semibold">{fmt(weight)} kg</span>
      <span className="opacity-60">·</span>
      <span className="font-semibold">{fmt(length)} m</span>
      <span className="opacity-60">·</span>
      <span>{count} {count === 1 ? t("rollUnit") : t("rollsUnit")}</span>
    </span>
  );
}

// ── Date range filter (from / to / clear; empty = all time) ───────────────────

function DateRangeFilter({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const { t } = useTranslation();
  const active = !!(range.from || range.to);
  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div className="space-y-1">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("fromDate")}</Label>
        <Input
          type="date"
          className="h-9 w-40 text-sm"
          value={range.from}
          max={range.to || undefined}
          onChange={(e) => onChange({ ...range, from: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("toDate")}</Label>
        <Input
          type="date"
          className="h-9 w-40 text-sm"
          value={range.to}
          min={range.from || undefined}
          onChange={(e) => onChange({ ...range, to: e.target.value })}
        />
      </div>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onChange({ from: "", to: "" })}
        >
          {t("clearAll")}
        </Button>
      )}
    </div>
  );
}

// ── Export-to-Excel button (shared by both tabs) ───────────────────────────────

function ExportButton({ onExport, label, variant = "default" }: {
  onExport: () => Promise<void>;
  label: string;
  variant?: "default" | "outline";
}) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const handleClick = async () => {
    setExporting(true);
    try {
      await onExport();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failedToExport"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button variant={variant} size="sm" className="h-9 text-xs gap-1.5" onClick={handleClick} disabled={exporting}>
      {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

// ── Flow stat chips (section header) ──────────────────────────────────────────

function FlowStatChips({ stats }: { stats: FlowStats }) {
  const { t } = useTranslation();
  const items = [
    { key: "in", label: t("ingested"), weight: stats.ingested_weight, rolls: stats.ingested_rolls, cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" },
    { key: "out", label: t("digested"), weight: stats.digested_weight, rolls: stats.digested_rolls, cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  ];
  return (
    <div className="ml-auto flex items-center gap-2 flex-wrap justify-end shrink-0">
      {items.map((i) => (
        <span key={i.key} className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap ${i.cls}`}>
          <span className="font-medium">{i.label}</span>
          <span className="font-semibold">{fmt(i.weight)} kg</span>
          <span className="opacity-60">·</span>
          <span>{i.rolls} {i.rolls === 1 ? t("rollUnit") : t("rollsUnit")}</span>
        </span>
      ))}
    </div>
  );
}

// ── Collapsible section (range total / one day) ───────────────────────────────

function FlowSection({ label, totals, defaultOpen, children }: {
  label: string;
  totals: FlowStats;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-muted/10 hover:bg-muted/30 transition-colors text-left flex-wrap"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <span className="font-semibold text-sm">{label}</span>
        <FlowStatChips stats={totals} />
      </button>
      {open && <div className="p-3 bg-background">{children}</div>}
    </div>
  );
}

// ── Breakdown tables (one direction each: counterparty then identity) ─────────

function TotalHeadCells() {
  const { t } = useTranslation();
  return (
    <>
      <TableHead>{t("weightKg")}</TableHead>
      <TableHead>{t("lengthM")}</TableHead>
      <TableHead>{t("rollsUnit")}</TableHead>
    </>
  );
}

function TotalCells({ entry }: { entry: RollFlowEntryBase }) {
  return (
    <>
      <TableCell className="tabular-nums">{fmt(entry.total_weight)}</TableCell>
      <TableCell className="tabular-nums">{entry.total_length > 0 ? fmt(entry.total_length) : "—"}</TableCell>
      <TableCell className="tabular-nums">{entry.roll_count}</TableCell>
    </>
  );
}

function DyedBreakdownTable({ entries }: { entries: DyedRollFlowEntry[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead>{t("fabricCode")}</TableHead>
            <TableHead>{t("material")}</TableHead>
            <TableHead>{t("color")}</TableHead>
            <TotalHeadCells />
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={e.client_fabric_code_id}>
              <TableCell>
                <Badge className="font-mono text-xs">{e.fabric_code ?? `#${e.client_fabric_code_id}`}</Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{e.material_name}</TableCell>
              <TableCell className="whitespace-nowrap">{e.color_name}</TableCell>
              <TotalCells entry={e} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function UndyedBreakdownTable({ entries }: { entries: UndyedRollFlowEntry[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead>{t("client")}</TableHead>
            <TableHead>{t("material")}</TableHead>
            <TotalHeadCells />
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((e) => (
            <TableRow key={`${e.client_id}-${e.material_id}`}>
              <TableCell className="whitespace-nowrap">{e.client_name}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{e.material_name}</TableCell>
              <TotalCells entry={e} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ── Flow view for one roll type ───────────────────────────────────────────────

function FlowTypeView<T extends RollFlowEntryBase>({ loading, error, entries, range, renderTable }: {
  loading: boolean;
  error: string | null;
  entries: T[];
  range: DateRange;
  renderTable: (entries: T[]) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const { language } = useLanguage();

  const filtered = useMemo(() => filterByRange(entries, range), [entries, range]);
  const dayGroups = useMemo(() => buildDayGroups(filtered), [filtered]);

  const rangeActive = !!(range.from || range.to);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-5 w-5 animate-spin" /> {t("loadingAnalytics")}
      </div>
    );
  }
  if (error) {
    return <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>;
  }
  if (filtered.length === 0) {
    return (
      <div className="rounded-md border px-6 py-12 text-center text-muted-foreground">
        {rangeActive ? t("noRollsInRange") : t("noRollData")}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Per-day sections, newest first; ingestion and digestion separated */}
      <div className="space-y-2">
        {dayGroups.map((group, idx) => (
          <FlowSection
            key={group.key ?? "unknown"}
            label={group.key != null ? dayLabel(group.key, language) : t("unknownDate")}
            totals={group.totals}
            defaultOpen={false}
          >
            <div className="space-y-4">
              {group.ingested.length > 0 && (
                <div className="space-y-2">
                  <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30">
                    {t("ingested")}
                  </span>
                  <div className="space-y-2">
                    {groupByCounterparty(group.ingested).map((cg, cidx) => (
                      <CollapsibleBlock
                        key={cg.key}
                        defaultOpen={false}
                        header={
                          <>
                            <span className="text-sm font-medium">{cg.counterparty ?? "—"}</span>
                            <RollGroupTotalsBadge weight={cg.weight} length={cg.length} count={cg.count} cls="bg-muted text-muted-foreground border-border" />
                          </>
                        }
                      >
                        {renderTable(cg.entries)}
                      </CollapsibleBlock>
                    ))}
                  </div>
                </div>
              )}
              {group.digested.length > 0 && (
                <div className="space-y-2">
                  <span className="inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30">
                    {t("digested")}
                  </span>
                  <div className="space-y-2">
                    {groupByCounterparty(group.digested).map((cg, cidx) => (
                      <CollapsibleBlock
                        key={cg.key}
                        defaultOpen={false}
                        header={
                          <>
                            <span className="text-sm font-medium">{cg.counterparty ?? "—"}</span>
                            <RollGroupTotalsBadge weight={cg.weight} length={cg.length} count={cg.count} cls="bg-muted text-muted-foreground border-border" />
                          </>
                        }
                      >
                        {renderTable(cg.entries)}
                      </CollapsibleBlock>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </FlowSection>
        ))}
      </div>
    </div>
  );
}

// ── Roll flow tab (tab 1) ─────────────────────────────────────────────────────

function RollFlowTab() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [range, setRange] = useState<DateRange>(() => ({ from: todayISO(), to: todayISO() }));

  const [dyed, setDyed] = useState<DyedRollFlowEntry[]>([]);
  const [dyedLoading, setDyedLoading] = useState(true);
  const [dyedError, setDyedError] = useState<string | null>(null);

  const [undyed, setUndyed] = useState<UndyedRollFlowEntry[]>([]);
  const [undyedLoading, setUndyedLoading] = useState(true);
  const [undyedError, setUndyedError] = useState<string | null>(null);

  useEffect(() => {
    fabricRollApi.getFlowAnalytics()
      .then(setDyed)
      .catch((e) => setDyedError(e instanceof Error ? e.message : t("failedToLoadAnalytics")))
      .finally(() => setDyedLoading(false));
    undyedFabricRollApi.getFlowAnalytics()
      .then(setUndyed)
      .catch((e) => setUndyedError(e instanceof Error ? e.message : t("failedToLoadAnalytics")))
      .finally(() => setUndyedLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("analyticsRollFlowDescription")}</p>

      <Tabs defaultValue="dyed">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <TabsList className="h-12 p-1.5 bg-muted/60 border rounded-xl gap-1 w-auto inline-flex">
            <TabsTrigger
              value="dyed"
              className="h-9 rounded-lg px-5 gap-2.5 font-medium text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shrink-0" />
              {t("dyedFabric")}
            </TabsTrigger>
            <TabsTrigger
              value="undyed"
              className="h-9 rounded-lg px-5 gap-2.5 font-medium text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" />
              {t("undyedFabric")}
            </TabsTrigger>
          </TabsList>

          <div className="flex items-end gap-3 flex-wrap">
            <DateRangeFilter range={range} onChange={setRange} />
            <ExportButton
              label={t("exportToExcel")}
              onExport={() => analyticsApi.exportRollFlow(range.from || undefined, range.to || undefined, language)}
            />
          </div>
        </div>

        <TabsContent value="dyed" className="mt-5">
          <FlowTypeView
            loading={dyedLoading}
            error={dyedError}
            entries={dyed}
            range={range}
            renderTable={(entries) => <DyedBreakdownTable entries={entries} />}
          />
        </TabsContent>
        <TabsContent value="undyed" className="mt-5">
          <FlowTypeView
            loading={undyedLoading}
            error={undyedError}
            entries={undyed}
            range={range}
            renderTable={(entries) => <UndyedBreakdownTable entries={entries} />}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Accounts tab (tab 2): per-logical-location roll traffic ───────────────────

function totalsOf(rolls: AccountFlowRoll[]): { weight: number; length: number; count: number } {
  return rolls.reduce(
    (acc, r) => ({ weight: acc.weight + r.weight, length: acc.length + (r.length ?? 0), count: acc.count + 1 }),
    { weight: 0, length: 0, count: 0 },
  );
}

function AccountTotalsBadge({ rolls, cls }: { rolls: AccountFlowRoll[]; cls: string }) {
  const { t } = useTranslation();
  const totals = totalsOf(rolls);
  return (
    <span className={`ml-auto inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap shrink-0 ${cls}`}>
      <span className="font-semibold">{fmt(totals.weight)} kg</span>
      <span className="opacity-60">·</span>
      <span className="font-semibold">{fmt(totals.length)} m</span>
      <span className="opacity-60">·</span>
      <span>{totals.count} {totals.count === 1 ? t("rollUnit") : t("rollsUnit")}</span>
    </span>
  );
}

// ── Aggregation tree: client → material → fabric code + color ─────────────────

interface AggNode {
  key: string;
  label: string;
  badge?: string | null;
  weight: number;
  length: number;
  count: number;
  children: AggNode[];
}

type LevelFn = (r: AccountFlowRoll) => { key: string; label: string; badge?: string | null };

function buildAggTree(rolls: AccountFlowRoll[], levels: LevelFn[]): AggNode[] {
  if (levels.length === 0) return [];
  const [level, ...rest] = levels;
  const groups = new Map<string, { meta: ReturnType<LevelFn>; rolls: AccountFlowRoll[] }>();
  for (const r of rolls) {
    const meta = level(r);
    const group = groups.get(meta.key);
    if (group) group.rolls.push(r);
    else groups.set(meta.key, { meta, rolls: [r] });
  }
  return [...groups.values()]
    .map(({ meta, rolls: groupRolls }) => {
      const totals = totalsOf(groupRolls);
      return {
        key: meta.key,
        label: meta.label,
        badge: meta.badge,
        weight: totals.weight,
        length: totals.length,
        count: totals.count,
        children: buildAggTree(groupRolls, rest),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function flattenTree(nodes: AggNode[], depth = 0, parentKey = ""): { node: AggNode; depth: number; path: string }[] {
  return nodes.flatMap((node) => {
    const path = `${parentKey}/${node.key}`;
    return [{ node, depth, path }, ...flattenTree(node.children, depth + 1, path)];
  });
}

/** Aggregated table: client → material → fabric code + color, totals per row. */
function AccountAggTable({ rolls }: { rolls: AccountFlowRoll[] }) {
  const { t } = useTranslation();
  const levels: LevelFn[] = [
    (r) => ({ key: r.client_name, label: r.client_name }),
    (r) => ({ key: r.material_name, label: r.material_name }),
    (r) => r.roll_type === "dyed"
      ? { key: `fc-${r.client_fabric_code_id}`, label: r.color_name ?? "—", badge: r.fabric_code ?? `#${r.client_fabric_code_id}` }
      : { key: "undyed", label: t("undyedFabric") },
  ];
  const rows = flattenTree(buildAggTree(rolls, levels));
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40">
            <TableHead>{t("breakdown")}</TableHead>
            <TableHead>{t("weightKg")}</TableHead>
            <TableHead>{t("lengthM")}</TableHead>
            <TableHead>{t("rollsUnit")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ node, depth, path }) => (
            <TableRow key={path} className={depth === 0 ? "bg-muted/20" : ""}>
              <TableCell>
                <div className="flex items-center gap-2 flex-wrap" style={{ paddingInlineStart: depth * 24 }}>
                  {node.badge != null && <Badge className="font-mono text-xs">{node.badge}</Badge>}
                  <span className={depth === 0 ? "font-semibold" : depth === 1 ? "font-medium" : "text-muted-foreground"}>
                    {node.label}
                  </span>
                </div>
              </TableCell>
              <TableCell className="tabular-nums">{fmt(node.weight)}</TableCell>
              <TableCell className="tabular-nums">{fmt(node.length)}</TableCell>
              <TableCell className="tabular-nums">{node.count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Collapsible bordered block with an arbitrary header row. */
function CollapsibleBlock({ header, defaultOpen = false, children }: {
  header: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left flex-wrap"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
        {header}
      </button>
      {open && <div className="p-3 bg-background">{children}</div>}
    </div>
  );
}

function groupByDate(rolls: AccountFlowRoll[]): { date: string | null; rolls: AccountFlowRoll[] }[] {
  const map = new Map<string | null, AccountFlowRoll[]>();
  for (const r of rolls) {
    const list = map.get(r.date);
    if (list) list.push(r);
    else map.set(r.date, [r]);
  }
  return [...map.entries()]
    .map(([date, dateRolls]) => ({ date, rolls: dateRolls }))
    .sort((a, b) => {
      if (a.date == null) return 1;
      if (b.date == null) return -1;
      return a.date < b.date ? 1 : -1;
    });
}

interface ReceiptGroup {
  kind: string;
  id: number;
  date: string | null;
  rolls: AccountFlowRoll[];
}

const RECEIPT_KIND_KEY = {
  supplier: "supplierReceipt",
  internal: "internalReceipt",
  external: "externalReceipt",
} as const;

function groupByReceipt(rolls: AccountFlowRoll[]): ReceiptGroup[] {
  const map = new Map<string, ReceiptGroup>();
  for (const r of rolls) {
    const key = `${r.receipt_kind}-${r.receipt_id}`;
    let group = map.get(key);
    if (!group) {
      group = { kind: r.receipt_kind ?? "", id: r.receipt_id ?? 0, date: r.date, rolls: [] };
      map.set(key, group);
    }
    group.rolls.push(r);
  }
  return [...map.values()].sort((a, b) => {
    if (a.date == null) return 1;
    if (b.date == null) return -1;
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b.id - a.id;
  });
}

function AccountsTab() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [range, setRange] = useState<DateRange>(() => ({ from: todayISO(), to: todayISO() }));
  const [accounts, setAccounts] = useState<FlowAccount[]>([]);
  const [selected, setSelected] = useState<FlowAccount | null>(null);
  const [flow, setFlow] = useState<AccountFlow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The dropdown only offers accounts with activity inside the selected dates.
  // An account is a logical location, a client (roll.supplier stores either
  // name), or an external-receipt receiver (identified by name alone).
  const sameAccount = (a: FlowAccount, b: FlowAccount) =>
    a.account_type === b.account_type && (a.id ?? null) === (b.id ?? null) && a.name === b.name;

  useEffect(() => {
    analyticsApi.getFlowAccounts(range.from || undefined, range.to || undefined)
      .then((list) => {
        setAccounts(list);
        setSelected((current) =>
          current != null && list.some((a) => sameAccount(a, current)) ? current : null,
        );
      })
      .catch(() => setAccounts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  useEffect(() => {
    if (selected == null) {
      setFlow(null);
      return;
    }
    setLoading(true);
    setError(null);
    analyticsApi.getAccountFlow(selected)
      .then(setFlow)
      .catch((e) => setError(e instanceof Error ? e.message : t("failedToLoadAnalytics")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.account_type, selected?.id, selected?.name]);

  const accountTypeLabel = (type: FlowAccount["account_type"]) => {
    if (type === "client") return t("client");
    if (type === "external") return t("receiver");
    return t("logicalLocation");
  };

  // Ids can collide across account types, so combobox items are keyed by index
  const locationItems = useMemo(
    () => accounts.map((a, idx) => ({
      id: idx,
      label: `${a.name} (${accountTypeLabel(a.account_type)})`,
    })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts],
  );
  const selectedIndex = useMemo(
    () => (selected == null ? null : accounts.findIndex((a) => sameAccount(a, selected))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, selected],
  );

  const ingested = useMemo(() => filterByRange(flow?.ingested ?? [], range), [flow, range]);
  const digested = useMemo(() => filterByRange(flow?.digested ?? [], range), [flow, range]);
  const dateGroups = useMemo(() => groupByDate(ingested), [ingested]);
  // Digested: date first, receipts second — each date block nests its receipts
  const digestedDateGroups = useMemo(
    () => groupByDate(digested).map((g) => ({ ...g, receipts: groupByReceipt(g.rolls) })),
    [digested],
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("analyticsAccountsDescription")}</p>

      {/* Date selection first, then the account */}
      <div className="flex items-end gap-3 flex-wrap">
        <DateRangeFilter range={range} onChange={setRange} />
        <ExportButton
          label={t("exportAllAccounts")}
          variant="outline"
          onExport={() => analyticsApi.exportAllAccounts(range.from || undefined, range.to || undefined, language)}
        />
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="space-y-1 max-w-sm">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("account")}</Label>
          <Combobox
            items={locationItems}
            value={selectedIndex != null && selectedIndex >= 0 ? selectedIndex : null}
            onSelect={(idx) => setSelected(accounts[idx] ?? null)}
            placeholder={t("selectAccount")}
          />
        </div>
        {selected != null && (
          <ExportButton
            label={t("exportAccount")}
            onExport={() => analyticsApi.exportAccountFlow(selected, range.from || undefined, range.to || undefined, language)}
          />
        )}
      </div>

      {selected == null && (
        <div className="rounded-md border px-6 py-12 text-center text-muted-foreground">{t("noAccountSelected")}</div>
      )}

      {selected != null && loading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-5 w-5 animate-spin" /> {t("loadingAnalytics")}
        </div>
      )}

      {selected != null && !loading && error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
      )}

      {selected != null && !loading && !error && flow && (
        ingested.length === 0 && digested.length === 0 ? (
          <div className="rounded-md border px-6 py-12 text-center text-muted-foreground">{t("noAccountActivity")}</div>
        ) : (
          <div className="space-y-4">
            {/* Ingested from this account, aggregated per date */}
            <div className="border rounded-md overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/10 flex-wrap">
                <span className="font-semibold text-sm">{t("ingested")}</span>
                <AccountTotalsBadge rolls={ingested} cls="bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" />
              </div>
              <div className="p-3 bg-background space-y-3">
                {dateGroups.length === 0 && (
                  <p className="text-sm text-muted-foreground px-1 py-2">{t("noRollsInRange")}</p>
                )}
                {dateGroups.map((group, idx) => (
                  <CollapsibleBlock
                    key={group.date ?? "unknown"}
                    defaultOpen={false}
                    header={
                      <>
                        <span className="text-sm font-medium">
                          {group.date != null ? dayLabel(group.date, language) : t("unknownDate")}
                        </span>
                        <AccountTotalsBadge rolls={group.rolls} cls="bg-muted text-muted-foreground border-border" />
                      </>
                    }
                  >
                    <AccountAggTable rolls={group.rolls} />
                  </CollapsibleBlock>
                ))}
              </div>
            </div>

            {/* Digested to this account, aggregated per date with the date's
                receipts nested. Locations are targeted by supplier/internal
                receipts; clients and external receivers by external receipts. */}
            <div className="border rounded-md overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 bg-muted/10 flex-wrap">
                <span className="font-semibold text-sm">{t("digested")}</span>
                <AccountTotalsBadge rolls={digested} cls="bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30" />
              </div>
              <div className="p-3 bg-background space-y-3">
                {digestedDateGroups.length === 0 && (
                  <p className="text-sm text-muted-foreground px-1 py-2">{t("noRollsInRange")}</p>
                )}
                {digestedDateGroups.map((group, idx) => (
                  <CollapsibleBlock
                    key={group.date ?? "unknown"}
                    defaultOpen={false}
                    header={
                      <>
                        <span className="text-sm font-medium">
                          {group.date != null ? dayLabel(group.date, language) : t("unknownDate")}
                        </span>
                        <AccountTotalsBadge rolls={group.rolls} cls="bg-muted text-muted-foreground border-border" />
                      </>
                    }
                  >
                    <div className="space-y-3">
                      {group.receipts.map((rg) => (
                        <CollapsibleBlock
                          key={`${rg.kind}-${rg.id}`}
                          defaultOpen={false}
                          header={
                            <>
                              <Badge variant="secondary" className="font-mono text-xs">
                                {t(RECEIPT_KIND_KEY[rg.kind as keyof typeof RECEIPT_KIND_KEY] ?? "supplierReceipt")} #{rg.id}
                              </Badge>
                              <AccountTotalsBadge rolls={rg.rolls} cls="bg-muted text-muted-foreground border-border" />
                            </>
                          }
                        >
                          <AccountAggTable rolls={rg.rolls} />
                        </CollapsibleBlock>
                      ))}
                    </div>
                  </CollapsibleBlock>
                ))}
              </div>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const Analytics = () => {
  const [searchParams] = useSearchParams();
  const currentWarehouseId = searchParams.get("warehouse");
  const { t } = useTranslation();

  if (!currentWarehouseId) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-destructive mb-4">{t("noWarehouseSelected")}</h1>
            <p className="text-muted-foreground">
              {t("pleaseSelectWarehouseFromList")}
            </p>
          </div>
        </div>
      </PageTransition>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-8 space-y-6 overflow-auto">

          {/* Header */}
          <div className="flex items-center gap-3">
            <TrendingUp className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-primary">{t("analytics")}</h1>
          </div>

          <Tabs defaultValue="rollFlow">
            <TabsList className="h-12 p-1.5 bg-muted/60 border rounded-xl gap-1 w-auto inline-flex">
              <TabsTrigger
                value="rollFlow"
                className="h-9 rounded-lg px-5 font-medium text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                {t("analyticsRollFlowTab")}
              </TabsTrigger>
              <TabsTrigger
                value="accounts"
                className="h-9 rounded-lg px-5 font-medium text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all"
              >
                {t("analyticsAccountsTab")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="rollFlow" className="mt-5">
              <RollFlowTab />
            </TabsContent>
            <TabsContent value="accounts" className="mt-5">
              <AccountsTab />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    </PageTransition>
  );
};

export default Analytics;
