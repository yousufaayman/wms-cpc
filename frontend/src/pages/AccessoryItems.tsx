/**
 * Accessory Items (items 8 + 9): every accessory/trim we stock, with its code
 * and the client's / supplier's own codes for it ("references").
 *
 * - A searchable list, 50 per page (item 11). The quick search finds every
 *   word somewhere (code, client/supplier code, description, color, size,
 *   line value); "Advanced search" combines fields (e.g. color AND size, a
 *   template's line values). Filters are kept in the page link. See
 *   `components/accessory-items/ItemFilters.tsx`.
 * - New item: pick the category (pre-fills the base unit and whether it's for a
 *   client), then a client or "Generic", description, color, size, and at least
 *   one reference. While typing a reference the page asks the server whether
 *   that party's code is already on another item, and offers to open it.
 *   The server makes our code (UR-ELS-0007) on save.
 * - Edit item: description, color, size, base unit, active; references (add /
 *   delete, the last one stays); the item's own unit conversions. Category and
 *   client are part of the code, so they're read-only.
 * - Templates + variants (item 10): an item's "Variable lines" (adding one
 *   makes it a template) and, on a template, its variants
 *   (`components/accessory-items/TemplateSections.tsx`). Opening a variant
 *   shows its values for editing; its unit and conversions come from the
 *   template and its own references are optional. A Kind filter and badges
 *   tell plain items, templates and variants apart.
 * - Look-alike warning (item 11): while the form has the same category, client,
 *   description, color and size as another item (ignoring case and spaces),
 *   it says so and offers to open it. Saving is still allowed (user decision).
 * Anyone with a WMS role can look; creating/editing needs `manage_accessory_items`.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Pencil, Plus, Trash2 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import {
  accessoryCategoryApi, accessoryItemApi, clientApi, logicalLocationApi, uomApi,
  type AccessoryCategory, type AccessoryItem, type AccessoryItemRef, type Client, type LogicalLocation,
  type Uom, type UomConversion, valueSummary,
} from "@/lib/api";
import {
  ValueInputs, VariableLinesSection, VariantsSection,
} from "@/components/accessory-items/TemplateSections";
import {
  ALL, GENERIC, ItemFilterBar, ItemPager, toItemQuery, useItemFilters,
} from "@/components/accessory-items/ItemFilters";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";

const PAGE_SIZE = 50;

type Form = {
  category_id: string;
  client_id: string; // GENERIC or a client id
  description: string;
  color: string;
  size: string;
  base_uom_id: string;
  active: boolean;
  values: Record<string, string>; // a variant's values
};

const BLANK: Form = {
  category_id: "", client_id: "", description: "", color: "", size: "", base_uom_id: "", active: true, values: {},
};

/** One reference being typed. `party` is "c:<client id>" or "s:<supplier id>". */
type RefRow = { party: string; code: string; description: string; takenBy: AccessoryItem | null };
const BLANK_REF: RefRow = { party: "", code: "", description: "", takenBy: null };

const partyParams = (party: string): { client_id?: number; supplier_id?: number } =>
  party.startsWith("c:") ? { client_id: Number(party.slice(2)) } : { supplier_id: Number(party.slice(2)) };

const AccessoryItems = () => {
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const { can } = useCurrentUser();
  const canManage = can("manage_accessory_items");

  // Lookup lists
  const [categories, setCategories] = useState<AccessoryCategory[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [suppliers, setSuppliers] = useState<LogicalLocation[]>([]);

  // List + filters
  const [items, setItems] = useState<AccessoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const { filters, update: updateFilters, clear: clearFilters, advanced } = useItemFilters();
  const [advancedOpen, setAdvancedOpen] = useState(advanced > 0);
  const [templates, setTemplates] = useState<AccessoryItem[]>([]); // for the Template filter
  const query = useMemo(() => toItemQuery(filters, PAGE_SIZE), [filters]);
  const queryKey = JSON.stringify(query);

  // Dialog
  const [editing, setEditing] = useState<AccessoryItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Form>(BLANK);
  const [saving, setSaving] = useState(false);
  const [conversions, setConversions] = useState<UomConversion[]>([]);
  const [convForm, setConvForm] = useState({ uom_id: "", factor: "" });
  const [refRows, setRefRows] = useState<RefRow[]>([BLANK_REF]); // new item
  const [newRef, setNewRef] = useState<RefRow>(BLANK_REF); // adding to an existing item
  const [variants, setVariants] = useState<AccessoryItem[]>([]); // of the open template
  const [template, setTemplate] = useState<AccessoryItem | null>(null); // of the open variant
  const [similar, setSimilar] = useState<AccessoryItem[]>([]); // look-alikes of the form

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const uomById = useMemo(() => new Map(uoms.map((u) => [u.id, u])), [uoms]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);

  const categoryName = (c: AccessoryCategory) => `${c.code} · ${language === "ar" ? c.name_ar : c.name_en}`;
  const uomCode = (id: number) => uomById.get(id)?.code ?? `#${id}`;
  const refParty = (r: AccessoryItemRef) =>
    r.client_id != null
      ? clientById.get(r.client_id)?.name ?? `#${r.client_id}`
      : supplierById.get(r.supplier_id ?? -1)?.name ?? `#${r.supplier_id}`;

  const fail = (error: unknown) =>
    toast({
      title: t("error"),
      description: error instanceof Error ? error.message : t("accSaveFailed"),
      variant: "destructive",
    });
  const warn = (key: Parameters<typeof t>[0], params?: Record<string, string>) =>
    toast({ title: t("error"), description: t(key, params), variant: "destructive" });

  useEffect(() => {
    Promise.all([
      accessoryCategoryApi.getAll(),
      uomApi.getAll(),
      clientApi.getAll(),
      logicalLocationApi.getAll({ limit: 1000 }),
    ])
      .then(([cats, units, cls, locations]) => {
        setCategories(cats);
        setUoms(units);
        setClients([...cls].sort((a, b) => a.name.localeCompare(b.name)));
        setSuppliers(
          locations.filter((l) => l.location_type === "supplier").sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(fail);
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTemplates = () =>
    accessoryItemApi.search({ kind: "template", active_only: false, limit: 500 })
      .then((page) => setTemplates(page.items))
      .catch(fail);

  const loadItems = async () => {
    try {
      setLoading(true);
      const page = await accessoryItemApi.search(query);
      setItems(page.items);
      setTotal(page.total);
    } catch (error) {
      fail(error);
    } finally {
      setLoading(false);
    }
  };

  // Search as you type, after a short pause.
  useEffect(() => {
    const timer = setTimeout(loadItems, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);

  // Look-alikes of what the form says (not for variants: their check is the combination).
  const isVariantForm = editing?.parent_template_id != null;
  useEffect(() => {
    setSimilar([]);
    if (!dialogOpen || isVariantForm || !form.category_id || !form.client_id || !form.description.trim()) return;
    const timer = setTimeout(() => {
      accessoryItemApi.similar({
        category_id: Number(form.category_id),
        client_id: form.client_id === GENERIC ? undefined : Number(form.client_id),
        description: form.description.trim(),
        color: form.color.trim() || undefined,
        size: form.size.trim() || undefined,
        exclude_id: editing?.id,
      }).then(setSimilar).catch(() => setSimilar([])); // only a warning
    }, 400);
    return () => clearTimeout(timer);
  }, [dialogOpen, isVariantForm, editing?.id, form.category_id, form.client_id, form.description, form.color, form.size]);

  const loadConversions = async (itemId: number) => {
    try {
      setConversions(await accessoryItemApi.getConversions(itemId));
    } catch (error) {
      fail(error);
    }
  };

  /** A template's variants, or a variant's template (for its lines). */
  const loadFamily = async (item: AccessoryItem) => {
    try {
      setVariants(item.is_template ? await accessoryItemApi.getVariants(item.id) : []);
      setTemplate(item.parent_template_id != null ? await accessoryItemApi.get(item.parent_template_id) : null);
    } catch (error) {
      fail(error);
    }
  };

  /** Re-read the open item (after a reference, line or variant changed) and the list. */
  const refreshEditing = async (itemId: number) => {
    try {
      const item = await accessoryItemApi.get(itemId);
      setEditing(item);
      loadFamily(item);
      loadItems();
    } catch (error) {
      fail(error);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm(BLANK);
    setConversions([]);
    setRefRows([BLANK_REF]);
    setVariants([]);
    setTemplate(null);
    setDialogOpen(true);
  };

  const openEdit = (item: AccessoryItem) => {
    setEditing(item);
    setForm({
      category_id: String(item.category_id),
      client_id: item.client_id == null ? GENERIC : String(item.client_id),
      description: item.description,
      color: item.color ?? "",
      size: item.size ?? "",
      base_uom_id: String(item.base_uom_id),
      active: item.active,
      values: { ...(item.variable_values ?? {}) },
    });
    setConvForm({ uom_id: "", factor: "" });
    setNewRef(BLANK_REF);
    setConversions([]);
    setVariants([]);
    setTemplate(null);
    if (item.parent_template_id == null) loadConversions(item.id);
    loadFamily(item);
    setDialogOpen(true);
  };

  // The category pre-fills the base unit and generic/client (both can be changed).
  const pickCategory = (value: string) => {
    const cat = categoryById.get(Number(value));
    setForm({
      ...form,
      category_id: value,
      base_uom_id: cat ? String(cat.default_uom_id) : form.base_uom_id,
      client_id: cat?.default_client_specific ? (form.client_id === GENERIC ? "" : form.client_id) : GENERIC,
    });
  };

  // ── References on a new item ──────────────────────────────────────────────

  const setRefRow = (index: number, changes: Partial<RefRow>) =>
    setRefRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));

  /** Is this party's code already on another item? Asked when the code or party changes. */
  const checkTaken = async (index: number, row: RefRow) => {
    if (!row.party || !row.code.trim()) {
      setRefRow(index, { takenBy: null });
      return;
    }
    try {
      setRefRow(index, { takenBy: await accessoryItemApi.lookupRef(row.code.trim(), partyParams(row.party)) });
    } catch {
      // The server checks again on save.
    }
  };

  /** What's missing in the form, as a message key, or null. */
  const formProblem = (filledRefs: RefRow[]): Parameters<typeof t>[0] | null => {
    if (!form.category_id) return "accPickCategory";
    if (!form.client_id) return "accPickClient";
    if (!form.description.trim()) return "accDescriptionRequired";
    if (!form.base_uom_id) return "accPickDefaultUnit";
    if (!editing && (filledRefs.length === 0 || filledRefs.some((r) => !r.party))) return "accRefRequired";
    return null;
  };

  const save = async () => {
    const filledRefs = refRows.filter((r) => r.code.trim());
    const problem = formProblem(filledRefs);
    if (problem) {
      warn(problem);
      return;
    }
    const taken = !editing && filledRefs.find((r) => r.takenBy);
    if (taken && taken.takenBy) {
      warn("accRefTaken", { code: taken.takenBy.code });
      return;
    }
    setSaving(true);
    try {
      const common = {
        description: form.description.trim(),
        color: form.color.trim() || null,
        size: form.size.trim() || null,
        base_uom_id: Number(form.base_uom_id),
      };
      if (editing) {
        const variantEdit = editing.parent_template_id != null;
        await accessoryItemApi.update(editing.id, {
          ...common,
          active: form.active,
          ...(variantEdit ? {
            base_uom_id: undefined, // the template's
            variable_values: Object.fromEntries(Object.entries(form.values).map(([k, v]) => [k, v.trim() || null])),
          } : {}),
        });
        toast({ title: t("success"), description: t("accSaved") });
      } else {
        const created = await accessoryItemApi.create({
          ...common,
          category_id: Number(form.category_id),
          client_id: form.client_id === GENERIC ? null : Number(form.client_id),
          refs: filledRefs.map((r) => ({
            ...partyParams(r.party),
            ref_code: r.code.trim(),
            ref_description: r.description.trim() || null,
          })),
        });
        toast({ title: t("success"), description: t("accItemCreated", { code: created.code }) });
      }
      setDialogOpen(false);
      loadItems();
      loadTemplates();
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  // ── References on an existing item ────────────────────────────────────────

  const addRef = async () => {
    if (!editing) return;
    if (!newRef.party || !newRef.code.trim()) {
      warn("accRefRequired");
      return;
    }
    try {
      await accessoryItemApi.addRef(editing.id, {
        ...partyParams(newRef.party),
        ref_code: newRef.code.trim(),
        ref_description: newRef.description.trim() || null,
      });
      setNewRef(BLANK_REF);
      refreshEditing(editing.id);
    } catch (error) {
      fail(error);
    }
  };

  const removeRef = async (ref: AccessoryItemRef) => {
    if (!editing) return;
    try {
      await accessoryItemApi.deleteRef(editing.id, ref.id);
      refreshEditing(editing.id);
    } catch (error) {
      fail(error);
    }
  };

  // ── Item conversions (always 1 <other unit> = factor × <base unit>) ──────

  const addConversion = async () => {
    if (!editing) return;
    const factor = Number(convForm.factor);
    if (!convForm.uom_id) {
      warn("accSelectUnit");
      return;
    }
    if (!(factor > 0)) {
      warn("accFactorPositive");
      return;
    }
    try {
      await accessoryItemApi.createConversion(editing.id, {
        from_uom_id: Number(convForm.uom_id),
        to_uom_id: editing.base_uom_id,
        factor,
      });
      setConvForm({ uom_id: "", factor: "" });
      loadConversions(editing.id);
    } catch (error) {
      fail(error);
    }
  };

  const removeConversion = async (conv: UomConversion) => {
    if (!editing) return;
    try {
      await accessoryItemApi.deleteConversion(editing.id, conv.id);
      toast({ title: t("success"), description: t("accConversionDeleted") });
      loadConversions(editing.id);
    } catch (error) {
      fail(error);
    }
  };

  const clientLabel = (id: number | null) => (id == null ? t("accGeneric") : clientById.get(id)?.name ?? `#${id}`);
  const activeCategories = categories.filter((c) => c.active);
  const activeUoms = uoms.filter((u) => u.active);
  const readOnly = !canManage;
  const isVariant = isVariantForm;
  // A client-specific item only takes its own client's codes.
  const itemClientId = form.client_id && form.client_id !== GENERIC ? Number(form.client_id) : null;
  const refClients = itemClientId == null ? clients : clients.filter((c) => c.id === itemClientId);

  const partySelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44"><SelectValue placeholder={t("accRefParty")} /></SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{t("accClients")}</SelectLabel>
          {refClients.map((c) => (
            <SelectItem key={`c${c.id}`} value={`c:${c.id}`}>{c.name}</SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>{t("accSuppliers")}</SelectLabel>
          {suppliers.map((s) => (
            <SelectItem key={`s${s.id}`} value={`s:${s.id}`}>{s.name}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-8">
          <div className="space-y-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">{t("accessoryItems")}</h1>
                <p className="text-muted-foreground">{t("accessoryItemsDesc")}</p>
              </div>
              {canManage && (
                <Button onClick={openNew}>
                  <Plus className="mr-2 h-4 w-4" />{t("accNewItem")}
                </Button>
              )}
            </div>

            <Card>
              <CardContent className="pt-6 space-y-4">
                <ItemFilterBar
                  filters={filters} update={updateFilters} clear={clearFilters} advanced={advanced}
                  open={advancedOpen} setOpen={setAdvancedOpen}
                  categories={categories} categoryName={categoryName} clients={clients} suppliers={suppliers}
                  uoms={uoms} templates={templates}
                />

                {loading ? (
                  <div className="text-center py-8">{t("loading")}</div>
                ) : items.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">{t("accNoItems")}</div>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("accItemCode")}</TableHead>
                          <TableHead>{t("accDescription")}</TableHead>
                          <TableHead>{t("accRefs")}</TableHead>
                          <TableHead>{t("accCategory")}</TableHead>
                          <TableHead>{t("client")}</TableHead>
                          <TableHead>{t("color")}</TableHead>
                          <TableHead>{t("accSize")}</TableHead>
                          <TableHead>{t("accBaseUnit")}</TableHead>
                          <TableHead>{t("accStatus")}</TableHead>
                          <TableHead className="text-right">{t("actions")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {items.map((item) => {
                          const cat = categoryById.get(item.category_id);
                          return (
                            <TableRow key={item.id}>
                              <TableCell>
                                <div className="font-mono font-medium" dir="ltr">{item.code}</div>
                                {item.is_template && <Badge variant="secondary">{t("accTemplate")}</Badge>}
                                {item.template_code && (
                                  <div className="text-xs text-muted-foreground">
                                    {t("accVariantOf", { code: item.template_code })}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                {item.description}
                                {item.value_lines.length > 0 && (
                                  <div className="text-xs text-muted-foreground">{valueSummary(item.value_lines, language)}</div>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">
                                {item.refs.length === 0 ? (
                                  item.template_code
                                    ? <span className="text-xs text-muted-foreground">{t("accRefsFromTemplate")}</span>
                                    : "—"
                                ) : item.refs.map((r) => (
                                  <div key={r.id}>
                                    <span className="text-muted-foreground">{refParty(r)}: </span>
                                    <span className="font-mono" dir="ltr">{r.ref_code}</span>
                                  </div>
                                ))}
                              </TableCell>
                              <TableCell>{cat ? categoryName(cat) : `#${item.category_id}`}</TableCell>
                              <TableCell>{clientLabel(item.client_id)}</TableCell>
                              <TableCell>{item.color ?? "—"}</TableCell>
                              <TableCell>{item.size ?? "—"}</TableCell>
                              <TableCell>{uomCode(item.base_uom_id)}</TableCell>
                              <TableCell>
                                <Badge variant={item.active ? "outline" : "secondary"}>
                                  {item.active ? t("accActive") : t("accInactive")}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button variant="outline" size="sm" onClick={() => openEdit(item)} title={t("accEdit")}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                    <ItemPager page={filters.page} pageSize={PAGE_SIZE} total={total}
                      onPage={(page) => updateFilters({ page })} />
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editing ? `${t("accEditItem")} · ${editing.code}` : t("accNewItem")}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {!editing && <p className="text-sm text-muted-foreground">{t("accCodeOnSave")}</p>}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>{t("accCategory")}</Label>
                    <Select value={form.category_id} onValueChange={pickCategory} disabled={!!editing}>
                      <SelectTrigger><SelectValue placeholder={t("accPickCategory")} /></SelectTrigger>
                      <SelectContent>
                        {(editing ? categories : activeCategories).map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{categoryName(c)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("client")}</Label>
                    <Select value={form.client_id} onValueChange={(v) => setForm({ ...form, client_id: v })} disabled={!!editing}>
                      <SelectTrigger><SelectValue placeholder={t("accPickClient")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={GENERIC}>{t("accGeneric")}</SelectItem>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {editing && <p className="text-xs text-muted-foreground">{t("accCodeFieldsFixed")}</p>}

                {isVariant && editing && (
                  <div className="space-y-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span>{t("accVariantOf", { code: editing.template_code ?? "" })}</span>
                      {template && (
                        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => openEdit(template)}>
                          {t("accOpenItem")}
                        </Button>
                      )}
                    </div>
                    {template && !template.active && <p className="text-sm text-destructive">{t("accTemplateOff")}</p>}
                    {template && (
                      <ValueInputs fields={template.fields} values={form.values} disabled={readOnly}
                        onChange={(values) => setForm({ ...form, values })} />
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="description">{t("accDescription")}</Label>
                  <Input id="description" maxLength={255} value={form.description} disabled={readOnly}
                    onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="color">{t("color")}</Label>
                    <Input id="color" maxLength={100} value={form.color} disabled={readOnly}
                      onChange={(e) => setForm({ ...form, color: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="size">{t("accSize")}</Label>
                    <Input id="size" maxLength={50} value={form.size} disabled={readOnly}
                      onChange={(e) => setForm({ ...form, size: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>{t("accBaseUnit")}</Label>
                    <Select value={form.base_uom_id} onValueChange={(v) => setForm({ ...form, base_uom_id: v })}
                      disabled={readOnly || conversions.length > 0 || isVariant || variants.length > 0}>
                      <SelectTrigger><SelectValue placeholder={t("accSelectUnit")} /></SelectTrigger>
                      <SelectContent>
                        {(readOnly ? uoms : activeUoms).map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>{`${u.code} · ${u.name_en} · ${u.name_ar}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {similar.length > 0 && (
                  <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                    {similar.map((item) => (
                      <div key={item.id} className="flex items-center gap-2">
                        <span>{t("accSimilarItem", { code: item.code })}</span>
                        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => openEdit(item)}>
                          {t("accOpenItem")}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {editing && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="active">{t("accActive")}</Label>
                    <Switch id="active" checked={form.active} disabled={readOnly}
                      onCheckedChange={(v) => setForm({ ...form, active: v })} />
                  </div>
                )}

                {/* References: the client's / supplier's own codes */}
                <div className="space-y-3 border-t pt-4">
                  <div>
                    <h3 className="font-medium">{t("accRefs")}</h3>
                    {isVariant && <p className="text-xs text-muted-foreground">{t("accRefsFromTemplate")}</p>}
                    {itemClientId != null && <p className="text-xs text-muted-foreground">{t("accRefOwnClientOnly")}</p>}
                  </div>

                  {!editing ? (
                    <>
                      {refRows.map((row, index) => (
                        <div key={index} className="space-y-1">
                          <div className="flex items-center gap-2">
                            {partySelect(row.party, (v) => {
                              const next = { ...row, party: v };
                              setRefRow(index, { party: v });
                              checkTaken(index, next);
                            })}
                            <Input className="w-36 font-mono" dir="ltr" placeholder={t("accRefCode")} maxLength={100}
                              value={row.code} onChange={(e) => setRefRow(index, { code: e.target.value, takenBy: null })}
                              onBlur={() => checkTaken(index, row)} />
                            <Input className="flex-1" placeholder={t("accRefDescription")} maxLength={255}
                              value={row.description} onChange={(e) => setRefRow(index, { description: e.target.value })} />
                            <Button variant="outline" size="sm" title={t("accDeleteRef")} disabled={refRows.length <= 1}
                              onClick={() => setRefRows((rows) => rows.filter((_, i) => i !== index))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          {row.takenBy && (
                            <div className="flex items-center gap-2 text-sm text-destructive">
                              <span>{t("accRefTaken", { code: row.takenBy.code })}</span>
                              <Button variant="link" size="sm" className="h-auto p-0"
                                onClick={() => row.takenBy && openEdit(row.takenBy)}>
                                {t("accOpenItem")}
                              </Button>
                            </div>
                          )}
                        </div>
                      ))}
                      <Button variant="outline" size="sm" onClick={() => setRefRows((rows) => [...rows, BLANK_REF])}>
                        <Plus className="mr-2 h-4 w-4" />{t("accAddRef")}
                      </Button>
                    </>
                  ) : (
                    <>
                      {editing.refs.length === 0 && (
                        <p className="text-sm text-muted-foreground">{t("accNoRefs")}</p>
                      )}
                      {editing.refs.map((r) => (
                        <div key={r.id} className="flex items-center justify-between gap-2">
                          <div className="text-sm">
                            <span className="text-muted-foreground">{refParty(r)}: </span>
                            <span className="font-mono" dir="ltr">{r.ref_code}</span>
                            {r.ref_description && <span className="text-muted-foreground"> · {r.ref_description}</span>}
                          </div>
                          {canManage && (
                            <Button variant="outline" size="sm" onClick={() => removeRef(r)}
                              disabled={!isVariant && editing.refs.length <= 1}
                              title={!isVariant && editing.refs.length <= 1 ? t("accRefLastOne") : t("accDeleteRef")}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {canManage && (
                        <div className="flex items-center gap-2">
                          {partySelect(newRef.party, (v) => setNewRef({ ...newRef, party: v }))}
                          <Input className="w-36 font-mono" dir="ltr" placeholder={t("accRefCode")} maxLength={100}
                            value={newRef.code} onChange={(e) => setNewRef({ ...newRef, code: e.target.value })} />
                          <Input className="flex-1" placeholder={t("accRefDescription")} maxLength={255}
                            value={newRef.description} onChange={(e) => setNewRef({ ...newRef, description: e.target.value })} />
                          <Button variant="outline" size="sm" onClick={addRef} title={t("accAddRef")}>
                            <Plus className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {editing && !isVariant && (
                  <VariableLinesSection item={editing} variants={variants} canManage={canManage}
                    onChanged={() => refreshEditing(editing.id)} onError={fail} />
                )}

                {editing && editing.is_template && (
                  <VariantsSection template={editing} variants={variants} canManage={canManage}
                    onChanged={() => refreshEditing(editing.id)} onOpen={openEdit} onError={fail} />
                )}

                {editing && !isVariant && (
                  <div className="space-y-3 border-t pt-4">
                    <div>
                      <h3 className="font-medium">{t("accItemConversions")}</h3>
                      <p className="text-xs text-muted-foreground">{t("accItemConversionHint")}</p>
                    </div>
                    {conversions.map((c) => (
                      <div key={c.id} className="flex items-center justify-between">
                        <span className="font-mono text-sm" dir="ltr">
                          {`1 ${uomCode(c.from_uom_id)} = ${c.factor} ${uomCode(c.to_uom_id)}`}
                        </span>
                        {canManage && (
                          <Button variant="outline" size="sm" title={t("delete")} onClick={() => removeConversion(c)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ))}
                    {canManage && (
                      <div className="flex items-center gap-2" dir="ltr">
                        <span className="text-sm">1</span>
                        <Select value={convForm.uom_id} onValueChange={(v) => setConvForm({ ...convForm, uom_id: v })}>
                          <SelectTrigger className="w-28"><SelectValue placeholder="—" /></SelectTrigger>
                          <SelectContent>
                            {activeUoms.filter((u) => u.id !== editing.base_uom_id).map((u) => (
                              <SelectItem key={u.id} value={String(u.id)}>{u.code}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-sm">=</span>
                        <Input className="w-28" type="number" min="0" step="any" value={convForm.factor}
                          onChange={(e) => setConvForm({ ...convForm, factor: e.target.value })} />
                        <span className="text-sm font-mono">{uomCode(editing.base_uom_id)}</span>
                        <Button variant="outline" size="sm" onClick={addConversion} title={t("accAddConversion")}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                    {canManage && <p className="text-xs text-muted-foreground">{t("accOneSideBase")}</p>}
                  </div>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("cancel")}</Button>
                  {canManage && (
                    <Button onClick={save} disabled={saving}>{editing ? t("saveChanges") : t("create")}</Button>
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </PageTransition>
  );
};

export default AccessoryItems;
