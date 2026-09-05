export interface RollSummary {
  material_name: string;
  color_name: string;
  weight: number;
  length: number | null;
}

export interface ColorGroup {
  color_name: string;
  total_weight: number;
  total_length: number | null;
  count: number;
}

export interface MaterialGroup {
  material_name: string;
  total_weight: number;
  total_length: number | null;
  count: number;
  colors: ColorGroup[];
}

export function buildMaterialGroups(rolls: RollSummary[]): MaterialGroup[] {
  const matMap = new Map<string, Map<string, { w: number; l: number | null; n: number }>>();
  for (const roll of rolls) {
    if (!matMap.has(roll.material_name)) matMap.set(roll.material_name, new Map());
    const colorMap = matMap.get(roll.material_name)!;
    const existing = colorMap.get(roll.color_name);
    if (existing) {
      existing.w += roll.weight;
      existing.n += 1;
      if (roll.length !== null) existing.l = (existing.l ?? 0) + roll.length;
    } else {
      colorMap.set(roll.color_name, { w: roll.weight, l: roll.length, n: 1 });
    }
  }

  const groups: MaterialGroup[] = [];
  for (const [matName, colorMap] of matMap) {
    const colors: ColorGroup[] = [];
    let mw = 0, ml: number | null = null, mc = 0;
    for (const [colorName, data] of colorMap) {
      colors.push({ color_name: colorName, total_weight: data.w, total_length: data.l, count: data.n });
      mw += data.w;
      if (data.l !== null) ml = (ml ?? 0) + data.l;
      mc += data.n;
    }
    groups.push({ material_name: matName, total_weight: mw, total_length: ml, count: mc, colors });
  }
  return groups;
}

export function fmt(n: number | null | undefined, decimals = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimals);
}
