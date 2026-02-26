import { QueryClient } from "@tanstack/react-query";

export const queryClientInstance = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      // Serve cached data instantly on navigation; revalidate in background after 5 min
      staleTime: 5 * 60 * 1000,
    },
  },
});
