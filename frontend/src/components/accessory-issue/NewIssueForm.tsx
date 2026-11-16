/**
 * Start an accessory issue (item 20).
 *
 * An issue is an internal receipt of an Accessory warehouse for one job
 * order, going to a production line (or an internal location). This form
 * asks for the two, creates the receipt, and opens the scan page for it.
 * - From Material Requests (a job order's Issue button) the job order is
 *   already known, so only the destination is asked.
 * - From Receipts → New internal receipt, the job order is picked too: only
 *   job orders that have requirement lines are offered (nothing else can be
 *   issued to).
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTranslation } from "@/hooks/useTranslation";
import {
  accessoryRequirementApi, internalReceiptApi, isInternalTarget, logicalLocationApi,
  type LogicalLocation, type RequirementJobOrder,
} from "@/lib/api";

export interface PresetJobOrder {
  job_order_id: number;
  job_order_number: string;
}

/** Job order search + list (only job orders with requirement lines). */
function JobOrderPicker({ value, onChange }: Readonly<{ value: number | null; onChange: (id: number) => void }>) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<RequirementJobOrder[]>([]);

  useEffect(() => {
    const id = setTimeout(() => {
      accessoryRequirementApi.jobOrders(search.trim())
        .then(setRows)
        .catch((e: Error) => toast.error(e.message));
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  return (
    <div className="space-y-1.5">
      <Label>{t("accIssueJobOrder")} *</Label>
      <Input placeholder={t("accReqSearch")} value={search} onChange={(e) => setSearch(e.target.value)} />
      <Select value={value !== null ? String(value) : undefined} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger><SelectValue placeholder={t("accIssuePickJo")} /></SelectTrigger>
        <SelectContent>
          {rows.map((jo) => (
            <SelectItem key={jo.job_order_id} value={String(jo.job_order_id)}>
              {jo.job_order_number}{jo.client_name ? ` · ${jo.client_name}` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function NewIssueForm({ warehouseId, jobOrder }: Readonly<{ warehouseId: number; jobOrder?: PresetJobOrder }>) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [locations, setLocations] = useState<LogicalLocation[]>([]);
  const [locationId, setLocationId] = useState<number | null>(null);
  const [jobOrderId, setJobOrderId] = useState<number | null>(jobOrder?.job_order_id ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    logicalLocationApi.getAll({ limit: 500 })
      .then((all) => {
        // Production lines first: that's where trims usually go
        const targets = all.filter(isInternalTarget)
          .sort((a, b) => Number(b.location_type === "production_line") - Number(a.location_type === "production_line"));
        setLocations(targets);
      })
      .catch((e: Error) => toast.error(e.message));
  }, []);

  const start = async () => {
    if (jobOrderId === null || locationId === null) return;
    setSaving(true);
    try {
      const receipt = await internalReceiptApi.create({
        source_warehouse_id: warehouseId, target_logical_location_id: locationId, job_order_id: jobOrderId,
      });
      navigate(`/receipts/create/internal?receipt_id=${receipt.id}&warehouse=${warehouseId}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {jobOrder ? (
        <div className="text-sm">
          <span className="text-muted-foreground">{t("accIssueJobOrder")}: </span>
          <span className="font-medium">{jobOrder.job_order_number}</span>
        </div>
      ) : (
        <JobOrderPicker value={jobOrderId} onChange={setJobOrderId} />
      )}
      <div className="space-y-1.5">
        <Label>{t("accIssueTo")} *</Label>
        <Select value={locationId !== null ? String(locationId) : undefined} onValueChange={(v) => setLocationId(Number(v))}>
          <SelectTrigger><SelectValue placeholder={t("selectTargetLocation")} /></SelectTrigger>
          <SelectContent>
            {locations.map((l) => (
              <SelectItem key={l.id} value={String(l.id)}>
                {l.name}{l.location_type === "production_line" ? ` · ${t("productionLineType")}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={start} disabled={saving || jobOrderId === null || locationId === null} className="w-full">
        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2 rtl:mr-0 rtl:ml-2" /> : <ScanLine className="h-4 w-4 mr-2 rtl:mr-0 rtl:ml-2" />}
        {t("processReceipt")}
      </Button>
    </div>
  );
}

/** The same form in a dialog (Material Requests: Issue on a job order). */
export function NewIssueDialog({ warehouseId, jobOrder, onClose }: Readonly<{
  warehouseId: number | null; jobOrder: PresetJobOrder | null; onClose: () => void;
}>) {
  const { t } = useTranslation();
  return (
    <Dialog open={jobOrder !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{jobOrder ? t("accIssueNew", { jo: jobOrder.job_order_number }) : ""}</DialogTitle>
        </DialogHeader>
        {jobOrder && warehouseId !== null && <NewIssueForm warehouseId={warehouseId} jobOrder={jobOrder} />}
      </DialogContent>
    </Dialog>
  );
}
