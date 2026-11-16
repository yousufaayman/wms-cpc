/**
 * Shortage report (item 20), Material Requests → Shortages tab.
 *
 * Per item: how much all **open** job orders (not archived) still need,
 * against what this warehouse has on hand. Only items that are short are
 * listed, most short first. Stock isn't reserved for job orders, so this is
 * what to buy or chase: remaining - on hand.
 */
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtQty } from "@/components/accessory-items/AccessoryItemPicker";
import { useTranslation } from "@/hooks/useTranslation";
import { accessoryRequirementApi, type AccessoryShortage } from "@/lib/api";

export default function AccessoryShortages({ warehouseId }: Readonly<{ warehouseId: number | null }>) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AccessoryShortage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (warehouseId === null) return;
    setLoading(true);
    accessoryRequirementApi.shortages(warehouseId)
      .then(setRows)
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [warehouseId]);

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("accItemCode")}</TableHead>
              <TableHead className="text-right">{t("jobOrdersTab")}</TableHead>
              <TableHead className="text-right">{t("accShortageRemaining")}</TableHead>
              <TableHead className="text-right">{t("accInvOnHand")}</TableHead>
              <TableHead className="text-right">{t("accShortageTab")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={5} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin inline" /></TableCell></TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                  <CheckCircle2 className="h-4 w-4 inline mr-1.5 rtl:mr-0 rtl:ml-1.5 text-green-600" />{t("accShortageNone")}
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.map((r) => (
              <TableRow key={r.accessory_item_id}>
                <TableCell>
                  <div className="font-mono text-sm">{r.item_code}</div>
                  <div className="text-sm">{r.item_description}</div>
                </TableCell>
                <TableCell className="text-right">{r.job_orders}</TableCell>
                <TableCell className="text-right" dir="ltr">{fmtQty(r.remaining)} <span className="text-xs text-muted-foreground">{r.uom_code}</span></TableCell>
                <TableCell className="text-right" dir="ltr">{fmtQty(r.on_hand)}</TableCell>
                <TableCell className="text-right text-red-700 font-medium" dir="ltr">{fmtQty(r.short)} <span className="text-xs">{r.uom_code}</span></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
