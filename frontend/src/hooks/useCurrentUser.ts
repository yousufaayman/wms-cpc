import { useEffect, useState } from "react";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { WMS_SYSTEM_ID, type WmsRole } from "@/lib/api";
import { hasPermission, type Permission } from "@/lib/permissions";

interface UseCurrentUserResult {
  user: CurrentUser | null;
  role: WmsRole | null;
  isAdmin: boolean;
  can: (permission: Permission) => boolean;
  loading: boolean;
}

export function useCurrentUser(): UseCurrentUserResult {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // core.users/core.user_roles are shared across systems (WMS, OPS, PLAN);
  // a role in another system must not count here.
  const role = (user?.user_roles.find(r => r.system_id === WMS_SYSTEM_ID)?.role as WmsRole | undefined) ?? null;
  const isAdmin = role === "admin";
  const can = (permission: Permission) => hasPermission(role, permission);

  return { user, role, isAdmin, can, loading };
}
