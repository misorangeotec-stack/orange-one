import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import type { Department, Profile } from "@/core/platform/types";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { candidateWindowStartIso, fetchHrData, HR_QK, hrQueryKey } from "./data/hrFetch";
import {
  addCandidates as addCandidatesWrite,
  announce as announceWrite,
  cancelRequisition as cancelRequisitionWrite,
  decideExtension as decideExtensionWrite,
  decideProbation as decideProbationWrite,
  hodDecide as hodDecideWrite,
  moveCandidate as moveCandidateWrite,
  recordInterviewResult as recordInterviewResultWrite,
  recordProbationReview as recordProbationReviewWrite,
  scheduleInterview as scheduleInterviewWrite,
  shareCandidatesWithHod as shareCandidatesWithHodWrite,
  updateCandidate as updateCandidateWrite,
  decideMrf as decideMrfWrite,
  holdRequisition as holdRequisitionWrite,
  insertMaster as insertMasterWrite,
  insertOnboardingItem as insertOnboardingItemWrite,
  markNotificationsRead as markNotificationsReadWrite,
  postJob as postJobWrite,
  resubmitMrf as resubmitMrfWrite,
  setConfig as setConfigWrite,
  setEmployeeCode as setEmployeeCodeWrite,
  setOfferStatus as setOfferStatusWrite,
  setOnboardingDate as setOnboardingDateWrite,
  setStepOwner as setStepOwnerWrite,
  setRequisitionJd as setRequisitionJdWrite,
  submitMrf as submitMrfWrite,
  uploadJd,
  toggleOnboardingCheck as toggleOnboardingCheckWrite,
  updateMaster as updateMasterWrite,
  updateOnboardingItem as updateOnboardingItemWrite,
  type CandidateInput,
  type CheckInput,
  type HrMasterTable,
  type MasterInput,
  type MovePayload,
  type MrfDecision,
  type MrfInput,
  type MrfStage,
  type OnboardingItemInput,
  type ProbationDecision,
  type StepOwnerInput,
  setMasterManagers as setMasterManagersWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
} from "./data/hrWrites";
import { masterTypeLabel } from "./lib/masterFields";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import { isHodStep, type StepKey } from "./lib/steps";
import {
  buildQueueEntries,
  candidateDueIso,
  checkDueIso,
  daysInStage,
  hrSnapshotFrom,
  isOpenRequisition,
  onboardingDueIso,
  probationDueIso,
  probationPendingStep,
  requisitionDueIso,
  seatsJoined,
  seatsTaken,
  STAGE_PENDING_STEP,
  type HrSnapshot,
  type QueueEntry,
} from "./lib/queues";
import type {
  Candidate,
  CandidateStage,
  Designation,
  DisqualificationReason,
  Interview,
  HrActivity,
  HrEntityType,
  HrLocation,
  HrMasterManager,
  HrMasterRequest,
  HrMasterType,
  HrNotification,
  JobPlatform,
  JobType,
  Onboarding,
  OnboardingCheck,
  OnboardingItem,
  Probation,
  ProbationReview,
  ProbationReviewStatus,
  Requisition,
  RequisitionPlatform,
  StepOwner,
} from "./types";

/** Prefix key for invalidation; the full key adds the real session user id. */
const QK = HR_QK;

interface HrStoreValue {
  isLoading: boolean;
  error: unknown;

  // directory
  profiles: Profile[];
  departments: Department[];
  designations: Designation[];
  profileById: (id: string) => Profile | undefined;

  // masters
  jobPlatforms: JobPlatform[];
  jobTypes: JobType[];
  locations: HrLocation[];
  disqualificationReasons: DisqualificationReason[];
  onboardingItems: OnboardingItem[];
  /** Only the active items, in order — this is what a new onboarding is seeded from. */
  activeOnboardingItems: OnboardingItem[];

  // master governance
  masterManagers: HrMasterManager[];
  masterRequests: HrMasterRequest[];
  pendingRequests: HrMasterRequest[];
  managerIdsFor: (masterType: HrMasterType) => string[];
  /** May the user CRUD this master — admin, or its assigned owner. */
  canManage: (masterType: HrMasterType) => boolean;
  /** Owns at least one master → sees the Masters page and the review tabs. */
  isAnyMasterManager: boolean;
  /** Pending requests this user may resolve (admin → all; owner → their types). */
  resolvableRequests: HrMasterRequest[];
  /** Requests I raised, newest first — the requester's worklist. */
  myMasterRequests: HrMasterRequest[];
  /** Who reviews a new request of this type: its owners, else the admins. */
  masterReviewersFor: (masterType: HrMasterType) => string[];
  /** True when nobody owns this master — its requests fall back to the admins. */
  isMasterUnassigned: (masterType: HrMasterType) => boolean;

  // config
  stepOwners: StepOwner[];
  stepOwnerFor: (stepKey: StepKey) => StepOwner | undefined;
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
  minCvsToShare: number;
  /** Who may see the offered salary (departments + named people). Admin-configured. */
  salaryViewers: { departmentIds: string[]; personIds: string[] };
  /**
   * May the effective user see the OFFERED salary? Admins, anyone in an allowed
   * department, and anyone named. The requisition salary RANGE stays public — this
   * gates only the finalized/offered CTC.
   */
  canViewSalary: boolean;
  setSalaryViewers: (departmentIds: string[], personIds: string[]) => Promise<void>;

  // capabilities (derived from the EFFECTIVE identity, so demo personas re-scope)
  isAdmin: boolean;
  canConfigure: boolean;
  isProcessCoordinator: boolean;
  /**
   * Owner of a step per the global step-owner table.
   *
   * NOTE this is not the whole story for the HOD steps (hod_shortlist,
   * interview_2, probation_m1..m3): those are owned by the requisition's own
   * hiring manager. Screens that act on a specific requisition must use
   * `canActOnRequisition`; this flag answers the coarser "should the nav show
   * this queue at all". Server-side, fms_hr_can_act() is the real gate.
   */
  isStepOwner: (stepKey: StepKey) => boolean;
  /** True if the user owns ANY step — i.e. works in recruitment at all. */
  isAnyStepOwner: boolean;

  // requisitions
  requisitions: Requisition[];
  requisitionById: (id: string) => Requisition | undefined;
  requisitionPlatforms: RequisitionPlatform[];
  platformIdsFor: (requisitionId: string) => string[];
  /** Requisitions this user raised (or is the hiring manager for). */
  myRequisitions: Requisition[];
  /** Sent back to me to fix and resubmit. */
  mySentBack: Requisition[];

  // candidates
  candidates: Candidate[];
  candidateById: (id: string) => Candidate | undefined;
  candidatesFor: (requisitionId: string) => Candidate[];
  interviews: Interview[];
  interviewsFor: (candidateId: string) => Interview[];
  interviewRound: (candidateId: string, round: number) => Interview | undefined;
  /** Whole days a card has sat in its current column. */
  daysInStage: (candidate: Candidate) => number;
  candidateDueIso: (candidate: Candidate) => string | null;
  /** May this person act on the card where it sits? Mirrors fms_hr_can_act. */
  canActOnCandidate: (candidate: Candidate) => boolean;
  /** Anyone with this phone/email who already applied — a duplicate warning. */
  duplicatesOf: (phone: string | null, email: string | null, excludeId?: string) => Candidate[];

  // onboarding
  onboardings: Onboarding[];
  onboardingById: (id: string) => Onboarding | undefined;
  /** The onboarding opened when this candidate was finalized. */
  onboardingForCandidate: (candidateId: string) => Onboarding | undefined;
  /** The checklist, in board order. Empty until HR sets the joining date. */
  checksFor: (onboardingId: string) => OnboardingCheck[];
  onboardingDueIso: (onboarding: Onboarding) => string | null;
  /** One item's own due date: `dueDays` working days from the joining date. */
  checkDueIso: (onboarding: Onboarding, check: OnboardingCheck) => string | null;
  canActOnOnboarding: (onboarding: Onboarding) => boolean;
  /**
   * Seats a requisition has consumed — finalized candidates who have NOT declined or
   * no-showed. Mirrors fms_hr_seats_taken(); the RPC is the real gate.
   */
  seatsTaken: (requisitionId: string) => number;
  /** Seats actually FILLED — people who joined. This is what closes a requisition. */
  seatsJoined: (requisitionId: string) => number;

  setOnboardingDate: (onboardingId: string, joiningDate: string) => Promise<void>;
  setOfferStatus: (
    onboarding: Onboarding,
    status: "accepted" | "declined" | "no_show",
    reason?: string,
  ) => Promise<void>;
  toggleOnboardingCheck: (checkId: string, done: boolean, input?: CheckInput) => Promise<void>;
  setEmployeeCode: (onboardingId: string, code: string) => Promise<void>;

  // probation — the HOD's monthly work on people who have actually JOINED
  probations: Probation[];
  probationById: (id: string) => Probation | undefined;
  /** The probation opened when this hire's onboarding completed. */
  probationForOnboarding: (onboardingId: string) => Probation | undefined;
  /** This probation's reviews, month 1 first. */
  reviewsFor: (probationId: string) => ProbationReview[];
  reviewOf: (probationId: string, month: number) => ProbationReview | undefined;
  /** The ONE step this probation is waiting on (a review, or the decision). */
  probationPendingStep: (probation: Probation) => StepKey | null;
  /** When that step is due — N CALENDAR MONTHS from the joining date, never working days. */
  probationDueIso: (probation: Probation) => string | null;
  /** May this person review / decide? The HOD who raised the MRF, plus admins + coordinators. */
  canActOnProbation: (probation: Probation) => boolean;

  recordProbationReview: (
    probation: Probation,
    month: number,
    status: ProbationReviewStatus,
    remarks: string,
    filePath?: string | null,
    fileName?: string | null,
  ) => Promise<void>;
  decideProbation: (
    probation: Probation,
    decision: ProbationDecision,
    remarks: string,
    permanentFrom?: string | null,
    employeeCode?: string | null,
  ) => Promise<void>;
  decideExtension: (
    probation: Probation,
    decision: "approve" | "reject",
    remarks: string,
    permanentFrom?: string | null,
    employeeCode?: string | null,
  ) => Promise<void>;

  // queues — the SAME entries the Control Center counts, so they cannot disagree
  queueEntries: QueueEntry[];
  /** Open work at one step, narrowed to what this user may action. */
  myQueue: (stepKey: StepKey) => QueueEntry[];
  dueIsoFor: (requisition: Requisition, stepKey: StepKey) => string | null;
  /** True if the user may act on THIS requisition at THIS step (mirrors fms_hr_can_act). */
  canActOn: (stepKey: StepKey, requisition: Requisition) => boolean;
  /**
   * Who owes this work-item. A HOD step routes to the requisition's OWN hiring
   * manager; every other step reads the global step-owner table. Empty = nobody owns
   * it — which the reports surface rather than hide.
   */
  queueOwnerIds: (entry: QueueEntry) => string[];

  // reporting
  probationReviews: ProbationReview[];
  /**
   * CVs uploaded before this date are NOT loaded (data/hrFetch.ts bounds the one
   * unbounded table). The dashboard states this as the coverage of its funnel, and
   * the board warns when an old vacancy's CVs fall outside it.
   */
  candidateWindowStartIso: string;

  // activity + bell
  activity: HrActivity[];
  activityFor: (entityType: HrEntityType, entityId: string) => HrActivity[];
  notifications: HrNotification[];
  unreadCount: number;
  markNotificationsRead: (ids: string[]) => Promise<void>;

  // candidate writes
  addCandidates: (requisitionId: string, candidates: CandidateInput[]) => Promise<string[]>;
  updateCandidate: (id: string, input: CandidateInput) => Promise<void>;
  moveCandidate: (candidate: Candidate, toStage: CandidateStage, payload?: MovePayload) => Promise<void>;
  shareCandidatesWithHod: (ids: string[]) => Promise<void>;
  hodDecide: (ids: string[], selected: boolean, reasonId?: string | null, note?: string) => Promise<void>;
  scheduleInterview: (
    id: string,
    round: number,
    interviewerId: string | null,
    interviewerName: string | null,
    scheduledOn: string | null,
  ) => Promise<void>;
  recordInterviewResult: (
    candidate: Candidate,
    round: number,
    status: "selected" | "rejected" | "on_hold" | "no_show",
    remarks: string,
    docPath?: string | null,
    docName?: string | null,
    videoUrl?: string | null,
    /** On `selected`, the stage to advance to (a later interview stage, or `final_decision`). */
    nextStage?: CandidateStage | null,
  ) => Promise<void>;

  // workflow writes
  submitMrf: (input: MrfInput) => Promise<string>;
  resubmitMrf: (requisitionId: string, input: MrfInput) => Promise<void>;
  /** Upload a JD file to jd/<id>/… and record its path on the requisition. */
  attachRequisitionJd: (requisitionId: string, file: File) => Promise<void>;
  decideMrf: (requisitionId: string, stage: MrfStage, decision: MrfDecision, remarks: string) => Promise<void>;
  postJob: (requisitionId: string, platformIds: string[], postedOn: string) => Promise<void>;
  holdRequisition: (requisitionId: string, hold: boolean, reason: string) => Promise<void>;
  cancelRequisition: (requisitionId: string, reason: string) => Promise<void>;

  // config writes
  setStepOwner: (stepKey: StepKey, input: StepOwnerInput) => Promise<void>;
  setStepSla: (map: StepSlaMap) => Promise<void>;
  setProcessCoordinators: (userIds: string[]) => Promise<void>;
  setMinCvsToShare: (n: number) => Promise<void>;
  // setSalaryViewers is declared with canViewSalary above.
  insertMaster: (table: HrMasterTable, input: MasterInput) => Promise<void>;
  updateMaster: (table: HrMasterTable, id: string, input: MasterInput) => Promise<void>;
  insertOnboardingItem: (input: OnboardingItemInput) => Promise<void>;
  updateOnboardingItem: (id: string, input: OnboardingItemInput) => Promise<void>;

  setMasterManagers: (masterType: HrMasterType, userIds: string[]) => Promise<void>;
  requestNewMaster: (masterType: HrMasterType, payload: Record<string, unknown>) => Promise<string>;
  resolveMasterRequest: (
    requestId: string,
    approve: boolean,
    payload: Record<string, unknown> | null,
    note: string | null
  ) => Promise<string | null>;
}

const Ctx = createContext<HrStoreValue | null>(null);

export function HrStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  // Effective identity: the real signed-in user, or the impersonated persona in
  // demo mode. Every capability flag below derives from this, so switching persona
  // re-scopes the whole app. The fetch stays keyed on the REAL session id (admin
  // RLS returns all rows) so switching persona never triggers a refetch.
  const { user, isAdmin } = useEffectiveIdentity();
  const dir = useDirectory();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: hrQueryKey(session.user?.id ?? null),
    queryFn: fetchHrData,
    enabled: !!session.user,
  });

  const stepOwners = data?.stepOwners ?? [];
  const designations = data?.designations ?? [];
  const jobPlatforms = data?.jobPlatforms ?? [];
  const jobTypes = data?.jobTypes ?? [];
  const locations = data?.locations ?? [];
  const disqualificationReasons = data?.disqualificationReasons ?? [];
  const onboardingItems = data?.onboardingItems ?? [];
  const requisitions = data?.requisitions ?? [];
  const requisitionPlatforms = data?.requisitionPlatforms ?? [];
  const candidates = data?.candidates ?? [];
  const interviews = data?.interviews ?? [];
  const onboardings = data?.onboardings ?? [];
  const onboardingChecks = data?.onboardingChecks ?? [];
  const probations = data?.probations ?? [];
  const probationReviews = data?.probationReviews ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;
  const minCvsToShare = data?.config.minCvsToShare ?? 5;
  const salaryViewers = data?.config.salaryViewers ?? { departmentIds: [], personIds: [] };

  // The REAL signed-in user, never the impersonated persona. RLS and RPC actor
  // stamping run off the JWT, so any write whose policy checks `= auth.uid()`
  // must carry this id — see requestNewMaster below.
  const realUserId = session.user?.id ?? null;

  const value = useMemo<HrStoreValue>(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    const stepOwnerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);

    const isStepOwner = (stepKey: StepKey): boolean => {
      if (isAdmin) return true;
      if (stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(user.id))) return true;
      // A HOD step is owned per-requisition by whoever raised the MRF. For nav
      // purposes, anyone who could raise an MRF might later own one of these — and the
      // same is true of resubmitting one that was sent back.
      const perRequisition = isHodStep(stepKey) || stepKey === "mrf_resubmit";
      return perRequisition && (stepOwnerFor("mrf")?.employeeIds.includes(user.id) ?? false);
    };

    const isAnyStepOwner = isAdmin || stepOwners.some((o) => o.employeeIds.includes(user.id));
    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(user.id);

    // Offered-salary visibility. Admins always; otherwise a named person or anyone in an
    // allowed department. The finalize form shows the input regardless (you must see what
    // you type) — this only governs read-back on the board, onboarding and reports.
    const canViewSalary =
      isAdmin ||
      salaryViewers.personIds.includes(user.id) ||
      (!!user.departmentId && salaryViewers.departmentIds.includes(user.departmentId));

    /** Who to notify when work lands at a step. */
    const ownerIdsOf = (stepKey: StepKey): string[] =>
      stepOwners.find((o) => o.stepKey === stepKey)?.employeeIds ?? [];

    const activityByEntity = new Map<string, HrActivity[]>();
    for (const a of activity) {
      const k = `${a.entityType}:${a.entityId}`;
      const list = activityByEntity.get(k) ?? [];
      list.push(a);
      activityByEntity.set(k, list);
    }

    const mine = notifications.filter((n) => n.userId === user.id);

    /** Fan out a transition notification; never let it break the workflow action. */
    const safeAnnounce = async (input: Parameters<typeof announceWrite>[0]) => {
      try {
        await announceWrite(input);
      } catch {
        // The trail is best-effort. State lives on the domain row, stamped in the RPC.
      }
    };

    /* ---- master governance ---- */

    const managerIdsFor = (mt: HrMasterType) =>
      masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId);

    const canManage = (mt: HrMasterType) => isAdmin || managerIdsFor(mt).includes(user.id);

    const isAnyMasterManager = isAdmin || masterManagers.some((m) => m.managerUserId === user.id);

    const resolvableRequests = masterRequests
      .filter((r) => r.status === "pending")
      .filter((r) => canManage(r.masterType));

    // A master with no assigned owner still has to go somewhere: admins can always
    // resolve, so they are the implicit reviewers. Nothing black-holes.
    const adminIds = () => dir.profiles.filter((p) => p.role === "admin").map((p) => p.id);
    const masterReviewersFor = (mt: HrMasterType): string[] => {
      const ids = managerIdsFor(mt);
      return ids.length ? ids : adminIds();
    };
    const isMasterUnassigned = (mt: HrMasterType) => managerIdsFor(mt).length === 0;

    /* ------------------------------ requisitions --------------------------- */

    const reqById = new Map(requisitions.map((r) => [r.id, r]));
    const requisitionById = (id: string) => reqById.get(id);

    const platformsByReq = new Map<string, string[]>();
    for (const rp of requisitionPlatforms) {
      const list = platformsByReq.get(rp.requisitionId) ?? [];
      list.push(rp.platformId);
      platformsByReq.set(rp.requisitionId, list);
    }

    const ownsRequisition = (r: Requisition) =>
      r.requesterId === user.id || r.hiringManagerIds.includes(user.id);

    /**
     * Mirrors fms_hr_can_act() in SQL. Kept in step with it deliberately: this
     * only decides what the UI offers — the RPC re-checks and is the real gate.
     */
    const canActOn = (stepKey: StepKey, r: Requisition): boolean => {
      // Resubmitting a sent-back MRF is the ONE step whose server rule is neither
      // "step owner" nor "hiring manager": fms_hr_resubmit_mrf allows the REQUESTER (or
      // an admin) and nobody else — not the hiring manager, not a coordinator. This
      // branch sits above the admin/coordinator short-circuit so we never offer a
      // coordinator a button the database will reject.
      if (stepKey === "mrf_resubmit") return r.requesterId === user.id || isAdmin;
      if (isAdmin || isProcessCoordinator) return true;
      if (isHodStep(stepKey)) return r.hiringManagerIds.includes(user.id);
      return stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(user.id));
    };

    /* ------------------------------- candidates ---------------------------- */

    const canById = new Map(candidates.map((c) => [c.id, c]));
    const cansByReq = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const list = cansByReq.get(c.requisitionId) ?? [];
      list.push(c);
      cansByReq.set(c.requisitionId, list);
    }
    const ivsByCan = new Map<string, Interview[]>();
    for (const iv of interviews) {
      const list = ivsByCan.get(iv.candidateId) ?? [];
      list.push(iv);
      ivsByCan.set(iv.candidateId, list);
    }

    /**
     * May this person act on the card where it currently sits?
     *
     * Keyed on the card's PENDING step (the one that moves it out), NOT the column
     * it is in — a card in "Shared with HOD" is the HOD's work-item even though HR
     * put it there. Getting this wrong is exactly the bug the SQL side had.
     */
    const canActOnCandidate = (c: Candidate): boolean => {
      const r = reqById.get(c.requisitionId);
      if (!r) return false;
      const step = STAGE_PENDING_STEP[c.stage];
      if (!step) return isAdmin || isProcessCoordinator;
      return canActOn(step, r);
    };

    /* ------------------------------- onboarding ---------------------------- */

    const onbById = new Map(onboardings.map((o) => [o.id, o]));
    const onbByCandidate = new Map(onboardings.map((o) => [o.candidateId, o]));
    const checksByOnb = new Map<string, OnboardingCheck[]>();
    for (const k of onboardingChecks) {
      const list = checksByOnb.get(k.onboardingId) ?? [];
      list.push(k);
      checksByOnb.set(k.onboardingId, list);
    }
    for (const list of checksByOnb.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    }

    const canActOnOnboarding = (o: Onboarding): boolean => {
      const r = reqById.get(o.requisitionId);
      return r ? canActOn("onboarding", r) : false;
    };

    /* ------------------------------- probation ----------------------------- */

    const probById = new Map(probations.map((p) => [p.id, p]));
    const probByOnb = new Map(probations.map((p) => [p.onboardingId, p]));
    const reviewsByProb = new Map<string, ProbationReview[]>();
    for (const rv of probationReviews) {
      const list = reviewsByProb.get(rv.probationId) ?? [];
      list.push(rv);
      reviewsByProb.set(rv.probationId, list);
    }
    for (const list of reviewsByProb.values()) list.sort((a, b) => a.month - b.month);

    const pendingStepOf = (p: Probation) => probationPendingStep(p, reviewsByProb.get(p.id) ?? []);

    /**
     * Every probation step is a HOD step, so this is always the requisition's own
     * hiring manager (plus admins and coordinators). Keyed on the PENDING step, so
     * the person who owes the work is the person offered the buttons.
     */
    const canActOnProbation = (p: Probation): boolean => {
      const r = reqById.get(p.requisitionId);
      if (!r) return false;
      const step = pendingStepOf(p);
      // Decided: nobody owes anything, but an admin / coordinator can still look.
      if (!step) return isAdmin || isProcessCoordinator;
      return canActOn(step, r);
    };

    // Built through the SAME function the cross-FMS scoreboard uses — see hrSnapshotFrom.
    // Two hand-written literals is how the scoreboard and the app drifted apart before.
    const snapshot: HrSnapshot = hrSnapshotFrom({
      requisitions,
      candidates,
      interviews,
      onboardings,
      onboardingChecks,
      probations,
      probationReviews,
      config: { stepSla },
    });
    const queueEntries = buildQueueEntries(snapshot);

    const myQueue = (stepKey: StepKey): QueueEntry[] =>
      queueEntries.filter((e) => {
        if (e.stepKey !== stepKey) return false;
        const r = e.requisitionId ? reqById.get(e.requisitionId) : undefined;
        return r ? canActOn(stepKey, r) : false;
      });

    /**
     * Who owes a work-item — the same split fms_hr_can_act() makes server-side, so
     * "whose queue is it in" and "who may act on it" are one answer, not two.
     */
    const queueOwnerIds = (e: QueueEntry): string[] => {
      const r = e.requisitionId ? reqById.get(e.requisitionId) : undefined;
      // Owed by the one person who raised it — not the hiring manager, and not the
      // global owners table (which has no row for this step, so without this branch it
      // would be reported as work owed by "Nobody").
      if (e.stepKey === "mrf_resubmit") return r?.requesterId ? [r.requesterId] : [];
      if (isHodStep(e.stepKey)) return r?.hiringManagerIds ?? [];
      return ownerIdsOf(e.stepKey);
    };

    /* ---------------------------------------------------------------------- */

    return {
      requisitions,
      requisitionById,
      requisitionPlatforms,
      platformIdsFor: (id) => platformsByReq.get(id) ?? [],
      myRequisitions: requisitions.filter(ownsRequisition),
      mySentBack: requisitions.filter((r) => r.status === "sent_back" && ownsRequisition(r)),

      candidates,
      candidateById: (id) => canById.get(id),
      candidatesFor: (rid) => cansByReq.get(rid) ?? [],
      interviews,
      interviewsFor: (cid) => ivsByCan.get(cid) ?? [],
      interviewRound: (cid, round) => (ivsByCan.get(cid) ?? []).find((iv) => iv.round === round),
      daysInStage,
      candidateDueIso: (c) => candidateDueIso(snapshot, c, reqById),
      canActOnCandidate,
      duplicatesOf: (phone, email, excludeId) => {
        const ph = phone?.trim();
        const em = email?.trim().toLowerCase();
        if (!ph && !em) return [];
        return candidates.filter(
          (c) =>
            c.id !== excludeId &&
            ((!!ph && c.phone?.trim() === ph) || (!!em && c.email?.trim().toLowerCase() === em)),
        );
      },

      onboardings,
      onboardingById: (id) => onbById.get(id),
      onboardingForCandidate: (cid) => onbByCandidate.get(cid),
      checksFor: (oid) => checksByOnb.get(oid) ?? [],
      onboardingDueIso: (o) => onboardingDueIso(snapshot, o, canById, reqById),
      checkDueIso,
      canActOnOnboarding,
      seatsTaken: (rid) => seatsTaken(rid, candidates, onboardings),
      seatsJoined: (rid) => seatsJoined(rid, onboardings),

      setOnboardingDate: async (oid, joiningDate) => {
        await setOnboardingDateWrite(oid, joiningDate);
        await invalidate();
      },
      setOfferStatus: async (o, status, reason) => {
        await setOfferStatusWrite(o.id, status, reason ?? "");
        // Declining does not just change a field: the RPC hands the seat back and
        // reopens the vacancy, so tell the people who now have to fill it again.
        const c = canById.get(o.candidateId);
        const r = reqById.get(o.requisitionId);
        const declined = status !== "accepted";
        await safeAnnounce({
          entityType: "onboarding",
          entityId: o.id,
          type: `offer_${status}`,
          text: declined
            ? `${c?.name ?? "The candidate"} did not take up the offer on ${r?.mrfNo ?? "the vacancy"} — the seat is open again`
            : `${c?.name ?? "The candidate"} accepted the offer on ${r?.mrfNo ?? "the vacancy"}`,
          recipients: declined
            ? [...(r?.hiringManagerIds ?? []), ...ownerIdsOf("resume_upload")]
            : ownerIdsOf("onboarding"),
        });
        await invalidate();
      },
      toggleOnboardingCheck: async (checkId, done, input) => {
        await toggleOnboardingCheckWrite(checkId, done, input ?? {});
        await invalidate();
      },
      setEmployeeCode: async (oid, code) => {
        await setEmployeeCodeWrite(oid, code);
        await invalidate();
      },

      probations,
      probationById: (id) => probById.get(id),
      probationForOnboarding: (oid) => probByOnb.get(oid),
      reviewsFor: (pid) => reviewsByProb.get(pid) ?? [],
      reviewOf: (pid, month) => (reviewsByProb.get(pid) ?? []).find((r) => r.month === month),
      probationPendingStep: pendingStepOf,
      probationDueIso: (p) => {
        const step = pendingStepOf(p);
        return step ? probationDueIso(snapshot, p, step) : null;
      },
      canActOnProbation,

      recordProbationReview: async (p, month, status, remarks, filePath, fileName) => {
        await recordProbationReviewWrite(p.id, month, status, remarks, filePath ?? null, fileName ?? null);
        await invalidate();
      },
      decideProbation: async (p, decision, remarks, permanentFrom, employeeCode) => {
        await decideProbationWrite(p.id, decision, remarks, permanentFrom ?? null, employeeCode ?? null);
        const c = canById.get(p.candidateId);
        const r = reqById.get(p.requisitionId);
        // HR is not the decision maker here, but they carry it out — a confirmation
        // changes the payroll record, and a rejection starts an exit.
        await safeAnnounce({
          entityType: "probation",
          entityId: p.id,
          type: `probation_${decision}`,
          text: `${c?.name ?? "The new hire"} — probation ${
            decision === "approve" ? "cleared" : decision === "reject" ? "not cleared" : "extended by one month"
          }${r ? ` (${r.mrfNo})` : ""}`,
          recipients: ownerIdsOf("onboarding"),
        });
        await invalidate();
      },
      decideExtension: async (p, decision, remarks, permanentFrom, employeeCode) => {
        await decideExtensionWrite(p.id, decision, remarks, permanentFrom ?? null, employeeCode ?? null);
        const c = canById.get(p.candidateId);
        const r = reqById.get(p.requisitionId);
        await safeAnnounce({
          entityType: "probation",
          entityId: p.id,
          type: `probation_${decision}`,
          text: `${c?.name ?? "The new hire"} — extended probation ${
            decision === "approve" ? "cleared" : "not cleared"
          }${r ? ` (${r.mrfNo})` : ""}`,
          recipients: ownerIdsOf("onboarding"),
        });
        await invalidate();
      },

      queueEntries,
      myQueue,
      dueIsoFor: (r, stepKey) => requisitionDueIso(snapshot, r, stepKey),
      canActOn,
      queueOwnerIds,

      probationReviews,
      candidateWindowStartIso: candidateWindowStartIso(),

      addCandidates: async (rid, list) => {
        const ids = await addCandidatesWrite(rid, list);
        const r = reqById.get(rid);
        await safeAnnounce({
          entityType: "requisition",
          entityId: rid,
          type: "cvs_added",
          text: `${list.length} CV${list.length === 1 ? "" : "s"} added to ${r?.mrfNo ?? "the requisition"}`,
          recipients: ownerIdsOf("hr_shortlist"),
        });
        await invalidate();
        return ids;
      },
      updateCandidate: async (id, input) => {
        await updateCandidateWrite(id, input);
        await invalidate();
      },
      moveCandidate: async (c, toStage, payload) => {
        await moveCandidateWrite(c.id, toStage, payload ?? {});
        const nextStep = STAGE_PENDING_STEP[toStage];
        const r = reqById.get(c.requisitionId);
        // Notify whoever now owes this card an action. A HOD step routes to the
        // requisition's OWN hiring manager, not to a global owner list.
        const recipients =
          nextStep && r ? (isHodStep(nextStep) ? r.hiringManagerIds : ownerIdsOf(nextStep)) : [];
        await safeAnnounce({
          entityType: "candidate",
          entityId: c.id,
          type: `moved_${toStage}`,
          text: `${c.name} → ${toStage.replace(/_/g, " ")}`,
          recipients,
        });
        // Selection kicks off onboarding — nudge its owners to send the offer
        // confirmation (there is no auto-email; the checklist item is the record).
        if (toStage === "finalized") {
          await safeAnnounce({
            entityType: "candidate",
            entityId: c.id,
            type: "send_offer_confirmation",
            text: `${c.name} selected for ${r?.mrfNo ?? "the vacancy"} — send the offer confirmation`,
            recipients: ownerIdsOf("onboarding"),
          });
        }
        await invalidate();
      },
      shareCandidatesWithHod: async (ids) => {
        await shareCandidatesWithHodWrite(ids);
        const first = canById.get(ids[0]);
        const r = first ? reqById.get(first.requisitionId) : undefined;
        // ONE notification for the batch, not one per CV — the sheet's own rule is
        // to share 5–10 at a time, and ten pings would be noise.
        await safeAnnounce({
          entityType: "requisition",
          entityId: r?.id ?? "",
          type: "shared_with_hod",
          text: `${ids.length} CV${ids.length === 1 ? "" : "s"} shared for ${r?.mrfNo ?? "a requisition"}`,
          recipients: r?.hiringManagerIds ?? [],
        });
        await invalidate();
      },
      hodDecide: async (ids, selected, reasonId, note) => {
        await hodDecideWrite(ids, selected, reasonId ?? null, note ?? "");
        await safeAnnounce({
          entityType: "candidate",
          entityId: ids[0],
          type: selected ? "hod_shortlisted" : "hod_dropped",
          text: `HOD ${selected ? "shortlisted" : "dropped"} ${ids.length} candidate${ids.length === 1 ? "" : "s"}`,
          recipients: selected ? ownerIdsOf("telephonic_screening") : [],
        });
        await invalidate();
      },
      scheduleInterview: async (id, round, interviewerId, interviewerName, scheduledOn) => {
        await scheduleInterviewWrite(id, round, interviewerId, interviewerName, scheduledOn);
        await invalidate();
      },
      recordInterviewResult: async (c, round, status, remarks, docPath, docName, videoUrl, nextStage) => {
        await recordInterviewResultWrite(
          c.id,
          round,
          status,
          remarks,
          docPath ?? null,
          docName ?? null,
          videoUrl ?? null,
          nextStage ?? null,
        );
        const r = reqById.get(c.requisitionId);
        // 'selected' advances the card to the chosen next stage — notify whoever owns
        // the step that stage is then waiting on. With optional rounds we can no longer
        // assume it is the very next round.
        const nextStep: StepKey | null =
          status !== "selected" ? null : nextStage ? STAGE_PENDING_STEP[nextStage] : null;
        const recipients =
          nextStep && r ? (isHodStep(nextStep) ? r.hiringManagerIds : ownerIdsOf(nextStep)) : [];
        await safeAnnounce({
          entityType: "candidate",
          entityId: c.id,
          type: `round_${round}_${status}`,
          text: `${c.name} — Round ${round}: ${status.replace(/_/g, " ")}${remarks ? ` (${remarks})` : ""}`,
          recipients,
        });
        await invalidate();
      },

      submitMrf: async (input) => {
        const id = await submitMrfWrite(input);
        await safeAnnounce({
          entityType: "requisition",
          entityId: id,
          type: "submitted",
          text: `Requisition raised: ${input.jobTitle}`,
          recipients: ownerIdsOf("hr_head_approval"),
        });
        await invalidate();
        return id;
      },
      attachRequisitionJd: async (id, file) => {
        const up = await uploadJd(id, file);
        await setRequisitionJdWrite(id, up.path, up.name);
        await invalidate();
      },
      resubmitMrf: async (id, input) => {
        await resubmitMrfWrite(id, input);
        await safeAnnounce({
          entityType: "requisition",
          entityId: id,
          type: "resubmitted",
          text: `Requisition updated and resubmitted: ${input.jobTitle}`,
          recipients: ownerIdsOf("hr_head_approval"),
        });
        await invalidate();
      },
      decideMrf: async (id, stage, decision, remarks) => {
        await decideMrfWrite(id, stage, decision, remarks);
        const r = reqById.get(id);
        // Approving hands the work to the NEXT gate; rejecting or sending back
        // hands it back to whoever raised it.
        const next =
          decision !== "approve"
            ? (r?.requesterId ? [r.requesterId] : [])
            : stage === "hr"
              ? ownerIdsOf("mgmt_approval")
              : ownerIdsOf("job_posting");
        const verb =
          decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "sent back";
        await safeAnnounce({
          entityType: "requisition",
          entityId: id,
          type: decision,
          text: `${r?.mrfNo ?? "Requisition"} ${verb}${remarks ? ` — ${remarks}` : ""}`,
          recipients: next,
        });
        await invalidate();
      },
      postJob: async (id, platformIds, postedOn) => {
        await postJobWrite(id, platformIds, postedOn);
        const r = reqById.get(id);
        await safeAnnounce({
          entityType: "requisition",
          entityId: id,
          type: "posted",
          text: `${r?.mrfNo ?? "Requisition"} posted on ${platformIds.length} platform${platformIds.length === 1 ? "" : "s"}`,
          recipients: ownerIdsOf("resume_upload"),
        });
        await invalidate();
      },
      holdRequisition: async (id, hold, reason) => {
        await holdRequisitionWrite(id, hold, reason);
        await invalidate();
      },
      cancelRequisition: async (id, reason) => {
        await cancelRequisitionWrite(id, reason);
        await invalidate();
      },

      isLoading,
      error,

      profiles: dir.profiles,
      departments: dir.departments,
      designations,
      profileById: dir.profileById,

      masterManagers,
      masterRequests,
      pendingRequests: masterRequests.filter((r) => r.status === "pending"),
      managerIdsFor,
      canManage,
      isAnyMasterManager,
      resolvableRequests,
      myMasterRequests: masterRequests
        .filter((r) => r.requestedBy === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      masterReviewersFor,
      isMasterUnassigned,

      jobPlatforms,
      jobTypes,
      locations,
      disqualificationReasons,
      onboardingItems,
      activeOnboardingItems: onboardingItems
        .filter((i) => i.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),

      stepOwners,
      stepOwnerFor,
      processCoordinatorIds,
      stepSla,
      minCvsToShare,
      salaryViewers,
      canViewSalary,

      isAdmin,
      canConfigure: isAdmin,
      isProcessCoordinator,
      isStepOwner,
      isAnyStepOwner,

      activity,
      activityFor: (entityType, entityId) => activityByEntity.get(`${entityType}:${entityId}`) ?? [],
      notifications: mine,
      unreadCount: mine.filter((n) => !n.readAt).length,
      markNotificationsRead: async (ids) => {
        await markNotificationsReadWrite(ids);
        await invalidate();
      },

      setStepOwner: async (stepKey, input) => {
        await setStepOwnerWrite(stepKey, input);
        await invalidate();
      },
      setStepSla: async (map) => {
        await setConfigWrite("step_sla", map as unknown as Record<string, unknown>);
        await invalidate();
      },
      setProcessCoordinators: async (userIds) => {
        await setConfigWrite("process_coordinators", { user_ids: userIds });
        await invalidate();
      },
      setMinCvsToShare: async (n) => {
        await setConfigWrite("min_cvs_to_share", { value: n });
        await invalidate();
      },
      setSalaryViewers: async (departmentIds, personIds) => {
        await setConfigWrite("salary_viewers", { department_ids: departmentIds, person_ids: personIds });
        await invalidate();
      },
      insertMaster: async (table, input) => {
        await insertMasterWrite(table, input);
        await invalidate();
      },
      updateMaster: async (table, id, input) => {
        await updateMasterWrite(table, id, input);
        await invalidate();
      },
      insertOnboardingItem: async (input) => {
        await insertOnboardingItemWrite(input);
        await invalidate();
      },
      updateOnboardingItem: async (id, input) => {
        await updateOnboardingItemWrite(id, input);
        await invalidate();
      },

      setMasterManagers: async (masterType, userIds) => {
        await setMasterManagersWrite(masterType, userIds);
        await invalidate();
      },
      requestNewMaster: async (masterType, payload) => {
        // requested_by MUST equal auth.uid() — the insert policy checks it. In demo
        // mode the effective identity is a persona but the JWT is still the real
        // signed-in user's, so stamp the REAL session id or RLS rejects the insert.
        const id = await requestNewMasterWrite(masterType, payload, realUserId ?? user.id);
        const name = String(payload.name ?? "entry");
        await safeAnnounce({
          entityType: "master_request",
          entityId: id,
          type: "master_requested",
          // The HR bell renders this text verbatim (no actor prefix), so it has to
          // stand on its own as a sentence.
          text: `A new ${masterTypeLabel(masterType)} was requested — “${name}”. Review it.`,
          recipients: masterReviewersFor(masterType),
          meta: { masterType },
        });
        await invalidate();
        return id;
      },
      resolveMasterRequest: async (requestId, approve, payload, note) => {
        const req = masterRequests.find((r) => r.id === requestId);
        const newId = await resolveMasterRequestWrite(requestId, approve, payload, note);
        // The reviewer's edits win server-side, so report the name they actually saved.
        const finalPayload = payload ?? req?.proposedPayload ?? {};
        const name = String(finalPayload.name ?? "entry");
        const label = req ? masterTypeLabel(req.masterType) : "entry";
        await safeAnnounce({
          entityType: "master_request",
          entityId: requestId,
          type: approve ? "master_approved" : "master_rejected",
          text: approve
            ? `Your ${label} request — “${name}” — was approved. It is now selectable.`
            : `Your ${label} request — “${name}” — was rejected${note ? `: ${note}` : "."}`,
          recipients: req?.requestedBy ? [req.requestedBy] : [],
          meta: { masterType: req?.masterType, resolvedMasterId: newId },
        });
        await invalidate();
        return newId;
      },
    };
  }, [
    isLoading, error, dir, designations, jobPlatforms, jobTypes, locations, disqualificationReasons,
    onboardingItems, stepOwners, processCoordinatorIds, stepSla, minCvsToShare, salaryViewers, activity, notifications,
    requisitions, requisitionPlatforms, candidates, interviews, onboardings, onboardingChecks,
    probations, probationReviews, masterManagers, masterRequests, isAdmin, user.id, realUserId, queryClient,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHrStore(): HrStoreValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHrStore must be used within HrStoreProvider");
  return ctx;
}
