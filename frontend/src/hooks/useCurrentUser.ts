import { useEffect, useState } from "react";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";

interface UseCurrentUserResult {
  user: CurrentUser | null;
  isAdmin: boolean;
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

  const isAdmin = user?.user_roles.some(r => r.role === "admin") ?? false;

  return { user, isAdmin, loading };
}
