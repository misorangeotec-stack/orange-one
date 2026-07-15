import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { fetchImportData, importQueryKey } from "@/apps/import/data/importFetch";
import { buildQueueEntries } from "@/apps/import/lib/queues";
import { STEPS } from "@/apps/import/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Import Purchase FMS adapter.
 *
 * Counts come from `buildQueueEntries` — the exact predicates the per-step queue
 * pages use — so this scoreboard cannot drift from those pages. The query key
 * matches `import/store.tsx` exactly (same helper, same REAL session user id), so
 * react-query serves both from one cache entry.
 */
export const importAdapter: FmsAdapter = {
  key: "import",
  name: "Import Purchase FMS",
  controlCenterPath: "/import/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: importQueryKey(userId),
      queryFn: fetchImportData,
      enabled: !!userId,
    });
    const snapshot = useMemo(() => (data ? snapshotFrom(buildQueueEntries(data), STEPS) : null), [data]);
    return { snapshot, isLoading, error };
  },
};
