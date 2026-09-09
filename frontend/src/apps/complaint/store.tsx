import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import type { Department as OrgDepartment, Profile } from "@/core/platform/types";
import { fetchComplaintData, complaintQueryKey } from "./data/complaintFetch";
import type { ComplaintData } from "./data/complaintFetch";
import {
  COMPLAINT_MASTERS_QK,
  fetchComplaintMasters,
  partiesForCompany,
  type ComplaintMasters,
  type ComplaintParty,
  type NamedRow,
} from "./data/complaintMasters";
import * as W from "./data/complaintWrites";
import {
  buildQueueEntries,
  completedEntriesFor,
  complaintDueIso,
  complaintSnapshotFrom,
  isOpenRequest,
  openStep,
  type ComplaintSnapshot,
  type QueueEntry,
  type StageEntry,
} from "./lib/queues";
import { partyFlagOf } from "./lib/format";
import type { StepKey } from "./lib/steps";
import type {
  ComplaintActivity,
  ComplaintDoc,
  ComplaintEntityType,
  ComplaintMasterRequest,
  ComplaintMasterType,
  ComplaintNature,
  ComplaintNotification,
  ComplaintRequest,
  ComplaintType,
  Designation,
  RootCause,
  StepOwner,
} from "./types";
import type { StepSlaMap } from "./lib/sla";

const APP_ID = "complaint";

interface ComplaintStoreValue {
  loading: boolean;
  error: unknown;

  /* ------------------------------- raw data ------------------------------- */
  requests: ComplaintRequest[];
  docs: ComplaintDoc[];
  natures: ComplaintNature[];
  rootCauses: RootCause[];
  stepOwners: StepOwner[];
  designations: Designation[];
  masterRequests: ComplaintMasterRequest[];
  stepSla: StepSlaMap;
  /** The signed-in user's visible directory, for every people picker in Setup. */
  profiles: Profile[];
  /** Org departments — the UI filter that narrows a step-owner people picker. */
  orgDepartments: OrgDepartment[];
  processCoordinatorIds: string[];
  /** The owners configured for one step, or undefined when nobody is assigned. */
  ownerFor: (stepKey: StepKey) => StepOwner | undefined;
  /** Who owns one master today — seeds the Master Owners editor. */
  managerIdsFor: (mt: ComplaintMasterType) => string[];
  /** Central masters, behind their own query key — see data/complaintMasters.ts. */
  parties: ComplaintParty[];
  companies: NamedRow[];
  units: NamedRow[];

  /* ------------------------------ capabilities ---------------------------- */
  isAdmin: boolean;
  /**
   * THE MODULE-LEVEL WRITE CEILING — never a permission in its own right.
   *
   * ⚠ AND it into writes and button sites. It is deliberately NOT folded into
   *   `canActOn`, `canSeeQueue` or `isProcessCoordinator`: those three decide
   *   which QUEUES and SCREENS a person sees, and a view-only user must still
   *   see them. Fold it in and a viewer gets an empty app or Access Denied.
   *
   * ⚠ Read from the REAL session, never a demo persona — a persona must not be
   *   able to step around the real user's view-only grant.
   */
  canEdit: boolean;
  /**
   * A "View only" grant here is a READ-THE-WHOLE-MODULE grant: every queue, every
   * list, the Control Center, the Masters screens — and no buttons.
   *
   * ⚠ VISIBILITY ONLY, which is why it is its own flag rather than an arm on
   *   `isProcessCoordinator` — that one is a route guard AND the authority
   *   short-circuit inside `canActOn`, so widening it would hand a viewer
   *   act-authority on every step of every complaint.
   */
  isModuleViewer: boolean;
  isProcessCoordinator: boolean;
  /** NAV VISIBILITY ONLY — never authorization; use canActOn for that. */
  isStepOwner: (stepKey: StepKey) => boolean;
  /** ⚠ MIRRORS the SQL `fms_complaint_can_act(step, req, uid)`. Keep them in step. */
  canActOn: (stepKey: StepKey, r: ComplaintRequest) => boolean;
  canSeeQueue: (stepKey: StepKey) => boolean;
  /** Visibility half of isProcessCoordinator — the Control Center nav link and route. */
  canMonitor: boolean;
  /** Visibility half of isAnyMasterManager — the Masters nav link and route. */
  canSeeMasters: boolean;
  isAnyMasterManager: boolean;
  /** A pure WRITE gate — drives MasterCrud's Add button and Actions column. */
  canManage: (masterType: ComplaintMasterType) => boolean;
  /** May this person raise a complaint at all? Setup may restrict it; unset means anyone. */
  canRaise: boolean;

  /* -------------------------------- derived ------------------------------- */
  queueEntries: QueueEntry[];
  myQueue: (stepKey: StepKey) => QueueEntry[];
  completedFor: (stepKey: StepKey) => StageEntry<ComplaintRequest>[];
  dueIsoFor: (r: ComplaintRequest, step: StepKey) => string | null;
  queueOwnerIds: (e: QueueEntry) => string[];
  requestById: (id: string) => ComplaintRequest | undefined;
  /** Still owed by somebody — a rejected / closed / cancelled complaint is not. */
  isOpenRequest: (r: ComplaintRequest) => boolean;
  docsFor: (complaintId: string) => ComplaintDoc[];
  natureName: (id: string | null) => string;
  rootCauseName: (id: string | null) => string;
  companyName: (id: string | null) => string;
  personName: (id: string | null) => string;
  /** The directory row for an id, for anything needing more than a name (avatar colour). */
  profileById: (id: string) => Profile | undefined;
  /**
   * The parties a complaint of this company + type may name.
   *
   * `includeId` keeps a party already saved on a row selectable even if it has
   * since been deactivated or moved book — an edit screen must never silently
   * drop the value it is editing.
   */
  partiesFor: (
    companyId: string | null,
    complaintType: ComplaintType,
    includeId?: string | null,
  ) => ComplaintParty[];
  activityFor: (entityType: ComplaintEntityType, entityId: string) => ComplaintActivity[];
  notifications: ComplaintNotification[];
  unreadCount: number;

  /* --------------------------------- writes ------------------------------- */
  submitRequest: (input: W.RequestInput) => Promise<string>;
  recordPlant: (id: string, input: W.PlantInput) => Promise<void>;
  recordService: (id: string, input: W.ServiceInput) => Promise<void>;
  recordServiceClose: (id: string, input: W.ServiceCloseInput) => Promise<void>;
  recordApproval: (id: string, input: W.ApprovalInput) => Promise<void>;
  recordManagementReview: (id: string, input: W.ManagementReviewInput) => Promise<void>;
  holdRequest: (id: string, hold: boolean, reason?: string) => Promise<void>;
  cancelRequest: (id: string, reason: string) => Promise<void>;
  uploadDoc: (id: string, slot: ComplaintDoc["slot"], stepKey: string, file: File) => Promise<void>;
  deleteDoc: (docId: string) => Promise<void>;
  docUrl: (path: string) => Promise<string>;
  saveNature: (id: string | null, input: W.NatureInput) => Promise<void>;
  saveRootCause: (id: string | null, input: W.RootCauseInput) => Promise<void>;
  setMasterActive: (
    table: "fms_complaint_natures" | "fms_complaint_root_causes",
    id: string,
    active: boolean,
  ) => Promise<void>;
  setMasterManagers: (mt: ComplaintMasterType, userIds: string[]) => Promise<void>;
  saveStepOwner: (input: W.StepOwnerInput) => Promise<void>;
  saveProcessCoordinators: (userIds: string[]) => Promise<void>;
  saveStepSla: (map: Record<string, unknown>) => Promise<void>;
  saveApprovalThreshold: (threshold: number) => Promise<void>;
  /** The credit-note value above which approval is required. */
  approvalThreshold: number;
  requestNewMaster: (mt: ComplaintMasterType, payload: Record<string, unknown>) => Promise<string>;
  resolveMasterRequest: (
    id: string,
    approve: boolean,
    payload: Record<string, unknown> | null,
    note: string | null,
  ) => Promise<void>;
  markNotificationsRead: (ids: string[]) => Promise<void>;
}

const Ctx = createContext<ComplaintStoreValue | null>(null);

const EMPTY_DATA: ComplaintData = {
  stepOwners: [],
  designations: [],
  config: { processCoordinatorIds: [], stepSla: {} as StepSlaMap, approvalThreshold: 25000 },
  natures: [],
  rootCauses: [],
  masterManagers: [],
  masterRequests: [],
  requests: [],
  docs: [],
  activity: [],
  notifications: [],
};

const EMPTY_MASTERS: ComplaintMasters = { parties: [], companies: [], units: [] };

export function ComplaintStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const dir = useDirectory();
  const queryClient = useQueryClient();
  const userId = session.user?.id ?? null;
  const isAdmin = session.isAdmin;

  const { data, isLoading, error } = useQuery({
    queryKey: complaintQueryKey(userId),
    queryFn: fetchComplaintData,
    enabled: !!session.user,
  });

  // The central masters, on their own key and their own cadence — they change
  // only when the 15-minute Tally sync runs, so re-fetching them with the module
  // snapshot on every write would re-download ~22,000 rows for nothing.
  const { data: masters } = useQuery({
    queryKey: COMPLAINT_MASTERS_QK,
    queryFn: fetchComplaintMasters,
    enabled: !!session.user,
    staleTime: 5 * 60 * 1000,
  });

  // Org-wide names, so a colleague's completed entry never renders blank: the
  // directory `profiles` are RLS-scoped, so a cross-team actor would not resolve.
  const { data: orgPeople } = useQuery({
    queryKey: ["orgPeople"],
    queryFn: fetchOrgPeople,
    staleTime: 5 * 60 * 1000,
  });

  const d = data ?? EMPTY_DATA;
  const m = masters ?? EMPTY_MASTERS;

  const value = useMemo<ComplaintStoreValue>(() => {
    const uid = userId ?? "";
    const {
      requests,
      docs,
      natures,
      rootCauses,
      stepOwners,
      designations,
      masterManagers,
      masterRequests,
      activity,
      notifications,
      config,
    } = d;
    const { processCoordinatorIds, stepSla, approvalThreshold } = config;

    /* ------------------------------ capabilities ---------------------------- */

    const ownerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);

    /**
     * NAV VISIBILITY ONLY. Hiding a queue from an owner just because it is
     * momentarily empty would be worse than showing it — but NEVER use this to
     * authorize an action; `canActOn` is the only thing that may.
     */
    const isStepOwner = (stepKey: StepKey): boolean =>
      isAdmin || (ownerFor(stepKey)?.employeeIds.includes(uid) ?? false);

    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(uid);
    const isModuleViewer = session.isModuleViewer(APP_ID);
    const canMonitor = isModuleViewer || isProcessCoordinator;
    const canEdit = session.canEditModule(APP_ID);

    /**
     * Raising is a step with owners, so Setup can restrict it — but an EMPTY
     * owner list means "anyone who may edit", not "nobody". A module whose raise
     * step nobody has configured must still be usable on day one.
     */
    const raiseOwners = ownerFor("raise")?.employeeIds ?? [];
    const canRaise = canEdit && (isAdmin || raiseOwners.length === 0 || raiseOwners.includes(uid));

    /**
     * ⚠ MIRRORS `fms_complaint_can_act(step, req, uid)`, which is now three lines
     *   long: this chain routes to BUCKETS — plant, service, management — not to
     *   people named on the complaint. Authorization is entirely the step's owners
     *   in Setup, plus admins and coordinators.
     *
     * The `r` argument is kept because the SQL still takes the complaint and a
     * future rule may need it; today nothing in the predicate reads it.
     */
    const canActOn = (stepKey: StepKey, _r: ComplaintRequest): boolean =>
      isAdmin || isProcessCoordinator || isStepOwner(stepKey);

    const managerIdsFor = (mt: ComplaintMasterType) =>
      masterManagers.filter((x) => x.masterType === mt).map((x) => x.managerUserId);

    // A pure WRITE gate, so the ceiling folds straight in. `isAnyMasterManager`
    // below is the ROUTE authority and deliberately does not.
    const canManage = (mt: ComplaintMasterType) =>
      canEdit && (isAdmin || managerIdsFor(mt).includes(uid));
    const isAnyMasterManager = isAdmin || masterManagers.some((x) => x.managerUserId === uid);
    const canSeeMasters = isModuleViewer || isAnyMasterManager;

    /* --------------------------------- indexes ------------------------------- */

    const requestMap = new Map(requests.map((r) => [r.id, r]));
    const natureMap = new Map(natures.map((n) => [n.id, n.name]));
    const rootCauseMap = new Map(rootCauses.map((c) => [c.id, c.name]));
    const companyMap = new Map(m.companies.map((c) => [c.id, c.name]));

    const docsByComplaint = new Map<string, ComplaintDoc[]>();
    for (const doc of docs) {
      const list = docsByComplaint.get(doc.complaintId) ?? [];
      list.push(doc);
      docsByComplaint.set(doc.complaintId, list);
    }

    const activityByEntity = new Map<string, ComplaintActivity[]>();
    for (const a of activity) {
      const k = `${a.entityType}:${a.entityId}`;
      const list = activityByEntity.get(k) ?? [];
      list.push(a);
      activityByEntity.set(k, list);
    }

    // Newest first — the base fetch orders ascending.
    const mine = notifications
      .filter((n) => n.userId === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const personName = (id: string | null): string => {
      if (!id) return "—";
      const p = dir.profiles.find((x) => x.id === id);
      if (p) return p.name;
      const o = (orgPeople ?? []).find((x) => x.id === id);
      return o?.name ?? "—";
    };

    /* --------------------------------- derived ------------------------------- */

    const snapshot: ComplaintSnapshot = complaintSnapshotFrom({ requests, stepSla });
    const queueEntries = buildQueueEntries(snapshot);

    const myQueue = (stepKey: StepKey): QueueEntry[] =>
      queueEntries.filter((e) => {
        if (e.stepKey !== stepKey) return false;
        const r = requestMap.get(e.requestId);
        return r ? canActOn(stepKey, r) : false;
      });


    /**
     * May this person see the step's QUEUE at all — the nav link, the route, the page?
     *
     * Simple now that the chain routes to buckets: you see a queue if you own the
     * step, coordinate the process, or read the whole module. The earlier chain
     * needed `ever*` flags because its actors were named per complaint and owned
     * no step; none of that applies here.
     */
    const canSeeQueue = (stepKey: StepKey): boolean =>
      isModuleViewer || isProcessCoordinator || isStepOwner(stepKey) || myQueue(stepKey).length > 0;

    const queueOwnerIds = (e: QueueEntry): string[] => ownerFor(e.stepKey)?.employeeIds ?? [];

    const partiesFor = (
      companyId: string | null,
      complaintType: ComplaintType,
      includeId?: string | null,
    ): ComplaintParty[] =>
      partiesForCompany(m.parties, companyId, partyFlagOf(complaintType), includeId ?? null);

    /* --------------------------------- writes -------------------------------- */

    const refresh = async () => {
      await queryClient.invalidateQueries({ queryKey: complaintQueryKey(userId) });
    };

    /** Wrap a write so every mutation refreshes the one snapshot the module reads. */
    const w =
      <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        const out = await fn(...args);
        await refresh();
        return out;
      };

    return {
      loading: isLoading,
      error,

      requests,
      docs,
      natures,
      rootCauses,
      stepOwners,
      designations,
      masterRequests,
      stepSla,
      profiles: dir.profiles,
      orgDepartments: dir.departments,
      processCoordinatorIds,
      ownerFor,
      managerIdsFor,
      parties: m.parties,
      companies: m.companies,
      units: m.units,

      isAdmin,
      canEdit,
      isModuleViewer,
      isProcessCoordinator,
      isStepOwner,
      canActOn,
      canSeeQueue,
      canMonitor,
      canSeeMasters,
      isAnyMasterManager,
      canManage,
      canRaise,

      queueEntries,
      myQueue,
      completedFor: (stepKey: StepKey) => completedEntriesFor(stepKey, snapshot),
      dueIsoFor: (r: ComplaintRequest, step: StepKey) => complaintDueIso(snapshot, r, step),
      queueOwnerIds,
      requestById: (id: string) => requestMap.get(id),
      isOpenRequest,
      docsFor: (complaintId: string) => docsByComplaint.get(complaintId) ?? [],
      natureName: (id: string | null) => (id ? (natureMap.get(id) ?? "—") : "—"),
      rootCauseName: (id: string | null) => (id ? (rootCauseMap.get(id) ?? "—") : "—"),
      companyName: (id: string | null) => (id ? (companyMap.get(id) ?? "—") : "—"),
      personName,
      profileById: (id: string) => dir.profiles.find((x) => x.id === id),
      partiesFor,
      activityFor: (entityType, entityId) => activityByEntity.get(`${entityType}:${entityId}`) ?? [],
      notifications: mine,
      unreadCount: mine.filter((n) => !n.readAt).length,

      submitRequest: w(W.submitRequest),
      recordPlant: w(W.recordPlant),
      recordService: w(W.recordService),
      recordServiceClose: w(W.recordServiceClose),
      recordApproval: w(W.recordApproval),
      recordManagementReview: w(W.recordManagementReview),
      holdRequest: w(W.holdRequest),
      cancelRequest: w(W.cancelRequest),
      uploadDoc: w(async (id: string, slot: ComplaintDoc["slot"], stepKey: string, file: File) => {
        await W.uploadDoc(id, slot, stepKey, file);
      }),
      deleteDoc: w(W.deleteDoc),
      // NOT wrapped: minting a signed URL changes nothing, and refreshing the
      // whole snapshot on every document click would be a re-download per view.
      docUrl: W.docUrl,
      saveNature: w(W.saveNature),
      saveRootCause: w(W.saveRootCause),
      setMasterActive: w(W.setMasterActive),
      setMasterManagers: w(W.setMasterManagers),
      saveStepOwner: w(W.saveStepOwner),
      saveProcessCoordinators: w(W.saveProcessCoordinators),
      saveStepSla: w(W.saveStepSla),
      saveApprovalThreshold: w(W.saveApprovalThreshold),
      approvalThreshold,
      requestNewMaster: w(W.requestNewMaster),
      resolveMasterRequest: w(W.resolveMasterRequest),
      markNotificationsRead: w(W.markNotificationsRead),
    };
    // ⚠ EVERY array read out of `d` and `m` above must be listed here, or a screen
    //   keeps rendering the previous fetch's rows after a write. `d` and `m` are
    //   the whole snapshots, so listing them covers their members — do not
    //   "optimise" them into individual fields without listing every one.
  }, [d, m, orgPeople, dir.profiles, isAdmin, userId, isLoading, error, queryClient, session]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useComplaintStore(): ComplaintStoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useComplaintStore must be used inside ComplaintStoreProvider");
  return v;
}

/** Re-exported so pages can ask "is this still open?" without importing lib/queues. */
export { openStep };
