import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Permission } from "@/lib/permissions";
import LoadingSpinner from "./LoadingSpinner";

interface RequirePermissionProps {
  permission: Permission;
  children: React.ReactNode;
}

/** Gates a route on a permission; redirects to this role's home page (its
 * warehouse context preserved) if the current user lacks it. Viewer has no
 * access to /dashboard, so its home is /receipts instead. */
const RequirePermission = ({ permission, children }: RequirePermissionProps) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { role, can, loading } = useCurrentUser();

  const warehouseId = searchParams.get("warehouse");
  const homePath = role === "Viewer" ? "/receipts" : "/dashboard";
  const redirectTo = warehouseId ? `${homePath}?warehouse=${warehouseId}` : "/warehouses";

  const allowed = can(permission);

  useEffect(() => {
    if (!loading && !allowed) {
      navigate(redirectTo, { replace: true });
    }
  }, [loading, allowed, redirectTo, navigate]);

  if (loading || !allowed) {
    return <LoadingSpinner message="Checking access..." />;
  }

  return <>{children}</>;
};

export default RequirePermission;
