import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople } from "@/core/platform/orgPeople";
import type { Department as OrgDepartment, Profile } from "@/core/platform/types";
import { SUPPLIES_QK, fetchSuppliesData, suppliesQueryKey } from "./data/suppliesFetch";
import {
  announce as announceWrite,
  cancelRequest as cancelRequestWrite,
  decideFirstApproval as decideFirstApprovalWrite,
  decideSecondApproval as decideSecondApprovalWrite,
  holdRequest as holdRequestWrite,
  insertCategory as insertCategoryWrite,
  insertCompany as insertCompanyWrite,
  insertDepartment as insertDepartmentWrite,
  insertItem as insertItemWrite,
  insertServiceType as insertServiceTypeWrite,
  markNotificationsRead as markNotificationsReadWrite,
  recordHandover as recordHandoverWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  setConfig as setConfigWrite,
  reassignRequest as reassignRequestWrite,
  setMasterManagers as setMasterManagersWrite,
  setStepOwner as setStepOwnerWrite,
  submitRequest as submitRequestWrite,
  updateRequest as updateRequestWrite,
  updateCategory as updateCategoryWrite,
  updateCompany as updateCompanyWrite,
  updateDepartment as updateDepartmentWrite,
  updateItem as updateItemWrite,
  updateServiceType as updateServiceTypeWrite,
  updateFirstApproval as updateFirstApprovalWrite,
  updateSecondApproval as updateSecondApprovalWrite,
  updateHandover as updateHandoverWrite,
  type CategoryInput,
  type CompanyInput,
  type DepartmentInput,
  type HandoverInput,
  type ItemInput,
  type RequestInput,
  type ServiceTypeInput,
  type StepOwnerInput,
} from "./data/suppliesWrites";
import {
  buildQueueEntries,
  isOpenRequest,
  supplyDueIso,
  supplySnapshotFrom,
  completedFirstApprovalEntries,
  completedSecondApprovalEntries,
  completedHandoverEntries,
  type QueueEntry,
  type StageEntry,
  type SupplySnapshot,
} from "./lib/queues";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import { masterTypeLabel } from "./lib/masterFields";
import type { StepKey } from "./lib/steps";
import type {
  Category,
  Company,
  Department,
  Designation,
  Item,
  ServiceType,
  StepOwner,
  SupplyActivity,
  SupplyEntityType,
  SupplyMasterManager,
  SupplyMasterRequest,
  SupplyMasterType,
  SupplyNotification,
  SupplyRequest,
} from "./types";

const QK = SUPPLIES_QK;

const FULFILMENT_STEPS: StepKey[] = ["second_approval", "handover"];

interface SuppliesStoreValue {
  isLoading: boolean;
  error: unknown;

  // directory (portal)
  profiles: Profile[];
  orgDepartments: OrgDepartment[];
  designations: Designation[];
  profileById: (id: string) => Profile | undefined;

  // masters
  companies: Company[];
  departments: Department[];
  categories: Category[];
  items: Item[];
  serviceTypes: ServiceType[];
  activeCompanies: Company[];
  activeDepartments: Department[];
  activeCategories: Category[];
  activeServiceTypes: ServiceType[];
  itemsForCategory: (categoryId: string) => Item[];
  companyById: (id: string) => Company | undefined;
  departmentById: (id: string) => Department | undefined;
  /** The signed-in user's own department, from their profile. Null when unmapped. */
  myDepartment: Department | null;
  categoryById: (id: string) => Category | undefined;
  serviceTypeById: (id: string) => ServiceType | undefined;

  // config
  stepOwners: StepOwner[];
  stepOwnerFor: (stepKey: StepKey) => StepOwner | undefined;
  processCoordinatorIds: string[];
  /** Who may raise a request. EMPTY MEANS NOBODY BUT ADMINS — see SuppliesConfig. */
  requesterIds: string[];
  /** Designations that skip the HOD approval — see SuppliesConfig. */
  hodDesignationIds: string[];
  stepSla: StepSlaMap;

  // capabilities
  isAdmin: boolean;
  /**
   * Does this person's grant on General Purchase allow CHANGING anything? False
   * only on a view-only grant (Admin → Module Access).
   *
   * ⚠ A CEILING, never a permission. It grants nothing — a person still has to be
   *   a named requester, a step owner, a coordinator or a master manager exactly
   *   as before. It only takes away, so it is ANDed into the write predicates and
   *   the button sites and is deliberately kept OUT of `canActOn`, `canSeeQueue`
   *   and `isProcessCoordinator`, which decide what a person can SEE.
   *
   * ⚠ Combines WITH the `requesters` list, it does not replace it (see
   *   20260905120000_add_fms_supplies_raise_gate_and_hod_routing.sql) — a
   *   view-only person on the requester list still may not raise.
   */
  canEdit: boolean;
  isProcessCoordinator: boolean;
  isStepOwner: (stepKey: StepKey) => boolean;
  isFulfilmentStaff: boolean;
  /** May this person raise a request at all? Mirrors fms_supplies_can_raise. */
  canRaise: boolean;
  /** Departments this user is the HOD of — drives the First Approval queue visibility. */
  hodDepartmentIds: string[];
  canActOn: (stepKey: StepKey, r: SupplyRequest) => boolean;
  /** May this person see the step's queue at all — nav link, route, page. */
  canSeeQueue: (stepKey: StepKey) => boolean;

  // master governance
  masterManagers: SupplyMasterManager[];
  masterRequests: SupplyMasterRequest[];
  pendingRequests: SupplyMasterRequest[];
  managerIdsFor: (masterType: SupplyMasterType) => string[];
  canManage: (masterType: SupplyMasterType) => boolean;
  /**
   * Does this person hold a VIEW-ONLY grant on this module? They read every
   * screen in it and have no buttons anywhere.
   *
   * ⚠ VISIBILITY ONLY. Folded into canSeeQueue, canMonitor and canSeeMasters and
   *   nowhere else; canEdit is false for exactly these users.
   */
  isModuleViewer: boolean;
  /** Visibility half of isProcessCoordinator — the Control Center nav link and route. */
  canMonitor: boolean;
  /** Visibility half of isAnyMasterManager — the Masters nav link and route. */
  canSeeMasters: boolean;
  isAnyMasterManager: boolean;
  canManageMasters: boolean;
  resolvableRequests: SupplyMasterRequest[];
  myMasterRequests: SupplyMasterRequest[];
  masterReviewersFor: (masterType: SupplyMasterType) => string[];
  isMasterUnassigned: (masterType: SupplyMasterType) => boolean;
  setMasterManagers: (masterType: SupplyMasterType, userIds: string[]) => Promise<void>;
  requestNewMaster: (masterType: SupplyMasterType, payload: Record<string, unknown>) => Promise<string>;
  resolveMasterRequest: (
    requestId: string,
    approve: boolean,
    payload: Record<string, unknown> | null,
    note: string | null,
  ) => Promise<string | null>;

  // requests
  requests: SupplyRequest[];
  requestById: (id: string) => SupplyRequest | undefined;
  myRequests: SupplyRequest[];
  isOpenRequest: (r: SupplyRequest) => boolean;
  /** May the current user edit this request? Requester|admin|coordinator, and
   *  nobody has acted yet. */
  requestEditable: (r: SupplyRequest) => boolean;

  // queues
  queueEntries: QueueEntry[];
  myQueue: (stepKey: StepKey) => QueueEntry[];
  dueIsoFor: (r: SupplyRequest, stepKey: StepKey) => string | null;
  queueOwnerIds: (e: QueueEntry) => string[];

  /**
   * The "what I did here" side of each stage — every COMPLETED entry, unscoped.
   * Owner-agnostic on purpose (the Control Center needs the full set); the pages
   * scope to "mine" through `useStageMode`.
   */
  completedFirstApprovalEntries: StageEntry<SupplyRequest>[];
  completedSecondApprovalEntries: StageEntry<SupplyRequest>[];
  completedHandoverEntries: StageEntry<SupplyRequest>[];
  /** Every completed entry for one step — what RequestQueue renders. */
  completedFor: (stepKey: StepKey) => StageEntry<SupplyRequest>[];
  /** Org-wide name lookup for a stage actor — see the note at the query. */
  personName: (id: string | null) => string;

  // activity + bell
  activity: SupplyActivity[];
  activityFor: (entityType: SupplyEntityType, entityId: string) => SupplyActivity[];
  notifications: SupplyNotification[];
  unreadCount: number;
  markNotificationsRead: (ids: string[]) => Promise<void>;

  // workflow writes
  submitRequest: (input: RequestInput) => Promise<string>;
  updateRequest: (requestId: string, input: RequestInput) => Promise<void>;
  decideFirstApproval: (r: SupplyRequest, approve: boolean, remarks: string) => Promise<void>;
  decideSecondApproval: (r: SupplyRequest, approve: boolean, remarks: string) => Promise<void>;
  recordHandover: (r: SupplyRequest, input: HandoverInput) => Promise<void>;
  holdRequest: (r: SupplyRequest, hold: boolean, reason: string) => Promise<void>;
  cancelRequest: (r: SupplyRequest, reason: string) => Promise<void>;

  // stage edits — correcting an entry until the next step is done. Each RPC
  // re-checks its lock server-side and logs in-transaction, so none of these
  // needs a separate announce.
  updateFirstApproval: (r: SupplyRequest, approve: boolean, remarks: string) => Promise<void>;
  updateSecondApproval: (r: SupplyRequest, approve: boolean, remarks: string) => Promise<void>;
  updateHandover: (r: SupplyRequest, input: HandoverInput) => Promise<void>;
  /** Hand one request on, or pass approverId: null to return it to the department HOD. */
  reassignRequest: (input: { request: SupplyRequest; approverId: string | null; note?: string | null }) => Promise<void>;
  /** Whoever this request has been handed to, or null if it sits with the HOD. */
  holderOfRequest: (r: SupplyRequest) => string | null;
  /** May I hand this request on, or pull it back? Broader than deciding it. */
  canReassignRequest: (r: SupplyRequest) => boolean;
  /** Who it may be handed to: the configured pool plus this request's own HOD, minus me. */
  reassignCandidates: (r: SupplyRequest) => { id: string; name: string }[];
  /** Departments the Setup picker filters candidates by. A UI FILTER - grants nothing. */
  reassignPoolDepartmentIds: string[];
  /** Everyone who may be handed a request awaiting first approval. The authority. */
  reassignPoolUserIds: string[];

  // config writes
  setStepOwner: (stepKey: StepKey, input: StepOwnerInput) => Promise<void>;
  setStepSla: (map: StepSlaMap) => Promise<void>;
  setCoordinators: (userIds: string[]) => Promise<void>;
  setRequesters: (userIds: string[]) => Promise<void>;
  setHodDesignations: (designationIds: string[]) => Promise<void>;
  /** Save who may be handed a first approval. departmentIds is a picker filter and grants nothing. */
  setReassignPool: (input: { departmentIds: string[]; userIds: string[] }) => Promise<void>;

  // master writes
  insertCompany: (input: CompanyInput) => Promise<void>;
  updateCompany: (id: string, input: CompanyInput) => Promise<void>;
  insertDepartment: (input: DepartmentInput) => Promise<void>;
  updateDepartment: (id: string, input: DepartmentInput) => Promise<void>;
  insertCategory: (input: CategoryInput) => Promise<void>;
  updateCategory: (id: string, input: CategoryInput) => Promise<void>;
  insertItem: (input: ItemInput) => Promise<void>;
  updateItem: (id: string, input: ItemInput) => Promise<void>;
  insertServiceType: (input: ServiceTypeInput) => Promise<void>;
  updateServiceType: (id: string, input: ServiceTypeInput) => Promise<void>;
}

const Ctx = createContext<SuppliesStoreValue | null>(null);

export function SuppliesStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  const dir = useDirectory();
  const queryClient = useQueryClient();
  const userId = session.user?.id ?? null;
  const isAdmin = session.isAdmin;
  const myOrgDepartmentId = session.user?.departmentId ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: suppliesQueryKey(userId),
    queryFn: fetchSuppliesData,
    enabled: !!session.user,
  });

  // Org-wide names so a colleague's completed entry never renders blank: this
  // app's `profiles` come from the directory, which is RLS-scoped (self +
  // downline + same department), so a request approved by one department's HOD
  // and viewed from another would not resolve. list_org_people() is the SECURITY
  // DEFINER, name-only escape hatch.
  const { data: orgPeople } = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 5 * 60 * 1000 });

  const stepOwners = data?.stepOwners ?? [];
  const designations = data?.designations ?? [];
  const companies = data?.companies ?? [];
  const departments = data?.departments ?? [];
  const categories = data?.categories ?? [];
  const items = data?.items ?? [];
  const serviceTypes = data?.serviceTypes ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const requests = data?.requests ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const requesterIds = data?.config.requesterIds ?? [];
  const hodDesignationIds = data?.config.hodDesignationIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;
  const reassignPoolDepartmentIds = data?.config.reassignPoolDepartmentIds ?? [];
  const reassignPoolUserIds = data?.config.reassignPoolUserIds ?? [];

  const value = useMemo<SuppliesStoreValue>(() => {
    const uid = userId ?? "";
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    const stepOwnerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);
    const ownerIdsOf = (stepKey: StepKey): string[] => stepOwnerFor(stepKey)?.employeeIds ?? [];

    const isStepOwner = (stepKey: StepKey): boolean =>
      isAdmin || stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(uid));

    const isFulfilmentStaff =
      isAdmin || stepOwners.some((o) => FULFILMENT_STEPS.includes(o.stepKey as StepKey) && o.employeeIds.includes(uid));

    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(uid);

    /**
     * A "View only" grant on this module is a READ-THE-WHOLE-MODULE grant: every
     * queue, every list, the Control Center, the Masters screens — no buttons.
     *
     * ⚠ VISIBILITY ONLY, which is why it is a flag of its own rather than an arm
     *   on `isProcessCoordinator`. That one is a route guard AND the authority
     *   short-circuit inside canActOn, so widening it would hand a viewer
     *   act-authority on every step. `canMonitor` and `canSeeMasters` below are
     *   the visibility halves.
     *
     * ⚠ From the REAL `session`, never a demo persona — same reason as canEdit.
     *
     * A viewer therefore sees MORE screens than an editor who owns no step: that
     * inversion is deliberate. Ownership answers "whose work is this", the grant
     * answers "may this person read the module".
     */
    const isModuleViewer = session.isModuleViewer("office-supplies");

    /** Visibility half of the coordinator flag — nav link + RequireMonitor only. */
    const canMonitor = isModuleViewer || isProcessCoordinator;

    // Mirrors fms_supplies_can_raise(uid) — the RPC is the gate, this only
    // decides whether the nav item and the CTAs are worth showing.
    //
    // ⚠ An EMPTY list admits NOBODY but admins. Do not "helpfully" fall back to
    //   letting everyone through when nothing is configured: that is precisely
    //   the state this feature exists to close, and the strictness was asked for.
    // The module-level write ceiling — see the doc on canEdit. From `session`,
    // never a demo persona, so a persona cannot step around a real view-only grant.
    const canEdit = session.canEditModule("office-supplies");
    const canRaise = canEdit && (isAdmin || requesterIds.includes(uid));

    const hodDepartmentIds = departments.filter((d) => d.hodUserId === uid).map((d) => d.id);

    const departmentById = (id: string) => departments.find((d) => d.id === id);

    // The requester's own department, derived from their portal profile rather than
    // typed. Null when the profile has no department, or its portal department has
    // no live mirror row — the form then falls back to a picker so nobody is stuck.
    // fms_supplies_submit_request re-derives this server-side; the lock is not the gate.
    const myDepartment =
      departments.find((d) => d.active && d.orgDepartmentId && d.orgDepartmentId === myOrgDepartmentId) ?? null;

    // Mirrors fms_supplies_can_act(step, req, uid) — the same rule the update_*
    // RPCs enforce, so the greyed-out button and the server agree.
    //
    // first_approval is the department's HOD and NOBODY else — there is no
    // fall-through to the step-owner list. That list once granted org-wide reach,
    // which is exactly what let one department's HOD see another's requests.
    const canActOn = (stepKey: StepKey, r: SupplyRequest): boolean => {
      if (isAdmin || isProcessCoordinator) return true;
      if (stepKey === "first_approval") {
        // A HANDOVER MOVES THE WORK. While assignedApproverId is set the holder
        // is the only non-admin who may decide — deliberately NOT an OR with the
        // HOD, or the request would stay in his queue too and nothing would have
        // moved. Exact mirror of fms_supplies_can_act__ungated.
        if (r.assignedApproverId) return r.assignedApproverId === uid;
        const hod = departmentById(r.departmentId)?.hodUserId;
        return !!hod && hod === uid;
      }
      return isStepOwner(stepKey);
    };

    /** Whoever this request's first approval has been handed to, or null. */
    const holderOfRequest = (r: SupplyRequest): string | null => r.assignedApproverId;

    /**
     * Am I holding anything handed to me? The only reason somebody who heads no
     * department may reach the first-approval queue at all.
     */
    const holdsAnyReassigned = requests.some(
      (r) =>
        r.assignedApproverId === uid &&
        (r.status === "pending_first_approval" || r.status === "pending_second_approval")
    );

    /**
     * May I hand this on, or pull it back? Broader than deciding it: the HOD keeps
     * this after handing over, which is exactly how a request comes back.
     * Mirrors fms_supplies_reassign_request.
     *
     * WARNING: identity comes from the REAL `session`, never the effective
     * persona. This gates a write the server authorises against auth.uid(), so a
     * persona-derived gate would offer a button the RPC then refuses — and both
     * halves must come from `session`, since taking the real id but the persona's
     * isAdmin is the subtle version of the same bug.
     */
    const canReassignRequest = (r: SupplyRequest): boolean => {
      if (r.status !== "pending_first_approval") return false;
      const me = session.user?.id ?? "";
      if (!me || !canEdit) return false;
      if (session.isAdmin || processCoordinatorIds.includes(me)) return true;
      if (r.assignedApproverId === me) return true;
      return departmentById(r.departmentId)?.hodUserId === me;
    };

    /**
     * Who I may hand it to: the configured pool, plus this request's own HOD so it
     * can be handed BACK, minus me.
     *
     * Names resolve through `personName`, i.e. the ORG-WIDE list — the directory
     * is RLS-scoped, so a pool member in another department would render blank for
     * a non-admin HOD, who is precisely the person using this dialog.
     */
    const reassignCandidates = (r: SupplyRequest): { id: string; name: string }[] => {
      const ids = new Set<string>(reassignPoolUserIds);
      const hod = departmentById(r.departmentId)?.hodUserId;
      if (hod) ids.add(hod);
      ids.delete(session.user?.id ?? "");
      return [...ids]
        .map((id) => ({ id, name: personName(id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    };

    /**
     * May this person see the step's QUEUE at all — the nav link, the route, the page?
     *
     * ⚠ FIRST APPROVAL IS NOT A STEP-OWNER QUESTION, and asking `isStepOwner` here
     *   would both hide the queue from every HOD and show it to a step owner who may
     *   act on nothing. It belongs to whoever heads a department — `canActOn` then
     *   narrows the rows to that HOD's own department.
     *
     * The HOD route changes nothing here. A request raised BY an HOD skips straight
     * to second_approval, so it never enters this queue — but the queue itself stays
     * open to every department head, for their team's requests.
     */
    const canSeeQueue = (stepKey: StepKey): boolean => {
      // A view-only grant reads every queue, ahead of the HOD special case below.
      if (isModuleViewer || isProcessCoordinator) return true;
      // A holder heads no department, so without this arm the request would sit
      // in a queue they cannot open.
      if (stepKey === "first_approval") return hodDepartmentIds.length > 0 || holdsAnyReassigned;
      return isStepOwner(stepKey);
    };

    // Resolves against the org-wide list, not `dir.profileById`: the directory is
    // RLS-scoped, so a cross-department actor would render blank. Null actors are
    // real — every actor FK is `on delete set null`.
    const personName = (id: string | null): string => {
      if (!id) return "—";
      return (orgPeople ?? []).find((p) => p.id === id)?.name ?? "Unknown user";
    };

    /* --------------------------- master governance --------------------------- */

    const managerIdsFor = (mt: SupplyMasterType) =>
      masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId);
    // Pure write gate (MasterCrud's Add button + Actions column), so the ceiling
    // folds in. isAnyMasterManager is left alone: it guards the Masters ROUTE, and
    // a view-only master manager should still read the masters they look after.
    const canManage = (mt: SupplyMasterType) => canEdit && (isAdmin || managerIdsFor(mt).includes(uid));
    const isAnyMasterManager = isAdmin || masterManagers.some((m) => m.managerUserId === uid);
    /** Visibility half — nav link + RequireMasterAccess. canManage still gates every write. */
    const canSeeMasters = isModuleViewer || isAnyMasterManager;
    const resolvableRequests = masterRequests.filter((r) => r.status === "pending").filter((r) => canManage(r.masterType));
    const adminIds = () => dir.profiles.filter((p) => p.role === "admin").map((p) => p.id);
    const masterReviewersFor = (mt: SupplyMasterType): string[] => {
      const ids = managerIdsFor(mt);
      return ids.length ? ids : adminIds();
    };
    const isMasterUnassigned = (mt: SupplyMasterType) => managerIdsFor(mt).length === 0;

    /* --------------------------------- indexes ------------------------------- */

    const activityByEntity = new Map<string, SupplyActivity[]>();
    for (const a of activity) {
      const k = `${a.entityType}:${a.entityId}`;
      const list = activityByEntity.get(k) ?? [];
      list.push(a);
      activityByEntity.set(k, list);
    }

    // Newest first. The base fetch orders ascending, so without this the bell
    // read oldest-first — the stalest ping at the top.
    const mine = notifications
      .filter((n) => n.userId === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const safeAnnounce = async (input: Parameters<typeof announceWrite>[0]) => {
      try {
        await announceWrite(input);
      } catch {
        /* best-effort; state lives on the request row */
      }
    };

    const requestMap = new Map(requests.map((r) => [r.id, r]));

    const itemsByCategory = new Map<string, Item[]>();
    for (const it of items) {
      const list = itemsByCategory.get(it.categoryId) ?? [];
      list.push(it);
      itemsByCategory.set(it.categoryId, list);
    }
    for (const list of itemsByCategory.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    }

    const snapshot: SupplySnapshot = supplySnapshotFrom({ requests, stepSla });
    const queueEntries = buildQueueEntries(snapshot);
    // Unscoped, like every predicate in lib/queues.ts — the pages narrow to
    // "mine" via useStageMode, and the Control Center needs the full set.
    const firstEntries = completedFirstApprovalEntries(snapshot);
    const secondEntries = completedSecondApprovalEntries(snapshot);
    const handoverEntries = completedHandoverEntries(snapshot);

    /**
     * VISIBILITY — is this entry on MY desk? Deliberately NOT `canActOn`, which is
     * AUTHORITY and opens with an admin arm.
     *
     * ⚠ THE QUEUE HAS TO FOLLOW THE HOLDER EVEN FOR AN ADMIN. Without this the
     *   handover leaves an admin's queue never — `canActOn` returns true for them
     *   on everything — so the one thing the feature promises, that the work
     *   MOVES, is invisible to exactly the people most likely to be testing it.
     *   Caught in the browser; `tsc` and the build both passed.
     */
    const stepIsMine = (stepKey: StepKey, r: SupplyRequest): boolean => {
      if (stepKey === "first_approval" && r.assignedApproverId) return r.assignedApproverId === uid;
      return canActOn(stepKey, r);
    };

    const myQueue = (stepKey: StepKey): QueueEntry[] =>
      queueEntries.filter((e) => {
        if (e.stepKey !== stepKey) return false;
        const r = requestMap.get(e.requestId);
        return r ? stepIsMine(stepKey, r) : false;
      });

    // "Pending with" — for first_approval that is whoever it was HANDED to, and
    // otherwise the department's HOD alone. Merging in the step-owner list here
    // would name people who can no longer act.
    const queueOwnerIds = (e: QueueEntry): string[] => {
      if (e.stepKey === "first_approval") {
        if (e.assignedApproverId) return [e.assignedApproverId];
        const r = requestMap.get(e.requestId);
        const hod = r ? departmentById(r.departmentId)?.hodUserId : null;
        return hod ? [hod] : [];
      }
      return ownerIdsOf(e.stepKey);
    };

    const byOrder = <T extends { active: boolean; sortOrder: number; name: string }>(rows: T[]): T[] =>
      rows.filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    return {
      isLoading,
      error,

      profiles: dir.profiles,
      orgDepartments: dir.departments,
      designations,
      profileById: dir.profileById,

      companies,
      departments,
      categories,
      items,
      serviceTypes,
      activeCompanies: byOrder(companies),
      activeDepartments: byOrder(departments),
      activeCategories: byOrder(categories),
      activeServiceTypes: byOrder(serviceTypes),
      itemsForCategory: (categoryId) => (itemsByCategory.get(categoryId) ?? []).filter((i) => i.active),
      companyById: (id) => companies.find((c) => c.id === id),
      departmentById,
      myDepartment,
      categoryById: (id) => categories.find((c) => c.id === id),
      serviceTypeById: (id) => serviceTypes.find((c) => c.id === id),

      stepOwners,
      stepOwnerFor,
      processCoordinatorIds,
      requesterIds,
      hodDesignationIds,
      stepSla,

      isAdmin,
      canEdit,
      isProcessCoordinator,
      isStepOwner,
      isFulfilmentStaff,
      canRaise,
      hodDepartmentIds,
      canActOn,
      canSeeQueue,
      holderOfRequest,
      canReassignRequest,
      reassignCandidates,
      reassignPoolDepartmentIds,
      reassignPoolUserIds,

      masterManagers,
      masterRequests,
      pendingRequests: masterRequests.filter((r) => r.status === "pending"),
      managerIdsFor,
      canManage,
      isAnyMasterManager,
      canManageMasters: isAnyMasterManager,
      isModuleViewer,
      canMonitor,
      canSeeMasters,
      resolvableRequests,
      myMasterRequests: masterRequests
        .filter((r) => r.requestedBy === uid)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      masterReviewersFor,
      isMasterUnassigned,

      setMasterManagers: async (masterType, userIds) => {
        await setMasterManagersWrite(masterType, userIds);
        await invalidate();
      },
      requestNewMaster: async (masterType, payload) => {
        const id = await requestNewMasterWrite(masterType, payload, uid);
        const name = String(payload.name ?? "entry");
        await safeAnnounce({
          entityType: "master_request",
          entityId: id,
          type: "master_requested",
          text: `A new ${masterTypeLabel(masterType)} was requested — "${name}". Review it.`,
          recipients: masterReviewersFor(masterType),
          meta: { masterType },
        });
        await invalidate();
        return id;
      },
      resolveMasterRequest: async (requestId, approve, payload, note) => {
        const req = masterRequests.find((r) => r.id === requestId);
        const newId = await resolveMasterRequestWrite(requestId, approve, payload, note);
        const finalPayload = payload ?? req?.proposedPayload ?? {};
        const name = String((finalPayload as Record<string, unknown>).name ?? "entry");
        const label = req ? masterTypeLabel(req.masterType) : "entry";
        await safeAnnounce({
          entityType: "master_request",
          entityId: requestId,
          type: approve ? "master_approved" : "master_rejected",
          text: approve
            ? `Your ${label} request — "${name}" — was approved. It is now selectable.`
            : `Your ${label} request — "${name}" — was rejected${note ? `: ${note}` : "."}`,
          recipients: req?.requestedBy ? [req.requestedBy] : [],
          meta: { masterType: req?.masterType, resolvedMasterId: newId },
        });
        await invalidate();
        return newId;
      },

      requests,
      requestById: (id) => requestMap.get(id),
      myRequests: requests.filter((r) => r.raisedBy === uid || r.requestedForUserId === uid),
      isOpenRequest,
      // Mirrors the SQL predicate fms_supplies_request_editable + its authz:
      // requester|admin|coordinator, and nobody has acted yet (awaiting first
      // approval, or a no-approval request still awaiting handover).
      requestEditable: (r) =>
        canEdit &&
        (r.raisedBy === uid || isAdmin || isProcessCoordinator) &&
        (r.status === "pending_first_approval" ||
          (r.status === "pending_handover" && !r.requiresApproval && r.handedOverAt === null)),

      queueEntries,
      myQueue,
      dueIsoFor: (r, stepKey) => supplyDueIso(snapshot, r, stepKey),
      queueOwnerIds,

      completedFirstApprovalEntries: firstEntries,
      completedSecondApprovalEntries: secondEntries,
      completedHandoverEntries: handoverEntries,
      completedFor: (stepKey) =>
        stepKey === "first_approval" ? firstEntries
        : stepKey === "second_approval" ? secondEntries
        : stepKey === "handover" ? handoverEntries
        : [],
      personName,

      activity,
      activityFor: (entityType, entityId) => activityByEntity.get(`${entityType}:${entityId}`) ?? [],
      notifications: mine,
      unreadCount: mine.filter((n) => !n.readAt).length,
      markNotificationsRead: async (ids) => {
        await markNotificationsReadWrite(ids);
        await invalidate();
      },

      /* ------------------------------ workflow ------------------------------ */

      submitRequest: async (input) => {
        const id = await submitRequestWrite(input);
        // The RPC already fanned out from its SECURITY DEFINER context (the only way a
        // plain requester can notify approvers they cannot otherwise write to).
        await invalidate();
        return id;
      },
      updateRequest: async (requestId, input) => {
        // The RPC re-announces in its own context (the route may have changed).
        await updateRequestWrite(requestId, input);
        await invalidate();
      },
      decideFirstApproval: async (r, approve, remarks) => {
        await decideFirstApprovalWrite(r.id, approve, remarks);
        await safeAnnounce({
          entityType: "request",
          entityId: r.id,
          type: approve ? "first_approved" : "first_rejected",
          text: approve
            ? `${r.reqNo} passed first approval — it now needs the second (Management) approval.`
            : `${r.reqNo} was not approved${remarks ? `: ${remarks}` : "."}`,
          recipients: approve
            ? ownerIdsOf("second_approval")
            : [r.raisedBy, r.requestedForUserId].filter((x): x is string => !!x),
        });
        await invalidate();
      },
      decideSecondApproval: async (r, approve, remarks) => {
        await decideSecondApprovalWrite(r.id, approve, remarks);
        await safeAnnounce({
          entityType: "request",
          entityId: r.id,
          type: approve ? "second_approved" : "second_rejected",
          text: approve
            ? `${r.reqNo} is approved and ready for handover.`
            : `${r.reqNo} was not approved${remarks ? `: ${remarks}` : "."}`,
          recipients: approve
            ? ownerIdsOf("handover")
            : [r.raisedBy, r.requestedForUserId].filter((x): x is string => !!x),
        });
        await invalidate();
      },
      recordHandover: async (r, input) => {
        await recordHandoverWrite(r.id, input);
        if (input.actualDeliveryDate) {
          await safeAnnounce({
            entityType: "request",
            entityId: r.id,
            type: "delivered",
            text: `${r.reqNo} (${r.requestedForName}) has been delivered.`,
            recipients: [r.raisedBy, r.requestedForUserId].filter((x): x is string => !!x),
          });
        }
        await invalidate();
      },
      // ---- stage edits ----
      // No safeAnnounce for the edit itself: each update_* RPC writes its own
      // activity row inside the same transaction. safeAnnounce is best-effort and
      // swallows failures, which is not good enough to answer "who changed this".
      updateFirstApproval: async (r, approve, remarks) => {
        await updateFirstApprovalWrite(r.id, approve, remarks);
        await invalidate();
      },
      updateSecondApproval: async (r, approve, remarks) => {
        await updateSecondApprovalWrite(r.id, approve, remarks);
        await invalidate();
      },
      reassignRequest: async ({ request, approverId, note }) => {
        await reassignRequestWrite(request.id, approverId);
        const returned = approverId === null;
        const hod = departmentById(request.departmentId)?.hodUserId ?? null;
        await safeAnnounce({
          entityType: "request",
          entityId: request.id,
          type: "reassigned",
          text: returned
            ? `An approval was returned to the department head${note ? " — " + note : ""}`
            : `An approval was reassigned to ${personName(approverId)}${note ? " — " + note : ""}`,
          // On a hand-back nobody in particular owns it, so tell the HOD it is
          // theirs again.
          recipients: returned ? (hod ? [hod] : []) : [approverId as string],
          // ⚠ Unlike Import and Purchase, the CARD is built server-side by
          //   fms_supplies_email_payload — this meta only tells it which of the
          //   two directions to render, because by mail time the column is
          //   already null on a hand-back and the row cannot tell them apart.
          meta: { returned, note: note ?? null },
        });
        await invalidate();
      },
      updateHandover: async (r, input) => {
        await updateHandoverWrite(r.id, input);
        // An edit CAN deliver a request that was recorded but not yet delivered
        // (a tentative date saved, the actual filled in later). The requester
        // still deserves the notification — the RPC only writes the audit row.
        if (input.actualDeliveryDate && !r.actualDeliveryDate) {
          await safeAnnounce({
            entityType: "request",
            entityId: r.id,
            type: "delivered",
            text: `${r.reqNo} (${r.requestedForName}) has been delivered.`,
            recipients: [r.raisedBy, r.requestedForUserId].filter((x): x is string => !!x),
          });
        }
        await invalidate();
      },
      holdRequest: async (r, hold, reason) => {
        await holdRequestWrite(r.id, hold, reason);
        await invalidate();
      },
      cancelRequest: async (r, reason) => {
        await cancelRequestWrite(r.id, reason);
        await invalidate();
      },

      /* ------------------------------- config ------------------------------- */

      setStepOwner: async (stepKey, input) => {
        await setStepOwnerWrite(stepKey, input);
        await invalidate();
      },
      setStepSla: async (map) => {
        await setConfigWrite("step_sla", map as unknown as Record<string, unknown>);
        await invalidate();
      },
      setCoordinators: async (userIds) => {
        await setConfigWrite("process_coordinators", { user_ids: userIds });
        await invalidate();
      },
      setRequesters: async (userIds) => {
        await setConfigWrite("requesters", { user_ids: userIds });
        await invalidate();
      },
      setHodDesignations: async (designationIds) => {
        await setConfigWrite("hod_designations", { designation_ids: designationIds });
        await invalidate();
      },
      setReassignPool: async ({ departmentIds, userIds }) => {
        // department_ids is stored so Setup can re-open on the same filter; it is
        // NOT read by fms_supplies_can_receive_reassignment and grants nothing.
        await setConfigWrite("reassign_pool", { department_ids: departmentIds, user_ids: userIds });
        await invalidate();
      },

      insertCompany: async (input) => {
        await insertCompanyWrite(input);
        await invalidate();
      },
      updateCompany: async (id, input) => {
        await updateCompanyWrite(id, input);
        await invalidate();
      },
      insertDepartment: async (input) => {
        await insertDepartmentWrite(input);
        await invalidate();
      },
      updateDepartment: async (id, input) => {
        await updateDepartmentWrite(id, input);
        await invalidate();
      },
      insertCategory: async (input) => {
        await insertCategoryWrite(input);
        await invalidate();
      },
      updateCategory: async (id, input) => {
        await updateCategoryWrite(id, input);
        await invalidate();
      },
      insertItem: async (input) => {
        await insertItemWrite(input);
        await invalidate();
      },
      updateItem: async (id, input) => {
        await updateItemWrite(id, input);
        await invalidate();
      },
      insertServiceType: async (input) => {
        await insertServiceTypeWrite(input);
        await invalidate();
      },
      updateServiceType: async (id, input) => {
        await updateServiceTypeWrite(id, input);
        await invalidate();
      },
    };
  }, [
    isLoading, error, dir, userId, isAdmin, designations, companies, departments, categories, items,
    serviceTypes, masterManagers, masterRequests, requests, activity, notifications,
    stepOwners, processCoordinatorIds, requesterIds, hodDesignationIds, stepSla, queryClient,
    // Load-bearing and invisible to tsc, exactly like orgPeople below: without
    // these the memo keeps handing out the pool it was built with, so Setup Save
    // never confirms after a successful write and reassignCandidates goes stale.
    reassignPoolDepartmentIds, reassignPoolUserIds,
    // Load-bearing, and tsc cannot catch its absence: personName closes over
    // orgPeople, so without this the names stay "Unknown user" until some other
    // dep happens to change.
    orgPeople,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSuppliesStore(): SuppliesStoreValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSuppliesStore must be used within SuppliesStoreProvider");
  return ctx;
}
