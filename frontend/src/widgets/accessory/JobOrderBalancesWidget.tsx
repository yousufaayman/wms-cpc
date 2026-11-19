import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { accessoryRequirementApi, type OpenJobOrder } from "@/lib/api";
import WidgetCard from "../WidgetCard";
import { WidgetProps } from "../types";

const TOP_N = 10;

/** Item 24 Job Order Balances: the most urgent open job orders (priority,
    like the fabric Material Requests widget) that still have accessory lines
    to issue. A row opens that JO's requirement lines on Material Requests;
    Issue opens a new issue for it there (people who may issue only). */
const JobOrderBalancesWidget = ({ warehouseId }: WidgetProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { can } = useCurrentUser();
  const canIssue = can("issue_accessories") && can("create_receipts");
  const [rows, setRows] = useState<OpenJobOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(false);
    accessoryRequirementApi.openJobOrders(warehouseId, TOP_N)
      .then(setRows)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [warehouseId]);

  const base = `/material-requests?warehouse=${warehouseId}`;
  const openLines = (jo: OpenJobOrder) => navigate(`${base}&search=${encodeURIComponent(jo.job_order_number)}`);
  const issue = (jo: OpenJobOrder) =>
    navigate(`${base}&search=${encodeURIComponent(jo.job_order_number)}&issue=${jo.job_order_id}&jo=${encodeURIComponent(jo.job_order_number)}`);

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
    body = <p className="text-sm text-muted-foreground py-8 text-center">{t("widgetNoOpenJobOrders")}</p>;
  } else {
    body = (
      <div className="space-y-2">
        {rows.map((jo) => (
          <div key={jo.job_order_id} className="flex items-center gap-2 rounded-md border p-2.5 hover:bg-muted transition-colors">
            <button type="button" onClick={() => openLines(jo)} className="min-w-0 flex-1 flex items-center gap-3 text-left">
              <span className="shrink-0 h-8 w-8 rounded-full bg-primary/10 text-primary text-sm font-semibold flex items-center justify-center font-mono">
                {jo.priority ?? "—"}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {jo.job_order_number}
                  {jo.client_name && <span className="text-muted-foreground"> · {jo.client_name}</span>}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                  {t("widgetLinesToIssue", { open: jo.lines_to_issue, total: jo.lines })}
                  {jo.lines_over_issued > 0 && (
                    <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                      {t("accReqOver")}: {jo.lines_over_issued}
                    </Badge>
                  )}
                </div>
              </div>
            </button>
            {canIssue && (
              <Button size="sm" variant="outline" onClick={() => issue(jo)}>
                {t("accIssueAction")}
              </Button>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <WidgetCard
      title={t("widgetJoBalances")}
      icon={<ClipboardList className="h-4 w-4 text-primary" />}
      action={
        <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(base)}>
          {t("widgetViewAll")}
        </Button>
      }
    >
      {body}
    </WidgetCard>
  );
};

export default JobOrderBalancesWidget;
