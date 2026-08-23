import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchOcpiData, ocpiQueryKey } from "@/apps/ocpi/data/ocpiFetch";
import { buildQueueEntries } from "@/apps/ocpi/lib/queues";
import { resolveStepSla } from "@/apps/ocpi/lib/sla";
import { STAGES, STEPS } from "@/apps/ocpi/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * OCPI adapter — a row on the cross-FMS scoreboard.
 *
 * The counts come from `buildQueueEntries(...)` — LITERALLY the same call
 * ocpi/store.tsx makes, on the same react-query cache entry keyed on the REAL
 * session user id, so the scoreboard can never drift from the app.
 *
 * ⚠ WHAT THIS ROW DOES NOT SHOW: a DRAFT quotation. A draft owes nobody and is
 *   private to its author, so it is not a queue entry and must not appear on a
 *   coordinator's scoreboard — counting it would report someone's unfinished
 *   thinking as work the business is waiting on.
 *
 * ⚠ THE SLA MAP IS RESOLVED HERE TOO, from the same config row the app reads.
 *   Passing it is what makes a late deal show as late on the scoreboard; omitting
 *   it would bucket everything as "no date", which reads as "nothing is
 *   outstanding" to a director scanning ten modules. `resolveStepSla` merges the
 *   stored map over the defaults, so a module nobody has configured still reports
 *   honest dates rather than none.
 */
export const ocpiAdapter: FmsAdapter = {
  key: "ocpi",
  appId: "ocpi",
  name: appName("ocpi"),
  controlCenterPath: "/ocpi/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: ocpiQueryKey(userId),
      queryFn: fetchOcpiData,
      enabled: !!userId,
    });
    const snapshot = useMemo(
      () =>
        data
          ? snapshotFrom(buildQueueEntries(data.deals, resolveStepSla(data.stepSla)), STEPS, STAGES)
          : null,
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
