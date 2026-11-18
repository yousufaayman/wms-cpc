/**
 * Supplier return scan page (item 22): the scan page of an Accessory
 * warehouse's supplier receipt, i.e. packs going back to their supplier.
 *
 * What the worker sees:
 * - the return's number, its supplier and remarks
 * - a scan box. Scanning a pack (`1042*ACC`, or just the number) opens a
 *   quantity dialog pre-filled with what is free in the pack (on hand minus
 *   what open issues / returns hold). The quantity can be typed in any unit
 *   of the item that converts.
 * - the lines scanned so far, each removable until the return is sent.
 *
 * Nothing leaves stock here: "Close and send" on the receipt page does it
 * (W_Manager). The server checks everything again (free quantity, the pack
 * came from this supplier), so its message wins.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Info, Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QtyInUnit, ValueChips, fmtQty } from "@/components/accessory-items/AccessoryItemPicker";
import { IssueLinesTable } from "@/components/accessory-issue/AccessoryIssueScan";
import { useTranslation } from "@/hooks/useTranslation";
import {
  accessoryItemApi, accessoryPackApi, accessoryReceiptItemApi, logicalLocationApi, packOpsApi, supplierReceiptApi,
  type AccessoryItemUnit, type AccessoryPack, type AccessoryReceiptItem, type SupplierReceipt,
} from "@/lib/api";

const PACK_RE = /^([1-9]\d*)(\*ACC)?$/i;

interface Pending { pack: AccessoryPack; free: number }

function QtyDialog({ pending, onClose, onSave }: Readonly<{
  pending: Pending | null;
  onClose: () => void;
  onSave: (qty: string, uomId: number | null) => Promise<void>;
}>) {
  const { t } = useTranslation();
  const [units, setUnits] = useState<AccessoryItemUnit[]>([]);
  const [qty, setQty] = useState("");
  const [uomId, setUomId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!pending) return;
    setQty(pending.free > 0 ? String(pending.free) : "");
    setUnits([]);
    setUomId(null);
    accessoryItemApi.units(pending.pack.accessory_item_id)
      .then((us) => { setUnits(us); setUomId(us.find((u) => u.is_base)?.uom_id ?? null); })
      .catch((e: Error) => toast.error(e.message));
    setTimeout(() => qtyRef.current?.select(), 50);
  }, [pending]);

  if (!pending) return null;
  const canSave = Number(qty) > 0 && !saving;
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(qty, uomId);
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
            <div className="mt-2 text-sm">
              <span className="text-muted-foreground">{t("accIssueFree")}: </span>
              <span dir="ltr">{fmtQty(pending.free)} {pending.pack.uom_code}</span>
            </div>
          </div>
          <QtyInUnit label={t("quantity")} units={units} qty={qty} setQty={setQty} uomId={uomId} setUomId={setUomId}
            inputRef={qtyRef} onEnter={save} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={save} disabled={!canSave}>
            {saving && <Loader2 className="h-4 w-4 animate-spin mr-2 rtl:mr-0 rtl:ml-2" />}{t("addItem")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function SupplierReturnScan({ receiptId, warehouseId }: Readonly<{ receiptId: number; warehouseId: number | null }>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [receipt, setReceipt] = useState<SupplierReceipt | null>(null);
  const [supplierName, setSupplierName] = useState("");
  const [lines, setLines] = useState<AccessoryReceiptItem[]>([]);
  const [scan, setScan] = useState("");
  const [looking, setLooking] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    const [r, ls] = await Promise.all([
      supplierReceiptApi.getById(receiptId),
      accessoryReceiptItemApi.list("supplier", receiptId),
    ]);
    setReceipt(r);
    setLines(ls);
  }, [receiptId]);

  useEffect(() => {
    reload().catch((e: Error) => toast.error(e.message));
  }, [reload]);

  useEffect(() => {
    if (!receipt) return;
    logicalLocationApi.getById(receipt.target_logical_location_id)
      .then((l) => setSupplierName(l.name))
      .catch(() => setSupplierName(""));
  }, [receipt]);

  const editable = receipt !== null && !receipt.closed;

  const onScan = async () => {
    const m = PACK_RE.exec(scan.trim());
    setScan("");
    if (!m) { toast.error(t("accIssueScanHint")); return; }
    setLooking(true);
    try {
      const pack = await accessoryPackApi.get(Number(m[1]));
      const free = Number((await packOpsApi.free(pack.id)).free);
      if (free <= 0) {
        toast.error(t("accIssuePackShort", { pack: pack.id, qty: fmtQty(Math.max(free, 0)), unit: pack.uom_code }));
        return;
      }
      setPending({ pack, free });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLooking(false);
    }
  };

  const save = async (qty: string, uomId: number | null) => {
    if (!pending) return;
    try {
      await accessoryReceiptItemApi.add("supplier", receiptId, { pack_id: pending.pack.id, qty, uom_id: uomId });
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

  const back = () => navigate(`/receipts/supplier/${receiptId}${warehouseId ? `?warehouse=${warehouseId}` : ""}`);

  if (!receipt) {
    return <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin inline" /></div>;
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={back}><ArrowLeft className="h-4 w-4 rtl:rotate-180" /></Button>
          <div>
            <h1 className="text-xl font-semibold">{t("accEntry_supplier_return")} #{receipt.id}</h1>
            <p className="text-sm text-muted-foreground">
              {t("supplier")}: <span className="font-medium text-foreground">{supplierName}</span>
              {receipt.remarks && <> · {receipt.remarks}</>}
            </p>
          </div>
        </div>
        <Button onClick={back}><CheckCircle2 className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />{t("doneScanning")}</Button>
      </div>

      <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Info className="h-4 w-4" />{t("accSrNotSent")}</p>

      {editable && (
        <Card>
          <CardContent className="pt-6 space-y-2">
            <Label>{t("scan")}</Label>
            <div className="flex gap-2 max-w-md">
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
          <CardTitle className="text-base">{t("scannedItems")} ({lines.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <IssueLinesTable lines={lines} onRemove={editable ? remove : undefined} busyId={busyId} />
        </CardContent>
      </Card>

      <QtyDialog pending={pending} onClose={() => { setPending(null); scanRef.current?.focus(); }} onSave={save} />
    </div>
  );
}
