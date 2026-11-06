import { useQuery } from "@tanstack/react-query";
import { featureApi, type Features } from "@/lib/api";

// Everything is off until the server says otherwise (and if the call fails),
// so a switched-off module never flashes on screen.
const ALL_OFF: Features = { accessories: false, needles: false };

/** Feature flags from GET /api/v1/features. Fetched once per session and
    shared by every component that calls this hook. */
export function useFeatures(): Features & { loading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: ["features"],
    queryFn: featureApi.get,
    staleTime: Infinity,
    retry: 1,
  });
  return { ...(data ?? ALL_OFF), loading: isLoading };
}
