import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ReceiptText, ChevronRight } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import {
  internalReceiptApi,
  supplierReceiptApi,
  externalReceiptApi,
  logicalLocationApi,
  type LogicalLocation,
  type ReceiptKind,
} from "@/lib/api";
import WidgetCard from "../WidgetCard";
import { WidgetProps } from "../types";

interface OpenReceiptRow {
  kind: ReceiptKind;
  id: number;
  target: string;
  issuedAt: string;
}

const KIND_STYLE: Record<ReceiptKind, string> = {
  internal: "bg-blue-100 text-blue-800 border-blue-300",
  supplier: "bg-purple-100 text-purple-800 border-purple-300",
  external: "bg-gray-100 text-gray-700 border-gray-300",
};

/** Local calendar date (YYYY-MM-DD) of a timestamp string. */
const localDay = (ts: string) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** All open receipts of every kind for the warehouse, oldest first. */
async function loadOpenReceipts(warehouseId: number): Promise<OpenReceiptRow[]> {
  const filters = { warehouse_id: warehouseId, closed: false, limit: 200 };
  const [internal, supplier, external, locations]: [
    Awaited<ReturnType<typeof internalReceiptApi.getAll>>,
    Awaited<ReturnType<typeof supplierReceiptApi.getAll>>,
    Awaited<ReturnType<typeof externalReceiptApi.getAll>>,
    LogicalLocation[],
  ] = await Promise.all([
    internalReceiptApi.getAll(filters),
    supplierReceiptApi.getAll(filters),
    externalReceiptApi.getAll(filters),
    logicalLocationApi.getAll({ limit: 500 }),
  ]);
  const locName = (id: number) => locations.find((l) => l.id === id)?.name ?? `#${id}`;
  const rows: OpenReceiptRow[] = [
    ...internal.map((r) => ({
      kind: "internal" as const,
      id: r.id,
      target: locName(r.target_logical_location_id),
      issuedAt: r.issued_at,
    })),
    ...supplier.map((r) => ({
      kind: "supplier" as const,
      id: r.id,
      target: locName(r.target_logical_location_id),
      issuedAt: r.issued_at,
    })),
    ...external.map((r) => ({
      kind: "external" as const,
      id: r.id,
      target: r.receiver,
      issuedAt: r.issued_at,
    })),
  ];
  // Oldest first so stale (red) receipts surface at the top
  return rows.sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
}

const OpenReceiptsWidget = ({ warehouseId }: WidgetProps) => {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const locale = language === "ar" ? "ar" : "en-US";

  const [rows, setRows] = useState<OpenReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    loadOpenReceipts(warehouseId)
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [warehouseId]);

  const today = useMemo(() => localDay(new Date().toISOString()), []);

  const kindLabel: Record<ReceiptKind, string> = {
    internal: t("receiptTypeInternal"),
    supplier: t("receiptTypeSupplier"),
    external: t("receiptTypeExternal"),
  };

  let body;
  if (loading) {
    body = (
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  } else if (error) {
    body = <p className="text-sm text-destructive py-8 text-center">{t("widgetLoadFailed")}</p>;
  } else if (rows.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground py-8 text-center">{t("widgetNoOpenReceipts")}</p>
    );
  } else {
    body = (
      <div className="space-y-2">
        {rows.map((r) => {
          const stale = localDay(r.issuedAt) !== today;
          return (
            <button
              key={`${r.kind}-${r.id}`}
              type="button"
              onClick={() => navigate(`/receipts/${r.kind}/${r.id}?warehouse=${warehouseId}`)}
              className={`w-full flex items-center gap-3 rounded-md border p-2.5 text-left transition-colors ${
                stale
                  ? "bg-red-50 border-red-300 hover:bg-red-100"
                  : "hover:bg-muted"
              }`}
            >
              <span
                className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${KIND_STYLE[r.kind]}`}
              >
                {kindLabel[r.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium truncate ${stale ? "text-red-800" : ""}`}>
                  #{r.id} — {r.target}
                </div>
                <div className={`text-xs ${stale ? "text-red-600" : "text-muted-foreground"}`}>
                  {new Date(r.issuedAt).toLocaleDateString(locale, {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <WidgetCard
      title={t("widgetOpenReceipts")}
      icon={<ReceiptText className="h-4 w-4 text-primary" />}
      action={
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => navigate(`/receipts?warehouse=${warehouseId}`)}
        >
          {t("widgetViewAll")}
        </Button>
      }
    >
      {body}
    </WidgetCard>
  );
};

export default OpenReceiptsWidget;
