import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, ScanLine } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import {
  fabricRollApi, type FabricRollDetail,
  undyedFabricRollApi, type UndyedFabricRollDetail,
  warehouseRackApi, type RackContents,
} from "@/lib/api";
import WidgetCard from "../WidgetCard";
import { WidgetProps } from "../types";

type ScanResult =
  | { kind: "dyed"; roll: FabricRollDetail }
  | { kind: "undyed"; roll: UndyedFabricRollDetail }
  | { kind: "rack"; contents: RackContents };

const fmtNum = (value: number | null | undefined) =>
  value == null ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 });

function DetailRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-dashed last:border-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-right truncate">{value}</span>
    </div>
  );
}

const QuickViewWidget = ({ warehouseId }: WidgetProps) => {
  const { t, language } = useTranslation();
  const locale = language === "ar" ? "ar" : "en-US";

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scanner input stays focused so consecutive scans need no clicks
  useEffect(() => {
    if (open && !scanning) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, scanning, result]);

  const resetDialog = () => {
    setInput("");
    setScanning(false);
    setScanError(null);
    setResult(null);
  };

  const lookupRoll = async (idStr: string, kind: "dyed" | "undyed") => {
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) throw new Error(t("rollNotFound"));
    if (kind === "dyed") {
      setResult({ kind, roll: await fabricRollApi.getDetail(id) });
    } else {
      setResult({ kind, roll: await undyedFabricRollApi.getDetail(id) });
    }
  };

  const lookupRackById = async (idStr: string) => {
    const id = Number(idStr);
    if (!Number.isInteger(id) || id <= 0) throw new Error(t("widgetScanNotFound"));
    setResult({ kind: "rack", contents: await warehouseRackApi.getContents(id) });
  };

  const lookupRackByCode = async (code: string) => {
    const racks = await warehouseRackApi.searchByCode(code, warehouseId);
    setResult({ kind: "rack", contents: await warehouseRackApi.getContents(racks[0].id) });
  };

  const runLookup = async (fn: () => Promise<void>) => {
    setScanning(true);
    setScanError(null);
    try {
      await fn();
    } catch (err) {
      setResult(null);
      setScanError(err instanceof Error ? err.message : t("widgetScanNotFound"));
    } finally {
      setInput("");
      setScanning(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setScanError(null);
    // Barcode suffixes terminate the scan: `<rollId>*F` = dyed roll,
    // `<rollId>*K` = undyed roll, `<rackId>*R` = rack.
    if (val.endsWith("*F")) {
      runLookup(() => lookupRoll(val.slice(0, -2), "dyed"));
      return;
    }
    if (val.endsWith("*K")) {
      runLookup(() => lookupRoll(val.slice(0, -2), "undyed"));
      return;
    }
    if (val.endsWith("*R")) {
      runLookup(() => lookupRackById(val.slice(0, -2)));
      return;
    }
    setInput(val);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setInput("");
      setScanError(null);
      return;
    }
    if (e.key !== "Enter" || !input.trim() || scanning) return;
    const value = input.trim();
    // No suffix (manual entry): try rack code first, then a bare roll id
    runLookup(async () => {
      try {
        await lookupRackByCode(value);
      } catch {
        if (!/^\d+$/.test(value)) throw new Error(t("widgetScanNotFound"));
        try {
          await lookupRoll(value, "dyed");
        } catch {
          await lookupRoll(value, "undyed");
        }
      }
    });
  };

  const renderRoll = (roll: FabricRollDetail | UndyedFabricRollDetail, dyed: boolean) => (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary">{dyed ? t("widgetDyedRoll") : t("widgetUndyedRoll")}</Badge>
        <Badge variant={roll.status === "in" ? "default" : "outline"}>{roll.status}</Badge>
        {dyed && (
          <Badge className="bg-primary/10 text-primary border border-primary/30 hover:bg-primary/10">
            {(roll as FabricRollDetail).color_name}
          </Badge>
        )}
      </div>
      <div>
        <DetailRow label={t("rollId")} value={`#${roll.id}`} />
        {dyed && (
          <DetailRow label={t("fabricCode")} value={(roll as FabricRollDetail).fabric_code ?? "—"} />
        )}
        <DetailRow label={t("client")} value={roll.client_name ?? "—"} />
        <DetailRow label={t("material")} value={roll.material_name} />
        {dyed && <DetailRow label={t("color")} value={(roll as FabricRollDetail).color_name} />}
        <DetailRow label={t("lotNumber")} value={roll.lot_number ?? "—"} />
        <DetailRow label={t("weight")} value={`${fmtNum(roll.weight)} ${t("unitKg")}`} />
        <DetailRow label={t("length")} value={roll.length == null ? "—" : `${fmtNum(roll.length)} ${t("unitM")}`} />
        <DetailRow label={t("gsm")} value={fmtNum(roll.gsm)} />
        <DetailRow label={t("fabricWidth")} value={fmtNum(roll.fabric_width)} />
        <DetailRow label={t("rack")} value={roll.rack_code ?? "—"} />
        <DetailRow label={t("supplier")} value={roll.supplier ?? "—"} />
        <DetailRow
          label={t("received")}
          value={
            roll.received_date
              ? new Date(roll.received_date).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })
              : "—"
          }
        />
      </div>
    </div>
  );

  const renderRack = (contents: RackContents) => (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary">{t("rack")} {contents.rack_code}</Badge>
        <span className="text-xs text-muted-foreground">
          {contents.roll_count} {t("rollsCount")} · {fmtNum(contents.total_weight)} {t("unitKg")}
        </span>
      </div>
      {contents.roll_count === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">{t("widgetEmptyRack")}</p>
      ) : (
        <div className="space-y-3">
          {contents.dyed_groups.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("dyedFabricRolls")}
              </p>
              {contents.dyed_groups.map((g) => (
                <div
                  key={`${g.client_fabric_code_id}-${g.lot_number ?? ""}`}
                  className="rounded-md border p-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      <span className="font-mono">{g.fabric_code ?? "—"}</span>
                      {" "}
                      <Badge className="bg-primary/10 text-primary border border-primary/30 hover:bg-primary/10 align-middle">
                        {g.color_name}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {g.client_name} · {g.material_name}
                      {g.lot_number && ` · ${t("lot")} ${g.lot_number}`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold">{fmtNum(g.total_weight)} {t("unitKg")}</div>
                    <div className="text-xs text-muted-foreground">{g.roll_count} {t("rollsCount")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {contents.undyed_groups.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {t("undyedFabricRolls")}
              </p>
              {contents.undyed_groups.map((g) => (
                <div
                  key={`${g.client_id}-${g.material_id}-${g.lot_number ?? ""}`}
                  className="rounded-md border p-2 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{g.material_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {g.client_name}
                      {g.lot_number && ` · ${t("lot")} ${g.lot_number}`}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold">{fmtNum(g.total_weight)} {t("unitKg")}</div>
                    <div className="text-xs text-muted-foreground">{g.roll_count} {t("rollsCount")}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <WidgetCard title={t("widgetQuickView")} icon={<ScanLine className="h-4 w-4 text-primary" />}>
      <div className="h-full flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("widgetQuickViewDesc")}</p>
        <Button onClick={() => { resetDialog(); setOpen(true); }}>
          <ScanLine className="h-4 w-4 mr-2" />
          {t("widgetOpenScanner")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("widgetQuickView")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={input}
                disabled={scanning}
                onChange={handleChange}
                onKeyDown={handleKey}
                onBlur={() => setTimeout(() => inputRef.current?.focus(), 0)}
                placeholder={t("widgetScanPrompt")}
                className="pl-9"
                autoComplete="off"
              />
            </div>
            {scanError && <p className="text-sm text-destructive">{scanError}</p>}
            {scanning && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}
            {!scanning && result && (
              <div className="max-h-96 overflow-y-auto pr-1">
                {result.kind === "rack"
                  ? renderRack(result.contents)
                  : renderRoll(result.roll, result.kind === "dyed")}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </WidgetCard>
  );
};

export default QuickViewWidget;
