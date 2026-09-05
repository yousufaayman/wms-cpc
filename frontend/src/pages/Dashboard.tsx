import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/hooks/useTranslation";
import { useLanguage } from "@/contexts/LanguageContext";
import { warehouseApi, Warehouse } from "@/lib/api";
import { widgetRegistry } from "@/widgets/registry";
import { WidgetSize } from "@/widgets/types";

// Grid span per widget size hint; the grid is 1 col on mobile, 2 on lg
const SIZE_CLASS: Record<WidgetSize, string> = {
  sm: "",
  md: "",
  lg: "lg:col-span-2",
  full: "lg:col-span-2",
};

const Dashboard = () => {
  const [searchParams] = useSearchParams();
  const warehouseId = searchParams.get("warehouse");
  const { t } = useTranslation();
  useLanguage();

  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!warehouseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    warehouseApi
      .getById(parseInt(warehouseId))
      .then(setWarehouse)
      .catch(() => setWarehouse(null))
      .finally(() => setLoading(false));
  }, [warehouseId]);

  const widgets = warehouse ? widgetRegistry[warehouse.type] : [];

  let content;
  if (loading) {
    content = (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  } else if (!warehouse) {
    content = (
      <p className="text-muted-foreground text-center py-24">{t("errorLoadingWarehouses")}</p>
    );
  } else if (widgets.length === 0) {
    content = <p className="text-muted-foreground text-center py-24">{t("noWidgetsYet")}</p>;
  } else {
    content = (
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 lg:grid-rows-7 gap-4">
        {widgets.map(({ id, component: Widget, size, gridClass }) => (
          <div key={id} className={`${gridClass ?? SIZE_CLASS[size]} min-h-0`}>
            <Suspense fallback={<Skeleton className="h-full min-h-40 w-full rounded-lg" />}>
              <Widget warehouseId={warehouse.id} warehouseType={warehouse.type} />
            </Suspense>
          </div>
        ))}
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex">
        <Sidebar />
        <main className="flex-1 p-6 flex flex-col lg:h-screen lg:overflow-hidden">
          <h1 className="text-2xl font-bold mb-4">{t("dashboard")}</h1>
          {content}
        </main>
      </div>
    </PageTransition>
  );
};

export default Dashboard;
