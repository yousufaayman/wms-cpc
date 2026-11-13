// ZPL labels for accessory packs. 10cm x 5cm (^PW800 x ^LL400 at 203dpi),
// printed upright (no rotation, unlike the roll labels).
//
// Layout: barcode + pack id top left, quantity + unit top right, a rule, then one
// row per detail with the Arabic caption right-aligned in the right column and
// the (mostly Latin) value on the left.
//
// Eight versions, picked from what the item has (Tab 1 "Pack label templates"):
//   V1 standard        no color, no size   description on 2 lines
//   V2 with color      color only          description on 2 lines
//   V3 color + size    both                description on 1 line, truncated
//   V4 with size       size only           description on 2 lines
//   V5-V8 = V1-V4 for a variant (item 10): the rows move into a narrower left
//   block, and a "Variant Data" panel right of a vertical divider lists the
//   variant's values ("Price: 34.99"), one per line, in the template's print
//   order (up to 5 lines; a 6th and more become "...").
//
// Item 17: a pack received on an expected delivery also gets a small "الدفعة"
// (batch) row under the quantity, top right; the quantity shrinks a little to
// make room. The rows below are unchanged.
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
 * What the label's barcode encodes: the pack id + `*ACC`, e.g. "1042*ACC"
 * (rolls use `<id>*F` / `<id>*K`). Same rule as
 * backend/domains/accessories/pack_barcode.py (a test checks the suffix).
 */
export const PACK_BARCODE_SUFFIX = '*ACC';
export const packBarcode = (packId: number): string => `${packId}${PACK_BARCODE_SUFFIX}`;

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
  /** A variant's values in print order (item 10), e.g. [{label: "Price", value: "34.99"}]. */
  variantLines?: { label: string; value: string }[] | null;
  /** The delivery batch (item 17), e.g. "B-12"; printed under the quantity. None = no row. */
  batchNo?: string | null;
}

export type PackLabelVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const present = (v: string | null | undefined): boolean => v != null && v.trim() !== '';

const hasVariantData = (data: Pick<AccessoryPackLabelData, 'variantLines'>): boolean =>
  (data.variantLines ?? []).some((l) => present(l.value));

export function packLabelVersion(
  data: Pick<AccessoryPackLabelData, 'color' | 'size' | 'variantLines'>,
): PackLabelVersion {
  const hasColor = present(data.color);
  const hasSize = present(data.size);
  const base = hasColor && hasSize ? 3 : hasColor ? 2 : hasSize ? 4 : 1;
  return (hasVariantData(data) ? base + 4 : base) as PackLabelVersion;
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
const ROW_FONT = 30;
const ROW_H = 42;
const ROWS_TOP = 182;
const ELLIPSIS = '...';
// Variant versions (V5-V8): rows end at DIVIDER_X, the variant panel is right of it.
const DIVIDER_X = 510;
const PANEL_X = DIVIDER_X + 18;
const PANEL_FONT = 26;
const PANEL_LINE_H = 36;
const PANEL_MAX_LINES = 5;
const PANEL_TITLE = 'Variant Data';

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

/** Arabic caption right-aligned at `right` (no ^FB: it breaks ^PA). */
const caption = (y: number, label: string, right = RIGHT): string => {
  const size = fitSize(label, ROW_FONT, CAPTION_W);
  const w = Math.ceil(textWidthAtSize(label, size));
  return text(right - w, y, label, size);
};

/** The variant panel: title, then one "Label: value" line per value. */
const variantPanel = (lines: { label: string; value: string }[]): string[] => {
  const maxW = RIGHT - PANEL_X;
  const filled = lines.filter((l) => present(l.value));
  const shown = filled.length > PANEL_MAX_LINES ? filled.slice(0, PANEL_MAX_LINES - 1) : filled;
  const texts = shown.map((l) => zplSafe(present(l.label) ? `${l.label.trim()}: ${l.value.trim()}` : l.value.trim()));
  if (shown.length < filled.length) texts.push(ELLIPSIS);
  return [
    `^FO${DIVIDER_X},174^GB3,${400 - 174 - 6},3^FS`,
    text(PANEL_X, ROWS_TOP, PANEL_TITLE, fitSize(PANEL_TITLE, PANEL_FONT, maxW)),
    ...texts.map((line, i) =>
      text(PANEL_X, ROWS_TOP + 40 + i * PANEL_LINE_H, truncate(line, fitSize(line, PANEL_FONT, maxW), maxW),
        fitSize(line, PANEL_FONT, maxW))),
  ];
};

/** One pack label. `copies` = how many of this label to print. */
export function generateAccessoryPackLabel(data: AccessoryPackLabelData, copies = 1): string {
  const version = packLabelVersion(data);
  const withVariant = version >= 5;
  const shape = withVariant ? version - 4 : version; // 1-4: which rows
  // Rows' right edge: the label edge, or just left of the variant panel.
  const rowsRight = withVariant ? DIVIDER_X - 12 : RIGHT;
  const valueW = rowsRight - LEFT - CAPTION_W - 15;
  const id = String(data.packId);
  const code = packBarcode(data.packId);
  const qty = zplSafe(`${data.quantity} ${data.uomAr}`.trim());

  // Top block: barcode + big pack id on the left, quantity on the right.
  const barcodeW = code128Width(code);
  const qtyX = LEFT + barcodeW + 30;
  const qtyW = RIGHT - qtyX;
  const batch = present(data.batchNo) ? zplSafe(data.batchNo!.trim()) : null;
  const qtySize = fitSize(qty, batch ? 52 : 64, qtyW);
  const top = [
    `^BY${BARCODE_MODULE},2,80`,
    `^FO${LEFT},20^BCN,95,N,N,N^FD${code}^FS`,
    text(LEFT, 122, id, fitSize(id, 44, barcodeW)),
    caption(25, 'الكمية'),
    text(RIGHT - Math.ceil(textWidthAtSize(qty, qtySize)), batch ? 66 : 75, qty, qtySize),
    `^FO${LEFT},170^GB${RIGHT - LEFT},4,4^FS`,
  ];
  if (batch) {
    // "B-12  الدفعة": caption at the right edge, the batch just left of it.
    const label = 'الدفعة';
    const labelW = Math.ceil(textWidthAtSize(label, ROW_FONT));
    const batchSize = fitSize(batch, ROW_FONT, qtyW - labelW - 15);
    top.push(
      text(RIGHT - labelW, 130, label, ROW_FONT),
      text(RIGHT - labelW - 15 - Math.ceil(textWidthAtSize(batch, batchSize)), 130, batch, batchSize),
    );
  }

  const rows: [string, string][] = [
    ['كود الصنف', zplSafe(data.itemCode || '-')],
    ['كود العميل', zplSafe(clientTrimCode(data))],
  ];
  if (shape === 2 || shape === 3) rows.push(['اللون', zplSafe(data.color!.trim())]);
  if (shape === 3 || shape === 4) rows.push(['المقاس', zplSafe(data.size!.trim())]);

  let y = ROWS_TOP;
  const body = rows.map(([label, value]) => {
    const out = `${caption(y, label, rowsRight)}\n${text(LEFT, y, value, fitSize(value, ROW_FONT, valueW))}`;
    y += ROW_H;
    return out;
  });

  // Description: whatever room is left (V3/V7 have room for one line only).
  const desc = zplSafe(data.description?.trim() || '-');
  const descLines = wrap(desc, ROW_FONT, valueW, shape === 3 ? 1 : 2);
  body.push(caption(y, 'الوصف', rowsRight));
  descLines.forEach((line, i) => body.push(text(LEFT, y + i * ROW_H, line, ROW_FONT)));

  if (withVariant) body.push(...variantPanel(data.variantLines ?? []));

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
