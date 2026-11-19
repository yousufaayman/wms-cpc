import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronRight, PackageX } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { accessoryRequirementApi, type AccessoryShortage } from "@/lib/api";
import WidgetCard from "../WidgetCard";
import { WidgetProps } from "../types";

const TOP_N = 10;

const fmtQty = (value: string | number) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 4 });

/** Item 24 Shortages: the items where open job orders still need more than
    this warehouse holds, biggest shortage first (the item-20 shortage report,
    top 10). Clicking goes to Material Requests → Shortages. */
const ShortagesWidget = ({ warehouseId }: WidgetProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AccessoryShortage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    accessoryRequirementApi.shortages(warehouseId)
      .then((all) => setRows(all.slice(0, TOP_N)))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [warehouseId]);

  const openReport = () => navigate(`/material-requests?warehouse=${warehouseId}&tab=shortages`);

  let body;
  if (loading) {
    body = (
      <div className="space-y-2">
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  } else if (error) {
    body = <p className="text-sm text-destructive py-8 text-center">{t("widgetLoadFailed")}</p>;
  } else if (rows.length === 0) {
    body = <p className="text-sm text-muted-foreground py-8 text-center">{t("accShortageNone")}</p>;
  } else {
    body = (
      <div className="space-y-2">
        {rows.map((r) => (
          <button
            key={r.accessory_item_id}
            type="button"
            onClick={openReport}
            className="w-full flex items-center gap-3 rounded-md border p-2.5 text-left hover:bg-muted transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">
                <span className="font-mono">{r.item_code}</span> · {r.item_description}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {t("widgetJobOrdersCount", { count: r.job_orders })}
                {" · "}{t("accInvOnHand")}: {fmtQty(r.on_hand)} {r.uom_code}
              </div>
            </div>
            <span className="text-sm font-semibold text-destructive shrink-0">
              {t("widgetShortBy", { qty: fmtQty(r.short), unit: r.uom_code })}
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <WidgetCard
      title={t("widgetShortages")}
      icon={<PackageX className="h-4 w-4 text-primary" />}
      action={
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={openReport}>
          {t("widgetViewAll")}
        </Button>
      }
    >
      {body}
    </WidgetCard>
  );
};

export default ShortagesWidget;
