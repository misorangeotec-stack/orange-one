import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useAppData, groupNameOf } from "./useAppData";
import { useFY } from "./fyContext";
import {
  fetchCollectionPlans, upsertCollectionPlan, upsertCollectionPlans, deleteCollectionPlan,
} from "./collectionPlanApi";
import {
  indexPlans, planKey,
  type CollectionPlan, type CollectionPlanInput, type PlanEntityType,
} from "./collectionPlanTypes";

/**
 * The single hook for the monthly collection plan.
 *
 * Like `useFollowups`, it is also the SCOPE CHOKEPOINT: a non-admin only ever sees plans for
 * customers inside their salesperson scope. That falls out for free — `useAppData().allCustomers`
 * is already scope-filtered, so we keep the plans whose entity is a name (or a group of names)
 * that survives it. Admins are unrestricted. Like the rest of the Hub this is UI-level scoping
 * (the rows still reach the browser); see lib/scope.tsx.
 *
 * SHARED CELL: there is exactly one plan row per (month, entity) and any signed-in user may
 * revise it — a manager revising a salesperson's number is the intended workflow, not an abuse.
 * `revision` / `updatedBy` are what make an overwrite visible rather than silent.
 */

export interface UseCollectionPlan {
  loading: boolean;
  error: string | null;
  /** Scoped plan rows, indexed by planKey(month, type, name). */
  byKey: Map<string, CollectionPlan>;
  /** Planned rupees for one entity in one month; 0 when unplanned. The hot path. */
  plannedFor: (month: string, type: PlanEntityType, name: string) => number;
  /** The whole row — for the editor (date, note, who revised it, revision). */
  planFor: (month: string, type: PlanEntityType, name: string) => CollectionPlan | undefined;
  /** Display name of a plan's last editor. */
  personName: (id: string | null) => string;
  /** Shared cell: true for any signed-in user. A function so the rule has one home. */
  canEdit: () => boolean;
  /** Mirrors the Edge Function's DELETE rule, so the UI never offers a call the server rejects. */
  canDelete: (p: CollectionPlan) => boolean;
  save: (input: CollectionPlanInput) => Promise<void>;
  saveMany: (entries: CollectionPlanInput[]) => Promise<void>;
  remove: (month: string, type: PlanEntityType, name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * @param months every month label the caller may ask about — normally the whole FY's trend
 *   months. One fetch then serves both the report table AND the month-wise analysis panel, which
 *   iterates every month; keying per selected month would make the panel issue twelve queries and
 *   refetch on every dropdown change.
 */
export function useCollectionPlan(months: string[]): UseCollectionPlan {
  const queryClient = useQueryClient();
  const { user, isAdmin } = useSession();
  // The same FY discriminator useAppData keys on (`["appData", fySuffix]`), so the plan cache
  // and the customer cache always turn over together.
  const { suffix: fySuffix } = useFY();
  // Unfiltered customer set for the current user — already salesperson-scoped by useAppData.
  const { allCustomers, customerGroupMap } = useAppData({});

  // Cache key is the FY, not the selected month, matching the `months` argument above.
  // INVARIANT: `months` derives from dashboard.trend, which is FY-scoped, so the two always move
  // together. If that ever stops holding, this key silently serves the wrong month set.
  const queryKey = ["receivablesCollectionPlan", fySuffix] as const;

  const { data: rows, isLoading, error } = useQuery({
    queryKey,
    queryFn: () => fetchCollectionPlans(months),
    enabled: months.length > 0,
    staleTime: 60 * 1000,
  });

  // Org-wide names so a colleague's revision never renders as "Unknown": the normal directory is
  // RLS-scoped, so a peer in another department wouldn't resolve. Shared query key with
  // useFollowups / the mention picker, so this costs no extra request.
  const { data: orgPeople } = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 5 * 60 * 1000 });

  const personName = useCallback(
    (id: string | null): string => {
      if (!id) return "—";
      if (id === user.id) return user.name;
      return (orgPeople ?? []).find((p) => p.id === id)?.name ?? "Unknown user";
    },
    [orgPeople, user.id, user.name],
  );

  // ── Scope ────────────────────────────────────────────────────────────────────
  // A customer entity is visible if its name survived useAppData's scope filter; a group entity
  // if ANY of its children did.
  const visibleNames = useMemo(() => {
    if (isAdmin) return null; // unrestricted
    const customers = new Set(allCustomers.map((c) => c.name));
    const groups = new Set<string>();
    // Resolve each visible LEDGER to its group (by ledger id), not each distinct name: where a
    // name repeats across companies its group can differ, and a name-keyed pass would grant or
    // withhold visibility based on whichever company happened to win the derived map.
    for (const c of allCustomers) groups.add(groupNameOf(c, customerGroupMap));
    return { customers, groups };
  }, [isAdmin, allCustomers, customerGroupMap]);

  const byKey = useMemo(() => {
    const list = rows ?? [];
    const scoped = visibleNames
      ? list.filter((p) =>
          p.entityType === "group"
            ? visibleNames.groups.has(p.entityName)
            : visibleNames.customers.has(p.entityName),
        )
      : list;
    return indexPlans(scoped);
  }, [rows, visibleNames]);

  const planFor = useCallback(
    (month: string, type: PlanEntityType, name: string) => byKey.get(planKey(month, type, name)),
    [byKey],
  );

  const plannedFor = useCallback(
    (month: string, type: PlanEntityType, name: string) =>
      byKey.get(planKey(month, type, name))?.plannedAmount ?? 0,
    [byKey],
  );

  // ── Mutations ────────────────────────────────────────────────────────────────
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["receivablesCollectionPlan", fySuffix] }),
    [queryClient, fySuffix],
  );

  const save = useCallback(
    async (input: CollectionPlanInput) => { await upsertCollectionPlan(input); await refresh(); },
    [refresh],
  );

  const saveMany = useCallback(
    async (entries: CollectionPlanInput[]) => { await upsertCollectionPlans(entries); await refresh(); },
    [refresh],
  );

  const remove = useCallback(
    async (month: string, type: PlanEntityType, name: string) => {
      await deleteCollectionPlan(month, type, name);
      await refresh();
    },
    [refresh],
  );

  /** Any signed-in user may set or revise a plan — see the SHARED CELL note above. */
  const canEdit = useCallback(() => true, []);
  /** Deletion is the only irreversible action, so it keeps the tighter author-or-admin rule. */
  const canDelete = useCallback(
    (p: CollectionPlan) => isAdmin || p.createdBy === user.id,
    [isAdmin, user.id],
  );

  return {
    loading: isLoading,
    error: error ? (error as Error).message : null,
    byKey,
    plannedFor,
    planFor,
    personName,
    canEdit,
    canDelete,
    save,
    saveMany,
    remove,
    refresh,
  };
}
