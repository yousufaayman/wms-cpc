import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarDays, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { useTranslation } from "@/hooks/useTranslation";
import { expectedDeliveryApi, type ExpectedDelivery, type ExpectedDeliveryStatus } from "@/lib/api";
import WidgetCard from "../WidgetCard";
import { WidgetProps } from "../types";

const STATUS_STYLE: Record<ExpectedDeliveryStatus, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  partial: "bg-blue-100 text-blue-800 border-blue-300",
  received: "bg-green-100 text-green-800 border-green-300",
  cancelled: "bg-gray-100 text-gray-500 border-gray-300",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Local calendar-date key (YYYY-MM-DD) — string compare works for ordering. */
const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

const todayKey = () => {
  const n = new Date();
  return dayKey(n.getFullYear(), n.getMonth(), n.getDate());
};

const ExpectedDeliveriesCalendarWidget = ({ warehouseId }: WidgetProps) => {
  const navigate = useNavigate();
  const { t, language } = useTranslation();
  const locale = language === "ar" ? "ar" : "en-US";

  const [deliveries, setDeliveries] = useState<ExpectedDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  // Selected dialog target: a YYYY-MM-DD key, or "undated" for the no-date list
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(false);
    expectedDeliveryApi
      .getAll({ warehouse_id: warehouseId, open_only: true, limit: 500 })
      .then(setDeliveries)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [warehouseId]);

  const byDay = useMemo(() => {
    const map = new Map<string, ExpectedDelivery[]>();
    for (const d of deliveries) {
      const key = d.expected_date ? d.expected_date.slice(0, 10) : "undated";
      const list = map.get(key) ?? [];
      list.push(d);
      map.set(key, list);
    }
    return map;
  }, [deliveries]);

  const undated = byDay.get("undated") ?? [];
  const today = todayKey();

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadingBlanks = new Date(year, month, 1).getDay(); // week starts Sunday

  // Jan 1 2023 was a Sunday — stable source for localized weekday names
  const weekdayNames = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) =>
        new Date(2023, 0, i + 1).toLocaleDateString(locale, { weekday: "short" }),
      ),
    [locale],
  );

  const monthLabel = cursor.toLocaleDateString(locale, { month: "long", year: "numeric" });

  const statusLabel: Record<ExpectedDeliveryStatus, string> = {
    pending: t("statusPending"),
    partial: t("statusPartial"),
    received: t("statusReceived"),
    cancelled: t("statusCancelled"),
  };

  const selectedDeliveries = selectedDay ? byDay.get(selectedDay) ?? [] : [];
  const dialogTitle =
    selectedDay === "undated"
      ? t("widgetUndatedDialogTitle")
      : t("widgetDeliveriesOn", {
          date: selectedDay
            ? new Date(`${selectedDay}T00:00:00`).toLocaleDateString(locale, {
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : "",
        });

  const openDelivery = (id: number) =>
    navigate(`/expected-deliveries/${id}?warehouse=${warehouseId}`);

  const renderDayCell = (day: number) => {
    const key = dayKey(year, month, day);
    const dayDeliveries = byDay.get(key) ?? [];
    const hasDeliveries = dayDeliveries.length > 0;
    const isOverdue = hasDeliveries && key < today;
    const isToday = key === today;

    let cellStyle = "text-foreground hover:bg-muted";
    if (hasDeliveries) {
      cellStyle = isOverdue
        ? "bg-red-100 text-red-800 border border-red-300 hover:bg-red-200"
        : "bg-green-100 text-green-800 border border-green-300 hover:bg-green-200";
    }

    return (
      <button
        key={key}
        type="button"
        disabled={!hasDeliveries}
        onClick={() => setSelectedDay(key)}
        className={`relative min-h-0 rounded-md text-xs flex items-center justify-center transition-colors disabled:cursor-default disabled:hover:bg-transparent ${cellStyle} ${isToday ? "ring-2 ring-primary" : ""}`}
      >
        {day}
        {hasDeliveries && (
          <span
            className={`absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 rounded-full text-[9px] font-semibold flex items-center justify-center ${isOverdue ? "bg-red-600 text-white" : "bg-green-600 text-white"}`}
          >
            {dayDeliveries.length}
          </span>
        )}
      </button>
    );
  };

  let body;
  if (loading) {
    body = (
      <div className="h-full flex flex-col gap-2">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="flex-1 w-full" />
      </div>
    );
  } else if (error) {
    body = <p className="text-sm text-destructive py-8 text-center">{t("widgetLoadFailed")}</p>;
  } else {
    const weekRows = Math.ceil((leadingBlanks + daysInMonth) / 7);
    body = (
      <div className="h-full flex flex-col gap-2">
        {/* Month navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setCursor(new Date(year, month - 1, 1))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium">{monthLabel}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setCursor(new Date(year, month + 1, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Weekday header */}
        <div className="grid grid-cols-7 gap-1">
          {weekdayNames.map((name) => (
            <div key={name} className="text-center text-xs text-muted-foreground font-medium">
              {name}
            </div>
          ))}
        </div>

        {/* Day grid — stretches to fill the widget's remaining height */}
        <div
          className="flex-1 min-h-0 grid grid-cols-7 gap-1"
          style={{ gridTemplateRows: `repeat(${weekRows}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => renderDayCell(i + 1))}
        </div>

        {/* Legend + undated deliveries */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 inline-block" />
              {t("widgetOverdue")}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-green-500 inline-block" />
              {t("widgetUpcoming")}
            </span>
          </div>
          {undated.length > 0 && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => setSelectedDay("undated")}
            >
              {t("widgetUndatedDeliveries", { count: undated.length })}
            </Button>
          )}
        </div>

        {deliveries.length === 0 && (
          <p className="text-sm text-muted-foreground text-center">{t("widgetNoOpenDeliveries")}</p>
        )}
      </div>
    );
  }

  return (
    <WidgetCard
      title={t("widgetExpectedDeliveriesCalendar")}
      icon={<CalendarDays className="h-4 w-4 text-primary" />}
    >
      {body}

      {/* Day detail dialog */}
      <Dialog open={selectedDay !== null} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {selectedDeliveries.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => openDelivery(d.id)}
                className="w-full flex items-center justify-between gap-2 rounded-md border p-3 text-left hover:bg-muted transition-colors"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    #{d.id} — {d.supplier_name ?? t("unknown")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("widgetItemCount", { count: d.items.length })}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[d.status]}`}
                  >
                    {statusLabel[d.status]}
                  </span>
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </WidgetCard>
  );
};

export default ExpectedDeliveriesCalendarWidget;
