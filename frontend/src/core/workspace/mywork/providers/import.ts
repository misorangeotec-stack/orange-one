/**
 * Import Purchase FMS → My Work. The Purchase twin — see `purchase.ts`.
 *
 * Import's own owner rule is line-scoped with a single approver per band, unlike
 * Purchase's requisition-scoped multi-approver bands, which is why each app keeps
 * its own `lib/owners.ts` rather than sharing one.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { appName } from "@/apps/appInfo";
import { fetchImportData, importQueryKey } from "@/apps/import/data/importFetch";
import { buildQueueEntries } from "@/apps/import/lib/queues";
import { stepByKey } from "@/apps/import/lib/steps";
import { ownerResolver } from "@/apps/import/lib/owners";
import { linkResolver } from "@/apps/import/lib/links";
import type { MyWorkProvider, MyWorkResult, WorkItem } from "../types";

function useImportWork(active: boolean): MyWorkResult {
  const { user, isAdmin } = useSession();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: importQueryKey(uid),
    queryFn: fetchImportData,
    enabled: active && !!uid,
  });

  const items = useMemo<WorkItem[]>(() => {
    if (!data || !uid) return [];
    const owners = ownerResolver(data);
    const linkOf = linkResolver(data.requestItems);
    return buildQueueEntries(data)
      .filter((e) => isAdmin || owners.isMine(e, uid))
      .map((e) => ({
        id: `import:${e.entityId}:${e.stepKey}`,
        source: "import",
        sourceLabel: appName("import"),
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

export const importProvider: MyWorkProvider = {
  key: "import",
  label: appName("import"),
  appId: "import",
  category: "fms",
  unit: "steps",
  tier: 2,
  useMyWork: useImportWork,
};
