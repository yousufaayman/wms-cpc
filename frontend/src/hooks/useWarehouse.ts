import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { warehouseApi, type Warehouse } from "@/lib/api";
import { moduleEnabled, type WarehouseModule } from "@/lib/warehouseModules";
import { useFeatures } from "./useFeatures";

interface UseWarehouseResult {
  /** From the page's ?warehouse= parameter; null when there is none. */
  warehouseId: number | null;
  warehouse: Warehouse | null;
  loading: boolean;
  /** Does this warehouse have `module` (its type has it and its feature flag is on)? */
  has: (module: WarehouseModule) => boolean;
}

/** The warehouse the user is working in, and which modules it offers.
    The warehouse is fetched once and shared by every component on the page. */
export function useWarehouse(): UseWarehouseResult {
  const [searchParams] = useSearchParams();
  const param = searchParams.get("warehouse");
  const warehouseId = param && /^\d+$/.test(param) ? Number(param) : null;
  const features = useFeatures();

  const { data, isLoading } = useQuery({
    queryKey: ["warehouse", warehouseId],
    queryFn: () => warehouseApi.getById(warehouseId!),
    enabled: warehouseId !== null,
    staleTime: 5 * 60_000,
  });

  const warehouse = data ?? null;
  return {
    warehouseId,
    warehouse,
    loading: (warehouseId !== null && isLoading) || features.loading,
    has: (module) => moduleEnabled(warehouse?.type, module, features),
  };
}
