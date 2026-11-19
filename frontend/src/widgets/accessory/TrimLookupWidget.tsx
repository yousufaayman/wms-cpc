import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Loader2, Search } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { accessoryPackApi, valueSummary, type LookupRow } from "@/lib/api";
import WidgetCard from "../WidgetCard";
import { WidgetProps } from "../types";

const fmtQty = (value: string | number) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 4 });

/** Item 24 Trim Code Lookup: type our item code or a client / supplier
    reference code (nothing else is searched) and see how much of it is in
    this warehouse. A template shows the total of its variants. Clicking a
    result opens its packs on the Accessory Inventory page. */
const TrimLookupWidget = ({ warehouseId }: WidgetProps) => {
  const { t, language } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LookupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Ask the server a moment after typing stops; drop answers to older text.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearched(false);
      setError(false);
      setLoading(false);
      return;
    }
    let current = true;
    const id = setTimeout(() => {
      setLoading(true);
      setError(false);
      accessoryPackApi.lookup(warehouseId, q)
        .then((rows) => { if (current) { setResults(rows); setSearched(true); } })
        .catch(() => { if (current) setError(true); })
        .finally(() => { if (current) setLoading(false); });
    }, 300);
    return () => { current = false; clearTimeout(id); };
  }, [query, warehouseId]);

  const reset = () => {
    setQuery("");
    setResults([]);
    setSearched(false);
    setError(false);
  };

  const openPacks = (row: LookupRow) =>
    navigate(`/accessory-inventory?warehouse=${warehouseId}&tab=packs&code=${encodeURIComponent(row.code)}`);

  return (
    <WidgetCard title={t("widgetTrimLookup")} icon={<Search className="h-4 w-4 text-primary" />}>
      <div className="h-full flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("widgetTrimLookupDesc")}</p>
        <Button onClick={() => { reset(); setOpen(true); }}>
          <Search className="h-4 w-4 mr-2" />
          {t("widgetTrimLookup")}
        </Button>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("widgetTrimLookup")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("widgetTrimSearchPrompt")}
                className="pl-9"
                autoComplete="off"
              />
            </div>

            {loading && (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!loading && error && <p className="text-sm text-destructive">{t("widgetLoadFailed")}</p>}
            {!loading && !error && searched && results.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t("widgetNoTrimsFound")}</p>
            )}

            {!loading && results.length > 0 && (
              <div className="max-h-[28rem] overflow-y-auto space-y-2 pr-1">
                {results.map((r) => {
                  const details = [r.color, r.size, valueSummary(r.value_lines, language)].filter(Boolean).join(" · ");
                  const inStock = Number(r.on_hand) > 0;
                  return (
                    <button
                      key={r.accessory_item_id}
                      type="button"
                      onClick={() => openPacks(r)}
                      className="w-full rounded-md border p-2.5 text-left hover:bg-muted transition-colors flex items-center gap-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge className="font-mono text-xs">{r.code}</Badge>
                          {r.is_template && <Badge variant="secondary">{t("accTemplate")}</Badge>}
                          {r.merged_into_code && (
                            <Badge variant="outline">{t("itemMergedInto", { code: r.merged_into_code })}</Badge>
                          )}
                          {!r.active && !r.merged_into_code && <Badge variant="outline">{t("accInactive")}</Badge>}
                        </div>
                        <div className="text-sm font-medium truncate">
                          {r.description}
                          {r.client_name && <span className="text-muted-foreground"> · {r.client_name}</span>}
                        </div>
                        {details && <div className="text-xs text-muted-foreground truncate">{details}</div>}
                        {r.refs.length > 0 && (
                          <div className="text-xs text-muted-foreground truncate">
                            {r.refs.map((ref) => `${ref.party_name ?? "—"}: ${ref.ref_code}`).join(" · ")}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        {inStock ? (
                          <>
                            <div className="text-sm font-semibold">{fmtQty(r.on_hand)} {r.uom_code}</div>
                            <div className="text-xs text-muted-foreground">
                              {t("widgetPacksCount", { count: r.pack_count })}
                            </div>
                            {Number(r.unracked) > 0 && (
                              <div className="text-xs text-amber-600">
                                {t("accInvWaitingPutaway")}: {fmtQty(r.unracked)}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-xs text-muted-foreground">{t("widgetNotInStock")}</div>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </WidgetCard>
  );
};

export default TrimLookupWidget;
