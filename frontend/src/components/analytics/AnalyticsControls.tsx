// Controls shared by the Analytics page's fabric tabs and its accessory
// reports (item 26): the from / to day filter and the Export to Excel button.
import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslation } from "@/hooks/useTranslation";

export interface DateRange {
  from: string;
  to: string;
}

/** Today as a local ISO day (YYYY-MM-DD) — the default range for both tabs. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ── Date range filter (from / to / clear; empty = all time) ───────────────────

export function DateRangeFilter({ range, onChange }: { range: DateRange; onChange: (r: DateRange) => void }) {
  const { t } = useTranslation();
  const active = !!(range.from || range.to);
  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div className="space-y-1">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("fromDate")}</Label>
        <Input
          type="date"
          className="h-9 w-40 text-sm"
          value={range.from}
          max={range.to || undefined}
          onChange={(e) => onChange({ ...range, from: e.target.value })}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("toDate")}</Label>
        <Input
          type="date"
          className="h-9 w-40 text-sm"
          value={range.to}
          min={range.from || undefined}
          onChange={(e) => onChange({ ...range, to: e.target.value })}
        />
      </div>
      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="h-9 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onChange({ from: "", to: "" })}
        >
          {t("clearAll")}
        </Button>
      )}
    </div>
  );
}

// ── Export-to-Excel button (shared by both tabs) ───────────────────────────────

export function ExportButton({ onExport, label, variant = "default" }: {
  onExport: () => Promise<void>;
  label: string;
  variant?: "default" | "outline";
}) {
  const { t } = useTranslation();
  const [exporting, setExporting] = useState(false);

  const handleClick = async () => {
    setExporting(true);
    try {
      await onExport();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("failedToExport"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button variant={variant} size="sm" className="h-9 text-xs gap-1.5" onClick={handleClick} disabled={exporting}>
      {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}
