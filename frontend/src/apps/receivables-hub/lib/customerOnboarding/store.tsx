/**
 * Customer Creation FMS — the module store.
 *
 * ONE react-query snapshot for the whole module, one blunt invalidation after
 * every write. Mounted by CustomerOnboardingLayout so the snapshot loads on
 * these routes ONLY — the hub's other 40 pages must not pay for it.
 *
 * ⚠ THIS MODULE IS ISOLATED FROM THE HUB'S RECEIVABLES MACHINERY ON PURPOSE.
 *   Never call useAppData() or useReceivablesSource() from anywhere under
 *   customerOnboarding/. Those read a different Supabase project and are wired
 *   to the Live-Tally topbar toggle; flipping Live would re-fetch the entire
 *   receivables dataset underneath a form. This module reads the identity
 *   project and has nothing to do with that switch.
 */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import { companyDisplayName, type MasterCompany } from "@/core/platform/liveMasters";
import {
  CUSTOMER_QK, customerQueryKey, fetchCustomerData, type CustomerSnapshot,
} from "@hub/data/customerOnboarding/customerFetch";
import * as writes from "@hub/data/customerOnboarding/customerWrites";
import {
  buildQueueEntries, completedFor, customerDueIso, openStep,
  type CustomerQueueEntry,
} from "./queues";
import { OWNED_STEPS, type StepKey } from "./steps";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./sla";
import {
  DEFAULT_APPROVAL_RULES,
  type ApprovalRules, type CustomerActivity, type CustomerNotification,
  type CustomerRequest, type GstState, type StepOwner,
} from "./types";

const EMPTY: CustomerSnapshot = {
  requests: [], companies: [], stepOwners: [], gstStates: [], activity: [], notifications: [],
  stepSla: DEFAULT_STEP_SLA, approvalRules: DEFAULT_APPROVAL_RULES, coordinatorIds: [],
};

interface CustomerStore {
  loading: boolean;
  error: string | null;

  requests: CustomerRequest[];
  requestById: (id: string) => CustomerRequest | undefined;

  /**
   * OUR Tally companies, ACTIVE ONLY — the options for "which company is this
   * customer for".
   *
   * ⚠ NOT filtered by the `modules` allow-list, on purpose. That allow-list
   *   exists to keep a 9,200-row party dropdown usable; mst_companies has five
   *   rows and they are untagged, so filtering on it would ship an empty
   *   dropdown. See core/platform/liveMasters.ts.
   */
  companies: MasterCompany[];
  /**
   * A company id → the ALIAS ("Colorix — Surat"), never Tally's book name, which
   * carries the financial year and is re-minted each April. Falls back to `—`
   * for null (every request raised before the company question existed) and for
   * an id that no longer resolves.
   *
   * ⚠ Reads the UNFILTERED list, unlike `companies` above: a request onboarded
   *   into a company since deactivated must still render its name.
   */
  companyName: (id: string | null | undefined) => string;
  gstStates: GstState[];
  stepOwners: StepOwner[];
  approvalRules: ApprovalRules;
  /** The RESOLVED map — defaults merged with whatever config holds. */
  stepSla: StepSlaMap;
  notifications: CustomerNotification[];
  activityFor: (entityId: string) => CustomerActivity[];

  /** Capabilities. ⚠ canActOn MIRRORS the SQL fms_customer_can_act — keep them in step. */
  isAdmin: boolean;
  /**
   * Does this person's grant on Customer Onboarding allow CHANGING anything?
   * False only on a view-only grant.
   *
   * ⚠ A CEILING, never a permission. Kept OUT of `canActOn`, which also decides
   *   which rows land in a person's worklist (pages/customerOnboarding/Home.tsx):
   *   folding it in there would empty a view-only user's list rather than freeze
   *   it. ANDed in at each action site instead.
   */
  canEdit: boolean;
  isCoordinator: boolean;
  /** The configured list, for the Settings picker. Admins are coordinators implicitly. */
  coordinatorIds: string[];
  isStepOwner: (step: StepKey) => boolean;
  isAnyStepOwner: boolean;
  canRaise: boolean;
  canActOn: (step: StepKey, r: CustomerRequest) => boolean;
  /** May this person see a back-office queue at all — nav link and tab. */
  canSeeQueue: (step: StepKey) => boolean;

  stepOwnerFor: (step: StepKey) => StepOwner | undefined;
  stepOwnerIds: (step: StepKey) => string[];
  personName: (id: string | null | undefined) => string;

  queueEntries: CustomerQueueEntry[];
  queueFor: (step: StepKey) => CustomerQueueEntry[];
  completedFor: (step: StepKey) => CustomerRequest[];
  myDrafts: CustomerRequest[];
  myRequests: CustomerRequest[];
  dueIsoFor: (r: CustomerRequest) => string | null;
  openStepOf: (r: CustomerRequest) => StepKey | null;

  /** Would this request need a director if the sales head approved it right now? */
  wouldNeedDirector: (r: CustomerRequest) => boolean;

  refresh: () => Promise<void>;
  writes: typeof writes;
}

const Ctx = createContext<CustomerStore | null>(null);

export function CustomerOnboardingProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin, canEditModule, isModuleViewer: moduleIsViewer } = useSession();
  // Module-level write ceiling for Customer Onboarding. Its own grant, not the
  // hub's — the two are separate modules even though they share these pages.
  const canEdit = canEditModule("customer-onboarding");
  // A "View only" grant reads the whole module: every back-office queue, no
  // buttons. VISIBILITY ONLY — folded into canSeeQueue and nothing else, and
  // deliberately not an arm on isCoordinator, which also short-circuits canActOn.
  const isModuleViewer = moduleIsViewer("customer-onboarding");
  const queryClient = useQueryClient();
  const uid = user?.id ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: customerQueryKey(uid),
    queryFn: fetchCustomerData,
    enabled: !!uid,
  });

  // Org-wide name lookup. Without it every "verified by" reads "Unknown user"
  // for anyone outside the viewer's own RLS-scoped directory slice.
  const { data: orgPeople } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });

  const snap = data ?? EMPTY;

  const invalidate = useCallback(async () => {
    // Prefix-matched on purpose: hits every user-suffixed key of this module,
    // and ONLY this module's keys.
    await queryClient.invalidateQueries({ queryKey: CUSTOMER_QK });
  }, [queryClient]);

  const value = useMemo<CustomerStore>(() => {
    const requests = snap.requests;
    const byId = new Map(requests.map((r) => [r.id, r]));
    const ownerByStep = new Map(snap.stepOwners.map((o) => [o.stepKey, o]));
    // Built from EVERY company, active or not — a request onboarded into a
    // company that has since been deactivated must still render its name.
    const companyLabel = new Map(snap.companies.map((c) => [c.id, companyDisplayName(c)]));
    const peopleById = new Map((orgPeople ?? []).map((p: { id: string; name: string }) => [p.id, p.name]));

    const isCoordinator = isAdmin || (uid ? snap.coordinatorIds.includes(uid) : false);
    const stepOwnerIds = (step: StepKey): string[] => ownerByStep.get(step)?.employeeIds ?? [];
    const isStepOwner = (step: StepKey): boolean => !!uid && stepOwnerIds(step).includes(uid);

    // A 'submission' owner list, when non-empty, restricts who may raise.
    // No list at all = anyone with hub access may raise one.
    const submissionOwners = stepOwnerIds("submission");
    const canRaise =
      canEdit && (isCoordinator || submissionOwners.length === 0 || (!!uid && submissionOwners.includes(uid)));

    /**
     * ⚠ Mirrors public.fms_customer_can_act(step, req, uid). Keep the two in step.
     *
     * ⚠ THE canEdit ARM IS THE MIRROR, NOT AN ADDITION. 20260923120000 wrapped the
     *   SQL predicate as `module_can_edit(uid, customer-onboarding) AND
     *   fms_customer_can_act__ungated(...)`, and this copy was not updated with it —
     *   so on a view-only grant every correction and step button rendered live and
     *   then failed at the RPC.
     */
    const canActOn = (step: StepKey, r: CustomerRequest): boolean => {
      if (!uid || !canEdit) return false;
      if (isCoordinator) return true;
      if (step === "submission") return r.raisedBy === uid;
      return isStepOwner(step);
    };

    /**
     * May this person see a back-office queue at all — the nav link and the tab?
     *
     * The four OWNED_STEPS have no per-row arm in `canActOn` (only `submission`
     * does, and it has no queue), so this is the whole rule for them.
     *
     * ⚠ THE NAV USED TO ADD "…or the queue is non-empty", reading `queueFor`,
     *   which returns EVERY pending entry rather than the reader's. It was true
     *   for everyone whenever a step had work, so all four queues showed for any
     *   user of the module — the opposite of what nav.tsx's own header promises.
     */
    const canSeeQueue = (step: StepKey): boolean => isModuleViewer || isCoordinator || isStepOwner(step);

    const queueEntries = buildQueueEntries(requests, snap.stepSla);

    /**
     * Mirrors fms_customer_director_required() so the Sales Head panel can render
     * the escalation box ticked-and-disabled with a truthful caption BEFORE the
     * decision is sent. The server recomputes it; this is only the caption.
     */
    const wouldNeedDirector = (r: CustomerRequest): boolean => {
      const rules = snap.approvalRules;
      if (r.paymentTerms === "advance" && rules.exemptAdvanceTerms) return false;
      const limit = r.accRecommendedLimit ?? r.requestedCreditLimit;
      if (limit === null && rules.exemptWhenNoLimitRequested) return false;
      return (limit ?? 0) > rules.directorThreshold;
    };

    return {
      loading: isLoading,
      error: error ? (error as Error).message : null,

      requests,
      requestById: (id) => byId.get(id),
      companies: snap.companies.filter((c) => c.active),
      companyName: (id) => (id ? companyLabel.get(id) ?? "—" : "—"),
      gstStates: snap.gstStates,
      stepOwners: snap.stepOwners,
      approvalRules: snap.approvalRules,
      stepSla: snap.stepSla,
      notifications: snap.notifications,
      activityFor: (entityId) =>
        snap.activity
          .filter((a) => a.entityId === entityId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),

      isAdmin,
      canEdit,
      isCoordinator,
      coordinatorIds: snap.coordinatorIds,
      isStepOwner,
      isAnyStepOwner: OWNED_STEPS.some((s) => isStepOwner(s)),
      canRaise,
      canActOn,
      canSeeQueue,

      stepOwnerFor: (step) => ownerByStep.get(step),
      stepOwnerIds,
      personName: (id) => (id ? (peopleById.get(id) ?? "Unknown user") : "—"),

      queueEntries,
      queueFor: (step) => queueEntries.filter((e) => e.stepKey === step),
      completedFor: (step) => completedFor(requests, step),
      myDrafts: requests.filter((r) => r.status === "draft" && r.raisedBy === uid),
      myRequests: requests.filter((r) => r.raisedBy === uid && r.status !== "draft"),
      dueIsoFor: (r) => customerDueIso(r, snap.stepSla),
      openStepOf: (r) => openStep(r),

      wouldNeedDirector,

      refresh: invalidate,
      writes,
    };
    // ⚠ EVERY snapshot slice belongs in this list. Leave one out and its screen
    //   keeps rendering the pre-write value after a successful save — the classic
    //   "I saved it and nothing happened" bug in these stores.
  }, [snap, orgPeople, isAdmin, uid, isLoading, error, invalidate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCustomerStore(): CustomerStore {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useCustomerStore must be used inside <CustomerOnboardingProvider>");
  }
  return ctx;
}

/**
 * Run a write and refresh the snapshot. Every caller in the module goes through
 * this so no screen can forget the invalidation.
 */
export function useCustomerAction() {
  const s = useCustomerStore();
  return useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      const out = await fn();
      await s.refresh();
      return out;
    },
    [s],
  );
}
