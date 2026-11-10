/**
 * Units & Categories (item 7): the lists accessory items are built from.
 *
 * Three tabs, each a table with an add/edit dialog:
 *  - Units: PCS, M, CONE... with the Arabic name printed on pack labels.
 *  - Conversions: 1 DOZ = 12 PCS. One row per pair, it works both ways.
 *  - Categories: trim types (BTN, ZIP...) with a default unit and whether new
 *    items in it are client-specific by default (both only pre-fill the item form).
 * Codes can't be changed once created (category codes are part of item codes),
 * and units/categories are switched off rather than deleted.
 * Needs `manage_accessory_items`; Accessory warehouses only (module accessory_items).
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Pencil, Plus, Trash2 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import {
  accessoryCategoryApi, uomApi,
  type AccessoryCategory, type Uom, type UomConversion,
} from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/hooks/useTranslation";

const UOM_CODE = /^[A-Z0-9]{1,10}$/;
const CATEGORY_CODE = /^[A-Z]{2,5}$/;

type Dialogs =
  | { kind: "uom"; editing: Uom | null }
  | { kind: "conversion"; editing: UomConversion | null }
  | { kind: "category"; editing: AccessoryCategory | null }
  | null;

const ActiveBadge = ({ active, t }: { active: boolean; t: ReturnType<typeof useTranslation>["t"] }) => (
  <Badge variant={active ? "outline" : "secondary"}>{active ? t("accActive") : t("accInactive")}</Badge>
);

const AccessorySetup = () => {
  const { t } = useTranslation();
  const { toast } = useToast();

  const [uoms, setUoms] = useState<Uom[]>([]);
  const [conversions, setConversions] = useState<UomConversion[]>([]);
  const [categories, setCategories] = useState<AccessoryCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [saving, setSaving] = useState(false);

  // One form object for whichever dialog is open.
  const [form, setForm] = useState({
    code: "", name_en: "", name_ar: "", allows_decimals: false, active: true,
    from_uom_id: "", to_uom_id: "", factor: "",
    default_uom_id: "", default_client_specific: false,
  });

  const uomById = useMemo(() => new Map(uoms.map((u) => [u.id, u])), [uoms]);
  const activeUoms = uoms.filter((u) => u.active);
  const uomLabel = (id: number) => {
    const u = uomById.get(id);
    return u ? `${u.code} · ${u.name_ar}` : `#${id}`;
  };

  const fail = (error: unknown) =>
    toast({
      title: t("error"),
      description: error instanceof Error ? error.message : t("accSaveFailed"),
      variant: "destructive",
    });

  const load = async () => {
    try {
      setLoading(true);
      const [u, c, cats] = await Promise.all([uomApi.getAll(), uomApi.getConversions(), accessoryCategoryApi.getAll()]);
      setUoms(u);
      setConversions(c);
      setCategories(cats);
    } catch (error) {
      fail(error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = (next: NonNullable<Dialogs>) => {
    const blank = {
      code: "", name_en: "", name_ar: "", allows_decimals: false, active: true,
      from_uom_id: "", to_uom_id: "", factor: "", default_uom_id: "", default_client_specific: false,
    };
    const e = next.editing;
    if (next.kind === "uom" && e) {
      const u = e as Uom;
      setForm({ ...blank, code: u.code, name_en: u.name_en, name_ar: u.name_ar, allows_decimals: u.allows_decimals, active: u.active });
    } else if (next.kind === "conversion" && e) {
      const c = e as UomConversion;
      setForm({ ...blank, from_uom_id: String(c.from_uom_id), to_uom_id: String(c.to_uom_id), factor: String(c.factor) });
    } else if (next.kind === "category" && e) {
      const c = e as AccessoryCategory;
      setForm({
        ...blank, code: c.code, name_en: c.name_en, name_ar: c.name_ar, active: c.active,
        default_uom_id: String(c.default_uom_id), default_client_specific: c.default_client_specific,
      });
    } else {
      setForm(blank);
    }
    setDialog(next);
  };

  /** Checks the form; returns an error message key or null. */
  const invalid = (): Parameters<typeof t>[0] | null => {
    if (!dialog) return null;
    if (dialog.kind === "conversion") {
      const f = Number(form.factor);
      if (!form.from_uom_id || !form.to_uom_id) return "accPickBothUnits";
      if (form.from_uom_id === form.to_uom_id) return "accSameUnit";
      if (!(f > 0)) return "accFactorPositive";
      return null;
    }
    if (!form.name_en.trim() || !form.name_ar.trim()) return "accNamesRequired";
    if (!dialog.editing) {
      const pattern = dialog.kind === "uom" ? UOM_CODE : CATEGORY_CODE;
      if (!pattern.test(form.code.trim().toUpperCase()))
        return dialog.kind === "uom" ? "accUnitCodeRule" : "accCategoryCodeRule";
    }
    if (dialog.kind === "category" && !form.default_uom_id) return "accPickDefaultUnit";
    return null;
  };

  const save = async () => {
    if (!dialog) return;
    const problem = invalid();
    if (problem) {
      toast({ title: t("error"), description: t(problem), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const names = { name_en: form.name_en.trim(), name_ar: form.name_ar.trim() };
      if (dialog.kind === "uom") {
        if (dialog.editing) await uomApi.update(dialog.editing.id, { ...names, allows_decimals: form.allows_decimals, active: form.active });
        else await uomApi.create({ ...names, code: form.code.trim().toUpperCase(), allows_decimals: form.allows_decimals });
      } else if (dialog.kind === "conversion") {
        if (dialog.editing) await uomApi.updateConversion(dialog.editing.id, Number(form.factor));
        else await uomApi.createConversion({
          from_uom_id: Number(form.from_uom_id), to_uom_id: Number(form.to_uom_id), factor: Number(form.factor),
        });
      } else {
        const common = { ...names, default_uom_id: Number(form.default_uom_id), default_client_specific: form.default_client_specific };
        if (dialog.editing) await accessoryCategoryApi.update(dialog.editing.id, { ...common, active: form.active });
        else await accessoryCategoryApi.create({ ...common, code: form.code.trim().toUpperCase() });
      }
      toast({ title: t("success"), description: t("accSaved") });
      setDialog(null);
      load();
    } catch (error) {
      fail(error);
    } finally {
      setSaving(false);
    }
  };

  const removeConversion = async (c: UomConversion) => {
    try {
      await uomApi.deleteConversion(c.id);
      toast({ title: t("success"), description: t("accConversionDeleted") });
      load();
    } catch (error) {
      fail(error);
    }
  };

  const conversionText = (c: { from_uom_id: number; to_uom_id: number; factor: number }) =>
    `1 ${uomById.get(c.from_uom_id)?.code ?? "?"} = ${c.factor} ${uomById.get(c.to_uom_id)?.code ?? "?"}`;

  const editButton = (onClick: () => void) => (
    <Button variant="outline" size="sm" onClick={onClick} title={t("accEdit")}>
      <Pencil className="h-4 w-4" />
    </Button>
  );

  const uomSelect = (value: string, onChange: (v: string) => void, disabled = false) => (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger><SelectValue placeholder={t("accSelectUnit")} /></SelectTrigger>
      <SelectContent>
        {(disabled ? uoms : activeUoms).map((u) => (
          <SelectItem key={u.id} value={String(u.id)}>{`${u.code} · ${u.name_en} · ${u.name_ar}`}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const editing = dialog?.editing != null;
  const dialogTitle = !dialog ? "" : t(
    dialog.kind === "uom" ? (editing ? "accEditUnit" : "accAddUnit")
      : dialog.kind === "conversion" ? (editing ? "accEditConversion" : "accAddConversion")
      : (editing ? "accEditCategory" : "accAddCategory"),
  );

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-8">
          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t("unitsAndCategories")}</h1>
              <p className="text-muted-foreground">{t("unitsAndCategoriesDesc")}</p>
            </div>

            {loading ? (
              <div className="text-center py-8">{t("loading")}</div>
            ) : (
              <Tabs defaultValue="categories">
                <TabsList>
                  <TabsTrigger value="categories">{t("accCategoriesTab")}</TabsTrigger>
                  <TabsTrigger value="units">{t("accUnitsTab")}</TabsTrigger>
                  <TabsTrigger value="conversions">{t("accConversionsTab")}</TabsTrigger>
                </TabsList>

                {/* Categories */}
                <TabsContent value="categories">
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      <Button onClick={() => open({ kind: "category", editing: null })}>
                        <Plus className="mr-2 h-4 w-4" />{t("accAddCategory")}
                      </Button>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("accCode")}</TableHead>
                            <TableHead>{t("accNameEn")}</TableHead>
                            <TableHead>{t("accNameAr")}</TableHead>
                            <TableHead>{t("accDefaultUnit")}</TableHead>
                            <TableHead>{t("accClientSpecific")}</TableHead>
                            <TableHead>{t("accStatus")}</TableHead>
                            <TableHead className="text-right">{t("actions")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {categories.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-mono font-medium">{c.code}</TableCell>
                              <TableCell>{c.name_en}</TableCell>
                              <TableCell dir="rtl">{c.name_ar}</TableCell>
                              <TableCell>{uomLabel(c.default_uom_id)}</TableCell>
                              <TableCell>{c.default_client_specific ? t("accYes") : t("accNo")}</TableCell>
                              <TableCell><ActiveBadge active={c.active} t={t} /></TableCell>
                              <TableCell className="text-right">{editButton(() => open({ kind: "category", editing: c }))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Units */}
                <TabsContent value="units">
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      <Button onClick={() => open({ kind: "uom", editing: null })}>
                        <Plus className="mr-2 h-4 w-4" />{t("accAddUnit")}
                      </Button>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t("accCode")}</TableHead>
                            <TableHead>{t("accNameEn")}</TableHead>
                            <TableHead>{t("accNameAr")}</TableHead>
                            <TableHead>{t("accAllowsDecimals")}</TableHead>
                            <TableHead>{t("accStatus")}</TableHead>
                            <TableHead className="text-right">{t("actions")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {uoms.map((u) => (
                            <TableRow key={u.id}>
                              <TableCell className="font-mono font-medium">{u.code}</TableCell>
                              <TableCell>{u.name_en}</TableCell>
                              <TableCell dir="rtl">{u.name_ar}</TableCell>
                              <TableCell>{u.allows_decimals ? t("accYes") : t("accNo")}</TableCell>
                              <TableCell><ActiveBadge active={u.active} t={t} /></TableCell>
                              <TableCell className="text-right">{editButton(() => open({ kind: "uom", editing: u }))}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Conversions */}
                <TabsContent value="conversions">
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      <p className="text-sm text-muted-foreground">{t("accConversionHint")}</p>
                      <Button onClick={() => open({ kind: "conversion", editing: null })}>
                        <Plus className="mr-2 h-4 w-4" />{t("accAddConversion")}
                      </Button>
                      {conversions.length === 0 ? (
                        <div className="text-center py-6 text-muted-foreground">{t("accNoConversions")}</div>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("accConversion")}</TableHead>
                              <TableHead className="text-right">{t("actions")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {conversions.map((c) => (
                              <TableRow key={c.id}>
                                <TableCell className="font-mono" dir="ltr">{conversionText(c)}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    {editButton(() => open({ kind: "conversion", editing: c }))}
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="outline" size="sm" title={t("delete")}><Trash2 className="h-4 w-4" /></Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>{t("accDeleteConversion")}</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            {t("accConfirmDeleteConversion", { conversion: conversionText(c) })}
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => removeConversion(c)}>{t("delete")}</AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            )}
          </div>

          <Dialog open={dialog != null} onOpenChange={(o) => !o && setDialog(null)}>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>{dialogTitle}</DialogTitle></DialogHeader>
              <div className="space-y-4">
                {dialog?.kind === "conversion" ? (
                  <>
                    <div className="space-y-2">
                      <Label>{t("accFromUnit")}</Label>
                      {uomSelect(form.from_uom_id, (v) => setForm({ ...form, from_uom_id: v }), editing)}
                    </div>
                    <div className="space-y-2">
                      <Label>{t("accToUnit")}</Label>
                      {uomSelect(form.to_uom_id, (v) => setForm({ ...form, to_uom_id: v }), editing)}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="factor">{t("accFactor")}</Label>
                      <Input id="factor" type="number" min="0" step="any" value={form.factor}
                        onChange={(e) => setForm({ ...form, factor: e.target.value })} />
                      {form.from_uom_id && form.to_uom_id && Number(form.factor) > 0 && (
                        <p className="text-sm text-muted-foreground font-mono" dir="ltr">
                          {conversionText({ from_uom_id: Number(form.from_uom_id), to_uom_id: Number(form.to_uom_id), factor: Number(form.factor) })}
                        </p>
                      )}
                    </div>
                  </>
                ) : dialog ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="code">{t("accCode")}</Label>
                      <Input id="code" className="font-mono uppercase" value={form.code} disabled={editing}
                        maxLength={dialog.kind === "uom" ? 10 : 5}
                        onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
                      <p className="text-xs text-muted-foreground">
                        {t(dialog.kind === "uom" ? "accUnitCodeRule" : "accCategoryCodeRule")}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="name_en">{t("accNameEn")}</Label>
                      <Input id="name_en" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="name_ar">{t("accNameAr")}</Label>
                      <Input id="name_ar" dir="rtl" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
                    </div>
                    {dialog.kind === "uom" ? (
                      <div className="flex items-center justify-between">
                        <Label htmlFor="decimals">{t("accAllowsDecimals")}</Label>
                        <Switch id="decimals" checked={form.allows_decimals}
                          onCheckedChange={(v) => setForm({ ...form, allows_decimals: v })} />
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <Label>{t("accDefaultUnit")}</Label>
                          {uomSelect(form.default_uom_id, (v) => setForm({ ...form, default_uom_id: v }))}
                        </div>
                        <div className="flex items-center justify-between">
                          <Label htmlFor="client_specific">{t("accClientSpecificDefault")}</Label>
                          <Switch id="client_specific" checked={form.default_client_specific}
                            onCheckedChange={(v) => setForm({ ...form, default_client_specific: v })} />
                        </div>
                      </>
                    )}
                    {editing && (
                      <div className="flex items-center justify-between">
                        <Label htmlFor="active">{t("accActive")}</Label>
                        <Switch id="active" checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
                      </div>
                    )}
                  </>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setDialog(null)}>{t("cancel")}</Button>
                  <Button onClick={save} disabled={saving}>{editing ? t("saveChanges") : t("create")}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </main>
      </div>
    </PageTransition>
  );
};

export default AccessorySetup;
