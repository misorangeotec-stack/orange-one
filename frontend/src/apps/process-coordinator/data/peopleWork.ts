import { useMemo } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/core/platform/supabase";
import { useSession } from "@/core/platform/session";
import { ORG_PEOPLE_DETAIL_QUERY, type OrgPersonDetail } from "@/core/platform/orgPeople";
import { appName } from "@/apps/appInfo";
import { holdAwareBucketOf, todayLocalIso, type WorkBucket } from "@/shared/lib/dueBuckets";
import type { WorkItem } from "@/core/workspace/mywork/types";

import { fetchProcurementData, procurementQueryKey } from "@/apps/procurement/data/procFetch";
import { fetchImportData, importQueryKey } from "@/apps/import/data/importFetch";
import { fetchHrData, hrQueryKey } from "@/apps/hr-recruitment/data/hrFetch";
import { fetchExitData, exitQueryKey } from "@/apps/hr-exit/data/exitFetch";
import { fetchSuppliesData, suppliesQueryKey } from "@/apps/office-supplies/data/suppliesFetch";
import { fetchSamplingData, samplingQueryKey } from "@/apps/sampling/data/samplingFetch";
import { fetchProductionData, productionQueryKey } from "@/apps/production-entry/data/productionFetch";
import { fetchDispatchData, dispatchQueryKey } from "@/apps/order-to-dispatch/data/dispatchFetch";
import { fetchAssetData, assetQueryKey } from "@/apps/asset-maintenance/data/assetFetch";
import { fetchTravelData, travelQueryKey } from "@/apps/travel-desk/data/travelFetch";
import { fetchLdData, ldQueryKey } from "@/apps/learning-development/data/ldFetch";
import { fetchHelpData, helpQueryKey } from "@/apps/help-desk/data/helpFetch";
import { fetchCustomerData, customerQueryKey } from "@hub/data/customerOnboarding/customerFetch";
import { fetchComplaintData, complaintQueryKey } from "@/apps/complaint/data/complaintFetch";
import { fetchOcpiData, ocpiQueryKey } from "@/apps/ocpi/data/ocpiFetch";
import { FLOW_QUERY, fetchFlow, useInkLots, type FlowData } from "@/apps/ink-stabilisation/lib/flow";
import type { InkLot } from "@/apps/ink-stabilisation/lib/schedule";

import { purchaseWorkItems } from "@/core/workspace/mywork/items/purchase";
import { importWorkItems } from "@/core/workspace/mywork/items/import";
import { hrWorkItems } from "@/core/workspace/mywork/items/hr";
import { hrExitWorkItems } from "@/core/workspace/mywork/items/hrExit";
import { officeSuppliesWorkItems } from "@/core/workspace/mywork/items/officeSupplies";
import { samplingWorkItems } from "@/core/workspace/mywork/items/sampling";
import { productionWorkItems } from "@/core/workspace/mywork/items/productionEntry";
import { dispatchWorkItems } from "@/core/workspace/mywork/items/orderToDispatch";
import { assetWorkItems } from "@/core/workspace/mywork/items/assetMaintenance";
import { travelDeskWorkItems } from "@/core/workspace/mywork/items/travel-desk";
import { learningDevelopmentWorkItems } from "@/core/workspace/mywork/items/learning-development";
import { helpDeskWorkItems } from "@/core/workspace/mywork/items/help-desk";
import { customerOnboardingWorkItems } from "@/core/workspace/mywork/items/customerOnboarding";
import { complaintWorkItems } from "@/core/workspace/mywork/items/complaint";
import { ocpiWorkItems } from "@/core/workspace/mywork/items/ocpi";
import { inkStabilisationWorkItems } from "@/core/workspace/mywork/items/inkStabilisation";

/**
 * EVERY PERSON'S FMS WORK, as each of them sees it on My Control Center.
 *
 * ⚠ NOTHING HERE DECIDES WHOSE WORK A ROW IS. It runs each module's own
 *   `core/workspace/mywork/items/` rule once per person — the same rule My Control
 *   Center renders from and the 9am mail computes from (supabase/worksnapshot/
 *   entry.ts does exactly this loop on the server). So when the coordinator sees
 *   "Manisha · 3 overdue in Purchase", Manisha's own home screen says the same.
 *   If a count here looks wrong, the bug is in that module's items/ file, and
 *   fixing it there fixes all three readers.
 *
 * ⚠ ALWAYS AS A NON-ADMIN (`isAdmin = false`). With `true` every rule returns the
 *   whole book, and every admin would be listed as owing every open step in the
 *   company. As a non-admin, an admin still shows what is routed to them by name —
 *   an approval in their value band, a ticket assigned to them. Same call the
 *   ranking makes (fms-control-center/ranking/types.ts, `openFor`).
 *
 * ⚠ THE DATA IS WHAT THE COORDINATOR CAN READ. Each module is fetched with her own
 *   session, on the SAME query key the module's store and her own My Control
 *   Center use (so it is one cache entry, not a second copy). To see a module's
 *   whole book she needs a VIEW grant on it — see process-coordinator/meta.tsx for
 *   why it must be `view`, not `edit`. A module she has no grant on is not fetched
 *   at all and is listed as "no access" on screen, rather than silently counting
 *   nothing.
 *
 * Task Management is deliberately left out: it is not an FMS, its tasks are RLS'd
 * to the assignee's own line (so the coordinator would see a partial book and
 * think it whole), and it has its own Weekly Scorecard.
 */

/** One FMS on the Call List. */
interface ModuleDef {
  appId: string;
  queryKey: (uid: string | null) => readonly unknown[];
  fetch: () => Promise<unknown>;
  /** The module's own My Work rule, as a non-admin. */
  rule: (data: never, uid: string) => WorkItem[];
}

const def = <D>(
  appId: string,
  queryKey: (uid: string | null) => readonly unknown[],
  fetch: () => Promise<D>,
  rule: (data: D, uid: string) => WorkItem[],
): ModuleDef => ({ appId, queryKey, fetch, rule: rule as ModuleDef["rule"] });

/** Display order — matches My Control Center's provider registry. */
const MODULES: ModuleDef[] = [
  def("procurement", procurementQueryKey, fetchProcurementData, (d, u) => purchaseWorkItems(d, u, false)),
  def("import", importQueryKey, fetchImportData, (d, u) => importWorkItems(d, u, false)),
  def("hr-recruitment", hrQueryKey, fetchHrData, (d, u) => hrWorkItems(d, u, false)),
  def("hr-exit", exitQueryKey, fetchExitData, (d, u) => hrExitWorkItems(d, u, false)),
  def("office-supplies", suppliesQueryKey, fetchSuppliesData, (d, u) => officeSuppliesWorkItems(d, u, false)),
  def("sampling", samplingQueryKey, fetchSamplingData, (d, u) => samplingWorkItems(d, u, false)),
  def("production-entry", productionQueryKey, fetchProductionData, (d, u) => productionWorkItems(d, u, false)),
  def("order-to-dispatch", dispatchQueryKey, fetchDispatchData, (d, u) => dispatchWorkItems(d, u, false)),
  def("customer-onboarding", customerQueryKey, fetchCustomerData, (d, u) => customerOnboardingWorkItems(d, u, false)),
  def("ocpi", ocpiQueryKey, fetchOcpiData, (d, u) => ocpiWorkItems(d, u, false)),
  def("complaint", complaintQueryKey, fetchComplaintData, (d, u) => complaintWorkItems(d, u, false)),
  def("asset-maintenance", assetQueryKey, fetchAssetData, (d, u) => assetWorkItems(d, u, false)),
  def("travel-desk", travelQueryKey, fetchTravelData, (d, u) => travelDeskWorkItems(d, u, false)),
  def("learning-development", ldQueryKey, fetchLdData, (d, u) => learningDevelopmentWorkItems(d, u, false)),
  // Help Desk's rule takes no isAdmin at all — see supabase/worksnapshot/entry.ts.
  def("help-desk", helpQueryKey, fetchHelpData, (d, u) => helpDeskWorkItems(d, u)),
];

/** Ink Stabilisation needs two reads (flow + ConnectWave lots), so it is wired by hand below. */
const INK = "ink-stabilisation";

export const CALL_LIST_APP_IDS: string[] = [...MODULES.map((m) => m.appId), INK];

/* ---- per-dataset memo ----------------------------------------------------------- */

/**
 * The rule runs once per (module dataset, person) and is remembered against the
 * dataset object. ~70 people × 16 modules is ~1,100 rule calls, and a refetch of
 * Purchase must not make every other module run again — only the module whose
 * data object changed is recomputed.
 */
const ruleCache = new WeakMap<object, Map<string, WorkItem[]>>();

function itemsFor(data: object, key: string, uid: string, run: () => WorkItem[]): WorkItem[] {
  let perUser = ruleCache.get(data);
  if (!perUser) {
    perUser = new Map();
    ruleCache.set(data, perUser);
  }
  const k = `${key}|${uid}`;
  let hit = perUser.get(k);
  if (!hit) {
    try {
      hit = run();
    } catch (e) {
      // One module's rule failing for one person must not blank the whole list.
      console.error(`[call-list] ${key} rule failed for ${uid}`, e);
      hit = [];
    }
    perUser.set(k, hit);
  }
  return hit;
}

/* ---- contacts ------------------------------------------------------------------- */

export interface Contact {
  phone: string | null;
  email: string | null;
}

/**
 * Phone + email for everyone.
 *
 * Reads `pc_people_contacts()` (migration 20270111120000). Until that migration is
 * live, falls back to `pc_step_owner_contacts()`, which already exists and carries
 * the phone of every step owner — so the screen works on day one and only the
 * approvers who own no step show "no number" until the migration lands.
 */
async function fetchContacts(): Promise<Map<string, Contact>> {
  const db = supabase as any;
  const out = new Map<string, Contact>();
  const people = await db.rpc("pc_people_contacts");
  if (!people.error) {
    for (const r of (people.data ?? []) as { user_id: string; phone: string | null; email: string | null }[]) {
      out.set(r.user_id, { phone: r.phone, email: r.email });
    }
    return out;
  }
  const owners = await db.rpc("pc_step_owner_contacts");
  if (owners.error) throw new Error(owners.error.message);
  for (const r of (owners.data ?? []) as { user_id: string | null; phone: string | null; email: string | null }[]) {
    if (r.user_id && !out.has(r.user_id)) out.set(r.user_id, { phone: r.phone, email: r.email });
  }
  return out;
}

/* ---- the result ----------------------------------------------------------------- */

export type CallBucket = "overdue" | "today" | "next2" | "noDate" | "hold";

export interface BucketCounts {
  overdue: number;
  today: number;
  next2: number;
  noDate: number;
  hold: number;
}

export const emptyCounts = (): BucketCounts => ({ overdue: 0, today: 0, next2: 0, noDate: 0, hold: 0 });

export const callBucketOf = (b: WorkBucket | null): CallBucket | null =>
  b === "delayed" ? "overdue"
  : b === "today" ? "today"
  : b === "tomorrow" || b === "dayAfter" ? "next2"
  : b === "noDate" ? "noDate"
  : b === "hold" ? "hold"
  : null;

export interface PersonItem extends WorkItem {
  appId: string;
  bucket: CallBucket;
}

export interface PersonWork {
  person: OrgPersonDetail;
  contact: Contact;
  items: PersonItem[];
  counts: BucketCounts;
  /** appId → counts, only for modules where this person has something. */
  byModule: Map<string, BucketCounts>;
  /** Earliest due date among overdue items — "how long has this been sitting". */
  oldestOverdueIso: string | null;
}

export type ModuleLoad = "loaded" | "loading" | "error" | "no-access";

export interface ModuleStatus {
  appId: string;
  name: string;
  state: ModuleLoad;
  error?: string;
}

export interface PeopleWorkResult {
  rows: PersonWork[];
  modules: ModuleStatus[];
  peopleLoading: boolean;
  contactsMissing: boolean;
  todayIso: string;
  /** When the oldest-loaded module was last fetched — the honest "as of" time. */
  updatedAt: number | null;
  refreshing: boolean;
  /** Refetch every module on the list, plus people and contacts. */
  refresh: () => void;
}

export function usePeopleWork(): PeopleWorkResult {
  const { user, hasModule } = useSession();
  const me = user?.id ?? null;
  const qc = useQueryClient();

  const people = useQuery({ ...ORG_PEOPLE_DETAIL_QUERY, enabled: !!me });
  const contacts = useQuery({
    queryKey: ["pc", "peopleContacts"],
    queryFn: fetchContacts,
    staleTime: 10 * 60_000,
    enabled: !!me,
  });

  const results = useQueries({
    queries: MODULES.map((m) => ({
      queryKey: m.queryKey(me),
      queryFn: m.fetch,
      enabled: !!me && hasModule(m.appId),
    })),
  });

  const inkAllowed = hasModule(INK);
  const flow = useQuery({ queryKey: FLOW_QUERY, queryFn: fetchFlow, enabled: !!me && inkAllowed, staleTime: 30_000 });
  const lots = useInkLots(!!flow.data && flow.data.owners.plant.length > 0);

  const todayIso = todayLocalIso();

  // Re-run only when some module's data object (or the people list) changes.
  const dataKey = results.map((r) => r.dataUpdatedAt).join(",");

  const computed = useMemo(() => {
    const list = people.data ?? [];
    const contactMap = contacts.data ?? new Map<string, Contact>();
    const rows: PersonWork[] = [];

    for (const person of list) {
      const items: PersonItem[] = [];
      MODULES.forEach((m, i) => {
        const data = results[i]?.data as object | undefined;
        if (!data) return;
        for (const it of itemsFor(data, m.appId, person.id, () => m.rule(data as never, person.id))) {
          const bucket = callBucketOf(holdAwareBucketOf(it, todayIso));
          if (bucket) items.push({ ...it, appId: m.appId, bucket });
        }
      });
      if (flow.data) {
        const fd: FlowData = flow.data;
        const ld: InkLot[] | null = lots.data ?? null;
        // Keyed on the lots too: the plant's work only appears once they arrive.
        const key = ld ? `${INK}+lots` : INK;
        for (const it of itemsFor(fd, key, person.id, () => inkStabilisationWorkItems(fd, ld, person.id, false))) {
          const bucket = callBucketOf(holdAwareBucketOf(it, todayIso));
          if (bucket) items.push({ ...it, appId: INK, bucket });
        }
      }
      if (items.length === 0) continue;

      const counts = emptyCounts();
      const byModule = new Map<string, BucketCounts>();
      let oldest: string | null = null;
      for (const it of items) {
        counts[it.bucket]++;
        const mc = byModule.get(it.appId) ?? emptyCounts();
        mc[it.bucket]++;
        byModule.set(it.appId, mc);
        if (it.bucket === "overdue" && it.dueIso && (!oldest || it.dueIso < oldest)) oldest = it.dueIso;
      }
      items.sort(compareItems);
      rows.push({
        person,
        contact: contactMap.get(person.id) ?? { phone: null, email: null },
        items,
        counts,
        byModule,
        oldestOverdueIso: oldest,
      });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people.data, contacts.data, dataKey, flow.data, lots.data, todayIso]);

  const modules: ModuleStatus[] = [
    ...MODULES.map((m, i): ModuleStatus => {
      const r = results[i];
      return {
        appId: m.appId,
        name: appName(m.appId),
        state: !hasModule(m.appId) ? "no-access" : r?.error ? "error" : r?.data ? "loaded" : "loading",
        error: r?.error ? String((r.error as Error).message ?? r.error) : undefined,
      };
    }),
    {
      appId: INK,
      name: appName(INK),
      state: !inkAllowed ? "no-access" : flow.error ? "error" : flow.data ? "loaded" : "loading",
      error: flow.error ? String((flow.error as Error).message ?? flow.error) : undefined,
    },
  ];

  const stamps = [...results.map((r) => r.dataUpdatedAt), flow.dataUpdatedAt].filter((t) => t > 0);
  const refresh = () => {
    MODULES.forEach((m) => void qc.invalidateQueries({ queryKey: m.queryKey(me) }));
    void qc.invalidateQueries({ queryKey: FLOW_QUERY });
    void people.refetch();
    void contacts.refetch();
  };

  return {
    rows: computed,
    modules,
    peopleLoading: people.isLoading,
    contactsMissing: !!contacts.error,
    todayIso,
    updatedAt: stamps.length ? Math.min(...stamps) : null,
    refreshing: results.some((r) => r.isFetching) || flow.isFetching,
    refresh,
  };
}

/** Worst first: held last, then by due date (undated after dated), then by ref. */
const RANK: Record<CallBucket, number> = { overdue: 0, today: 1, next2: 2, noDate: 3, hold: 4 };
function compareItems(a: PersonItem, b: PersonItem): number {
  if (RANK[a.bucket] !== RANK[b.bucket]) return RANK[a.bucket] - RANK[b.bucket];
  const ax = a.dueIso ?? "9999-12-31";
  const bx = b.dueIso ?? "9999-12-31";
  return ax === bx ? a.ref.localeCompare(b.ref) : ax < bx ? -1 : 1;
}
