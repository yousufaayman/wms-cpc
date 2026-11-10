// ZPL labels for accessory packs. 10cm x 5cm (^PW800 x ^LL400 at 203dpi),
// printed upright (no rotation, unlike the roll labels).
//
// Layout: barcode + UID top left, quantity + unit top right, a rule, then one
// row per detail with the Arabic caption right-aligned in the right column and
// the (mostly Latin) value on the left.
//
// Four versions, picked from what the item has (Tab 1 "Pack label templates"):
//   V1 standard        no color, no size   description on 2 lines
//   V2 with color      color only          description on 2 lines
//   V3 color + size    both                description on 1 line, truncated
//   V4 with size       size only           description on 2 lines
//
// Fonts, Arabic shaping (^PA) and text measuring are shared with the roll
// labels (rollLabelTemplates.ts), so the same printer setup works for both.

import {
  BARCODE_MODULE,
  LABEL_TEXT_SETUP,
  MIN_FONT,
  code128Width,
  textWidthAtSize,
  zplSafe,
} from './rollLabelTemplates';

/**
 * Pack UID = the pack's id in Base36, at least 5 characters (1 → "00001",
 * 1042 → "000SY"). Same rule as backend/domains/accessories/pack_uid.py
 * (a test checks they match).
 */
export const packUid = (packId: number): string => packId.toString(36).toUpperCase().padStart(5, '0');

/** What the label's barcode encodes: the pack UID + `*ACC` (rolls use `<id>*F` / `<id>*K`). */
export const PACK_BARCODE_SUFFIX = '*ACC';
export const packBarcode = (packId: number): string => `${packUid(packId)}${PACK_BARCODE_SUFFIX}`;

export interface AccessoryPackLabelData {
  /** The pack's id (wms.accessory_packs.id). */
  packId: number;
  quantity: number | string;
  /** Unit name in Arabic, e.g. "قطعة". */
  uomAr: string;
  itemCode: string;
  /** The item's client reference (client-specific items). Preferred. */
  clientRef?: string | null;
  /** The supplier's reference, used when there's no client reference (generic items). */
  supplierRef?: string | null;
  color?: string | null;
  size?: string | null;
  description?: string | null;
}

export type PackLabelVersion = 1 | 2 | 3 | 4;

const present = (v: string | null | undefined): boolean => v != null && v.trim() !== '';

export function packLabelVersion(data: Pick<AccessoryPackLabelData, 'color' | 'size'>): PackLabelVersion {
  const hasColor = present(data.color);
  const hasSize = present(data.size);
  if (hasColor && hasSize) return 3;
  if (hasColor) return 2;
  if (hasSize) return 4;
  return 1;
}

/** Client trim code row: the client's reference, else the supplier's. */
export function clientTrimCode(data: Pick<AccessoryPackLabelData, 'clientRef' | 'supplierRef'>): string {
  if (data.clientRef?.trim()) return data.clientRef.trim();
  if (data.supplierRef?.trim()) return data.supplierRef.trim();
  return '-';
}

// ── Layout (printer dots) ────────────────────────────────────────────────────
const LEFT = 20;
const RIGHT = 780;
const CAPTION_W = 150; // right column for Arabic captions
const VALUE_W = RIGHT - LEFT - CAPTION_W - 15; // value column to its left
const ROW_FONT = 30;
const ROW_H = 42;
const ROWS_TOP = 182;
const ELLIPSIS = '...';

const text = (x: number, y: number, value: string, size: number): string =>
  `^FO${Math.max(0, Math.round(x))},${Math.round(y)}^A1N,${size},${size}^FD${value}^FS`;

/** Largest size up to `base` (down to MIN_FONT) at which `value` fits `maxW`. */
const fitSize = (value: string, base: number, maxW: number): number => {
  const w = textWidthAtSize(value, base);
  return w > 0 ? Math.max(MIN_FONT, Math.min(base, Math.floor((base * maxW * 0.98) / w))) : base;
};

/** Cut `value` so it fits `maxW` at `size`, ending in "..." when cut. */
const truncate = (value: string, size: number, maxW: number): string => {
  if (textWidthAtSize(value, size) <= maxW) return value;
  let cut = value;
  while (cut.length > 0 && textWidthAtSize(cut + ELLIPSIS, size) > maxW) cut = cut.slice(0, -1);
  return cut.trimEnd() + ELLIPSIS;
};

/** Split into at most `lines` lines that fit `maxW`; the last line is truncated. */
const wrap = (value: string, size: number, maxW: number, lines: number): string[] => {
  const words = value.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let line = '';
  let i = 0;
  // Fill every line but the last word by word...
  while (i < words.length && out.length < lines - 1) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (!line || textWidthAtSize(next, size) <= maxW) {
      line = next;
      i++;
    } else {
      out.push(line);
      line = '';
    }
  }
  // ...and the last line gets everything left, truncated.
  const rest = [line, ...words.slice(i)].filter(Boolean).join(' ');
  if (rest) out.push(rest);
  return out.map((l) => truncate(l, size, maxW));
};

/** Arabic caption right-aligned in the caption column (no ^FB: it breaks ^PA). */
const caption = (y: number, label: string): string => {
  const size = fitSize(label, ROW_FONT, CAPTION_W);
  const w = Math.ceil(textWidthAtSize(label, size));
  return text(RIGHT - w, y, label, size);
};

const row = (y: number, label: string, value: string): string =>
  `${caption(y, label)}\n${text(LEFT, y, value, fitSize(value, ROW_FONT, VALUE_W))}`;

/** One pack label. `copies` = how many of this label to print. */
export function generateAccessoryPackLabel(data: AccessoryPackLabelData, copies = 1): string {
  const version = packLabelVersion(data);
  const uid = packUid(data.packId);
  const code = packBarcode(data.packId);
  const qty = zplSafe(`${data.quantity} ${data.uomAr}`.trim());

  // Top block: barcode + big UID on the left, quantity on the right.
  const barcodeW = code128Width(code);
  const qtyX = LEFT + barcodeW + 30;
  const qtyW = RIGHT - qtyX;
  const qtySize = fitSize(qty, 64, qtyW);
  const top = [
    `^BY${BARCODE_MODULE},2,80`,
    `^FO${LEFT},20^BCN,95,N,N,N^FD${code}^FS`,
    text(LEFT, 122, uid, fitSize(uid, 44, barcodeW)),
    caption(25, 'الكمية'),
    text(RIGHT - Math.ceil(textWidthAtSize(qty, qtySize)), 75, qty, qtySize),
    `^FO${LEFT},170^GB${RIGHT - LEFT},4,4^FS`,
  ];

  const rows: [string, string][] = [
    ['كود الصنف', zplSafe(data.itemCode || '-')],
    ['كود العميل', zplSafe(clientTrimCode(data))],
  ];
  if (version === 2 || version === 3) rows.push(['اللون', zplSafe(data.color!.trim())]);
  if (version === 3 || version === 4) rows.push(['المقاس', zplSafe(data.size!.trim())]);

  let y = ROWS_TOP;
  const body = rows.map(([label, value]) => {
    const out = row(y, label, value);
    y += ROW_H;
    return out;
  });

  // Description: whatever room is left (V3 has room for one line only).
  const desc = zplSafe(data.description?.trim() || '-');
  const descLines = wrap(desc, ROW_FONT, VALUE_W, version === 3 ? 1 : 2);
  body.push(caption(y, 'الوصف'));
  descLines.forEach((line, i) => body.push(text(LEFT, y + i * ROW_H, line, ROW_FONT)));

  return [
    '^XA',
    '^PW800',
    '^LL400',
    LABEL_TEXT_SETUP,
    ...top,
    ...body,
    `^PQ${Math.max(1, Math.floor(copies))}`,
    '^XZ',
  ].join('\n');
}

/** Several packs in one print job (e.g. a whole receiving session). */
export function generateAccessoryPackLabels(packs: AccessoryPackLabelData[]): string {
  return packs.map((p) => generateAccessoryPackLabel(p)).join('\n');
}
