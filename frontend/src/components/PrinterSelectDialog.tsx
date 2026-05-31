import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Printer, RefreshCw, Check, WifiOff } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";

interface PrinterSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPrinterSelect: (device: BrowserPrint.Device) => void;
  selectedPrinterUid?: string | null;
}

export function PrinterSelectDialog({
  open,
  onOpenChange,
  onPrinterSelect,
  selectedPrinterUid,
}: PrinterSelectDialogProps) {
  const { t } = useTranslation();
  const [printers, setPrinters] = useState<BrowserPrint.Device[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPrinters = () => {
    if (typeof BrowserPrint === "undefined") {
      setError(t("failedToLoadPrinters"));
      return;
    }
    setLoading(true);
    setError(null);
    BrowserPrint.getLocalDevices(
      (devices) => {
        setPrinters(devices as BrowserPrint.Device[]);
        setLoading(false);
      },
      () => {
        setError(t("failedToLoadPrinters"));
        setLoading(false);
      },
      "printer",
    );
  };

  useEffect(() => {
    if (open) loadPrinters();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            {t("choosePrinter")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 min-h-[120px]">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("loadingPrinters")}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center py-8 gap-3 text-center">
              <WifiOff className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive">{error}</p>
              <p className="text-xs text-muted-foreground">{t("noPrintersFoundHint")}</p>
              <Button variant="outline" size="sm" onClick={loadPrinters}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("refreshPrinters")}
              </Button>
            </div>
          ) : printers.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-3 text-center">
              <WifiOff className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("noPrintersFound")}</p>
              <p className="text-xs text-muted-foreground">{t("noPrintersFoundHint")}</p>
              <Button variant="outline" size="sm" onClick={loadPrinters}>
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("refreshPrinters")}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {printers.map((printer) => (
                <div
                  key={printer.uid}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Printer className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{printer.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {printer.connection} · {printer.uid}
                      </p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={selectedPrinterUid === printer.uid ? "default" : "outline"}
                    onClick={() => {
                      onPrinterSelect(printer);
                      onOpenChange(false);
                    }}
                    className="shrink-0 ml-2"
                  >
                    {selectedPrinterUid === printer.uid ? (
                      <>
                        <Check className="h-3 w-3 mr-1" />
                        {t("selected")}
                      </>
                    ) : (
                      t("select")
                    )}
                  </Button>
                </div>
              ))}
              <div className="flex justify-end pt-1">
                <Button variant="ghost" size="sm" onClick={loadPrinters}>
                  <RefreshCw className="h-3 w-3 mr-2" />
                  {t("refreshPrinters")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
