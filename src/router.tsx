import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Serve a revisited screen from cache INSTANTLY, then revalidate in the
        // background — so navigating back to a page is immediate, not a refetch.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    // Preload a route's code (and any loader data) on hover/touch so clicking a
    // nav link feels instant instead of waiting on the lazy chunk + fetch.
    defaultPreload: "intent",
    defaultPreloadStaleTime: 30_000,
    defaultPreloadGcTime: 300_000,
  });

  return router;
};

