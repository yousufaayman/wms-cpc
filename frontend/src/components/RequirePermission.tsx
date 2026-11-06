import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import type { Permission } from "@/lib/permissions";
import LoadingSpinner from "./LoadingSpinner";
import { useTranslation } from "@/hooks/useTranslation";

/** Exactly one rule per route:
 * - `permission`: the role must hold that permission (admin always passes)
 * - `anyRole`: any WMS role is enough (pages every role may see, e.g. receipts)
 * - `adminOnly`: only admin */
type RequirePermissionProps = { children: React.ReactNode } & (
  | { permission: Permission; anyRole?: never; adminOnly?: never }
  | { anyRole: true; permission?: never; adminOnly?: never }
  | { adminOnly: true; permission?: never; anyRole?: never }
);

/** Gates a route; redirects to this role's home page (its warehouse context
 * preserved) if the current user fails the rule. Viewer has no access to
 * /dashboard, so its home is /receipts instead. A user with no WMS role goes
 * back to /warehouses (the backend refuses them everywhere anyway). */
const RequirePermission = (props: RequirePermissionProps) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { role, isAdmin, can, loading } = useCurrentUser();
  const { t } = useTranslation();

  const warehouseId = searchParams.get("warehouse");
  const homePath = role === "Viewer" ? "/receipts" : "/dashboard";
  const redirectTo = role && warehouseId ? `${homePath}?warehouse=${warehouseId}` : "/warehouses";

  const { permission, anyRole, adminOnly } = props;
  let allowed = false;
  if (adminOnly) allowed = isAdmin;
  else if (anyRole) allowed = role !== null;
  else if (permission) allowed = can(permission);

  useEffect(() => {
    if (!loading && !allowed) {
      navigate(redirectTo, { replace: true });
    }
  }, [loading, allowed, redirectTo, navigate]);

  if (loading || !allowed) {
    return <LoadingSpinner message={t("checkingAccess")} />;
  }

  return <>{props.children}</>;
};

export default RequirePermission;
