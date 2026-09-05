// ZPL Label Templates for Fabric Rolls (dyed & undyed), 5x10cm labels.
// Layouts follow the approved "fabric_label_5x10_spread" spec.

export interface DyedRollLabelData {
  rollId: number;
  /** Human-readable client fabric code line printed under the barcode. */
  fabricCode: string;
  client: string;
  material: string;
  color: string;
  lot?: string | null;
  weightKg: number | string;
  lengthM?: number | string | null;
  widthCm?: number | string | null;
  gsm?: number | string | null;
  supplier?: string | null;
}

export type UndyedRollLabelData = Omit<DyedRollLabelData, "color" | "fabricCode">;

// ^FD field data must not contain ZPL control characters.
const zplSafe = (value: string): string => value.replace(/[\^~\\]/g, " ");

const field = (value: number | string | null | undefined): string => {
  if (value == null || value === "") return "-";
  return zplSafe(String(value));
};

/**
 * Dyed roll label. Barcode encodes `<rollId>*F`, with the roll id and fabric
 * code printed as text lines under it; detail lines are in Arabic, rendered
 * with the printer-resident Swiss 721 TrueType font (^CW1 → ^A1).
 */
export function generateDyedRollLabel(data: DyedRollLabelData, copies = 2): string {
  return `
^XA

^PW400
^LL800
^CI28

^CW1,E:SWISS271.TTF
^BY2,2,80

^FO10,20
^BCN,100,N,N,N
^FD${data.rollId}*F^FS

^FO140,130
^A1N,20,20
^FB360,1,0,L
^FD${data.rollId}^FS

^FO10,170
^A1N,55,55
^FB360,1,0,L
^FD${field(data.fabricCode)}^FS

^FO0,240^GB400,6,5^FS

^FO20,270^A1N,30,30^FDالعميل: ${field(data.client)}^FS
^FO20,330^A1N,30,30^FDالخامة: ${field(data.material)}^FS
^FO20,390^A1N,30,30^FDاللون: ${field(data.color)}^FS
^FO20,450^A1N,30,30^FDحوض: ${field(data.lot)}^FS
^FO20,510^A1N,30,30^FDالوزن: ${field(data.weightKg)} كجم^FS
^FO20,570^A1N,30,30^FDالطول: ${field(data.lengthM)} م^FS
^FO20,630^A1N,30,30^FDالعرض: ${field(data.widthCm)} سم^FS
^FO20,690^A1N,30,30^FDالمتر المربع: ${field(data.gsm)} جم^FS
^FO20,750^A1N,30,30^FDالمورد: ${field(data.supplier)}^FS

^PQ${Math.max(1, copies)}
^XZ
`.trim();
}

/**
 * Undyed roll label. Barcode encodes `<rollId>*K` (dyed uses `*F`);
 * no color / fabric code lines, Arabic details via Swiss 721 (^CW1 → ^A1).
 */
export function generateUndyedRollLabel(data: UndyedRollLabelData, copies = 2): string {
  return `
^XA

^PW400
^LL800
^CI28

^CW1,E:SWISS271.TTF

^BY2,2,80
^FO10,20
^BCN,100,N,N,N
^FD${data.rollId}*K^FS

^FO0,150^GB400,5,5^FS

^FO20,190^A1N,30,30^FDالعميل: ${field(data.client)}^FS
^FO20,270^A1N,30,30^FDالخامة: ${field(data.material)}^FS
^FO20,350^A1N,30,30^FDحوض: ${field(data.lot)}^FS
^FO20,430^A1N,30,30^FDالوزن: ${field(data.weightKg)} كجم^FS
^FO20,510^A1N,30,30^FDالطول: ${field(data.lengthM)} م^FS
^FO20,590^A1N,30,30^FDالعرض: ${field(data.widthCm)} سم^FS
^FO20,670^A1N,30,30^FDالمتر المربع: ${field(data.gsm)} جم^FS
^FO20,750^A1N,30,30^FDالمورد: ${field(data.supplier)}^FS

^PQ${Math.max(1, copies)}
^XZ
`.trim();
}

/**
 * Send raw ZPL to a printer discovered via Zebra Browser Print
 * (BrowserPrint.getLocalDevices → Device.send per the BrowserPrint docs).
 */
export function sendZplToDevice(device: BrowserPrint.Device, zpl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    device.send(zpl, resolve, (err) => reject(err instanceof Error ? err : new Error(String(err))));
  });
}
