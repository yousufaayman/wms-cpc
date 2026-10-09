// ZPL Label Templates for Fabric Rolls (dyed & undyed). The printer is fed
// 10cm wide (^PW800) x 5cm tall (^LL400) at 203dpi, but the content is a 5cm x
// 10cm portrait layout printed rotated 270° (ZPL orientation B) into that frame.

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

// ^FD field data must not contain ZPL control characters or line breaks.
const zplSafe = (value: string): string => value.replace(/[\^~\\\r\n]+/g, " ");

// TrueType font on the printer assigned to slot 1 (^CW1 → ^A1). Bitmap fonts
// can't draw Arabic, so this file must already be uploaded to the printer.
const LABEL_FONT = (import.meta.env?.VITE_ZEBRA_LABEL_FONT ||"E:SWISS271.TTF").trim();

// UTF-8 field data, the Arabic-capable font in slot 1, and ^PA0,1,1,1 (default
// glyph off, bidirectional/RTL layout on, character shaping on, OpenType on) so
// the printer itself joins Arabic letters and orders mixed Arabic/Latin lines.
const LABEL_TEXT_SETUP = `^CI28\n^CW1,${LABEL_FONT}\n^PA0,1,1,1`;

const field = (value: number | string | null | undefined): string => {
  if (value == null || value === "") return "-";
  return zplSafe(String(value));
};

// Layout coordinates are in the portrait reading frame (LAYOUT_W x LAYOUT_H).
// Rotating 270° maps reading +x to printer -y and reading +y to printer +x, so a
// field's box at (x, y) with reading width w lands at printer ^FO y, LAYOUT_W - x - w.
const LAYOUT_W = 400; // = printer ^LL
const LAYOUT_H = 800; // = printer ^PW
const fo = (x: number, y: number, w: number): string => `^FO${y},${Math.max(0, LAYOUT_W - x - w)}`;

// ^BC without a start code uses Code 128 subset B: start + data + check (11
// modules each) + stop (13 modules).
const BARCODE_MODULE = 2; // ^BY module width
const code128Width = (data: string): number => (11 * (data.length + 2) + 13) * BARCODE_MODULE;

const barcode = (x: number, y: number, data: string, height: number): string =>
  `${fo(x, y, code128Width(data))}^BCB,${height},N,N,N^FD${data}^FS`;

// Horizontal rule in the reading frame becomes a vertical bar on the printer.
const rule = (y: number, thickness: number): string =>
  `^FO${y},0^GB${thickness},${LAYOUT_W},${thickness}^FS`;

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
 * Rotated text field in the Arabic font at the largest size (up to `baseSize`,
 * down to MIN_FONT) whose measured width fits `maxWidth` dots, centered within
 * its `baseSize` line box. ^FB is kept as a last-resort clip.
 */
const fitText = (
  x: number,
  y: number,
  text: string,
  baseSize: number,
  maxWidth: number,
  align: "L" | "C" = "L",
): string => {
  const widthAtBase = textWidthAtSize(text, baseSize);
  const fit = widthAtBase > 0 ? Math.floor((baseSize * maxWidth * FIT_MARGIN) / widthAtBase) : baseSize;
  const size = Math.max(MIN_FONT, Math.min(baseSize, fit));
  const top = y + Math.round((baseSize - size) / 2);
  return `${fo(x, top, maxWidth)}^A1B,${size},${size}^FB${maxWidth},1,0,${align}^FD${text}^FS`;
};

const detail = (y: number, label: string, value: string): string =>
  fitText(20, y, `${label}: ${value}`, 30, 370);

/**
 * Dyed roll label. Barcode encodes `<rollId>*F`, with the roll id and fabric
 * code printed as text lines under it; detail lines are in Arabic, rendered
 * with the printer-resident Swiss 721 TrueType font (^CW1 → ^A1).
 */
export function generateDyedRollLabel(data: DyedRollLabelData, copies = 2): string {
  const code = `${data.rollId}*F`;
  return `
^XA

^PW${LAYOUT_H}
^LL${LAYOUT_W}
${LABEL_TEXT_SETUP}

^BY${BARCODE_MODULE},2,80

${barcode(10, 20, code, 100)}
${fitText(10, 130, String(data.rollId), 20, code128Width(code), "C")}

${fitText(10, 170, field(data.fabricCode), 55, 380)}

${rule(240, 6)}

${detail(270, 'العميل', `${field(data.client)}`)}
${detail(330, 'الخامة', `${field(data.material)}`)}
${detail(390, 'اللون', `${field(data.color)}`)}
${detail(450, 'حوض', `${field(data.lot)}`)}
${detail(510, 'الوزن', `${field(data.weightKg)} كجم`)}
${detail(570, 'الطول', `${field(data.lengthM)} م`)}
${detail(630, 'العرض', `${field(data.widthCm)} سم`)}
${detail(690, 'المتر المربع', `${field(data.gsm)} جم`)}
${detail(750, 'المورد', `${field(data.supplier)}`)}

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

^PW${LAYOUT_H}
^LL${LAYOUT_W}
${LABEL_TEXT_SETUP}

^BY${BARCODE_MODULE},2,80

${barcode(10, 20, `${data.rollId}*K`, 100)}

${rule(150, 5)}

${detail(190, 'العميل', `${field(data.client)}`)}
${detail(270, 'الخامة', `${field(data.material)}`)}
${detail(350, 'حوض', `${field(data.lot)}`)}
${detail(430, 'الوزن', `${field(data.weightKg)} كجم`)}
${detail(510, 'الطول', `${field(data.lengthM)} م`)}
${detail(590, 'العرض', `${field(data.widthCm)} سم`)}
${detail(670, 'المتر المربع', `${field(data.gsm)} جم`)}
${detail(750, 'المورد', `${field(data.supplier)}`)}

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
