import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, ChevronRight } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { materialRequestApi, type MaterialRequest } from "@/lib/api";
import WidgetCard from "../WidgetCard";
import { WidgetProps } from "../types";

const TOP_N = 10;

const fmtQty = (value: number | null | undefined) =>
  value == null ? "—" : Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 });

const MaterialRequestsWidget = ({ warehouseId }: WidgetProps) => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    // Server returns requests ordered by job order priority (most urgent
    // first), so the first N unfulfilled rows are the top N.
    materialRequestApi
      .getAll({ fulfilled: false, limit: TOP_N })
      .then(setRequests)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  // Lands on the Material Requests page with the issue-receipt dialog open
  // for this request — the path into the receipt create/scan view.
  const openRequest = (id: number) =>
    navigate(`/material-requests?warehouse=${warehouseId}&fulfill=${id}`);

  let body;
  if (loading) {
    body = (
      <div className="space-y-2">
        {Array.from({ length: TOP_N }, (_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  } else if (error) {
    body = <p className="text-sm text-destructive py-8 text-center">{t("widgetLoadFailed")}</p>;
  } else if (requests.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground py-8 text-center">
        {t("widgetNoUnfulfilledRequests")}
      </p>
    );
  } else {
    body = (
      <div className="space-y-2">
        {requests.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => openRequest(r.id)}
            className="w-full flex items-center gap-3 rounded-md border p-2.5 text-left hover:bg-muted transition-colors"
          >
            <span className="shrink-0 h-8 w-8 rounded-full bg-primary/10 text-primary text-sm font-semibold flex items-center justify-center font-mono">
              {r.job_order?.priority ?? "—"}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                {r.job_order?.job_order_number ?? `#${r.job_order_id}`}
                {r.fabric_code?.color?.name && ` · ${r.fabric_code.color.name}`}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                <span className="font-mono">{r.fabric_code?.fabric_code ?? "—"}</span>
                {` · ${r.panel_type}`}
                {r.quantity != null && ` · ${fmtQty(r.quantity)} ${r.measurement_scale}`}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <WidgetCard
      title={t("widgetTopMaterialRequests")}
      icon={<ClipboardList className="h-4 w-4 text-primary" />}
      action={
        <Button
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={() => navigate(`/material-requests?warehouse=${warehouseId}`)}
        >
          {t("widgetViewAll")}
        </Button>
      }
    >
      {body}
    </WidgetCard>
  );
};

export default MaterialRequestsWidget;
