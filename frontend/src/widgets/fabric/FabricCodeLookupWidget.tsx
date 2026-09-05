import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { clientFabricCodeApi, type FabricCodeLookupResult } from "@/lib/api";
import WidgetCard from "../WidgetCard";
import { WidgetProps } from "../types";

const fmtNum = (value: number | null | undefined) =>
  value == null ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 });

/** Search-as-you-type fabric code lookup: enriches each match with client,
    material, color and the fabric code's current in-stock totals. The card
    itself stays compact — search and results live in a popup. */
const FabricCodeLookupWidget = (_props: WidgetProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FabricCodeLookupResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q) {
      setResults([]);
      setError(null);
      setSearched(false);
      setLoading(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setLoading(true);
      setError(null);
      clientFabricCodeApi.lookup(q)
        .then((rs) => { setResults(rs); setSearched(true); })
        .catch((e) => setError(e instanceof Error ? e.message : t("widgetScanNotFound")))
        .finally(() => setLoading(false));
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const resetDialog = () => {
    setQuery("");
    setResults([]);
    setError(null);
    setSearched(false);
    setLoading(false);
  };

  return (
    <WidgetCard title={t("widgetFabricCodeLookup")} icon={<Search className="h-4 w-4 text-primary" />}>
      <div className="h-full flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("widgetFabricCodeLookupDesc")}</p>
        <Button onClick={() => { resetDialog(); setOpen(true); }}>
          <Search className="h-4 w-4 mr-2" />
          {t("widgetFabricCodeLookup")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("widgetFabricCodeLookup")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("widgetFabricCodeSearchPrompt")}
                className="pl-9"
                autoComplete="off"
              />
            </div>

            {loading && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && error && <p className="text-sm text-destructive">{error}</p>}
            {!loading && !error && searched && results.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t("widgetNoFabricCodesFound")}</p>
            )}

            {!loading && results.length > 0 && (
              <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
                {results.map((r) => (
                  <div key={r.client_fabric_code_id} className="rounded-md border p-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className="font-mono text-xs">{r.fabric_code ?? `#${r.client_fabric_code_id}`}</Badge>
                      <Badge className="bg-primary/10 text-primary border border-primary/30 hover:bg-primary/10">
                        {r.color_name}
                      </Badge>
                    </div>
                    <div className="text-sm font-medium truncate">{r.client_name} · {r.material_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t("inStock")}: {fmtNum(r.in_stock_weight)} {t("unitKg")}
                      {r.in_stock_length != null && ` · ${fmtNum(r.in_stock_length)} ${t("unitM")}`}
                      {" · "}{r.in_stock_rolls} {r.in_stock_rolls === 1 ? t("rollUnit") : t("rollsCount")}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </WidgetCard>
  );
};

export default FabricCodeLookupWidget;
