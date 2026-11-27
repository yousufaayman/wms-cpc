/**
 * Accessory Analytics (item 26): what the Analytics page shows in an Accessory
 * warehouse. Read-only reports from the stock ledger, four tabs:
 *
 * - Stock flow: per item, the quantity before the first day (opening), what was
 *   received / issued / returned / sent back to the supplier / written off /
 *   adjusted (opening stock included) / reclassified in the range, and the
 *   quantity after the last day (closing). Click an item to see its ledger rows.
 * - Issued to job orders: per job order, each item's issued, returned and net used.
 * - Slow-moving stock: items in stock with no receipt, issue or return for N
 *   days (default 90).
 * - Expected vs received: lines of open deliveries, and over-received lines of
 *   closed ones.
 *
 * Filters: from / to days (flow and job orders), client, category and
 * supplier (not job orders: there the client is the job order's), days
 * (slow-moving). Supplier = who delivered the packs (or the delivery's
 * supplier); each item also shows its supplier codes, and an opened flow item
 * shows what each supplier delivered in the range. "Export
 * to Excel" downloads the open tab's sheet, "Export all" the five-sheet
 * workbook (the fifth sheet is stock on hand) with the same filters, in the
 * app's language. Quantities are in each item's base unit and never added
 * across units.
 */
import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SupplierRefs } from "@/components/accessory-items/AccessoryItemPicker";
import { DateRangeFilter, ExportButton, todayISO, type DateRange } from "@/components/analytics/AnalyticsControls";
import {
  accessoryAnalyticsApi, accessoryCategoryApi, clientApi,
  type DeliveryReportRow, type FlowRow, type JoIssues, type ReportFilters, type ReportItem, type ReportSheet,
  type SlowMovingRow,
} from "@/lib/api";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/translations";

type Tab = "flow" | "jos" | "slow" | "deliveries";
const SHEET: Record<Tab, ReportSheet> = { flow: "flow", jos: "jo_issues", slow: "slow_moving", deliveries: "deliveries" };
const ALL = "all";
const DEFAULT_DAYS = 90;

const fmtQty = (q: string | number) => Number(q).toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtSigned = (q: string | number) => (Number(q) > 0 ? `+${fmtQty(q)}` : fmtQty(q));
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const dash = (n: string | number) => (Number(n) === 0 ? "—" : fmtQty(n));

/** First day of this month: the default start of the flow range. */
function monthStartISO(): string {
  return `${todayISO().slice(0, 8)}01`;
}

// ── Shared cells ─────────────────────────────────────────────────────────────

function ItemCell({ item }: Readonly<{ item: ReportItem }>) {
  const details = [item.color, item.size].filter(Boolean).join(" · ");
  return (
    <div className="min-w-[10rem]">
      <div className="font-mono text-sm font-medium" dir="ltr">{item.item_code}</div>
      <div className="text-xs text-muted-foreground">
        {item.description}{details ? ` · ${details}` : ""}
      </div>
      <SupplierRefs refs={item.supplier_refs} />
    </div>
  );
}

function ClientCell({ item }: Readonly<{ item: ReportItem }>) {
  const { t } = useTranslation();
  return item.client_name
    ? <span>{item.client_name}</span>
    : <span className="text-muted-foreground">{t("accInvGeneric")}</span>;
}

function TableState({ loading, error, empty, cols }: Readonly<{ loading: boolean; error: unknown; empty: boolean; cols: number }>) {
  const { t } = useTranslation();
  if (!loading && !error && !empty) return null;
  return (
    <TableRow>
      <TableCell colSpan={cols} className="text-center text-muted-foreground py-10">
        {loading ? (
          <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{t("loadingAnalytics")}</span>
        ) : error ? (
          <span className="text-destructive">{error instanceof Error ? error.message : t("failedToLoadAnalytics")}</span>
        ) : t("noResultsMatchFilters")}
      </TableCell>
    </TableRow>
  );
}

const num = "text-end tabular-nums whitespace-nowrap";

// ── Stock flow ───────────────────────────────────────────────────────────────

const FLOW_COLUMNS: { key: keyof FlowRow; label: TranslationKey; signed?: boolean }[] = [
  { key: "received", label: "aaReceived" },
  { key: "issued", label: "aaIssued" },
  { key: "returned", label: "aaReturned" },
  { key: "supplier_returns", label: "aaSupplierReturns" },
  { key: "written_off", label: "aaWrittenOff" },
  { key: "adjusted", label: "aaAdjusted", signed: true },
  { key: "reclassified", label: "aaReclassified", signed: true },
];

function FlowEntries({ row, filters, cols }: Readonly<{ row: FlowRow; filters: ReportFilters; cols: number }>) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["acc-analytics-entries", row.accessory_item_id, filters.warehouseId, filters.dateFrom, filters.dateTo, filters.supplier],
    queryFn: () => accessoryAnalyticsApi.flowEntries(row.accessory_item_id, filters),
  });
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={cols} className="p-3 space-y-2">
        {row.received_by_supplier.length > 0 && (
          <div className="text-sm">
            <span className="font-medium">{t("aaReceivedBySupplier")}:</span>{" "}
            {row.received_by_supplier.map((x) => (
              <Badge key={`${x.supplier_type}-${x.client_supplier_id}`} variant="outline" className="me-1.5">
                {x.supplier_name ?? t("aaNoSupplier")} · <span dir="ltr" className="ms-1">{fmtQty(x.qty)} {row.uom_code}</span>
              </Badge>
            ))}
          </div>
        )}
        <div className="overflow-x-auto rounded-md border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("accTypeDate")}</TableHead>
                <TableHead>{t("accInvPack")}</TableHead>
                <TableHead>{t("supplier")}</TableHead>
                <TableHead>{t("accLineType")}</TableHead>
                <TableHead className="text-end">{t("accInvChange")}</TableHead>
                <TableHead>{t("accInvJobOrder")}</TableHead>
                <TableHead>{t("accInvBy")}</TableHead>
                <TableHead>{t("accInvReason")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState loading={isLoading} error={error} empty={!data?.length} cols={8} />
              {data?.map((e) => (
                <TableRow key={e.id} className={e.reversal_of != null || e.is_reversed ? "text-muted-foreground" : ""}>
                  <TableCell className="whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono" dir="ltr">{e.pack_id}</TableCell>
                  <TableCell>{e.supplier_name ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {t(`accEntry_${e.entry_type}` as TranslationKey)}
                    {e.is_reversed && <Badge variant="outline" className="ms-2 text-[10px]">{t("accInvReversed")}</Badge>}
                  </TableCell>
                  <TableCell className={num} dir="ltr">{fmtSigned(e.qty_delta)} {row.uom_code}</TableCell>
                  <TableCell>{e.job_order_number ?? "—"}</TableCell>
                  <TableCell>{e.created_by_name ?? "—"}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={e.reason ?? undefined}>{e.reason ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </TableCell>
    </TableRow>
  );
}

function FlowTab({ filters }: Readonly<{ filters: ReportFilters }>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["acc-analytics-flow", filters],
    queryFn: () => accessoryAnalyticsApi.flow(filters),
  });
  const cols = 4 + FLOW_COLUMNS.length + 1;
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("accItemCode")}</TableHead>
              <TableHead>{t("client")}</TableHead>
              <TableHead>{t("accBaseUnit")}</TableHead>
              <TableHead className={num}>{t("aaOpening")}</TableHead>
              {FLOW_COLUMNS.map((c) => <TableHead key={c.key} className={num}>{t(c.label)}</TableHead>)}
              <TableHead className={num}>{t("aaClosing")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} error={error} empty={!data?.length} cols={cols} />
            {data?.map((r) => {
              const isOpen = open === r.accessory_item_id;
              return (
                <Fragment key={r.accessory_item_id}>
                  <TableRow className="cursor-pointer" onClick={() => setOpen(isOpen ? null : r.accessory_item_id)}>
                    <TableCell>
                      <div className="flex items-start gap-1.5">
                        {isOpen ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 rtl:rotate-180" />}
                        <ItemCell item={r} />
                      </div>
                    </TableCell>
                    <TableCell><ClientCell item={r} /></TableCell>
                    <TableCell className="font-mono" dir="ltr">{r.uom_code}</TableCell>
                    <TableCell className={num}>{fmtQty(r.opening)}</TableCell>
                    {FLOW_COLUMNS.map((c) => (
                      <TableCell key={c.key} className={num} dir="ltr">
                        {Number(r[c.key]) === 0 ? "—" : c.signed ? fmtSigned(r[c.key] as string) : fmtQty(r[c.key] as string)}
                      </TableCell>
                    ))}
                    <TableCell className={`${num} font-semibold`}>{fmtQty(r.closing)}</TableCell>
                  </TableRow>
                  {isOpen && <FlowEntries row={r} filters={filters} cols={cols} />}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Issued to job orders ─────────────────────────────────────────────────────

function JobOrdersTab({ filters }: Readonly<{ filters: ReportFilters }>) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["acc-analytics-jos", filters],
    queryFn: () => accessoryAnalyticsApi.jobOrders(filters),
  });
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("accInvJobOrder")}</TableHead>
              <TableHead>{t("accItemCode")}</TableHead>
              <TableHead>{t("accBaseUnit")}</TableHead>
              <TableHead className={num}>{t("aaIssued")}</TableHead>
              <TableHead className={num}>{t("aaReturned")}</TableHead>
              <TableHead className={num}>{t("aaNetUsed")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} error={error} empty={!data?.length} cols={6} />
            {data?.map((jo: JoIssues) => (
              <Fragment key={jo.job_order_id}>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={3}>
                    <span className="font-semibold" dir="ltr">{jo.job_order_number}</span>
                    <span className="ms-2 text-xs text-muted-foreground">{jo.client_name ?? t("accInvGeneric")}</span>
                  </TableCell>
                  <TableCell colSpan={3} className="text-end text-xs font-semibold" dir="ltr">
                    {jo.totals.map((x) => `${fmtQty(x.net)} ${x.uom_code}`).join(" · ")}
                  </TableCell>
                </TableRow>
                {jo.lines.map((l) => (
                  <TableRow key={`${jo.job_order_id}-${l.accessory_item_id}`}>
                    <TableCell />
                    <TableCell><ItemCell item={l} /></TableCell>
                    <TableCell className="font-mono" dir="ltr">{l.uom_code}</TableCell>
                    <TableCell className={num}>{dash(l.issued)}</TableCell>
                    <TableCell className={num}>{dash(l.returned)}</TableCell>
                    <TableCell className={`${num} font-semibold`}>{fmtQty(l.net)}</TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Slow-moving ──────────────────────────────────────────────────────────────

function SlowMovingTab({ filters }: Readonly<{ filters: ReportFilters }>) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["acc-analytics-slow", filters],
    queryFn: () => accessoryAnalyticsApi.slowMoving(filters),
  });
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("accItemCode")}</TableHead>
              <TableHead>{t("aaGenericOrClient")}</TableHead>
              <TableHead className={num}>{t("accInvOnHand")}</TableHead>
              <TableHead className={num}>{t("accInvPackCount")}</TableHead>
              <TableHead>{t("rack")}</TableHead>
              <TableHead>{t("aaLastMovement")}</TableHead>
              <TableHead className={num}>{t("aaDaysIdle")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} error={error} empty={!data?.length} cols={7} />
            {data?.map((r: SlowMovingRow) => (
              <TableRow key={r.accessory_item_id}>
                <TableCell><ItemCell item={r} /></TableCell>
                <TableCell>
                  {r.generic ? <span className="text-muted-foreground">{t("accInvGeneric")}</span> : (
                    <span>{t("accClientSpecific")} · {r.client_name}</span>
                  )}
                </TableCell>
                <TableCell className={num} dir="ltr">{fmtQty(r.on_hand)} {r.uom_code}</TableCell>
                <TableCell className={num}>{r.pack_count}</TableCell>
                <TableCell className="text-xs">
                  <div className="font-mono" dir="ltr">{r.racks.join(", ")}</div>
                  {Number(r.unracked) > 0 && (
                    <div className="text-amber-700 dark:text-amber-400">{t("accInvWaitingPutaway")}: {fmtQty(r.unracked)}</div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap">{fmtDay(r.last_movement)}</TableCell>
                <TableCell className={`${num} font-semibold`}>{r.idle_days}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── Expected vs received ─────────────────────────────────────────────────────

const STATE_LABEL: Record<DeliveryReportRow["state"], TranslationKey> = {
  waiting: "lineWaiting", partial: "linePartial", complete: "lineComplete", over: "lineOver",
};
const STATE_CLASS: Record<DeliveryReportRow["state"], string> = {
  waiting: "bg-muted text-muted-foreground",
  partial: "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30",
  complete: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  over: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30",
};

function DeliveriesTab({ filters }: Readonly<{ filters: ReportFilters }>) {
  const { t } = useTranslation();
  const { data, isLoading, error } = useQuery({
    queryKey: ["acc-analytics-deliveries", filters],
    queryFn: () => accessoryAnalyticsApi.deliveries(filters),
  });
  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("deliveryId")}</TableHead>
              <TableHead>{t("expectedDate")}</TableHead>
              <TableHead>{t("supplier")}</TableHead>
              <TableHead>{t("accItemCode")}</TableHead>
              <TableHead className={num}>{t("accExpectedQty")}</TableHead>
              <TableHead className={num}>{t("accReceivedQty")}</TableHead>
              <TableHead className={num}>{t("accQtyDifference")}</TableHead>
              <TableHead>{t("accStatus")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableState loading={isLoading} error={error} empty={!data?.length} cols={8} />
            {data?.map((r) => (
              <TableRow key={`${r.delivery_id}-${r.accessory_item_id}-${r.expected_qty}`}>
                <TableCell className="font-mono" dir="ltr">{r.delivery_id}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDay(r.expected_date)}</TableCell>
                <TableCell>{r.supplier_name ?? "—"}</TableCell>
                <TableCell><ItemCell item={r} /></TableCell>
                <TableCell className={num} dir="ltr">{fmtQty(r.expected_qty)} {r.uom_code}</TableCell>
                <TableCell className={num} dir="ltr">{fmtQty(r.received_qty)}</TableCell>
                <TableCell className={`${num} ${Number(r.difference) > 0 ? "text-amber-700 dark:text-amber-400" : ""}`} dir="ltr">
                  {fmtSigned(r.difference)}
                </TableCell>
                <TableCell><Badge variant="outline" className={STATE_CLASS[r.state]}>{t(STATE_LABEL[r.state])}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ── The tabs + filters ───────────────────────────────────────────────────────

const TRIGGER = "h-9 rounded-lg px-4 font-medium text-sm data-[state=active]:bg-background data-[state=active]:shadow-sm transition-all";

export default function AccessoryAnalytics({ warehouseId }: Readonly<{ warehouseId: number }>) {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [tab, setTab] = useState<Tab>("flow");
  const [range, setRange] = useState<DateRange>(() => ({ from: monthStartISO(), to: todayISO() }));
  const [clientId, setClientId] = useState<string>(ALL);
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [supplier, setSupplier] = useState<string>(ALL);
  const [daysText, setDaysText] = useState(String(DEFAULT_DAYS));

  const { data: clients = [] } = useQuery({ queryKey: ["clients"], queryFn: () => clientApi.getAll(), staleTime: 5 * 60_000 });
  const { data: categories = [] } = useQuery({
    queryKey: ["accessory-categories"], queryFn: () => accessoryCategoryApi.getAll(), staleTime: 5 * 60_000,
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["acc-analytics-suppliers", warehouseId],
    queryFn: () => accessoryAnalyticsApi.suppliers(warehouseId),
    staleTime: 5 * 60_000,
  });

  const days = Math.max(1, Math.min(3650, Number.parseInt(daysText, 10) || DEFAULT_DAYS));
  const filters: ReportFilters = useMemo(() => ({
    warehouseId,
    dateFrom: range.from || undefined,
    dateTo: range.to || undefined,
    clientId: clientId === ALL ? null : Number(clientId),
    categoryId: categoryId === ALL ? null : Number(categoryId),
    days,
    supplier: supplier === ALL ? null : supplier,
  }), [warehouseId, range, clientId, categoryId, days, supplier]);

  const dated = tab === "flow" || tab === "jos";
  const lang = language === "ar" ? "ar" : "en";

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="space-y-5">
      <div className="overflow-x-auto">
        <TabsList className="h-12 p-1.5 bg-muted/60 border rounded-xl gap-1 w-auto inline-flex">
          <TabsTrigger value="flow" className={TRIGGER}>{t("aaStockFlow")}</TabsTrigger>
          <TabsTrigger value="jos" className={TRIGGER}>{t("aaIssuedToJos")}</TabsTrigger>
          <TabsTrigger value="slow" className={TRIGGER}>{t("aaSlowMoving")}</TabsTrigger>
          <TabsTrigger value="deliveries" className={TRIGGER}>{t("aaExpectedVsReceived")}</TabsTrigger>
        </TabsList>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        {dated && <DateRangeFilter range={range} onChange={setRange} />}
        <div className="space-y-1">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("client")}</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger className="h-9 w-48 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("accAllClients")}</SelectItem>
              {clients.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {tab !== "jos" && (
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("accCategory")}</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="h-9 w-48 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("accAllCategories")}</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.code} · {language === "ar" ? c.name_ar : c.name_en}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {tab !== "jos" && (
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("supplier")}</Label>
            <Select value={supplier} onValueChange={setSupplier}>
              <SelectTrigger className="h-9 w-48 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("allSuppliers")}</SelectItem>
                {suppliers.map((x) => {
                  const key = `${x.supplier_type}:${x.client_supplier_id}`;
                  return <SelectItem key={key} value={key}>{x.name}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
        )}
        {tab === "slow" && (
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("aaNoMovementFor")}</Label>
            <Input
              type="number" min={1} max={3650} className="h-9 w-28 text-sm" value={daysText}
              onChange={(e) => setDaysText(e.target.value)}
            />
          </div>
        )}
        <div className="flex items-end gap-2 ms-auto">
          <ExportButton
            variant="outline"
            label={t("exportToExcel")}
            onExport={() => accessoryAnalyticsApi.exportWorkbook(filters, lang, [SHEET[tab]])}
          />
          <ExportButton label={t("aaExportAll")} onExport={() => accessoryAnalyticsApi.exportWorkbook(filters, lang)} />
        </div>
      </div>

      <TabsContent value="flow" className="mt-0"><FlowTab filters={filters} /></TabsContent>
      <TabsContent value="jos" className="mt-0"><JobOrdersTab filters={filters} /></TabsContent>
      <TabsContent value="slow" className="mt-0"><SlowMovingTab filters={filters} /></TabsContent>
      <TabsContent value="deliveries" className="mt-0"><DeliveriesTab filters={filters} /></TabsContent>
    </Tabs>
  );
}
