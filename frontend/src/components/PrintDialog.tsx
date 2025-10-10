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

interface PrinterInfo {
  name: string;
  description?: string;
}

interface PrintDialogProps {
  isOpen: boolean;
  onClose: () => void;
  racks: RackLabelData[];
  onPrintComplete?: (success: boolean) => void;
}

export default function PrintDialog({ isOpen, onClose, racks, onPrintComplete }: PrintDialogProps) {
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [selectedPrinter, setSelectedPrinter] = useState<string>("");
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
      // Check if Zebra Browser Print is available
      const isAvailable = await zebraPrinterService.isAvailable();
      if (!isAvailable) {
        setErrorMessage("Zebra Browser Print is not available. Please install the application.");
        setPrintStatus('error');
        return;
      }

      const availablePrinters = await zebraPrinterService.getAvailablePrinters();
      setPrinters(availablePrinters);
      
      if (availablePrinters.length > 0) {
        setSelectedPrinter(availablePrinters[0].name);
      } else {
        setErrorMessage("No Zebra printers found. Please ensure your printer is connected and Zebra Browser Print is running.");
        setPrintStatus('error');
      }
    } catch (error) {
      setErrorMessage("Failed to load printers. Please ensure Zebra Browser Print is installed and running.");
      setPrintStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePrint = async () => {
    if (!selectedPrinter || racks.length === 0) {
      setErrorMessage("Please select a printer and ensure there are racks to print.");
      setPrintStatus('error');
      return;
    }

    setIsPrinting(true);
    setPrintStatus('idle');
    setErrorMessage("");

    try {
      const success = await zebraPrinterService.printMultipleRackLabels(racks, selectedPrinter);
      
      if (success) {
        setPrintStatus('success');
        onPrintComplete?.(true);
        // Auto close after success
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setPrintStatus('error');
        setErrorMessage("Failed to print labels. Please check printer connection.");
        onPrintComplete?.(false);
      }
    } catch (error) {
      setPrintStatus('error');
      setErrorMessage("Print error: " + (error instanceof Error ? error.message : "Unknown error"));
      onPrintComplete?.(false);
    } finally {
      setIsPrinting(false);
    }
  };

  const handleClose = () => {
    setPrintStatus('idle');
    setErrorMessage("");
    setSelectedPrinter("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5" />
            Print Rack Labels
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Print Summary */}
          <div className="space-y-2">
            <Label>Labels to Print</Label>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{racks.length} labels</Badge>
              <span className="text-sm text-muted-foreground">
                {racks.length > 0 && `(${racks[0].rackCode} - ${racks[racks.length - 1].rackCode})`}
              </span>
            </div>
          </div>

          {/* Printer Selection */}
          <div className="space-y-2">
            <Label htmlFor="printer-select">Select Printer</Label>
            <Select 
              value={selectedPrinter} 
              onValueChange={setSelectedPrinter}
              disabled={isLoading || isPrinting}
            >
              <SelectTrigger>
                <SelectValue placeholder={isLoading ? "Loading printers..." : "Select a printer"} />
              </SelectTrigger>
              <SelectContent>
                {printers.map((printer) => (
                  <SelectItem key={printer.name} value={printer.name}>
                    {printer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {printers.length === 0 && !isLoading && (
              <p className="text-sm text-muted-foreground">
                No printers found. Please install Zebra Browser Print.
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
                Labels printed successfully!
              </AlertDescription>
            </Alert>
          )}

          {/* Zebra Browser Print Info */}
          <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
            <strong>Note:</strong> This feature requires the Zebra Browser Print application to be installed on your system.
            <br />
            Download from: <a href="https://www.zebra.com/us/en/products/software/barcode-printers/zebra-browser-print.html" 
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
            Cancel
          </Button>
          <Button 
            onClick={handlePrint}
            disabled={!selectedPrinter || racks.length === 0 || isPrinting}
            className="flex items-center gap-2"
          >
            <Printer className="h-4 w-4" />
            {isPrinting ? "Printing..." : `Print ${racks.length} Labels`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
