import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Printer, AlertCircle, CheckCircle } from "lucide-react";
import { zebraPrinterService } from "@/lib/zpl/zebraPrinterService";
import { RackLabelData } from "@/lib/zpl/labelTemplates";
import { useTranslation } from "@/hooks/useTranslation";

interface PrintDialogProps {
  isOpen: boolean;
  onClose: () => void;
  racks: RackLabelData[];
  onPrintComplete?: (success: boolean) => void;
}

export default function PrintDialog({ isOpen, onClose, racks, onPrintComplete }: PrintDialogProps) {
  const { t } = useTranslation();
  const [printers, setPrinters] = useState<BrowserPrint.Device[]>([]);
  const [selectedPrinterUid, setSelectedPrinterUid] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPrinting, setIsPrinting] = useState(false);
  const [printStatus, setPrintStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      loadPrinters();
    }
  }, [isOpen]);

  const loadPrinters = async () => {
    setIsLoading(true);
    setPrintStatus('idle');
    setErrorMessage("");

    try {
      if (!zebraPrinterService.isAvailable()) {
        setErrorMessage(t("zebraBrowserPrintUnavailable"));
        setPrintStatus('error');
        return;
      }

      const availablePrinters = await zebraPrinterService.getAvailablePrinters();
      setPrinters(availablePrinters);

      if (availablePrinters.length > 0) {
        setSelectedPrinterUid(availablePrinters[0].uid);
      } else {
        setErrorMessage(t("noZebraPrintersFound"));
        setPrintStatus('error');
      }
    } catch (error) {
      setErrorMessage(t("failedToLoadPrinters"));
      setPrintStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrint = async () => {
    const device = printers.find((p) => p.uid === selectedPrinterUid);
    if (!device || racks.length === 0) {
      setErrorMessage(t("selectPrinterAndEnsureRacks"));
      setPrintStatus('error');
      return;
    }

    setIsPrinting(true);
    setPrintStatus('idle');
    setErrorMessage("");

    try {
      const success = await zebraPrinterService.printMultipleRackLabels(racks, device);

      if (success) {
        setPrintStatus('success');
        onPrintComplete?.(true);
        // Auto close after success
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setPrintStatus('error');
        setErrorMessage(t("printJobFailedCheckConnection"));
        onPrintComplete?.(false);
      }
    } catch (error) {
      setPrintStatus('error');
      setErrorMessage(t("printErrorPrefix") + (error instanceof Error ? error.message : t("error")));
      onPrintComplete?.(false);
    } finally {
      setIsPrinting(false);
    }
  };

  const handleClose = () => {
    setPrintStatus('idle');
    setErrorMessage("");
    setSelectedPrinterUid("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            {t("printRackLabelsTitle")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Print Summary */}
          <div className="space-y-2">
            <Label>{t("labelsToPrint")}</Label>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{t("labelsCount", { count: racks.length })}</Badge>
              <span className="text-sm text-muted-foreground">
                {racks.length > 0 && `(${racks[0].rackCode} - ${racks[racks.length - 1].rackCode})`}
              </span>
            </div>
          </div>

          {/* Printer Selection */}
          <div className="space-y-2">
            <Label htmlFor="printer-select">{t("selectPrinter")}</Label>
            <Select
              value={selectedPrinterUid}
              onValueChange={setSelectedPrinterUid}
              disabled={isLoading || isPrinting}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoading ? t("loadingPrinters") : t("selectPrinter")} />
              </SelectTrigger>
              <SelectContent>
                {printers.map((printer) => (
                  <SelectItem key={printer.uid} value={printer.uid}>
                    {printer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {printers.length === 0 && !isLoading && (
              <p className="text-sm text-muted-foreground">
                {t("installZebraBrowserPrintHint")}
              </p>
            )}
          </div>

          {/* Status Messages */}
          {printStatus === 'error' && errorMessage && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          {printStatus === 'success' && (
            <Alert>
              <CheckCircle className="h-4 w-4" />
              <AlertDescription>
                {t("rackLabelsPrintedSuccessfully")}
              </AlertDescription>
            </Alert>
          )}

          {/* Zebra Browser Print Info */}
          <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
            <strong>{t("note")}:</strong> {t("zebraBrowserPrintNote")}
            <br />
            {t("downloadFrom")}: <a href="https://www.zebra.com/us/en/products/software/barcode-printers/zebra-browser-print.html"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Zebra Browser Print
            </a>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isPrinting}
          >
            {t("cancel")}
          </Button>
          <Button
            onClick={handlePrint}
            disabled={!selectedPrinterUid || racks.length === 0 || isPrinting}
            className="flex items-center gap-2"
          >
            <Printer className="h-4 w-4" />
            {isPrinting ? t("printing") : t("printNLabels", { count: racks.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
