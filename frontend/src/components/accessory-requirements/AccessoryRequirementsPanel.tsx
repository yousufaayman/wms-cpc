/**
 * Material Requests page, accessory mode (item 19).
 *
 * Shows the accessory requirement lines of job orders, which the planning
 * system (POMS) writes. Read only: nothing here creates or changes a line.
 * Per line: needed / issued / returned / used / remaining in the item's base
 * unit, worked out on the server from the stock ledger, and a status badge.
 * Lines are grouped under their job order. Clicking a line opens its issue
 * history (the ledger rows counted against it). Issuing comes with item 20.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ValueChips, fmtQty } from "@/components/accessory-items/AccessoryItemPicker";
import { useTranslation } from "@/hooks/useTranslation";
import {
  accessoryRequirementApi,
  type AccessoryRequirement, type RequirementEntry, type RequirementStatus,
} from "@/lib/api";
import type { TranslationKey } from "@/lib/translations";
import { toast } from "sonner";

const PAGE_SIZE = 50;

const STATUS: Record<RequirementStatus, { label: TranslationKey; style: string }> = {
  not_started: { label: "accReqNotStarted", style: "bg-muted text-muted-foreground border-border" },
  partly_issued: { label: "accReqPartly", style: "bg-amber-100 text-amber-800 border-amber-300" },
  fully_issued: { label: "accReqFull", style: "bg-green-100 text-green-800 border-green-300" },
  over_issued: { label: "accReqOver", style: "bg-red-100 text-red-800 border-red-300" },
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString();

function StatusBadge({ status }: Readonly<{ status: RequirementStatus }>) {
  const { t } = useTranslation();
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border whitespace-nowrap ${s.style}`}>
      {t(s.label)}
    </span>
  );
}

/** Item code, description, colour / size, variant values, other-client warning. */
function ItemCell({ r }: Readonly<{ r: AccessoryRequirement }>) {
  const { t } = useTranslation();
  const extra = [r.item_color, r.item_size].filter(Boolean).join(" · ");
  return (
    <div className="min-w-[14rem]">
      <div className="font-mono text-sm">{r.item_code}</div>
      <div className="text-sm">{r.item_description}{extra && <span className="text-muted-foreground"> · {extra}</span>}</div>
      <ValueChips values={r.value_lines} />
      {r.other_client && (
        <div className="mt-1 inline-flex items-center gap-1 text-xs text-red-700">
          <AlertTriangle className="h-3 w-3" /> {t("accReqOtherClient")}
        </div>
      )}
      {r.remarks && <div className="text-xs text-muted-foreground mt-0.5">{r.remarks}</div>}
    </div>
  );
}

function Qty({ value, unit, danger = false }: Readonly<{ value: string; unit: string; danger?: boolean }>) {
  return (
    <span dir="ltr" className={`whitespace-nowrap ${danger ? "text-red-700 font-medium" : ""}`}>
      {fmtQty(value)} <span className="text-xs text-muted-foreground">{unit}</span>
    </span>
  );
}

function HistoryDialog({ req, onClose }: Readonly<{ req: AccessoryRequirement | null; onClose: () => void }>) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<RequirementEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!req) return;
    setLoading(true);
    accessoryRequirementApi.entries(req.id)
      .then(setEntries)
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [req]);

  return (
    <Dialog open={req !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("accReqHistory")}</DialogTitle>
        </DialogHeader>
        {req && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm text-muted-foreground">{t("jobOrderNumber")}: <span className="font-medium text-foreground">{req.job_order_number}</span></div>
                <ItemCell r={req} />
              </div>
              <StatusBadge status={req.status} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-sm">
              {([
                ["accReqNeeded", req.qty_needed], ["accReqIssued", req.issued], ["accReqReturned", req.returned],
                ["accReqUsed", req.used], ["accReqRemaining", req.remaining],
              ] as [TranslationKey, string][]).map(([label, value]) => (
                <div key={label} className="rounded-md border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{t(label)}</div>
                  <Qty value={value} unit={req.uom_code} danger={label === "accReqRemaining" && Number(value) < 0} />
                </div>
              ))}
            </div>
            {loading ? (
              <div className="py-6 text-center"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("accTypeDate")}</TableHead>
                    <TableHead>{t("accLineType")}</TableHead>
                    <TableHead>{t("accInvPack")}</TableHead>
                    <TableHead className="text-right">{t("accInvChange")}</TableHead>
                    <TableHead>{t("accInvReason")}</TableHead>
                    <TableHead>{t("accInvBy")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">—</TableCell></TableRow>
                  )}
                  {entries.map((e) => (
                    <TableRow key={e.id} className={e.is_reversed || e.reversal_of !== null ? "text-muted-foreground" : undefined}>
                      <TableCell className="whitespace-nowrap">{fmtDate(e.created_at)}</TableCell>
                      <TableCell>
                        {t(`accEntry_${e.entry_type}` as TranslationKey)}
                        {e.is_reversed && <Badge variant="outline" className="ml-2 rtl:ml-0 rtl:mr-2">{t("accInvReversed")}</Badge>}
                      </TableCell>
                      <TableCell className="font-mono">{e.pack_id}</TableCell>
                      <TableCell className="text-right" dir="ltr">
                        {Number(e.qty_delta) > 0 ? "+" : ""}{fmtQty(e.qty_delta)}
                      </TableCell>
                      <TableCell>{e.reason ?? ""}</TableCell>
                      <TableCell>{e.created_by_name ?? e.created_by}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function AccessoryRequirementsPanel({ warehouseId }: Readonly<{ warehouseId: number | null }>) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AccessoryRequirement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<RequirementStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AccessoryRequirement | null>(null);

  // Wait until typing stops before asking the server
  useEffect(() => {
    const id = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    accessoryRequirementApi.list({
      ...(warehouseId ? { warehouse_id: warehouseId } : {}),
      ...(query ? { search: query } : {}),
      ...(status === "all" ? {} : { status }),
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    })
      .then((r) => { setRows(r.items); setTotal(r.total); })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [warehouseId, query, status, page]);

  // Rows come sorted by job order, so one pass groups them
  const groups: { key: number; number: string; client: string | null; rows: AccessoryRequirement[] }[] = [];
  for (const r of rows) {
    const last = groups.at(-1);
    if (last?.key === r.job_order_id) last.rows.push(r);
    else groups.push({ key: r.job_order_id, number: r.job_order_number, client: r.job_order_client_name, rows: [r] });
  }
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t("accReqTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("accReqReadOnly")}</p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Input placeholder={t("accReqSearch")} value={search} onChange={(e) => setSearch(e.target.value)} className="w-64" />
        <Select value={status} onValueChange={(v) => { setStatus(v as RequirementStatus | "all"); setPage(1); }}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("allStatuses")}</SelectItem>
            {(Object.keys(STATUS) as RequirementStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{t(STATUS[s].label)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("accItemCode")}</TableHead>
                <TableHead className="text-right">{t("accReqNeeded")}</TableHead>
                <TableHead className="text-right">{t("accReqIssued")}</TableHead>
                <TableHead className="text-right">{t("accReqReturned")}</TableHead>
                <TableHead className="text-right">{t("accReqUsed")}</TableHead>
                <TableHead className="text-right">{t("accReqRemaining")}</TableHead>
                <TableHead>{t("status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && (
                <TableRow><TableCell colSpan={7} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
              )}
              {!loading && rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{t("accReqEmpty")}</TableCell></TableRow>
              )}
              {!loading && groups.map((g) => [
                <TableRow key={`jo-${g.key}`} className="bg-muted/50 hover:bg-muted/50">
                  <TableCell colSpan={7} className="py-2 font-medium">
                    {g.number}{g.client && <span className="text-muted-foreground font-normal"> · {g.client}</span>}
                  </TableCell>
                </TableRow>,
                ...g.rows.map((r) => (
                  <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpen(r)}>
                    <TableCell><ItemCell r={r} /></TableCell>
                    <TableCell className="text-right"><Qty value={r.qty_needed} unit={r.uom_code} /></TableCell>
                    <TableCell className="text-right"><Qty value={r.issued} unit={r.uom_code} /></TableCell>
                    <TableCell className="text-right"><Qty value={r.returned} unit={r.uom_code} /></TableCell>
                    <TableCell className="text-right"><Qty value={r.used} unit={r.uom_code} /></TableCell>
                    <TableCell className="text-right"><Qty value={r.remaining} unit={r.uom_code} danger={Number(r.remaining) < 0} /></TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                  </TableRow>
                )),
              ])}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {total > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{t("paginationShowing", { from, to, total })}</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t("previousPage")}</Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>{t("nextPage")}</Button>
          </div>
        </div>
      )}

      <HistoryDialog req={open} onClose={() => setOpen(null)} />
    </div>
  );
}
