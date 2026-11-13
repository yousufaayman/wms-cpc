/**
 * Accessory Inventory (item 14): what's in stock in this Accessory warehouse.
 * Read-only: stock only changes through receiving, issuing and corrections.
 *
 * - Filter bar: search (item code, description, client / supplier code, line
 *   values), client (or generic only), rack (or waiting for put-away), and
 *   "Show empty packs". The filters apply to every tab.
 * - Tabs By item / By client / By rack: totals from the `wms.accessory_stock`
 *   view, grouped on the server. A client or rack holding items in different
 *   units shows one total per unit ("1,200 PCS · 35 M"); they're never added.
 *   Clicking a row opens the Packs tab filtered to it.
 * - Packs: one row per pack (label `<id>*ACC`), its rack or "Waiting for
 *   put-away", and how much it holds. Clicking a pack shows its quantity
 *   history (every ledger row with the balance after it) and its rack moves.
 * Anyone with a WMS role can look (Tab 1: "everyone, including Viewer").
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, X } from "lucide-react";
import { Combobox, type ComboItem } from "@/components/Combobox";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import {
  accessoryPackApi, clientApi, valueSummary, warehouseRackApi,
  type AccessoryPack, type Client, type PackLedgerEntry, type PackMove, type PackQuery,
  type StockGroupBy, type StockFilters, type StockRow, type StockTotal, type WarehouseRack,
} from "@/lib/api";
import { useWarehouse } from "@/hooks/useWarehouse";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/lib/translations";

const PAGE_SIZE = 50;
const ALL = "all";
const GENERIC = "generic";
const UNRACKED = "unracked";

type Tab = StockGroupBy | "packs";

/** 1200.5000 → "1,200.5" */
const fmtQty = (q: string | number) => Number(q).toLocaleString("en-US", { maximumFractionDigits: 4 });
const fmtTotals = (totals: StockTotal[]) => totals.map((x) => `${fmtQty(x.qty)} ${x.uom_code}`).join(" · ");
const fmtDate = (iso: string) => new Date(iso).toLocaleString();

/** Previous / Next with plain "2 / 5" numbers. */
function Pager({ page, total, onPage }: Readonly<{ page: number; total: number; onPage: (p: number) => void }>) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-end gap-3 text-sm text-muted-foreground">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("previousPage")}</Button>
      <span dir="ltr">{page} / {pages}</span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t("nextPage")}</Button>
    </div>
  );
}

export default function AccessoryInventory() {
  const { t, language } = useTranslation();
  const { warehouseId } = useWarehouse();

  // Filters (shared by every tab)
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [clientFilter, setClientFilter] = useState<string>(ALL);
  const [rackFilter, setRackFilter] = useState<string>(ALL);
  const [showEmpty, setShowEmpty] = useState(false);
  const [itemFilter, setItemFilter] = useState<{ id: number; code: string } | null>(null); // from a By item click

  const [tab, setTab] = useState<Tab>("item");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [packs, setPacks] = useState<AccessoryPack[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [clients, setClients] = useState<Client[]>([]);
  const [racks, setRacks] = useState<WarehouseRack[]>([]);
  const [openPack, setOpenPack] = useState<AccessoryPack | null>(null);

  // Wait a moment after typing before searching.
  useEffect(() => {
    const id = setTimeout(() => setQ(typed.trim()), 300);
    return () => clearTimeout(id);
  }, [typed]);

  // Back to page 1 whenever the question changes.
  useEffect(() => setPage(1), [q, clientFilter, rackFilter, showEmpty, itemFilter, tab]);

  useEffect(() => {
    clientApi.getAll()
      .then((cls) => setClients([...cls].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setClients([]));
  }, []);

  useEffect(() => {
    if (warehouseId === null) return;
    (async () => {
      const all: WarehouseRack[] = [];
      for (let skip = 0; ; skip += 100) {
        const batch = await warehouseRackApi.getAll(warehouseId, skip, 100);
        all.push(...batch);
        if (batch.length < 100) break;
      }
      all.sort((a, b) => a.rack_code.localeCompare(b.rack_code));
      setRacks(all);
    })().catch(() => setRacks([]));
  }, [warehouseId]);

  const filters = useMemo((): StockFilters => {
    const f: StockFilters = { warehouse_id: warehouseId ?? undefined, q: q || undefined };
    if (clientFilter === GENERIC) f.generic = true;
    else if (clientFilter !== ALL) f.client_id = Number(clientFilter);
    if (rackFilter === UNRACKED) f.unracked = true;
    else if (rackFilter !== ALL) f.rack_id = Number(rackFilter);
    return f;
  }, [warehouseId, q, clientFilter, rackFilter]);

  useEffect(() => {
    if (warehouseId === null) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const paging = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
    const request = tab === "packs"
      ? accessoryPackApi.list({
          ...filters, ...paging, accessory_item_id: itemFilter?.id, status: showEmpty ? undefined : "active",
        } satisfies PackQuery)
      : accessoryPackApi.stock({
          ...filters, ...paging, group_by: tab, include_empty: showEmpty,
        });
    request
      .then((res) => {
        if (cancelled) return;
        if (tab === "packs") setPacks(res.items as AccessoryPack[]);
        else setRows(res.items as StockRow[]);
        setTotal(res.total);
      })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warehouseId, filters, tab, page, showEmpty, itemFilter]);

  const clientItems: ComboItem<string>[] = useMemo(() => [
    { id: ALL, label: t("accAllClients") },
    { id: GENERIC, label: t("accGenericOnly") },
    ...clients.map((c) => ({ id: String(c.id), label: c.name })),
  ], [clients, t]);

  const rackItems: ComboItem<string>[] = useMemo(() => [
    { id: ALL, label: `${t("rack")}: ${t("all")}` },
    { id: UNRACKED, label: t("accInvWaitingPutaway") },
    ...racks.map((r) => ({ id: String(r.id), label: r.rack_code })),
  ], [racks, t]);

  /** A roll-up row was clicked: show its packs. */
  const drill = (row: StockRow) => {
    if (tab === "item" && row.key !== null) setItemFilter({ id: row.key, code: row.code ?? "" });
    if (tab === "client") setClientFilter(row.key === null ? GENERIC : String(row.key));
    if (tab === "rack") setRackFilter(row.key === null ? UNRACKED : String(row.key));
    setTab("packs");
  };

  const variantText = (color: string | null, size: string | null, lines: StockRow["value_lines"]) =>
    [color, size, valueSummary(lines, language)].filter(Boolean).join(" · ");

  const rollupTable = (by: StockGroupBy) => (
    <Table>
      <TableHeader>
        <TableRow>
          {by === "item" && <>
            <TableHead>{t("accItemCode")}</TableHead>
            <TableHead>{t("accDescription")}</TableHead>
            <TableHead>{t("client")}</TableHead>
          </>}
          {by === "client" && <TableHead>{t("client")}</TableHead>}
          {by === "rack" && <TableHead>{t("rack")}</TableHead>}
          {by !== "item" && <TableHead className="text-right">{t("accInvItemCount")}</TableHead>}
          <TableHead className="text-right">{t("accInvPackCount")}</TableHead>
          <TableHead className="text-right">{t("accInvOnHand")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key ?? "none"} className="cursor-pointer hover:bg-muted/50" onClick={() => drill(row)}>
            {by === "item" && <>
              <TableCell className="font-mono">{row.code}</TableCell>
              <TableCell>
                <div>{row.name}</div>
                {variantText(row.color, row.size, row.value_lines) && (
                  <div className="text-xs text-muted-foreground">{variantText(row.color, row.size, row.value_lines)}</div>
                )}
              </TableCell>
              <TableCell>{row.client_name ?? t("accInvGeneric")}</TableCell>
            </>}
            {by === "client" && (
              <TableCell>{row.key === null ? <Badge variant="secondary">{t("accInvGeneric")}</Badge> : row.name}</TableCell>
            )}
            {by === "rack" && (
              <TableCell>
                {row.key === null
                  ? <Badge variant="outline" className="border-amber-500 text-amber-700">{t("accInvWaitingPutaway")}</Badge>
                  : <span className="font-mono">{row.code}</span>}
              </TableCell>
            )}
            {by !== "item" && <TableCell className="text-right">{row.item_count}</TableCell>}
            <TableCell className="text-right">{row.pack_count}</TableCell>
            <TableCell className="text-right font-medium" dir="ltr">{fmtTotals(row.totals)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const packTable = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("accInvPack")}</TableHead>
          <TableHead>{t("accItemCode")}</TableHead>
          <TableHead>{t("accDescription")}</TableHead>
          <TableHead>{t("rack")}</TableHead>
          <TableHead className="text-right">{t("accInvOnHand")}</TableHead>
          <TableHead>{t("accStatus")}</TableHead>
          <TableHead>{t("accInvReceivedAt")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {packs.map((p) => (
          <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setOpenPack(p)}>
            <TableCell className="font-mono" dir="ltr">{p.barcode}</TableCell>
            <TableCell className="font-mono">{p.item_code}</TableCell>
            <TableCell>
              <div>{p.item_description}</div>
              {variantText(p.item_color, p.item_size, p.value_lines) && (
                <div className="text-xs text-muted-foreground">{variantText(p.item_color, p.item_size, p.value_lines)}</div>
              )}
            </TableCell>
            <TableCell>
              {p.rack_code
                ? <span className="font-mono">{p.rack_code}</span>
                : <Badge variant="outline" className="border-amber-500 text-amber-700">{t("accInvWaitingPutaway")}</Badge>}
            </TableCell>
            <TableCell className="text-right font-medium" dir="ltr">{fmtQty(p.quantity)} {p.uom_code}</TableCell>
            <TableCell>
              <Badge variant={p.status === "active" ? "default" : "secondary"}>
                {t(p.status === "active" ? "accInvStatusActive" : "accInvStatusEmpty")}
              </Badge>
            </TableCell>
            <TableCell className="text-muted-foreground">{fmtDate(p.created_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const empty = tab === "packs" ? packs.length === 0 : rows.length === 0;
  const body = (content: JSX.Element) => {
    if (loading) return <div className="text-center py-8">{t("loading")}</div>;
    if (failed || empty) return <div className="text-center py-8 text-muted-foreground">{t("accInvNoStock")}</div>;
    return <div className="space-y-4">{content}<Pager page={page} total={total} onPage={setPage} /></div>;
  };

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-8">
          <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">{t("accessoryInventory")}</h1>

            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="relative flex-1 min-w-[260px]">
                    <Search className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={t("accInvSearch")}
                      className="pl-9 rtl:pl-3 rtl:pr-9" />
                  </div>
                  <div className="w-56">
                    <Combobox items={clientItems} value={clientFilter} onSelect={setClientFilter} placeholder={t("client")} />
                  </div>
                  <div className="w-56">
                    <Combobox items={rackItems} value={rackFilter} onSelect={setRackFilter} placeholder={t("rack")} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="acc-inv-empty" checked={showEmpty} onCheckedChange={setShowEmpty} />
                    <Label htmlFor="acc-inv-empty">{t("accInvShowEmpty")}</Label>
                  </div>
                </div>

                <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
                  <div className="flex flex-wrap items-center gap-3">
                    <TabsList>
                      <TabsTrigger value="item">{t("accInvByItem")}</TabsTrigger>
                      <TabsTrigger value="client">{t("accInvByClient")}</TabsTrigger>
                      <TabsTrigger value="rack">{t("accInvByRack")}</TabsTrigger>
                      <TabsTrigger value="packs">{t("accInvPacks")}</TabsTrigger>
                    </TabsList>
                    {tab === "packs" && itemFilter && (
                      <Badge variant="secondary" className="gap-1 font-mono">
                        {itemFilter.code}
                        <button type="button" onClick={() => setItemFilter(null)} aria-label="clear">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    )}
                  </div>
                  <TabsContent value="item" className="mt-4">{body(rollupTable("item"))}</TabsContent>
                  <TabsContent value="client" className="mt-4">{body(rollupTable("client"))}</TabsContent>
                  <TabsContent value="rack" className="mt-4">{body(rollupTable("rack"))}</TabsContent>
                  <TabsContent value="packs" className="mt-4">{body(packTable)}</TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        </main>
      </div>
      <PackDialog pack={openPack} onClose={() => setOpenPack(null)} />
    </PageTransition>
  );
}

/** One pack: details, quantity history, rack moves. */
function PackDialog({ pack, onClose }: Readonly<{ pack: AccessoryPack | null; onClose: () => void }>) {
  const { t, language } = useTranslation();
  const [history, setHistory] = useState<PackLedgerEntry[]>([]);
  const [moves, setMoves] = useState<PackMove[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!pack) return;
    setLoading(true);
    Promise.all([accessoryPackApi.ledger(pack.id), accessoryPackApi.moves(pack.id)])
      .then(([h, m]) => { setHistory(h); setMoves(m); })
      .catch(() => { setHistory([]); setMoves([]); })
      .finally(() => setLoading(false));
  }, [pack]);

  const values = pack ? [pack.item_color, pack.item_size, valueSummary(pack.value_lines, language)].filter(Boolean).join(" · ") : "";

  return (
    <Dialog open={pack !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        {pack && <>
          <DialogHeader>
            <DialogTitle>
              {t("accInvPack")} <span className="font-mono" dir="ltr">{pack.barcode}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">{t("accItemCode")}</div>
              <div className="font-mono">{pack.item_code}</div>
            </div>
            <div className="col-span-1 md:col-span-3">
              <div className="text-muted-foreground">{t("accDescription")}</div>
              <div>{pack.item_description}</div>
              {values && <div className="text-xs text-muted-foreground">{values}</div>}
            </div>
            <div>
              <div className="text-muted-foreground">{t("accInvOnHand")}</div>
              <div className="font-medium" dir="ltr">{fmtQty(pack.quantity)} {pack.uom_code}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("rack")}</div>
              <div>{pack.rack_code ?? t("accInvWaitingPutaway")}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("accStatus")}</div>
              <div>{t(pack.status === "active" ? "accInvStatusActive" : "accInvStatusEmpty")}</div>
            </div>
            <div>
              <div className="text-muted-foreground">{t("accInvReceivedAt")}</div>
              <div>{fmtDate(pack.created_at)}</div>
            </div>
          </div>

          <h3 className="font-semibold mt-4">{t("accInvHistory")}</h3>
          {loading ? <div className="py-4 text-center">{t("loading")}</div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("accTypeDate")}</TableHead>
                  <TableHead>{t("accLineType")}</TableHead>
                  <TableHead className="text-right">{t("accInvChange")}</TableHead>
                  <TableHead className="text-right">{t("accInvBalance")}</TableHead>
                  <TableHead>{t("accInvJobOrder")}</TableHead>
                  <TableHead>{t("accInvReason")}</TableHead>
                  <TableHead>{t("accInvBy")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((e) => (
                  <TableRow key={e.id} className={e.is_reversed ? "text-muted-foreground" : undefined}>
                    <TableCell className="whitespace-nowrap">{fmtDate(e.created_at)}</TableCell>
                    <TableCell>
                      {t(`accEntry_${e.entry_type}` as TranslationKey)}
                      {e.is_reversed && <Badge variant="outline" className="ml-2 rtl:ml-0 rtl:mr-2">{t("accInvReversed")}</Badge>}
                    </TableCell>
                    <TableCell className="text-right" dir="ltr">
                      {Number(e.qty_delta) > 0 ? "+" : ""}{fmtQty(e.qty_delta)}
                    </TableCell>
                    <TableCell className="text-right" dir="ltr">{e.balance === null ? "" : fmtQty(e.balance)}</TableCell>
                    <TableCell>{e.job_order_number ?? ""}</TableCell>
                    <TableCell>{e.reason ?? ""}</TableCell>
                    <TableCell>{e.created_by_name ?? e.created_by}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {moves.length > 0 && <>
            <h3 className="font-semibold mt-4">{t("accInvMoves")}</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("accInvFrom")}</TableHead>
                  <TableHead>{t("accInvTo")}</TableHead>
                  <TableHead>{t("accInvBy")}</TableHead>
                  <TableHead>{t("accTypeDate")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {moves.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-mono">{m.from_rack_code ?? t("accInvNoRack")}</TableCell>
                    <TableCell className="font-mono">{m.to_rack_code ?? t("accInvNoRack")}</TableCell>
                    <TableCell>{m.moved_by_name ?? m.moved_by}</TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">{fmtDate(m.moved_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>}
        </>}
      </DialogContent>
    </Dialog>
  );
}
