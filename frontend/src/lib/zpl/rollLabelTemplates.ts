// ZPL Label Templates for Fabric Rolls (dyed & undyed). Labels are 5cm x 10cm
// stock fed landscape: 10cm wide (^PW800) x 5cm tall (^LL400) at 203dpi.

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

// ZPL cannot measure text, so measure it in the browser with an Arial-metric
// font (Swiss 721 is Helvetica-compatible) and scale the size to just fit.
const MIN_FONT = 12;
const FIT_MARGIN = 0.98; // small safety margin for printer/browser metric drift
const FALLBACK_GLYPH_RATIO = 0.5; // avg glyph width / height when no canvas is available
const MEASURE_SIZE = 100;

let measureCtx: CanvasRenderingContext2D | null | undefined;
const textWidthAtSize = (text: string, size: number): number => {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement("canvas").getContext("2d");
      if (measureCtx) measureCtx.font = `${MEASURE_SIZE}px Arial, Helvetica, sans-serif`;
    } catch {
      measureCtx = null;
    }
  }
  if (!measureCtx) return [...text].length * FALLBACK_GLYPH_RATIO * size;
  return (measureCtx.measureText(text).width / MEASURE_SIZE) * size;
};

/**
 * Text field in the Arabic font at the largest size (up to `baseSize`, down to
 * MIN_FONT) whose measured width fits `maxWidth` dots, vertically centered
 * within its `baseSize` line box. ^FB is kept as a last-resort clip.
 */
const fitText = (x: number, y: number, text: string, baseSize: number, maxWidth: number): string => {
  const widthAtBase = textWidthAtSize(text, baseSize);
  const fit = widthAtBase > 0 ? Math.floor((baseSize * maxWidth * FIT_MARGIN) / widthAtBase) : baseSize;
  const size = Math.max(MIN_FONT, Math.min(baseSize, fit));
  const top = y + Math.round((baseSize - size) / 2);
  return `^FO${x},${top}^A1N,${size},${size}^FB${maxWidth},1,0,L^FD${text}^FS`;
};

const detail = (x: number, y: number, label: string, value: string): string =>
  fitText(x, y, `${label}: ${value}`, 30, 370);

/**
 * Dyed roll label. Barcode encodes `<rollId>*F`, with the roll id and fabric
 * code printed as text lines under it; detail lines are in Arabic, rendered
 * with the printer-resident Swiss 721 TrueType font (^CW1 → ^A1).
 */
export function generateDyedRollLabel(data: DyedRollLabelData, copies = 2): string {
  return `
^XA

^PW800
^LL400
^CI28

^CW1,E:SWISS271.TTF
^BY2,2,80

^FO20,15
^BCN,100,N,N,N
^FD${data.rollId}*F^FS

^FO20,125
^A1N,20,20
^FB360,1,0,L
^FD${data.rollId}^FS

${fitText(400, 40, field(data.fabricCode), 55, 380)}

^FO0,165^GB800,5,5^FS

${detail(20, 180, 'العميل', `${field(data.client)}`)}
${detail(20, 222, 'الخامة', `${field(data.material)}`)}
${detail(20, 264, 'اللون', `${field(data.color)}`)}
${detail(20, 306, 'حوض', `${field(data.lot)}`)}
${detail(20, 348, 'المورد', `${field(data.supplier)}`)}
${detail(410, 180, 'الوزن', `${field(data.weightKg)} كجم`)}
${detail(410, 222, 'الطول', `${field(data.lengthM)} م`)}
${detail(410, 264, 'العرض', `${field(data.widthCm)} سم`)}
${detail(410, 306, 'المتر المربع', `${field(data.gsm)} جم`)}

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

^PW800
^LL400
^CI28

^CW1,E:SWISS271.TTF

^BY2,2,80
^FO20,15
^BCN,100,N,N,N
^FD${data.rollId}*K^FS

^FO0,135^GB800,5,5^FS

${detail(20, 160, 'العميل', `${field(data.client)}`)}
${detail(20, 220, 'الخامة', `${field(data.material)}`)}
${detail(20, 280, 'حوض', `${field(data.lot)}`)}
${detail(20, 340, 'المورد', `${field(data.supplier)}`)}
${detail(410, 160, 'الوزن', `${field(data.weightKg)} كجم`)}
${detail(410, 220, 'الطول', `${field(data.lengthM)} م`)}
${detail(410, 280, 'العرض', `${field(data.widthCm)} سم`)}
${detail(410, 340, 'المتر المربع', `${field(data.gsm)} جم`)}

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
