/**
 * Scan-to-issue (item 20): the scan page of an accessory issue receipt.
 *
 * What the worker sees:
 * - left: the job order's requirement lines (needed, used so far, on this
 *   issue, remaining after this issue). Lines going past what's needed are red.
 * - right: a scan box. Scanning a pack (`1042*ACC`, or just the number)
 *   finds the requirement line of the pack's item and opens the quantity
 *   dialog, pre-filled with the smaller of "remaining" and "free in the
 *   pack". The quantity can be typed in any unit of the item that converts.
 *   More than remaining needs an over-issue reason (D-2); the line is then
 *   flagged, here, on the receipt and in Material Requests.
 * - below: the lines scanned so far, each removable until the issue is confirmed.
 *
 * Nothing leaves stock here: confirming the receipt (receipt page) does it.
 * The server checks everything again (free quantity across all open issues,
 * client-match, the requirement list), so its message wins over ours.
 *
 * `IssueLinesTable` is also used by the receipt page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, CheckCircle2, Info, Loader2, ScanLine, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { QtyInUnit, ValueChips, fmtQty } from "@/components/accessory-items/AccessoryItemPicker";
import { useTranslation } from "@/hooks/useTranslation";
import {
  accessoryItemApi, accessoryPackApi, accessoryReceiptItemApi, accessoryRequirementApi, internalReceiptApi,
  logicalLocationApi,
  type AccessoryItemUnit, type AccessoryPack, type AccessoryReceiptItem, type AccessoryRequirement, type InternalReceipt,
} from "@/lib/api";

const PACK_RE = /^([1-9]\d*)(\*ACC)?$/i;

/** `1042*ACC` (or `1042`) → 1042; anything else → null. */
function parsePackScan(text: string): number | null {
  const m = PACK_RE.exec(text.trim());
  return m ? Number(m[1]) : null;
}


// ─── Lines ───────────────────────────────────────────────────────────────────

/** The pack lines of an issue. `onRemove` given = lines not yet posted can be removed. */
export function IssueLinesTable({ lines, onRemove, busyId }: Readonly<{
  lines: AccessoryReceiptItem[];
  onRemove?: (line: AccessoryReceiptItem) => void;
  busyId?: number | null;
}>) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("accInvPack")}</TableHead>
          <TableHead>{t("accItemCode")}</TableHead>
          <TableHead className="text-right">{t("quantity")}</TableHead>
          <TableHead>{t("status")}</TableHead>
          {onRemove && <TableHead />}
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.length === 0 && (
          <TableRow><TableCell colSpan={onRemove ? 5 : 4} className="text-center text-muted-foreground py-6">{t("accIssueScanHint")}</TableCell></TableRow>
        )}
        {[...lines].reverse().map((line) => (
          <TableRow key={line.id} className={line.over_issue ? "bg-red-50 hover:bg-red-100/70 dark:bg-red-950/30" : undefined}>
            <TableCell className="font-mono">{line.pack_id}</TableCell>
            <TableCell>
              <div className="font-mono text-sm">{line.item_code}</div>
              <div className="text-sm">
                {line.item_description}
                {[line.item_color, line.item_size].filter(Boolean).length > 0 && (
                  <span className="text-muted-foreground"> · {[line.item_color, line.item_size].filter(Boolean).join(" · ")}</span>
                )}
              </div>
              <ValueChips values={line.value_lines} />
              {line.over_issue && (
                <div className="mt-1 inline-flex items-start gap-1 text-xs text-red-700">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  <span><span className="font-medium">{t("accReqOver")}:</span> {line.over_issue_reason}</span>
                </div>
              )}
            </TableCell>
            <TableCell className="text-right whitespace-nowrap" dir="ltr">
              {fmtQty(line.qty)} <span className="text-xs text-muted-foreground">{line.uom_code}</span>
            </TableCell>
            <TableCell>
              {line.posted
                ? <Badge className="bg-green-100 text-green-800 border-green-300" variant="outline">{t("accIssuePosted")}</Badge>
                : <Badge variant="secondary">{t("issued")}</Badge>}
            </TableCell>
            {onRemove && (
              <TableCell className="text-right">
                {!line.posted && (
                  <Button variant="ghost" size="sm" onClick={() => onRemove(line)} disabled={busyId === line.id}>
                    {busyId === line.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </Button>
                )}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ─── Requirement lines with "on this issue" ──────────────────────────────────

function RequirementsCard({ reqs, onThis }: Readonly<{ reqs: AccessoryRequirement[]; onThis: Map<number, number> }>) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">{t("accReqTitle")}</CardTitle></CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("accItemCode")}</TableHead>
              <TableHead className="text-right">{t("accReqNeeded")}</TableHead>
              <TableHead className="text-right">{t("accReqUsed")}</TableHead>
              <TableHead className="text-right">{t("accIssueOnThis")}</TableHead>
              <TableHead className="text-right">{t("accReqRemaining")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reqs.map((r) => {
              const here = onThis.get(r.id) ?? 0;
              const left = Number(r.remaining) - here;
              return (
                <TableRow key={r.id} className={left < 0 ? "bg-red-50 hover:bg-red-100/70 dark:bg-red-950/30" : undefined}>
                  <TableCell>
                    <div className="font-mono text-sm">{r.item_code}</div>
                    <div className="text-xs text-muted-foreground">{r.item_description}</div>
                    <ValueChips values={r.value_lines} />
                    {r.other_client && (
                      <div className="text-xs text-red-700 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{t("accReqOtherClient")}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right" dir="ltr">{fmtQty(r.qty_needed)} <span className="text-xs text-muted-foreground">{r.uom_code}</span></TableCell>
                  <TableCell className="text-right" dir="ltr">{fmtQty(r.used)}</TableCell>
                  <TableCell className="text-right font-medium" dir="ltr">{here ? fmtQty(here) : "—"}</TableCell>
                  <TableCell className={`text-right ${left < 0 ? "text-red-700 font-medium" : left === 0 ? "text-green-700" : ""}`} dir="ltr">
                    {fmtQty(left)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Quantity dialog ─────────────────────────────────────────────────────────

interface Pending { pack: AccessoryPack; req: AccessoryRequirement; free: number; left: number }

function QtyDialog({ pending, onClose, onSave }: Readonly<{
  pending: Pending | null;
  onClose: () => void;
  onSave: (qty: string, uomId: number | null, reason: string | null) => Promise<void>;
}>) {
  const { t } = useTranslation();
  const [units, setUnits] = useState<AccessoryItemUnit[]>([]);
  const [qty, setQty] = useState("");
  const [uomId, setUomId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pending) return;
    // Default: the smaller of what's still needed and what the pack has
    const suggested = Math.max(0, Math.min(pending.left, pending.free));
    setQty(suggested > 0 ? String(suggested) : "");
    setReason("");
    setUnits([]);
    setUomId(null);
    accessoryItemApi.units(pending.pack.accessory_item_id)
      .then((us) => { setUnits(us); setUomId(us.find((u) => u.is_base)?.uom_id ?? null); })
      .catch((e: Error) => toast.error(e.message));
    setTimeout(() => qtyRef.current?.select(), 50);
  }, [pending]);

  if (!pending) return null;
  const unit = units.find((u) => u.uom_id === uomId);
  const base = Number(qty) * Number(unit?.factor ?? 1);
  const over = base > pending.left ? base - Math.max(pending.left, 0) : 0;
  const canSave = base > 0 && (over === 0 || reason.trim() !== "") && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(qty, uomId, over > 0 ? reason.trim() : null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t("accIssueQtyTitle", { pack: pending.pack.id })}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border p-3">
            <div className="font-mono text-sm font-medium">{pending.pack.item_code}</div>
            <div className="text-sm">{pending.pack.item_description}</div>
            <ValueChips values={pending.pack.value_lines} />
            <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
              <div><span className="text-muted-foreground">{t("accIssueFree")}: </span><span dir="ltr">{fmtQty(pending.free)} {pending.pack.uom_code}</span></div>
              <div><span className="text-muted-foreground">{t("accReqRemaining")}: </span>
                <span dir="ltr" className={pending.left < 0 ? "text-red-700" : undefined}>{fmtQty(pending.left)} {pending.pack.uom_code}</span>
              </div>
            </div>
          </div>
          <QtyInUnit label={t("quantity")} units={units} qty={qty} setQty={setQty} uomId={uomId} setUomId={setUomId}
            inputRef={qtyRef} onEnter={save} />
          {over > 0 && (
            <div className="space-y-1.5 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 p-3">
              <p className="text-sm text-red-800 dark:text-red-300 flex items-start gap-1.5">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                {t("accIssueOverWarn", { over: fmtQty(over), unit: pending.pack.uom_code })}
              </p>
              <Label>{t("accIssueOverReason")} *</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={2} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={save} disabled={!canSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2 rtl:mr-0 rtl:ml-2" />}{t("accIssueAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── The page body ───────────────────────────────────────────────────────────

export default function AccessoryIssueScan({ receiptId, warehouseId }: Readonly<{ receiptId: number; warehouseId: number | null }>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<InternalReceipt | null>(null);
  const [target, setTarget] = useState("");
  const [reqs, setReqs] = useState<AccessoryRequirement[]>([]);
  const [lines, setLines] = useState<AccessoryReceiptItem[]>([]);
  const [scan, setScan] = useState("");
  const [looking, setLooking] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [r, ls] = await Promise.all([
      internalReceiptApi.getById(receiptId),
      accessoryReceiptItemApi.list("internal", receiptId),
    ]);
    setReceipt(r);
    setLines(ls);
    if (r.job_order_id) {
      const page = await accessoryRequirementApi.list({ job_order_id: r.job_order_id, limit: 500 });
      setReqs(page.items);
    }
  }, [receiptId]);

  useEffect(() => {
    reload().catch((e: Error) => toast.error(e.message));
  }, [reload]);

  useEffect(() => {
    if (!receipt) return;
    logicalLocationApi.getById(receipt.target_logical_location_id)
      .then((l) => setTarget(l.name))
      .catch(() => setTarget(""));
  }, [receipt]);

  // Unposted quantity on this issue, per requirement line and per pack
  const onThis = useMemo(() => {
    const byReq = new Map<number, number>();
    const byPack = new Map<number, number>();
    for (const l of lines) {
      if (l.posted) continue;
      if (l.jo_requirement_id) byReq.set(l.jo_requirement_id, (byReq.get(l.jo_requirement_id) ?? 0) + Number(l.qty));
      byPack.set(l.pack_id, (byPack.get(l.pack_id) ?? 0) + Number(l.qty));
    }
    return { byReq, byPack };
  }, [lines]);

  const editable = receipt?.status === "issued" && !receipt.closed;

  const onScan = async () => {
    const packId = parsePackScan(scan);
    setScan("");
    if (packId === null) { toast.error(t("accIssueScanHint")); return; }
    setLooking(true);
    try {
      const pack = await accessoryPackApi.get(packId);
      const req = reqs.find((r) => r.accessory_item_id === pack.accessory_item_id);
      if (!req) { toast.error(t("accIssueNotOnList", { item: pack.item_code })); return; }
      if (req.other_client) { toast.error(t("accIssueWrongClient", { item: pack.item_code })); return; }
      const free = Number(pack.quantity) - (onThis.byPack.get(pack.id) ?? 0);
      if (free <= 0) { toast.error(t("accIssuePackShort", { pack: pack.id, qty: fmtQty(Math.max(free, 0)), unit: pack.uom_code })); return; }
      // Remaining after what other open issues hold back for this line too
      const left = Number(req.remaining) - Number(req.pending);
      setPending({ pack, req, free, left });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLooking(false);
    }
  };

  const save = async (qty: string, uomId: number | null, reason: string | null) => {
    if (!pending) return;
    try {
      await accessoryReceiptItemApi.add("internal", receiptId, {
        pack_id: pending.pack.id, qty, uom_id: uomId, over_issue_reason: reason,
      });
      setPending(null);
      await reload();
      setTimeout(() => scanRef.current?.focus(), 50);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (line: AccessoryReceiptItem) => {
    setBusyId(line.id);
    try {
      await accessoryReceiptItemApi.delete(line.id);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const back = () => navigate(`/receipts/internal/${receiptId}${warehouseId ? `?warehouse=${warehouseId}` : ""}`);

  if (!receipt) {
    return <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin inline" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={back}><ArrowLeft className="h-4 w-4 rtl:rotate-180" /></Button>
          <div>
            <h1 className="text-xl font-semibold">{t("accIssueReceipt")} #{receipt.id}</h1>
            <p className="text-sm text-muted-foreground">
              {t("accIssueJobOrder")}: <span className="font-medium text-foreground">{receipt.job_order_number}</span>
              {target && <> · {target}</>}
            </p>
          </div>
        </div>
        <Button onClick={back}><CheckCircle2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />{t("doneScanning")}</Button>
      </div>

      <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Info className="h-4 w-4" />{t("accIssueNotPosted")}</p>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3"><RequirementsCard reqs={reqs} onThis={onThis.byReq} /></div>
        <div className="lg:col-span-2 space-y-4">
          {editable && (
            <Card>
              <CardContent className="pt-6 space-y-2">
                <Label>{t("scan")}</Label>
                <div className="flex gap-2">
                  <Input
                    ref={scanRef} autoFocus value={scan} onChange={(e) => setScan(e.target.value)} dir="ltr"
                    placeholder={t("accIssueScanHint")} onKeyDown={(e) => e.key === "Enter" && onScan()}
                  />
                  <Button onClick={onScan} disabled={looking || !scan.trim()}>
                    {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanLine className="h-4 w-4" />}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("scannedItems")} ({lines.length})

              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <IssueLinesTable lines={lines} onRemove={editable ? remove : undefined} busyId={busyId} />
            </CardContent>
          </Card>
        </div>
      </div>

      <QtyDialog pending={pending} onClose={() => { setPending(null); scanRef.current?.focus(); }} onSave={save} />
    </div>
  );
}
