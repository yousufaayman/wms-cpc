import { Navigate, useNavigate } from "react-router-dom";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import LoadingSpinner from "./LoadingSpinner";
import { useWarehouse } from "@/hooks/useWarehouse";
import { useTranslation } from "@/hooks/useTranslation";
import type { WarehouseModule } from "@/lib/warehouseModules";

/** Gates a route by warehouse type: the page opens only if the warehouse in
 * ?warehouse= has `module` (see lib/warehouseModules.ts). With no warehouse
 * the user is sent to pick one. Otherwise it shows a "not available here"
 * message, never a redirect, so it can't loop with RequirePermission. */
const RequireModule = ({ module, children }: { module: WarehouseModule; children: React.ReactNode }) => {
  const { warehouseId, warehouse, loading, has } = useWarehouse();
  const { t } = useTranslation();
  const navigate = useNavigate();

  if (warehouseId === null) return <Navigate to="/warehouses" replace />;
  if (loading) return <LoadingSpinner message={t("checkingAccess")} />;
  if (warehouse && has(module)) return <>{children}</>;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <Ban className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-xl font-semibold">{t("moduleNotAvailableTitle")}</h1>
      <p className="text-muted-foreground max-w-md">
        {warehouse ? t("moduleNotAvailableInWarehouse", { name: warehouse.name }) : t("errorLoadingWarehouses")}
      </p>
      <Button onClick={() => navigate("/warehouses")}>{t("backToWarehouses")}</Button>
    </div>
  );
};

export default RequireModule;
