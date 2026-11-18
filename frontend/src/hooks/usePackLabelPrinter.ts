/**
 * Label printing for new accessory packs (Pack Operations, item 21; merge
 * duplicates on the Items page, item 23). Lists the Zebra printers BrowserPrint
 * finds, keeps the chosen one, and `print(packs)` sends one label per pack
 * (each item is fetched once for its references and Arabic unit name).
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { fmtQty } from "@/components/accessory-items/AccessoryItemPicker";
import { accessoryItemApi, type AccessoryItem, type AccessoryPack } from "@/lib/api";
import { generateAccessoryPackLabels, sendZplToDevice, type AccessoryPackLabelData } from "@/lib/zpl";
import { useTranslation } from "@/hooks/useTranslation";

/** Prints labels for new packs (fetches each item once for its references). */
export function usePackLabelPrinter() {
  const { t } = useTranslation();
  const [printers, setPrinters] = useState<BrowserPrint.Device[]>([]);
  const [printer, setPrinter] = useState<BrowserPrint.Device | null>(null);
  useEffect(() => {
    if (typeof BrowserPrint === "undefined") return;
    BrowserPrint.getLocalDevices((d) => setPrinters(d as BrowserPrint.Device[]), () => undefined, "printer");
  }, []);

  const print = async (packs: AccessoryPack[]) => {
    if (packs.length === 0) return;
    if (!printer) { toast.warning(t("opsNoPrinter")); return; }
    const labels: AccessoryPackLabelData[] = [];
    const cache = new Map<number, [AccessoryItem, string]>();
    for (const pack of packs) {
      let entry = cache.get(pack.accessory_item_id);
      if (!entry) {
        const [item, units] = await Promise.all([
          accessoryItemApi.get(pack.accessory_item_id), accessoryItemApi.units(pack.accessory_item_id),
        ]);
        entry = [item, units.find((u) => u.is_base)?.name_ar ?? pack.uom_code];
        cache.set(pack.accessory_item_id, entry);
      }
      const [item, uomAr] = entry;
      labels.push({
        packId: pack.id,
        quantity: fmtQty(pack.quantity),
        uomAr,
        itemCode: pack.item_code,
        clientRef: item.client_refs?.[0]?.ref_code ?? null,
        supplierRef: (item.refs.find((r) => r.supplier_id != null && r.supplier_id === pack.client_supplier_id)
          ?? item.refs.find((r) => r.supplier_id != null))?.ref_code ?? null,
        color: pack.item_color,
        size: pack.item_size,
        description: pack.item_description,
        variantLines: pack.value_lines.map((v) => ({ label: v.label_en, value: v.value })),
        batchNo: pack.batch_no,
      });
    }
    await sendZplToDevice(printer, generateAccessoryPackLabels(labels)).catch(() => toast.warning(t("opsNoPrinter")));
  };
  return { printers, printer, setPrinter, print };
}
