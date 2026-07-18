/**
 * Purchase FMS → My Work.
 *
 * Reuses `buildQueueEntries` (the exact predicates the queue pages and the FMS
 * Control Center use) on the exact same query key, so this shares one cache entry
 * with the app and cannot report a different set of open work than the app does.
 *
 * The one thing it adds is OWNER FILTERING, which `buildQueueEntries` deliberately
 * does not do — a coordinator's Control Center must count everyone's work. The
 * rule lives in `procurement/lib/owners.ts` precisely so this file can apply it
 * without mounting the procurement store.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchProcurementData, procurementQueryKey } from "@/apps/procurement/data/procFetch";
import { buildQueueEntries } from "@/apps/procurement/lib/queues";
import { stepByKey } from "@/apps/procurement/lib/steps";
import { ownerResolver } from "@/apps/procurement/lib/owners";
import { linkResolver } from "@/apps/procurement/lib/links";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function usePurchaseWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: procurementQueryKey(uid),
    queryFn: fetchProcurementData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    const owners = ownerResolver(data);
    const linkOf = linkResolver(data.requestItems);
    return buildQueueEntries(data)
      // An admin owns no workflow steps, so a personal filter would show them an
      // empty screen. They see the whole book instead — matching the Control Center.
      .filter((e) => isAdmin || owners.isMine(e, uid))
      .map((e) => ({
        id: `purchase:${e.entityId}:${e.stepKey}`,
        source: "purchase",
        sourceLabel: appName("procurement"),
        ref: e.ref,
        stage: stepByKey(e.stepKey)?.short,
        dueIso: e.dueIso,
        to: linkOf(e),
        assignment: owners.isMine(e, uid) ? ("direct" as const) : ("team" as const),
        isApproval: e.stepKey === "approval",
      }));
  }, [data, uid, isAdmin]);

  return { items, isLoading, error };
}

export const purchaseProvider: MyWorkProvider = {
  key: "purchase",
  label: appName("procurement"),
  appId: "procurement",
  category: "fms",
  unit: "steps",
  tier: 2,
  useMyWork: usePurchaseWork,
};
