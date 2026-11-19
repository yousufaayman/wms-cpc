import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { accessoryPackApi, type AttentionCounts } from "@/lib/api";
import WidgetCard from "../WidgetCard";
import { WidgetProps } from "../types";

/** Item 24 Needs Attention: four counts of things someone has to deal with
    in this warehouse, each a link to the filtered page:
    - packs received but not on a rack yet (Accessory Inventory, waiting for put-away)
    - deliveries that brought more than expected / were closed short
      (Expected Deliveries with that filter; open or closed in the last N days)
    - unconfirmed issues with an over-issue line (Receipts, Internal tab) */
const NeedsAttentionWidget = ({ warehouseId }: WidgetProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [counts, setCounts] = useState<AttentionCounts | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setCounts(null);
    setError(false);
    accessoryPackApi.attention(warehouseId).then(setCounts).catch(() => setError(true));
  }, [warehouseId]);

  const tiles = counts && [
    { key: "unracked", count: counts.unracked_packs, label: t("accInvWaitingPutaway"),
      to: `/accessory-inventory?warehouse=${warehouseId}&tab=packs&rack=unracked` },
    { key: "over", count: counts.over_received, label: t("widgetAttnOverReceived"),
      to: `/expected-deliveries?warehouse=${warehouseId}&flag=over_received` },
    { key: "short", count: counts.closed_short, label: t("widgetAttnClosedShort"),
      to: `/expected-deliveries?warehouse=${warehouseId}&flag=closed_short` },
    { key: "issue", count: counts.over_issue_receipts, label: t("widgetAttnOverIssued"),
      to: `/receipts?warehouse=${warehouseId}` },
  ];

  let body;
  if (error) {
    body = <p className="text-sm text-destructive text-center py-2">{t("widgetLoadFailed")}</p>;
  } else if (!tiles) {
    body = (
      <div className="grid grid-cols-2 2xl:grid-cols-4 gap-2">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  } else {
    body = (
      <div className="space-y-2">
        <div className="grid grid-cols-2 2xl:grid-cols-4 gap-2">
          {tiles.map((tile) => (
            <button
              key={tile.key}
              type="button"
              onClick={() => navigate(tile.to)}
              title={tile.label}
              className={`rounded-md border px-2.5 py-1.5 text-start hover:bg-muted transition-colors ${
                tile.count > 0 ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30" : ""
              }`}
            >
              <div className={`text-lg font-semibold leading-tight ${tile.count > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                {tile.count}
              </div>
              <div className="text-xs text-muted-foreground leading-tight line-clamp-2">{tile.label}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t("widgetAttnRecent", { days: counts.days })}</p>
      </div>
    );
  }

  return (
    <WidgetCard title={t("widgetNeedsAttention")} icon={<AlertTriangle className="h-4 w-4 text-primary" />}>
      {body}
    </WidgetCard>
  );
};

export default NeedsAttentionWidget;
