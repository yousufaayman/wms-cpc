/**
 * Templates + variants on the Accessory Items page (item 10).
 *
 * - `VariableLinesSection`: a template's variable lines (Price, PO number...).
 *   Adding the first line makes a plain item a template. Labels and order can
 *   always change; a line that a variant uses can't change type or be deleted;
 *   once variants exist, new lines must be optional.
 * - `VariantsSection`: a base item's variants (one combination of values,
 *   color and size each). On an item without lines it adds colors / sizes
 *   ("Add color / size", item 11), which turns a plain item into a base item.
 *   The "Add variant" form that warns, while typing, when the combination
 *   already exists and offers to open that variant.
 * - `ValueInputs`: one input per line, typed (number, money, date, text);
 *   also used by the page to edit a variant's values.
 * `valueSummary` (lib/api/accessory-items.ts) writes a variant's values on one line.
 * The server checks every rule again; these screens only make them visible.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Plus, Save, Trash2 } from "lucide-react";
import {
  accessoryItemApi,
  type AccessoryItem, type AccessoryItemField, type FieldType, valueSummary,
} from "@/lib/api";
import { useTranslation } from "@/hooks/useTranslation";

type TKey = Parameters<ReturnType<typeof useTranslation>["t"]>[0];

const TYPE_LABEL: Record<FieldType, TKey> = {
  text: "accTypeText",
  number: "accTypeNumber",
  money: "accTypeMoney",
  date: "accTypeDate",
};

const fieldLabel = (f: AccessoryItemField, language: string) => (language === "ar" ? f.label_ar : f.label_en);

/** Does any variant hold a value for this line? */
const lineInUse = (variants: AccessoryItem[], key: string) =>
  variants.some((v) => v.variable_values != null && key in v.variable_values);

// ── Value inputs ────────────────────────────────────────────────────────────

export const ValueInputs = ({
  fields, values, onChange, disabled, onBlur,
}: {
  fields: AccessoryItemField[];
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  disabled?: boolean;
  onBlur?: () => void;
}) => {
  const { language } = useTranslation();
  return (
    <div className="grid grid-cols-2 gap-3">
      {fields.map((f) => (
        <div key={f.id} className="space-y-1">
          <Label htmlFor={`val-${f.id}`}>
            {fieldLabel(f, language)}{f.required && <span className="text-destructive"> *</span>}
          </Label>
          <Input
            id={`val-${f.id}`}
            dir="ltr"
            disabled={disabled}
            type={f.field_type === "date" ? "date" : f.field_type === "text" ? "text" : "number"}
            step={f.field_type === "money" ? "0.01" : f.field_type === "number" ? "any" : undefined}
            min={f.field_type === "money" ? "0" : undefined}
            maxLength={100}
            value={values[f.field_key] ?? ""}
            onChange={(e) => onChange({ ...values, [f.field_key]: e.target.value })}
            onBlur={onBlur}
          />
        </div>
      ))}
    </div>
  );
};

// ── Variable lines ──────────────────────────────────────────────────────────

type LineForm = { label_en: string; label_ar: string; field_type: FieldType; required: boolean; print_order: string };
const BLANK_LINE: LineForm = { label_en: "", label_ar: "", field_type: "text", required: false, print_order: "" };
const toForm = (f: AccessoryItemField): LineForm => ({ ...f, print_order: String(f.print_order) });

export const VariableLinesSection = ({
  item, variants, canManage, onChanged, onError,
}: {
  item: AccessoryItem;
  variants: AccessoryItem[];
  canManage: boolean;
  onChanged: () => void;
  onError: (error: unknown) => void;
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Record<number, LineForm>>({});
  const [newLine, setNewLine] = useState<LineForm>(BLANK_LINE);

  useEffect(() => {
    setRows(Object.fromEntries(item.fields.map((f) => [f.id, toForm(f)])));
  }, [item.fields]);

  const nextOrder = () => (item.fields.length ? Math.max(...item.fields.map((f) => f.print_order)) + 1 : 1);
  const payload = (row: LineForm, fallbackOrder: number) => ({
    label_en: row.label_en.trim(),
    label_ar: row.label_ar.trim(),
    field_type: row.field_type,
    required: row.required,
    print_order: row.print_order.trim() === "" ? fallbackOrder : Number(row.print_order),
  });

  const add = async () => {
    if (!newLine.label_en.trim() || !newLine.label_ar.trim()) return;
    try {
      await accessoryItemApi.addField(item.id, payload(newLine, nextOrder()));
      setNewLine(BLANK_LINE);
      onChanged();
    } catch (error) {
      onError(error);
    }
  };

  const save = async (f: AccessoryItemField) => {
    try {
      await accessoryItemApi.updateField(item.id, f.id, payload(rows[f.id], f.print_order));
      onChanged();
    } catch (error) {
      onError(error);
    }
  };

  const remove = async (f: AccessoryItemField) => {
    if (!window.confirm(t("accDeleteLineConfirm"))) return;
    try {
      await accessoryItemApi.deleteField(item.id, f.id);
      onChanged();
    } catch (error) {
      onError(error);
    }
  };

  const typeSelect = (value: FieldType, onChange: (v: FieldType) => void, disabled: boolean) => (
    <Select value={value} onValueChange={(v) => onChange(v as FieldType)} disabled={disabled}>
      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
      <SelectContent>
        {(Object.keys(TYPE_LABEL) as FieldType[]).map((type) => (
          <SelectItem key={type} value={type}>{t(TYPE_LABEL[type])}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const lineInputs = (row: LineForm, set: (r: LineForm) => void, opts: { typeLocked: boolean; requiredLocked: boolean }) => (
    <>
      <Input className="w-36" placeholder={t("accLabelEn")} maxLength={100} value={row.label_en}
        disabled={!canManage} onChange={(e) => set({ ...row, label_en: e.target.value })} />
      <Input className="w-36" placeholder={t("accLabelAr")} maxLength={100} value={row.label_ar} dir="rtl"
        disabled={!canManage} onChange={(e) => set({ ...row, label_ar: e.target.value })} />
      {typeSelect(row.field_type, (v) => set({ ...row, field_type: v }), !canManage || opts.typeLocked)}
      <div className="flex items-center gap-1" title={opts.requiredLocked ? t("accRequiredAfterVariants") : undefined}>
        <Switch checked={row.required} disabled={!canManage || opts.requiredLocked}
          onCheckedChange={(v) => set({ ...row, required: v })} />
        <span className="text-xs">{t("accRequired")}</span>
      </div>
      <Input className="w-16" type="number" title={t("accPrintOrder")} placeholder={t("accPrintOrder")}
        value={row.print_order} disabled={!canManage}
        onChange={(e) => set({ ...row, print_order: e.target.value })} />
    </>
  );

  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <h3 className="font-medium">{t("accVarLines")}</h3>
        {item.fields.length === 0 && <p className="text-xs text-muted-foreground">{t("accTemplateHint")}</p>}
      </div>
      {item.fields.map((f) => {
        const row = rows[f.id];
        if (!row) return null;
        const used = lineInUse(variants, f.field_key);
        return (
          <div key={f.id} className="flex flex-wrap items-center gap-2">
            {lineInputs(row, (r) => setRows({ ...rows, [f.id]: r }), {
              typeLocked: used,
              // Making a line required is refused while a variant has no value for it.
              requiredLocked: !f.required && variants.some((v) => !(f.field_key in (v.variable_values ?? {}))),
            })}
            {canManage && (
              <>
                <Button variant="outline" size="sm" title={t("saveChanges")} onClick={() => save(f)}>
                  <Save className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" disabled={used} title={used ? t("accLineInUse") : t("delete")}
                  onClick={() => remove(f)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        );
      })}
      {canManage && (
        <div className="flex flex-wrap items-center gap-2">
          {lineInputs(newLine, setNewLine, { typeLocked: false, requiredLocked: variants.length > 0 })}
          <Button variant="outline" size="sm" onClick={add} title={t("accAddLine")}
            disabled={!newLine.label_en.trim() || !newLine.label_ar.trim()}>
            <Plus className="mr-1 h-4 w-4" />{t("accAddLine")}
          </Button>
        </div>
      )}
    </div>
  );
};

// ── Variants ────────────────────────────────────────────────────────────────

type VariantForm = { values: Record<string, string>; color: string; size: string };
const BLANK_VARIANT: VariantForm = { values: {}, color: "", size: "" };

export const VariantsSection = ({
  template, variants, canManage, onChanged, onOpen, onError,
}: {
  template: AccessoryItem;
  variants: AccessoryItem[];
  canManage: boolean;
  onChanged: () => void;
  onOpen: (item: AccessoryItem) => void;
  onError: (error: unknown) => void;
}) => {
  const { t, language } = useTranslation();
  const [form, setForm] = useState<VariantForm>(BLANK_VARIANT);
  const [takenBy, setTakenBy] = useState<AccessoryItem | null>(null);
  const [saving, setSaving] = useState(false);

  const body = (f: VariantForm) => ({
    values: Object.fromEntries(Object.entries(f.values).map(([k, v]) => [k, v.trim() || null])),
    color: f.color.trim() || null,
    size: f.size.trim() || null,
  });
  const missingRequired = template.fields.some((f) => f.required && !(form.values[f.field_key] ?? "").trim());
  // A variant must differ from its base: a color, a size or a line value.
  const empty = !form.color.trim() && !form.size.trim() && !Object.values(form.values).some((v) => v.trim());
  const colorsOnly = template.fields.length === 0;
  const addLabel = colorsOnly ? t("accAddColorSize") : t("accAddVariant");

  /** Ask the server whether this combination exists (when a field loses focus). */
  const check = async () => {
    if (missingRequired || empty) {
      setTakenBy(null);
      return;
    }
    try {
      setTakenBy(await accessoryItemApi.checkVariant(template.id, body(form)));
    } catch {
      setTakenBy(null); // bad values: the server says why on save
    }
  };

  const add = async () => {
    setSaving(true);
    try {
      await accessoryItemApi.createVariant(template.id, body(form));
      setForm(BLANK_VARIANT);
      setTakenBy(null);
      onChanged();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">{t("accVariants")}</h3>
        <span className="text-xs text-muted-foreground">{t("accVariantCount", { n: variants.length })}</span>
      </div>
      {!template.active && <p className="text-sm text-destructive">{t("accTemplateOff")}</p>}

      {variants.map((v) => (
        <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
          <div className="min-w-0">
            <span className="font-mono font-medium" dir="ltr">{v.code}</span>
            {!v.active && <Badge variant="secondary" className="ms-2">{t("accInactive")}</Badge>}
            <div className="text-muted-foreground truncate">
              {[valueSummary(v.value_lines, language), v.color, v.size].filter(Boolean).join(" · ") || "—"}
            </div>
          </div>
          <Button variant="outline" size="sm" title={t("accOpenItem")} onClick={() => onOpen(v)}>
            <ExternalLink className="h-4 w-4" />
          </Button>
        </div>
      ))}

      {canManage && template.active && (
        <div className="space-y-3 rounded-md border p-3">
          <h4 className="text-sm font-medium">{addLabel}</h4>
          <ValueInputs fields={template.fields} values={form.values} onBlur={check}
            onChange={(values) => { setForm({ ...form, values }); setTakenBy(null); }} />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="variant-color">{t("color")}</Label>
              <Input id="variant-color" maxLength={100} value={form.color} onBlur={check}
                onChange={(e) => { setForm({ ...form, color: e.target.value }); setTakenBy(null); }} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="variant-size">{t("accSize")}</Label>
              <Input id="variant-size" maxLength={50} value={form.size} onBlur={check}
                onChange={(e) => { setForm({ ...form, size: e.target.value }); setTakenBy(null); }} />
            </div>
          </div>
          {takenBy && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <span>{t("accComboTaken", { code: takenBy.code })}</span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onOpen(takenBy)}>
                {t("accOpenItem")}
              </Button>
            </div>
          )}
          <div className="flex items-center justify-end gap-3">
            {colorsOnly && empty && <span className="text-xs text-muted-foreground">{t("accColorOrSize")}</span>}
            <Button size="sm" onClick={add} disabled={saving || missingRequired || empty || !!takenBy}>
              <Plus className="mr-1 h-4 w-4" />{addLabel}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
