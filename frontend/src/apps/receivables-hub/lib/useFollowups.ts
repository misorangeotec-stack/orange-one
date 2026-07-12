import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { useAppData } from "./useAppData";
import { fetchFollowups, insertFollowup, updateFollowup, deleteFollowup } from "./followupsApi";
import {
  entityKey, dueBucketFor, todayISO,
  type DueBucket, type Followup, type FollowupEntityType, type FollowupInput, type FollowupPatch,
} from "./followupTypes";

/**
 * The single hook for the customer follow-up log.
 *
 * It is also the SCOPE CHOKEPOINT, the same way `useAppData` is for customer data: a
 * non-admin only ever sees follow-ups for customers inside their salesperson scope. That
 * falls out for free — `useAppData().allCustomers` is already scope-filtered, so we just
 * keep the follow-ups whose entity is a name (or a group of names) that survives it.
 * Admins are unrestricted. Like the rest of the Hub this is UI-level scoping (the rows
 * still reach the browser); see lib/scope.tsx.
 *
 * OPEN/CLOSED MODEL: a customer's open follow-up is the `nextFollowupDate` on its MOST
 * RECENT entry — nothing else. Logging a new follow-up supersedes the previous one, so an
 * item leaves "Due Today" the moment it's actioned, and a blank next date closes the chase.
 */

export interface EntityStats {
  outstanding: number;
  overdue: number;
  salesperson: string | null;
}

export interface DueItem {
  entityType: FollowupEntityType;
  entityName: string;
  /** The latest follow-up on this entity — the one carrying the open next date. */
  followup: Followup;
  nextDate: string;
  bucket: DueBucket;
  outstanding: number;
  overdue: number;
}

export function useFollowups() {
  const queryClient = useQueryClient();
  const { user, isAdmin } = useSession();
  // Unfiltered customer set for the current user — already salesperson-scoped by useAppData.
  const { allCustomers, consolidatedCustomers, groupedCustomers, customerGroupMap } = useAppData({});

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["receivablesFollowups"],
    queryFn: fetchFollowups,
    staleTime: 60 * 1000,
  });

  // Org-wide names so a colleague's entry never renders as "Unknown": the normal directory
  // is RLS-scoped (self + downline + same department), so a peer in another department
  // wouldn't resolve. list_org_people() is the SECURITY DEFINER, name-only escape hatch.
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
  // A customer entity is visible if its name survived useAppData's scope filter; a group
  // entity is visible if ANY of its children did.
  const visibleNames = useMemo(() => {
    if (isAdmin) return null; // unrestricted
    const customers = new Set(allCustomers.map((c) => c.name));
    const groups = new Set<string>();
    for (const name of customers) groups.add(customerGroupMap.mapping[name] ?? name);
    return { customers, groups };
  }, [isAdmin, allCustomers, customerGroupMap.mapping]);

  /** Scoped follow-ups, newest first (the API already orders by created_at desc). */
  const all = useMemo<Followup[]>(() => {
    const list = rows ?? [];
    if (!visibleNames) return list;
    return list.filter((f) =>
      f.entityType === "group"
        ? visibleNames.groups.has(f.entityName)
        : visibleNames.customers.has(f.entityName),
    );
  }, [rows, visibleNames]);

  // ── Derivations ──────────────────────────────────────────────────────────────
  const byEntity = useMemo(() => {
    const map = new Map<string, Followup[]>();
    for (const f of all) {
      const key = entityKey(f.entityType, f.entityName);
      const list = map.get(key);
      if (list) list.push(f);
      else map.set(key, [f]);
    }
    return map;
  }, [all]);

  /** The most recent entry per entity — the one that defines the open follow-up. */
  const latestByEntity = useMemo(() => {
    const map = new Map<string, Followup>();
    // `all` is newest-first, so the first row seen for a key is the latest.
    for (const f of all) {
      const key = entityKey(f.entityType, f.entityName);
      if (!map.has(key)) map.set(key, f);
    }
    return map;
  }, [all]);

  /** Current figures for an entity, used to stamp the frozen at-entry context on a new row. */
  const statsFor = useCallback(
    (type: FollowupEntityType, name: string): EntityStats => {
      const row =
        type === "group"
          ? groupedCustomers.find((g) => g.name === name)
          : consolidatedCustomers.find((c) => c.name === name);
      if (!row) return { outstanding: 0, overdue: 0, salesperson: null };
      return { outstanding: row.outstanding, overdue: row.overdue, salesperson: row.salesPerson || null };
    },
    [consolidatedCustomers, groupedCustomers],
  );

  /** Every entity with an open (scheduled) follow-up, split into overdue / today / upcoming. */
  const due = useMemo(() => {
    const today = todayISO();
    const items: DueItem[] = [];
    for (const f of latestByEntity.values()) {
      if (!f.nextFollowupDate) continue; // no further chase scheduled
      const stats = statsFor(f.entityType, f.entityName);
      items.push({
        entityType: f.entityType,
        entityName: f.entityName,
        followup: f,
        nextDate: f.nextFollowupDate,
        bucket: dueBucketFor(f.nextFollowupDate, today),
        outstanding: stats.outstanding,
        overdue: stats.overdue,
      });
    }
    // Soonest first within each bucket (for overdue that means the longest-neglected first).
    items.sort((a, b) => a.nextDate.localeCompare(b.nextDate));
    return {
      overdue: items.filter((i) => i.bucket === "overdue"),
      today: items.filter((i) => i.bucket === "today"),
      upcoming: items.filter((i) => i.bucket === "upcoming"),
      all: items,
    };
  }, [latestByEntity, statsFor]);

  /**
   * Standing promises that have lapsed: the entity's latest entry carries a promised date
   * that is now in the past. Keyed off the LATEST entry (not any historical one) for the
   * same reason the due list is — a newer follow-up supersedes the old promise.
   */
  const brokenPromises = useMemo(() => {
    const today = todayISO();
    return [...latestByEntity.values()].filter(
      (f) => f.promisedDate != null && f.promisedDate < today,
    );
  }, [latestByEntity]);

  /** Total still-standing promised amount (promise date today or later). */
  const promisedTotal = useMemo(() => {
    const today = todayISO();
    return [...latestByEntity.values()]
      .filter((f) => f.promisedAmount != null && f.promisedDate != null && f.promisedDate >= today)
      .reduce((s, f) => s + (f.promisedAmount ?? 0), 0);
  }, [latestByEntity]);

  // ── Mutations ────────────────────────────────────────────────────────────────
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["receivablesFollowups"] }),
    [queryClient],
  );

  const add = useCallback(
    async (input: FollowupInput) => {
      const id = await insertFollowup({ ...input, createdBy: user.id });
      await refresh();
      return id;
    },
    [user.id, refresh],
  );

  const edit = useCallback(
    async (id: string, patch: FollowupPatch) => {
      await updateFollowup(id, patch);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteFollowup(id);
      await refresh();
    },
    [refresh],
  );

  /** May the signed-in user edit/delete this entry? Own rows, or anything if admin. */
  const canModify = useCallback(
    (f: Followup) => isAdmin || f.createdBy === user.id,
    [isAdmin, user.id],
  );

  return {
    loading: isLoading,
    error: error ? (error as Error).message : null,
    all,
    byEntity,
    latestByEntity,
    due,
    brokenPromises,
    promisedTotal,
    personName,
    statsFor,
    canModify,
    add,
    edit,
    remove,
  };
}

/**
 * History for one entity, newest first. On a GROUP it also merges in the entries logged
 * against its child customers (tagged with the child name), so opening a group never hides
 * a conversation that was recorded one level down.
 */
export function followupsForEntity(
  byEntity: Map<string, Followup[]>,
  type: FollowupEntityType,
  name: string,
  childNames: string[] = [],
): Followup[] {
  const own = byEntity.get(entityKey(type, name)) ?? [];
  if (type !== "group") return own;
  const children = childNames
    .filter((child) => child !== name)
    .flatMap((child) => byEntity.get(entityKey("customer", child)) ?? []);
  return [...own, ...children].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
