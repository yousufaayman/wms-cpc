/**
 * Accessory Items (item 8): every accessory/trim we stock, with its code.
 *
 * - A searchable list (code, description, color, size) with category / client
 *   filters and "show inactive".
 * - New item: pick the category (pre-fills the base unit and whether it's for a
 *   client), then a client or "Generic", description, color, size. The server
 *   makes the code (UR-ELS-0007) on save.
 * - Edit item: description, color, size, base unit, active. Category and client
 *   are part of the code, so they're shown read-only. The item's own unit
 *   conversions (1 CONE = 5000 M for one thread) are managed here too.
 * Anyone with a WMS role can look; creating/editing needs `manage_accessory_items`.
 * Item 11 adds search by client/supplier reference codes.
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Plus, Trash2 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import {
  accessoryCategoryApi, accessoryItemApi, clientApi, uomApi,
  type AccessoryCategory, type AccessoryItem, type Client, type Uom, type UomConversion,
} from "@/lib/api";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";

const PAGE_SIZE = 200;
const ALL = "all";
const GENERIC = "generic";

type Form = {
  category_id: string;
  client_id: string; // GENERIC or a client id
  description: string;
  color: string;
  size: string;
  base_uom_id: string;
  active: boolean;
};

const BLANK: Form = { category_id: "", client_id: "", description: "", color: "", size: "", base_uom_id: "", active: true };

const AccessoryItems = () => {
  const { t, language } = useTranslation();
  const { toast } = useToast();
  const { can } = useCurrentUser();
  const canManage = can("manage_accessory_items");

  // Lookup lists
  const [categories, setCategories] = useState<AccessoryCategory[]>([]);
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [clients, setClients] = useState<Client[]>([]);

  // List + filters
  const [items, setItems] = useState<AccessoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(ALL);
  const [clientFilter, setClientFilter] = useState(ALL);
  const [showInactive, setShowInactive] = useState(false);

  // Dialog
  const [editing, setEditing] = useState<AccessoryItem | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<Form>(BLANK);
  const [saving, setSaving] = useState(false);
  const [conversions, setConversions] = useState<UomConversion[]>([]);
  const [convForm, setConvForm] = useState({ uom_id: "", factor: "" });

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const uomById = useMemo(() => new Map(uoms.map((u) => [u.id, u])), [uoms]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  const categoryName = (c: AccessoryCategory) => `${c.code} · ${language === "ar" ? c.name_ar : c.name_en}`;
  const uomCode = (id: number) => uomById.get(id)?.code ?? `#${id}`;

  const fail = (error: unknown) =>
    toast({
      title: t("error"),
      description: error instanceof Error ? error.message : t("accSaveFailed"),
      variant: "destructive",
    });

  useEffect(() => {
    Promise.all([accessoryCategoryApi.getAll(), uomApi.getAll(), clientApi.getAll()])
      .then(([cats, units, cls]) => {
        setCategories(cats);
        setUoms(units);
        setClients([...cls].sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadItems = async () => {
    try {
      setLoading(true);
      const page = await accessoryItemApi.search({
        q: q.trim() || undefined,
        category_id: categoryFilter === ALL ? undefined : Number(categoryFilter),
        client_id: clientFilter === ALL || clientFilter === GENERIC ? undefined : Number(clientFilter),
        generic_only: clientFilter === GENERIC || undefined,
        active_only: !showInactive,
        limit: PAGE_SIZE,
      });
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
  }, [q, categoryFilter, clientFilter, showInactive]);

  const loadConversions = async (itemId: number) => {
    try {
      setConversions(await accessoryItemApi.getConversions(itemId));
    } catch (error) {
      fail(error);
    }
  };

  const openNew = () => {
    setEditing(null);
    setForm(BLANK);
    setConversions([]);
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
    });
    setConvForm({ uom_id: "", factor: "" });
    setConversions([]);
    loadConversions(item.id);
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

  const save = async () => {
    const problem =
      !form.category_id ? "accPickCategory"
      : !form.client_id ? "accPickClient"
      : !form.description.trim() ? "accDescriptionRequired"
      : !form.base_uom_id ? "accPickDefaultUnit"
      : null;
    if (problem) {
      toast({ title: t("error"), description: t(problem), variant: "destructive" });
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
        await accessoryItemApi.update(editing.id, { ...common, active: form.active });
        toast({ title: t("success"), description: t("accSaved") });
      } else {
        const created = await accessoryItemApi.create({
          ...common,
          category_id: Number(form.category_id),
          client_id: form.client_id === GENERIC ? null : Number(form.client_id),
        });
        toast({ title: t("success"), description: t("accItemCreated", { code: created.code }) });
      }
      setDialogOpen(false);
      loadItems();
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  // Item conversions are always written as 1 <other unit> = factor × <base unit>.
  const addConversion = async () => {
    if (!editing) return;
    const factor = Number(convForm.factor);
    if (!convForm.uom_id) {
      toast({ title: t("error"), description: t("accSelectUnit"), variant: "destructive" });
      return;
    }
    if (!(factor > 0)) {
      toast({ title: t("error"), description: t("accFactorPositive"), variant: "destructive" });
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
                <div className="flex flex-wrap items-center gap-3">
                  <Input className="max-w-sm" placeholder={t("accItemSearch")} value={q} onChange={(e) => setQ(e.target.value)} />
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>{t("accAllCategories")}</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{categoryName(c)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={clientFilter} onValueChange={setClientFilter}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>{t("accAllClients")}</SelectItem>
                      <SelectItem value={GENERIC}>{t("accGenericOnly")}</SelectItem>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-2">
                    <Switch id="inactive" checked={showInactive} onCheckedChange={setShowInactive} />
                    <Label htmlFor="inactive">{t("accShowInactive")}</Label>
                  </div>
                </div>

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
                              <TableCell className="font-mono font-medium" dir="ltr">{item.code}</TableCell>
                              <TableCell>{item.description}</TableCell>
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
                    {total > items.length && (
                      <p className="text-sm text-muted-foreground">{t("accShowingOf", { shown: items.length, total })}</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editing ? `${t("accEditItem")} · ${editing.code}` : t("accNewItem")}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {!editing && <p className="text-sm text-muted-foreground">{t("accCodeOnSave")}</p>}

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
                  {editing && <p className="text-xs text-muted-foreground">{t("accCodeFieldsFixed")}</p>}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="description">{t("accDescription")}</Label>
                  <Input id="description" maxLength={255} value={form.description} disabled={readOnly}
                    onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>

                <div className="grid grid-cols-2 gap-3">
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
                </div>

                <div className="space-y-2">
                  <Label>{t("accBaseUnit")}</Label>
                  <Select value={form.base_uom_id} onValueChange={(v) => setForm({ ...form, base_uom_id: v })}
                    disabled={readOnly || conversions.length > 0}>
                    <SelectTrigger><SelectValue placeholder={t("accSelectUnit")} /></SelectTrigger>
                    <SelectContent>
                      {(readOnly ? uoms : activeUoms).map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>{`${u.code} · ${u.name_en} · ${u.name_ar}`}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {editing && (
                  <div className="flex items-center justify-between">
                    <Label htmlFor="active">{t("accActive")}</Label>
                    <Switch id="active" checked={form.active} disabled={readOnly}
                      onCheckedChange={(v) => setForm({ ...form, active: v })} />
                  </div>
                )}

                {editing && (
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
