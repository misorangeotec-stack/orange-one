import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchAssetData, assetQueryKey } from "@/apps/asset-maintenance/data/assetFetch";
import { assetSnapshotFrom, buildQueueEntries } from "@/apps/asset-maintenance/lib/queues";
import { STAGES, STEPS } from "@/apps/asset-maintenance/lib/steps";
import { snapshotFrom } from "../lib/buckets";
import type { FmsAdapter } from "./types";

/**
 * Asset Maintenance FMS adapter — a row on the scoreboard.
 *
 * The counts come from `buildQueueEntries(assetSnapshotFrom(...))` — LITERALLY the
 * same two calls asset-maintenance/store.tsx makes, on the same react-query cache
 * entry keyed on the REAL session user id, so the scoreboard can never drift from
 * the app.
 *
 * ⚠ WHAT THIS ROW DOES NOT SHOW: a track whose reminder window has not opened yet
 *   has no job, so it is not a queue entry and cannot appear here. The scoreboard
 *   answers "is anyone slow at a step?"; "has an obligation lapsed?" is a
 *   different question, answered on this module's own Control Center.
 */
export const assetMaintenanceAdapter: FmsAdapter = {
  key: "asset-maintenance",
  appId: "asset-maintenance",
  name: appName("asset-maintenance"),
  controlCenterPath: "/asset-maintenance/monitoring",
  status: "live",
  useSnapshot() {
    const session = useSession();
    const userId = session.user?.id ?? null;
    const { data, isLoading, error } = useQuery({
      queryKey: assetQueryKey(userId),
      queryFn: fetchAssetData,
      enabled: !!userId,
    });
    const snapshot = useMemo(
      () =>
        data
          ? snapshotFrom(
              buildQueueEntries(
                assetSnapshotFrom({
                  jobs: data.jobs,
                  stepSla: data.config.stepSla,
                  assets: data.assets,
                  scheduleTypes: data.scheduleTypes,
                }),
              ),
              STEPS,
              STAGES,
            )
          : null,
      [data],
    );
    return { snapshot, isLoading, error };
  },
};
