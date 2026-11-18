/**
 * Merge duplicate item (item 23, admin only), opened from an item on the
 * Items page. The item that was open is the duplicate; the admin searches for
 * the item to keep. The page then shows what the server says will happen
 * (packs with stock that get a new pack of the kept item, references, open
 * delivery lines, unit conversions), a warning when the categories differ, and
 * anything that blocks the merge (e.g. an open issue, a job order still needing
 * the duplicate). With a reason, Merge does it in one go, prints the new pack
 * labels on the chosen printer and switches the duplicate off for good.
 * Rules: `backend/domains/accessories/item_merge.py`.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ItemSearch, PickedItem, fmtQty } from "@/components/accessory-items/AccessoryItemPicker";
import { accessoryItemApi, type AccessoryItem, type AccessoryItemMergePreview } from "@/lib/api";
import { usePackLabelPrinter } from "@/hooks/usePackLabelPrinter";
import { useTranslation } from "@/hooks/useTranslation";

const errorText = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export function MergeItemDialog({ duplicate, open, onOpenChange, onMerged }: Readonly<{
  duplicate: AccessoryItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: (duplicate: AccessoryItem) => void;
}>) {
  const { t } = useTranslation();
  const printing = usePackLabelPrinter();
  const [keep, setKeep] = useState<AccessoryItem | null>(null);
  const [preview, setPreview] = useState<AccessoryItemMergePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) { setKeep(null); setReason(""); }
  }, [open]);

  useEffect(() => {
    setPreview(null);
    if (!keep) return;
    let cancelled = false;
    setLoading(true);
    accessoryItemApi.mergePreview(duplicate.id, keep.id)
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((e) => toast.error(errorText(e, t("error"))))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [keep, duplicate.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = !!keep && !!preview && preview.blockers.length === 0 && !!reason.trim();
  const uom = preview?.packs[0]?.uom_code ?? "";

  const merge = async () => {
    if (!ready || !keep) return;
    setSaving(true);
    try {
      const out = await accessoryItemApi.merge(duplicate.id, keep.id, reason.trim());
      toast.success(t("itemMergeDone", { dup: duplicate.code, keep: keep.code, count: out.new_packs.length }));
      await printing.print(out.new_packs);
      onMerged(out.item);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorText(e, t("error")));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("itemMergeTitle")}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t("itemMergeDuplicate")}</Label>
            <PickedItem item={duplicate} />
          </div>

          <div className="space-y-1.5">
            <Label>{t("itemMergeKeep")} *</Label>
            {keep
              ? <PickedItem item={keep} onClear={() => setKeep(null)} />
              : <ItemSearch active={open} onPick={(item) => item.id !== duplicate.id && setKeep(item)} />}
          </div>

          {loading && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}

          {preview && keep && <>
            <div className="space-y-1 rounded-md border p-3 text-sm">
              <h3 className="font-medium">{t("itemMergePreview")}</h3>
              <ul className="list-disc ps-5 space-y-0.5">
                <li>
                  {t("itemMergePacks", { count: preview.packs.length, code: keep.code })}
                  {preview.packs.length > 0 && <span className="text-muted-foreground"> · {fmtQty(preview.total)} {uom}</span>}
                </li>
                <li>{t("itemMergeRefs", { count: preview.refs, code: keep.code })}</li>
                <li>{t("itemMergeLines", { count: preview.delivery_lines, code: keep.code })}</li>
                <li>{t("itemMergeConversions", { count: preview.conversions })}</li>
              </ul>
              {preview.category_differs && (
                <p className="flex items-center gap-1.5 text-amber-600">
                  <AlertTriangle className="h-4 w-4" />{t("itemMergeCategoryWarn")}
                </p>
              )}
            </div>

            {preview.blockers.length > 0 ? (
              <div className="space-y-1 rounded-md border border-destructive p-3 text-sm text-destructive">
                <h3 className="font-medium">{t("itemMergeBlocked")}</h3>
                <ul className="list-disc ps-5 space-y-0.5" dir="ltr">
                  {preview.blockers.map((b) => <li key={b}>{b}</li>)}
                </ul>
              </div>
            ) : <>
              <p className="text-sm text-muted-foreground">{t("itemMergeFinal")}</p>
              <div className="space-y-1.5">
                <Label>{t("opsReasonRequired")}</Label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={400} />
              </div>
              {preview.packs.length > 0 && (
                <div className="space-y-1.5 max-w-xs">
                  <Label>{t("selectPrinter")}</Label>
                  <Select value={printing.printer?.uid ?? ""}
                    onValueChange={(uid) => printing.setPrinter(printing.printers.find((p) => p.uid === uid) ?? null)}>
                    <SelectTrigger><SelectValue placeholder={t("selectPrinter")} /></SelectTrigger>
                    <SelectContent>
                      {printing.printers.map((p) => <SelectItem key={p.uid} value={p.uid}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>}
          </>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("cancel")}</Button>
            <Button variant="destructive" onClick={merge} disabled={!ready || saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5 rtl:mr-0 rtl:ml-1.5" />}{t("itemMergeConfirm")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
