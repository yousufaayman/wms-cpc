/**
 * Import items from Excel (item 35), opened from the Items page by people with
 * `manage_accessory_items`.
 *
 * 1. Download the blank sheet (in the screen's language; dropdowns come from
 *    the live categories, clients, units and suppliers).
 * 2. Upload the filled sheet: the server checks every row and saves nothing.
 *    Each row shows its errors (red, they block the import) and warnings
 *    (amber, e.g. "looks like an existing item", allowed).
 * 3. Create: only when no row has an error. The server checks the same file
 *    again and creates every row or none; the system makes the codes.
 * 4. Download the sheet back with the new item codes.
 *
 * Rules: `backend/crud/accessory_item_import.py`.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Loader2, Upload, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  accessoryItemApi,
  type ImportColumn,
  type ItemImportCreated,
  type ItemImportMessage,
  type ItemImportPreview,
} from "@/lib/api";
import type { TranslationKey } from "@/lib/translations";
import { useTranslation } from "@/hooks/useTranslation";

const COLUMN_LABEL: Record<ImportColumn, TranslationKey> = {
  category: "accCategory",
  client: "client",
  base_unit: "accBaseUnit",
  description: "accDescription",
  color: "color",
  size: "accSize",
  ref_owner: "accImportRefOwner",
  ref_code: "accRefCode",
  ref_description: "accRefDescription",
};

/** Server answers for a bad file (HTTP 400 detail) → the sentence to show. */
const FILE_ERRORS: Record<string, TranslationKey> = {
  not_import_sheet: "accImportNotSheet",
  no_rows: "accImportNoRows",
  too_many_rows: "accImportTooManyRows",
  too_big: "accImportTooBig",
  has_errors: "accImportHasErrors",
};

export function ItemImportDialog({ open, onOpenChange, onCreated }: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}>) {
  const { t, language } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ItemImportPreview | null>(null);
  const [created, setCreated] = useState<ItemImportCreated[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) { setFile(null); setPreview(null); setCreated(null); }
  }, [open]);

  const errorText = (e: unknown) => {
    const message = e instanceof Error ? e.message : "";
    return FILE_ERRORS[message] ? t(FILE_ERRORS[message]) : message || t("error");
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const message = (m: ItemImportMessage): string => {
    const field = m.field ? t(COLUMN_LABEL[m.field]) : "";
    switch (m.code) {
      case "required": return t("accImportRequired", { field });
      case "too_long": return t("accImportTooLong", { field, max: m.max });
      case "unknown": return t("accImportUnknown", { field, value: m.value });
      case "switched_off": return t("accImportSwitchedOff", { field, value: m.value });
      case "no_client_code": return t("accImportNoClientCode", { value: m.value });
      case "other_client": return t("accRefOwnClientOnly");
      case "ref_taken": return t("accRefTaken", { code: m.item_code });
      case "ref_twice": return t("accImportRefTwice", { row: m.row });
      case "similar_item": return t("accImportLooksLikeItem", { code: m.item_code });
      case "similar_row": return t("accImportLooksLikeRow", { row: m.row });
    }
  };

  const pickFile = (f: File | null) => { setFile(f); setPreview(null); setCreated(null); };

  const check = () => run(async () => {
    if (file) setPreview(await accessoryItemApi.previewImport(file));
  });

  const create = () => run(async () => {
    if (!file) return;
    const result = await accessoryItemApi.confirmImport(file);
    setCreated(result);
    toast.success(t("accImportCreated", { n: result.length }));
    onCreated();
  });

  const codeByRow = new Map((created ?? []).map((c) => [c.row, c.code]));
  const canCreate = !!preview && preview.error_count === 0 && !created;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("accImportExcel")}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t("accImportIntro")}</p>

          <div className="flex flex-col md:flex-row md:items-end gap-3">
            <Button variant="outline" disabled={busy}
              onClick={() => run(() => accessoryItemApi.downloadImportTemplate(language))}>
              <Download className="me-2 h-4 w-4" />{t("accImportDownloadBlank")}
            </Button>
            <div className="flex-1 min-w-0 space-y-1">
              <Label htmlFor="item-import-file">{t("accImportUpload")}</Label>
              <Input id="item-import-file" type="file" accept=".xlsx"
                onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
            </div>
            <Button onClick={check} disabled={!file || busy}>
              {busy && !preview ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : <Upload className="me-2 h-4 w-4" />}
              {t("accImportCheck")}
            </Button>
          </div>

          {preview && (
            <>
              <div className="flex flex-wrap gap-4 text-sm">
                <span className="flex items-center gap-1 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />{t("accImportRowsReady", { n: preview.ok_count })}
                </span>
                {preview.error_count > 0 && (
                  <span className="flex items-center gap-1 text-destructive">
                    <XCircle className="h-4 w-4" />{t("accImportRowsWithErrors", { n: preview.error_count })}
                  </span>
                )}
              </div>

              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">{t("accImportRow")}</TableHead>
                      {created && <TableHead>{t("accItemCode")}</TableHead>}
                      <TableHead>{t("accCategory")}</TableHead>
                      <TableHead>{t("client")}</TableHead>
                      <TableHead>{t("accDescription")}</TableHead>
                      <TableHead>{t("color")} / {t("accSize")}</TableHead>
                      <TableHead>{t("accRefCode")}</TableHead>
                      <TableHead className="min-w-56" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((r) => (
                      <TableRow key={r.row} className={r.errors.length ? "bg-destructive/5" : undefined}>
                        <TableCell>{r.row}</TableCell>
                        {created && <TableCell className="font-mono font-semibold">{codeByRow.get(r.row)}</TableCell>}
                        <TableCell>{r.values.category}</TableCell>
                        <TableCell>{r.values.client || t("accGeneric")}</TableCell>
                        <TableCell className="max-w-64 truncate" title={r.values.description ?? ""}>{r.values.description}</TableCell>
                        <TableCell>{[r.values.color, r.values.size].filter(Boolean).join(" / ")}</TableCell>
                        <TableCell className="font-mono">{r.values.ref_code}</TableCell>
                        <TableCell className="text-xs space-y-1">
                          {r.errors.map((m, i) => (
                            <div key={`e${i}`} className="flex items-start gap-1 text-destructive">
                              <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{message(m)}
                            </div>
                          ))}
                          {r.warnings.map((m, i) => (
                            <div key={`w${i}`} className="flex items-start gap-1 text-amber-600 dark:text-amber-400">
                              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{message(m)}
                            </div>
                          ))}
                          {!r.errors.length && !r.warnings.length && (
                            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{created ? t("accImportClose") : t("cancel")}</Button>
            {created ? (
              <Button disabled={busy}
                onClick={() => run(() => accessoryItemApi.downloadImportResult(created.map((c) => c.id), language))}>
                <Download className="me-2 h-4 w-4" />{t("accImportDownloadResult")}
              </Button>
            ) : (
              <Button onClick={create} disabled={!canCreate || busy}>
                {busy && preview ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
                {t("accImportCreate", { n: preview?.ok_count ?? 0 })}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
