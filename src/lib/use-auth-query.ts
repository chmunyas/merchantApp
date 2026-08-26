import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import { authFetch, hasAuthoritativeVenueSession } from "@/lib/auth";
import { getCurrentVenueId } from "@/lib/tenant-store";

// Cached authed GET for dashboard data. The query key is namespaced by the ACTIVE
// venue so a store switch never shows another store's cached rows, and the shared
// React Query cache means revisiting a screen paints instantly, then revalidates
// in the background (defaults: 30s stale, 5m gc — see router.tsx).
//
// `select` maps the raw JSON to the shape the page needs. Returns the full React
// Query result ({ data, isLoading, isFetching, refetch, ... }).
export function useAuthQuery<TRaw, TData = TRaw>(
  key: readonly unknown[],
  path: string,
  options?: Omit<UseQueryOptions<TRaw, Error, TData>, "queryKey" | "queryFn">,
) {
  const venue =
    typeof window !== "undefined" ? getCurrentVenueId() : "main";
  return useQuery<TRaw, Error, TData>({
    queryKey: [venue, ...key],
    queryFn: async () => {
      const res = await authFetch(path);
      if (!res.ok) throw new Error(`${path} -> ${res.status}`);
      return (await res.json()) as TRaw;
    },
    ...options,
    enabled:
      options?.enabled !== false && hasAuthoritativeVenueSession(),
  });
}
