import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import {
  dispatchOpenWorkQueryKey,
  dispatchQueryKey,
  fetchDispatchOpenWork,
  openWorkFrom,
  type DispatchData,
} from "./dispatchFetch";

/**
 * Pending Dispatch work, for screens that only COUNT what is owed: Home "My Work"
 * and the FMS Control Center row (which the Process Coordinator's Processes page
 * renders too). See `fetchDispatchOpenWork` for why this exists.
 *
 * ⚠ IF THE MODULE'S FULL COPY IS ALREADY IN THE BROWSER AND FRESH, IT IS USED
 *   INSTEAD - no request at all. "Fresh" is the same minute the store itself
 *   trusts (staleTime 60 s), so this never shows older data than the module does.
 *
 * ⚠ ITS OWN CACHE ENTRY. The store's post-save refresh invalidates it, which
 *   re-runs this with the just-refreshed full copy in hand, so the home list and
 *   the side panel follow a save straight away.
 *
 * ⚠ NOT FOR THE PROCESS COORDINATOR'S CALL LIST. Its search over hub numbers
 *   (`hubRefs.ts`) also finds FINISHED orders, so it stays on the full load until
 *   that search moves to the server (PERF-2 Step 4).
 */
const FRESH_MS = 60_000;

export function useDispatchOpenWork(enabled: boolean) {
  const { user } = useSession();
  const uid = user?.id ?? null;
  const qc = useQueryClient();

  return useQuery({
    queryKey: dispatchOpenWorkQueryKey(uid),
    queryFn: async () => {
      const full = qc.getQueryState<DispatchData>(dispatchQueryKey(uid));
      if (
        full?.data &&
        full.status === "success" &&
        !full.isInvalidated &&
        Date.now() - full.dataUpdatedAt < FRESH_MS
      ) {
        return openWorkFrom(full.data);
      }
      return fetchDispatchOpenWork();
    },
    enabled: enabled && !!uid,
  });
}
