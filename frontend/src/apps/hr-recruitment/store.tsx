import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import { fetchOrgPeople, type OrgPerson } from "@/core/platform/orgPeople";
import type { Department, Profile } from "@/core/platform/types";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import {
  candidateWindowStartIso,
  fetchHrData,
  fetchHrModuleUserIds,
  HR_QK,
  hrModuleUserIdsKey,
  hrQueryKey,
} from "./data/hrFetch";
import {
  addCandidates as addCandidatesWrite,
  announce as announceWrite,
  cancelRequisition as cancelRequisitionWrite,
  decideExtension as decideExtensionWrite,
  decideProbation as decideProbationWrite,
  hodDecide as hodDecideWrite,
  moveCandidate as moveCandidateWrite,
  postCandidateComment as postCandidateCommentWrite,
  setCandidateNote as setCandidateNoteWrite,
  setCandidateTags as setCandidateTagsWrite,
  saveCandidateScore as saveCandidateScoreWrite,
  reassignInterview as reassignInterviewWrite,
  reassignStep as reassignStepWrite,
  reconsiderCandidate as reconsiderCandidateWrite,
  recordInterviewResult as recordInterviewResultWrite,
  recordProbationReview as recordProbationReviewWrite,
  scheduleInterview as scheduleInterviewWrite,
  notifyHodPending as notifyHodPendingWrite,
  updateCandidate as updateCandidateWrite,
  decideMrf as decideMrfWrite,
  holdRequisition as holdRequisitionWrite,
  insertMaster as insertMasterWrite,
  insertOnboardingItem as insertOnboardingItemWrite,
  markNotificationsRead as markNotificationsReadWrite,
  postJob as postJobWrite,
  updateDecideMrf as updateDecideMrfWrite,
  updatePostJob as updatePostJobWrite,
  updateDecideProbation as updateDecideProbationWrite,
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
import { masterTypeLabel, type MasterLists } from "./lib/masterFields";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import { isHodStep, stepByKey, type StepKey } from "./lib/steps";
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
  reconsiderTargetStage,
  stageEntryOf,
  hrApprovalLockReason,
  mgmtApprovalLockReason,
  jobPostingLockReason,
  interviewResultLockReason,
  onboardingLockReason,
  reviewLockReason,
  probationDecisionLockReason,
  type HrSnapshot,
  type QueueEntry,
  type StageEntry,
  type CompletedRow,
} from "./lib/queues";
import { roundOf } from "./lib/board";
import { matchesOf, type DupMatch, type DupProbe } from "./lib/duplicates";
import type {
  Candidate,
  CandidateFit,
  CandidateStage,
  Designation,
  HrSkill,
  JobTitle,
  Qualification,
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
  /**
   * The JD masters behind the requisition form. `jobTitles` is HR's own list and
   * is NOT `designations` above — that one is the portal-wide employee title list.
   */
  jobTitles: JobTitle[];
  skills: HrSkill[];
  qualifications: Qualification[];
  jobTitleById: (id: string | null) => JobTitle | undefined;
  skillById: (id: string) => HrSkill | undefined;
  /** Resolve an id list to names, dropping ids whose master row is gone. */
  skillNames: (ids: string[]) => string[];
  qualificationNames: (ids: string[]) => string[];
  /**
   * Every master list in one bag, for `findExistingMaster`'s duplicate check.
   * Built here rather than at each call site: the import module learned that
   * letting two screens assemble the same object independently lets one of them
   * quietly omit a list, which turns the dup check into a silent no-op.
   */
  masterLists: MasterLists;

  // master governance
  masterManagers: HrMasterManager[];
  masterRequests: HrMasterRequest[];
  pendingRequests: HrMasterRequest[];
  managerIdsFor: (masterType: HrMasterType) => string[];
  /** May the user CRUD this master — admin, or its assigned owner. */
  canManage: (masterType: HrMasterType) => boolean;
  /** Owns at least one master → sees the Masters page and the review tabs. */
  /**
   * Does this person hold a VIEW-ONLY grant on this module? On THIS module that
   * reaches the VACANCY tier only — requisitions, the MRF queues, the Control
   * Center, the Masters. The candidate screens stay hidden, because their RLS
   * gate is the candidate-PII gate; see the note beside isModuleViewer in the
   * provider and 20260925130100 section D.
   */
  isModuleViewer: boolean;
  /** Visibility half of isProcessCoordinator — the Control Center nav link and route. */
  canMonitor: boolean;
  /** Visibility half of isAnyMasterManager — the Masters nav link and route. */
  canSeeMasters: boolean;
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
  /**
   * Does this person's grant on New Recruitment allow CHANGING anything? False
   * only on a view-only grant (Admin → Module Access).
   *
   * ⚠ A CEILING, never a permission — it grants nothing and only takes away.
   *   Deliberately kept OUT of `canActOn` / `canActOnCandidate`, which also decide
   *   which cards and queues a person SEES; folding it in there would empty a
   *   view-only user's board rather than merely freeze it. ANDed in at each
   *   button, panel, drag handle and bulk bar instead.
   *
   * ⚠ Read from the REAL session, not the effective persona — a demo persona must
   *   not be able to step around the real user's view-only grant.
   */
  canEdit: boolean;
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
  /** What HR typed when they ticked "Others" on this requisition's posting. */
  otherPlatformNoteFor: (requisitionId: string) => string | null;
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
  /**
   * May this person bring a DROPPED candidate back into play?
   *
   * Deliberately NOT `canActOnCandidate`, which answers "whose move is it?" and
   * returns admin-only for a disqualified card (its pending step is null) — that
   * hid Reconsider from the HR step owner, the one person the feature exists for.
   * Authorisation here is about the stage they would be RESTORED to: whoever
   * could have disqualified them from X may bring them back to X. Mirrors the
   * check in fms_hr_reconsider_candidate.
   */
  canReconsiderCandidate: (candidate: Candidate) => boolean;
  /**
   * Anyone who looks like this person already — across all five signals, not just
   * phone and email (see lib/duplicates.ts). `requisitionId` is the vacancy being
   * added to: a match on it is data corruption, a match elsewhere is a legitimate
   * second application.
   */
  duplicatesOf: (probe: DupProbe, requisitionId: string) => DupMatch[];
  /**
   * Bring a dropped candidate back into play, keeping their history — the
   * alternative to uploading their CV a second time.
   */
  reconsiderCandidate: (candidateId: string, note: string | null) => Promise<void>;

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
  toggleOnboardingCheck: (checkId: string, done: boolean, input?: CheckInput) => Promise<void>;
  setEmployeeCode: (onboardingId: string, code: string) => Promise<void>;
  /**
   * The answer to an offer. `pending` until somebody says — making the offer does
   * not assert it was taken up. Accepting may complete the onboarding outright if
   * the checklist is already done.
   */
  setOfferStatus: (
    onboardingId: string,
    status: "accepted" | "declined" | "no_show",
    reason?: string,
  ) => Promise<void>;

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
  /** Correct the 3-month decision while it is still an 'extend' (before the month-4 review). */
  updateDecideProbation: (
    probation: Probation,
    decision: ProbationDecision,
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
   * VISIBILITY, not authority. Whether this step of this requisition belongs on
   * MY queue - which follows the HOLDER even for an admin or coordinator, while
   * canActOn keeps its admin arm.
   */
  stepIsMine: (stepKey: StepKey, requisition: Requisition) => boolean;
  /** Whoever is holding (requisition, step), or null. */
  holderOfStep: (requisitionId: string | null, stepKey: string) => string | null;
  /** May I hand this step on, or pull it back? Broader than acting on it. */
  canReassignStep: (stepKey: StepKey, requisition: Requisition) => boolean;
  /** Who this step may be handed to: the pool plus its natural owners, minus me. */
  reassignCandidates: (stepKey: StepKey, requisition: Requisition) => { id: string; name: string }[];
  /** Departments the Setup picker filters candidates by. A UI FILTER - grants nothing. */
  reassignPoolDepartmentIds: string[];
  /** Everyone who may be handed a step. The authority. */
  reassignPoolUserIds: string[];
  /**
   * Who owes this work-item. A HOD step routes to the requisition's OWN hiring
   * manager; every other step reads the global step-owner table. Empty = nobody owns
   * it — which the reports surface rather than hide.
   */
  queueOwnerIds: (entry: QueueEntry) => string[];

  // the Completed tab — "what I did here", edit-until-next-step
  /** Completed entries for one step, newest computed here; the store attaches canEdit + names. */
  completedFor: (stepKey: StepKey) => StageEntry<CompletedRow>[];
  /** Actor id → display name, resolving people outside the RLS directory (org-wide). */
  personName: (id: string | null) => string;
  /**
   * The same lookup, but `undefined` when the person genuinely cannot be found.
   *
   * `panelNames` DROPS an id it cannot resolve, so passing it `personName` would print
   * the literal "Unknown user" inside a panel line. Passing it the RLS-scoped
   * `profileById` — which every caller used to do — silently erased any interviewer
   * outside the reader's own department, making a booked round look unassigned. This
   * tries the directory first (no flicker while the org roster loads) and falls back
   * to the org-wide roster before giving up.
   */
  personNameOrNull: (id: string) => string | undefined;
  /**
   * The ORG-WIDE roster (`list_org_people`), not the RLS-scoped directory.
   *
   * `profiles` exposes self + downline + same-department peers only, so any picker
   * built on it silently omits people in other departments. The interview panel is the
   * clearest case: a head of department elsewhere in the company simply was not there.
   * Non-sensitive fields only — no phone, no email.
   */
  orgPeople: OrgPerson[];
  /** Everyone who can open New Recruitment. Empty while the lookup is in flight. */
  moduleUserIds: ReadonlySet<string>;
  /** Owners of the `mrf` step — the heads this module is set up with, offered for R2. */
  mrfOwnerIds: string[];
  /** On the panel of at least one interview that has not been held yet. */
  isBookedInterviewer: boolean;
  /** The EFFECTIVE user id — what "Mine" means on a Completed tab. */
  userId: string;
  /** Set in persona mode so the Completed tab can say whose work "Mine" is showing. */
  stageScopeNote: string | undefined;

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
  /**
   * The latest AI fit score for a candidate, or undefined if never scored.
   * Advisory: nothing in the app reads this to decide anything.
   */
  fitFor: (candidateId: string) => CandidateFit | undefined;
  notifications: HrNotification[];
  unreadCount: number;
  markNotificationsRead: (ids: string[]) => Promise<void>;

  // candidate writes
  addCandidates: (requisitionId: string, candidates: CandidateInput[]) => Promise<string[]>;
  updateCandidate: (id: string, input: CandidateInput) => Promise<void>;
  /**
   * Say something about a candidate, tagging colleagues in. Lands in the activity
   * trail as a `comment`, so the page shows process and conversation as one timeline.
   */
  postCandidateComment: (candidateId: string, text: string, mentions?: string[]) => Promise<void>;
  /** The quick note and the tags — one column each, so neither can clobber the record. */
  setCandidateNote: (candidateId: string, note: string) => Promise<void>;
  setCandidateTags: (candidateId: string, tags: string[]) => Promise<void>;
  /** Record one AI fit score. Append-only; never moves a stage and notifies nobody. */
  saveCandidateScore: (
    candidateId: string,
    score: {
      overall: number;
      verdict: string;
      axes: unknown[];
      notes: string;
      cvQuality: string;
      jdFingerprint: string;
      model: string;
    },
  ) => Promise<void>;
  moveCandidate: (candidate: Candidate, toStage: CandidateStage, payload?: MovePayload) => Promise<void>;
  hodDecide: (ids: string[], selected: boolean, reasonId?: string | null, note?: string) => Promise<void>;
  scheduleInterview: (
    id: string,
    round: number,
    interviewerIds: string[],
    interviewerName: string | null,
    scheduledOn: string | null,
  ) => Promise<void>;
  /** Hand a BOOKED, not-yet-held round to a different panel. `reason` rides the trail. */
  reassignInterview: (
    candidate: Candidate,
    round: number,
    interviewerIds: string[],
    interviewerName: string | null,
    scheduledOn: string | null,
    reason: string,
  ) => Promise<void>;
  recordInterviewResult: (
    candidate: Candidate,
    round: number,
    status: "selected" | "rejected" | "on_hold" | "no_show",
    remarks: string,
    docPath?: string | null,
    docName?: string | null,
    videoUrl?: string | null,
    /** On `selected`, the later interview round to advance to. Null after the last round. */
    nextStage?: CandidateStage | null,
  ) => Promise<void>;

  // workflow writes
  submitMrf: (input: MrfInput) => Promise<string>;
  resubmitMrf: (requisitionId: string, input: MrfInput) => Promise<void>;
  /** Upload a JD file to jd/<id>/… and record its path on the requisition. */
  attachRequisitionJd: (requisitionId: string, file: File) => Promise<void>;
  decideMrf: (requisitionId: string, stage: MrfStage, decision: MrfDecision, remarks: string) => Promise<void>;
  /** Correct a completed approval (or flip it) while the next gate has not acted. */
  updateDecideMrf: (requisitionId: string, stage: MrfStage, decision: MrfDecision, remarks: string) => Promise<void>;
  postJob: (
    requisitionId: string,
    platformIds: string[],
    postedOn: string,
    otherNote: string | null,
  ) => Promise<void>;
  /** Correct the platforms / posting date while the job is posted but no candidate has landed. */
  updatePostJob: (
    requisitionId: string,
    platformIds: string[],
    postedOn: string,
    otherNote: string | null,
  ) => Promise<void>;
  holdRequisition: (requisitionId: string, hold: boolean, reason: string) => Promise<void>;
  cancelRequisition: (requisitionId: string, reason: string) => Promise<void>;

  // config writes
  setStepOwner: (stepKey: StepKey, input: StepOwnerInput) => Promise<void>;
  setStepSla: (map: StepSlaMap) => Promise<void>;
  /** Hand one step on, or pass assignee: null to return it to its natural owner. */
  reassignStep: (input: { requisition: Requisition; stepKey: StepKey; assignee: string | null; note?: string | null }) => Promise<void>;
  /** Save who may be handed a step. departmentIds is a picker filter and grants nothing. */
  setReassignPool: (input: { departmentIds: string[]; userIds: string[] }) => Promise<void>;
  setProcessCoordinators: (userIds: string[]) => Promise<void>;
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

  // The Completed tab names people the RLS directory cannot reach (a cross-department
  // hiring manager, an external actor stamped by id). Org people is the org-wide roster.
  const { data: orgPeople } = useQuery({ queryKey: ["orgPeople"], queryFn: fetchOrgPeople, staleTime: 5 * 60 * 1000 });

  // Who can actually OPEN this module. The R2 interview picker offers the heads set up
  // to raise an MRF, and not all of them hold a grant on New Recruitment — booking one
  // silently would notify somebody who lands on Access Denied. Its own cache entry: it
  // changes when an admin edits a user, not when recruitment work moves.
  const { data: moduleUserIdList } = useQuery({
    queryKey: hrModuleUserIdsKey,
    queryFn: fetchHrModuleUserIds,
    staleTime: 5 * 60 * 1000,
  });

  const stepOwners = data?.stepOwners ?? [];
  const stepAssignees = data?.stepAssignees ?? [];
  const designations = data?.designations ?? [];
  const jobPlatforms = data?.jobPlatforms ?? [];
  const jobTypes = data?.jobTypes ?? [];
  const locations = data?.locations ?? [];
  const disqualificationReasons = data?.disqualificationReasons ?? [];
  const onboardingItems = data?.onboardingItems ?? [];
  const jobTitles = data?.jobTitles ?? [];
  const skills = data?.skills ?? [];
  const qualifications = data?.qualifications ?? [];
  const requisitions = data?.requisitions ?? [];
  const requisitionPlatforms = data?.requisitionPlatforms ?? [];
  const candidates = data?.candidates ?? [];
  const interviews = data?.interviews ?? [];
  const onboardings = data?.onboardings ?? [];
  const onboardingChecks = data?.onboardingChecks ?? [];
  const probations = data?.probations ?? [];
  const probationReviews = data?.probationReviews ?? [];
  const activity = data?.activity ?? [];
  const candidateScores = data?.candidateScores ?? [];
  const notifications = data?.notifications ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;
  const salaryViewers = data?.config.salaryViewers ?? { departmentIds: [], personIds: [] };
  const reassignPoolDepartmentIds = data?.config.reassignPoolDepartmentIds ?? [];
  const reassignPoolUserIds = data?.config.reassignPoolUserIds ?? [];

  // The REAL signed-in user, never the impersonated persona. RLS and RPC actor
  // stamping run off the JWT, so any write whose policy checks `= auth.uid()`
  // must carry this id — see requestNewMaster below.
  const realUserId = session.user?.id ?? null;

  const value = useMemo<HrStoreValue>(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    const stepOwnerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);

    // The JD masters, indexed. A requisition stores plain uuid[] (no FK is possible
    // inside an array), so a master row that was deleted leaves a dangling id —
    // these resolvers drop it rather than rendering "undefined".
    const jobTitleIdx = new Map(jobTitles.map((t) => [t.id, t]));
    const skillIdx = new Map(skills.map((s) => [s.id, s]));
    const qualificationIdx = new Map(qualifications.map((q) => [q.id, q]));
    const jobTitleById = (id: string | null) => (id ? jobTitleIdx.get(id) : undefined);
    const skillById = (id: string) => skillIdx.get(id);
    const skillNames = (ids: string[]) => ids.map((id) => skillIdx.get(id)?.name).filter((n): n is string => !!n);
    const qualificationNames = (ids: string[]) =>
      ids.map((id) => qualificationIdx.get(id)?.name).filter((n): n is string => !!n);

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

    // Module-level write ceiling — see the doc on HrStoreValue.canEdit.
    //
    // ⚠ DECLARED HERE, not beside canActOnCandidate where it used to sit.
    //   `canManage` now folds it and `resolvableRequests` CALLS canManage
    //   synchronously below; with the old placement that is a temporal dead zone
    //   and the store throws on first render.
    const canEdit = session.canEditModule("hr-recruitment");

    /**
     * A "View only" grant on this module is a read grant — but on THIS module it
     * reaches the VACANCY tier only.
     *
     * ⚠ IT DOES NOT OPEN THE CANDIDATE BOARDS, and that is not an oversight. The
     *   RLS gate for candidates, interviews, scores, onboardings and probations is
     *   `fms_hr_can_read_requisition`, and closing a candidate-PII hole is the
     *   entire reason that function exists (20260712180000: a department head who
     *   could raise a requisition could read every other department's applicants —
     *   names, phones, CVs, salary expectations). 20260925130100 therefore widens
     *   a SIBLING, fms_hr_can_view_requisition, used only by the requisition
     *   tables, and leaves the PII gate exactly as it was.
     *
     *   So a viewer reads the requisitions, the MRF queues, the Control Center and
     *   the Masters — and the candidate screens stay hidden rather than opening
     *   empty. Letting a viewer read candidates needs a masked projection (stage
     *   and dates without name, phone, email, CV or expected salary), which is a
     *   separate piece of work with its own decision about which columns are PII.
     *
     * ⚠ VISIBILITY ONLY, and never an arm on `isProcessCoordinator` — that flag is
     *   also the authority short-circuit inside canActOn / canActOnCandidate.
     */
    const isModuleViewer = session.isModuleViewer("hr-recruitment");

    /** Visibility half of the coordinator flag — nav link + RequireMonitor only. */
    const canMonitor = isModuleViewer || isProcessCoordinator;

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

    // The LATEST fit score per candidate. The table is append-only — one row per
    // scoring run, so the history survives a JD edit — but only the newest is
    // ever shown, and "newest" is derived here rather than in SQL.
    const fitByCandidate = new Map<string, CandidateFit>();
    for (const s of candidateScores) {
      const held = fitByCandidate.get(s.candidateId);
      if (!held || s.scoredAt > held.scoredAt) fitByCandidate.set(s.candidateId, s);
    }

    // Newest first. The base fetch orders ascending, so without this the bell
    // read oldest-first — the stalest ping at the top.
    const mine = notifications
      .filter((n) => n.userId === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    /** Fan out a transition notification; never let it break the workflow action. */
    const safeAnnounce = async (input: Parameters<typeof announceWrite>[0]) => {
      try {
        await announceWrite(input);
      } catch {
        // The trail is best-effort. State lives on the domain row, stamped in the RPC.
      }
    };

    /**
     * Refresh the HOD's "N CVs awaiting your shortlist" digest for a requisition.
     * Swallowed for the same reason as `safeAnnounce`: a card really did move, and a
     * failed ping must not make it look otherwise. The count is recomputed from the
     * board on the next call, so a dropped refresh self-heals.
     */
    const safeNotifyHodPending = async (requisitionId: string) => {
      try {
        await notifyHodPendingWrite(requisitionId);
      } catch {
        // Best-effort, exactly like the trail above.
      }
    };

    /* ---- master governance ---- */

    const managerIdsFor = (mt: HrMasterType) =>
      masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId);

    // Pure write gate (MasterCrud Add + Actions, and Approve/Reject on a master
    // request), so the module ceiling folds straight in. It did NOT, which made
    // every one of those live on a view-only grant — on an ungated route.
    // isAnyMasterManager below is left alone: it guards the Masters ROUTE.
    const canManage = (mt: HrMasterType) => canEdit && (isAdmin || managerIdsFor(mt).includes(user.id));

    const isAnyMasterManager = isAdmin || masterManagers.some((m) => m.managerUserId === user.id);
    /** Visibility half — nav link + RequireMasterAccess. canManage still gates every write. */
    const canSeeMasters = isModuleViewer || isAnyMasterManager;

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
    // Only the "Others" row ever carries a note, so the first non-null is THE note.
    const otherNoteByReq = new Map<string, string>();
    for (const rp of requisitionPlatforms) {
      const list = platformsByReq.get(rp.requisitionId) ?? [];
      list.push(rp.platformId);
      platformsByReq.set(rp.requisitionId, list);
      if (rp.otherNote) otherNoteByReq.set(rp.requisitionId, rp.otherNote);
    }

    const ownsRequisition = (r: Requisition) =>
      r.requesterId === user.id || r.hiringManagerIds.includes(user.id);

    /**
     * Mirrors fms_hr_can_act() in SQL. Kept in step with it deliberately: this
     * only decides what the UI offers — the RPC re-checks and is the real gate.
     */
    /**
     * Who is HOLDING (requisition, step), or null. Keyed exactly the way
     * fms_hr_can_act authorises, so the client and the server cannot disagree.
     */
    const holderByKey = new Map<string, string>();
    for (const a of stepAssignees) holderByKey.set(a.requisitionId + '|' + a.stepKey, a.assignedTo);
    const holderOfStep = (requisitionId: string | null, stepKey: string): string | null =>
      requisitionId ? holderByKey.get(requisitionId + '|' + stepKey) ?? null : null;

    const canActOn = (stepKey: StepKey, r: Requisition): boolean => {
      // Resubmitting a sent-back MRF is the ONE step whose server rule is neither
      // "step owner" nor "hiring manager": fms_hr_resubmit_mrf allows the REQUESTER (or
      // an admin) and nobody else — not the hiring manager, not a coordinator. This
      // branch sits above the admin/coordinator short-circuit so we never offer a
      // coordinator a button the database will reject.
      if (stepKey === "mrf_resubmit") return r.requesterId === user.id || isAdmin;
      if (isAdmin || isProcessCoordinator) return true;
      // A HANDOVER MOVES THE WORK. While a holder is set they are the only
      // non-admin who may act - deliberately NOT an OR with the natural owner,
      // or the step would stay in that owner's queue too. Exact mirror of
      // fms_hr_can_act__ungated, and it sits BEFORE the HOD branch for the same
      // reason the SQL does: that branch returns, so anything after it is
      // unreachable for the seven steps that need this most.
      const holder = holderOfStep(r.id, stepKey);
      if (holder) return holder === user.id;
      if (isHodStep(stepKey)) return r.hiringManagerIds.includes(user.id);
      return stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(user.id));
    };

    /** Who owns a step when nobody holds it. Mirrors fms_hr_is_natural_step_owner. */
    const isNaturalStepOwner = (stepKey: StepKey, r: Requisition, uid: string): boolean =>
      isHodStep(stepKey)
        ? r.hiringManagerIds.includes(uid)
        : stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(uid));

    /**
     * May I hand this step on, or pull it back? Broader than acting on it: the
     * NATURAL owner keeps this after handing over, which is exactly how a step
     * comes back. Mirrors fms_hr_reassign_step.
     *
     * WARNING: identity comes from the REAL `session`, never the effective
     * persona. This gates a write the server authorises against auth.uid(), so a
     * persona-derived gate would offer a button the RPC then refuses — and both
     * halves must come from the real session, since taking the real id but the
     * persona's isAdmin is the subtle version of the same bug.
     */
    const canReassignStep = (stepKey: StepKey, r: Requisition): boolean => {
      if (r.status === "cancelled") return false;
      const me = realUserId ?? "";
      if (!me || !canEdit) return false;
      if (session.isAdmin || processCoordinatorIds.includes(me)) return true;
      if (holderOfStep(r.id, stepKey) === me) return true;
      return isNaturalStepOwner(stepKey, r, me);
    };

    /**
     * Who this step may be handed to: the configured pool, plus its own natural
     * owners so it can be handed BACK, minus me.
     *
     * Per-STEP rather than a flat list, because the natural owner differs by step
     * — the hiring managers for the seven HOD/probation steps, the configured step
     * owners for everything else — and fms_hr_reassign_step would refuse anyone
     * who is neither.
     *
     * Names resolve through `personName`, i.e. the ORG-WIDE list: the directory is
     * RLS-scoped, so a pool member in another department would render blank for a
     * non-admin hiring manager, who is precisely the person using this dialog.
     */
    const reassignCandidates = (stepKey: StepKey, r: Requisition): { id: string; name: string }[] => {
      const ids = new Set<string>(reassignPoolUserIds);
      for (const id of isHodStep(stepKey) ? r.hiringManagerIds : ownerIdsOf(stepKey)) ids.add(id);
      ids.delete(realUserId ?? "");
      return [...ids]
        .map((id) => ({ id, name: personName(id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
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
      if (step) {
        // The BOOKED panel owns the round it was given, alongside the requisition's
        // hiring manager — the client mirror of fms_hr_is_interview_panel. It lives
        // here rather than in `canActOn` because that one is requisition-scoped and
        // has no candidate to look a panel up by. Ownership is additive: the hiring
        // manager keeps the round, so a handover can never leave it owned by nobody.
        const round = roundOf(c.stage);
        if (
          round !== null &&
          (ivsByCan.get(c.id) ?? []).some(
            (iv) => iv.round === round && iv.interviewerIds.includes(user.id),
          )
        ) {
          return true;
        }
        return canActOn(step, r);
      }
      // A card with no pending step owes nobody a move — except Made Offer, which
      // still has two exits: mark them hired once they join, or disqualify them if
      // the offer falls through. Those belong to the onboarding owner and the offer
      // owner, and this must match the authz branches in fms_hr_move_candidate or the
      // board hides an action the server would have allowed.
      if (c.stage === "finalized") return canActOn("onboarding", r) || canActOn("final_decision", r);
      return isAdmin || isProcessCoordinator;
    };

    /**
     * Reconsider is authorised by DESTINATION, not by the card's current column.
     *
     * A disqualified card has no pending step, so canActOnCandidate falls through
     * to admin-only — which hid this control from Saloni, the natural hr_shortlist
     * owner and precisely the person whose CV re-uploads created the duplicate
     * rows FIX-5 exists to prevent. Conversely a flat "hr_shortlist may reconsider"
     * would let her resurrect someone a HOD dropped at Round 3, into a stage she
     * has no authority over. Both are fixed by asking the same question the
     * disqualify branch of fms_hr_move_candidate asks, about the target stage.
     */
    const canReconsiderCandidate = (c: Candidate): boolean => {
      const r = reqById.get(c.requisitionId);
      if (!r || c.stage !== "disqualified") return false;
      const to = reconsiderTargetStage(c, ivsByCan.get(c.id) ?? []);
      return (
        canActOn(STAGE_PENDING_STEP[to] ?? "final_decision", r) ||
        canActOn("final_decision", r) ||
        (to === "hr_shortlisted" && canActOn("hr_shortlist", r)) ||
        (to === "finalized" && canActOn("onboarding", r))
      );
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

    /**
     * VISIBILITY - is this entry on MY desk? Deliberately NOT canActOn, which is
     * AUTHORITY and opens with an admin/coordinator arm.
     *
     * ⚠ IT MATTERS MORE HERE THAN ANYWHERE ELSE. hr_head_approval and
     *   final_decision are both owned by the ONE person who is also the process
     *   coordinator, so canActOn returns true for her on everything. Without this
     *   split a handover would leave her queue never - and she is the single most
     *   likely person to use the feature.
     */
    const stepIsMine = (stepKey: StepKey, r: Requisition): boolean => {
      const holder = holderOfStep(r.id, stepKey);
      if (holder) return holder === user.id;
      return canActOn(stepKey, r);
    };

    const myQueue = (stepKey: StepKey): QueueEntry[] =>
      queueEntries.filter((e) => {
        if (e.stepKey !== stepKey) return false;
        const r = e.requisitionId ? reqById.get(e.requisitionId) : undefined;
        return r ? stepIsMine(stepKey, r) : false;
      });

    /**
     * Who owes a work-item — the same split fms_hr_can_act() makes server-side, so
     * "whose queue is it in" and "who may act on it" are one answer, not two.
     */
    const queueOwnerIds = (e: QueueEntry): string[] => {
      const r = e.requisitionId ? reqById.get(e.requisitionId) : undefined;
      // Handed over? Then it is owed by exactly one person, whatever the step.
      const holder = holderOfStep(e.requisitionId ?? null, e.stepKey);
      if (holder) return [holder];
      // Owed by the one person who raised it — not the hiring manager, and not the
      // global owners table (which has no row for this step, so without this branch it
      // would be reported as work owed by "Nobody").
      if (e.stepKey === "mrf_resubmit") return r?.requesterId ? [r.requesterId] : [];
      if (isHodStep(e.stepKey)) return r?.hiringManagerIds ?? [];
      return ownerIdsOf(e.stepKey);
    };

    /* -------------------------- the Completed tab -------------------------- */

    // Actor id → display name. The Completed tab names people outside the RLS
    // directory's reach (a cross-department hiring manager), so it goes through org
    // people, not profileById.
    const personName = (id: string | null): string => {
      if (!id) return "Not recorded";
      if (id === user.id) return user.name;
      return (orgPeople ?? []).find((p) => p.id === id)?.name ?? "Unknown user";
    };

    /**
     * The same lookup without the "Unknown user" sentinel — see the doc on the type.
     * Directory first so a same-department name never flickers while the org roster
     * loads; org-wide second so a cross-department interviewer resolves at all.
     */
    const personNameOrNull = (id: string): string | undefined => {
      if (id === user.id) return user.name;
      return dir.profileById(id)?.name ?? (orgPeople ?? []).find((p) => p.id === id)?.name;
    };

    const moduleUserIds: ReadonlySet<string> = new Set(moduleUserIdList ?? []);
    const mrfOwnerIds = stepOwnerFor("mrf")?.employeeIds ?? [];

    /**
     * On the panel of an interview that has not happened yet.
     *
     * The Interviews queue and its sidebar link were gated on `isStepOwner(interview_*)`
     * / coordinator / owning the requisition — and the HOD steps have NO rows in the
     * step-owner table, so a head booked onto a round they do not otherwise own got no
     * link and an Access Denied on the page their notification points at.
     */
    const isBookedInterviewer = interviews.some(
      (iv) => !iv.heldAt && iv.interviewerIds.includes(user.id),
    );

    const deptOfReq = (requisitionId: string | null): string | null =>
      requisitionId ? (reqById.get(requisitionId)?.departmentId ?? null) : null;

    /**
     * "What I did here", one entry per (step, entity). Each entry carries its own
     * lockReason (pure, mirrors the server guard) and a precomputed canEdit (this
     * user owns the step AND its window is open) — canActOn is not uniform across the
     * four entities, so the builder that knows the entity resolves ownership once.
     */
    const completedForUngated = (stepKey: StepKey): StageEntry<CompletedRow>[] => {
      switch (stepKey) {
        case "hr_head_approval":
          return requisitions
            .filter((r) => r.hrApprovedAt)
            .map((r) => {
              const lock = hrApprovalLockReason(r);
              return stageEntryOf(
                "hr_head_approval",
                { id: `hr_head_approval:${r.id}`, entityId: r.id, requisitionId: r.id, departmentId: r.departmentId, ref: r.mrfNo, editedAtIso: r.editedAt, editedById: r.editedBy, row: r },
                r.hrApproverId, r.hrApprovedAt!, lock, canActOn("hr_head_approval", r) && !lock,
              );
            });
        case "mgmt_approval":
          return requisitions
            .filter((r) => r.mgmtApprovedAt)
            .map((r) => {
              const lock = mgmtApprovalLockReason(r);
              return stageEntryOf(
                "mgmt_approval",
                { id: `mgmt_approval:${r.id}`, entityId: r.id, requisitionId: r.id, departmentId: r.departmentId, ref: r.mrfNo, editedAtIso: r.editedAt, editedById: r.editedBy, row: r },
                r.mgmtApproverId, r.mgmtApprovedAt!, lock, canActOn("mgmt_approval", r) && !lock,
              );
            });
        case "job_posting":
          return requisitions
            .filter((r) => r.postedAt)
            .map((r) => {
              const hasCandidate = (cansByReq.get(r.id)?.length ?? 0) > 0;
              const lock = jobPostingLockReason(r, hasCandidate);
              return stageEntryOf(
                "job_posting",
                { id: `job_posting:${r.id}`, entityId: r.id, requisitionId: r.id, departmentId: r.departmentId, ref: r.mrfNo, editedAtIso: r.editedAt, editedById: r.editedBy, row: r },
                r.postedBy, r.postedAt!, lock, canActOn("job_posting", r) && !lock,
              );
            });
        case "telephonic_screening":
        case "interview_1":
        case "interview_2":
        case "interview_3": {
          const round = (stepKey === "telephonic_screening" ? 0 : Number(stepKey.slice(-1))) as 0 | 1 | 2 | 3;
          const out: StageEntry<CompletedRow>[] = [];
          for (const c of candidates) {
            const iv = (ivsByCan.get(c.id) ?? []).find((v) => v.round === round && v.heldAt);
            if (!iv) continue;
            const lock = interviewResultLockReason(c, round);
            out.push(
              stageEntryOf(
                stepKey,
                { id: `${stepKey}:${c.id}`, entityId: c.id, requisitionId: c.requisitionId, departmentId: deptOfReq(c.requisitionId), ref: c.name, editedAtIso: iv.editedAt, editedById: iv.editedBy, row: c },
                iv.resultRecordedBy, iv.heldAt!, lock, canActOnCandidate(c) && !lock,
              ),
            );
          }
          return out;
        }
        case "onboarding":
          // Reaches Completed only once the person joined — a record, view-only.
          return onboardings
            .filter((o) => o.completedAt)
            .map((o) =>
              stageEntryOf(
                "onboarding",
                { id: `onboarding:${o.id}`, entityId: o.id, requisitionId: o.requisitionId, departmentId: deptOfReq(o.requisitionId), ref: canById.get(o.candidateId)?.name ?? "New hire", editedAtIso: o.editedAt, editedById: o.editedBy, row: o },
                o.joiningDateBy ?? o.offerDecidedBy, o.completedAt!, onboardingLockReason(), false,
              ),
            );
        case "probation_m1":
        case "probation_m2":
        case "probation_m3":
        case "probation_extension": {
          const month = stepKey === "probation_extension" ? 4 : Number(stepKey.slice(-1));
          const out: StageEntry<CompletedRow>[] = [];
          for (const p of probations) {
            const review = (reviewsByProb.get(p.id) ?? []).find((rv) => rv.month === month);
            if (!review) continue;
            const lock = reviewLockReason(p, review);
            out.push(
              stageEntryOf(
                stepKey,
                { id: `${stepKey}:${p.id}`, entityId: p.id, requisitionId: p.requisitionId, departmentId: deptOfReq(p.requisitionId), ref: canById.get(p.candidateId)?.name ?? "New hire", editedAtIso: review.editedAt, editedById: review.editedBy, row: p },
                review.reviewerId, review.reviewedAt, lock, canActOnProbation(p) && !lock,
              ),
            );
          }
          return out;
        }
        case "probation_final":
          // The decision is VIEW-ONLY in the Completed tab: it is taken (and, for an
          // 'extend', corrected) from the probation panel while it is the pending work —
          // there is no standalone decision editor. onView opens the panel.
          return probations
            .filter((p) => p.outcome)
            .map((p) => {
              const hasM4 = (reviewsByProb.get(p.id) ?? []).some((rv) => rv.month === 4);
              const lock =
                probationDecisionLockReason(p, hasM4) ??
                "Open the probation to change an extended decision while the month-4 review is pending.";
              return stageEntryOf(
                "probation_final",
                { id: `probation_final:${p.id}`, entityId: p.id, requisitionId: p.requisitionId, departmentId: deptOfReq(p.requisitionId), ref: canById.get(p.candidateId)?.name ?? "New hire", editedAtIso: p.editedAt, editedById: p.editedBy, row: p },
                p.outcomeBy, p.outcomeAt!, lock, false,
              );
            });
        default:
          return [];
      }
    };

    /**
     * The module write ceiling, applied once to every completed entry.
     *
     * ⚠ EACH BRANCH ABOVE SETS `canEdit` FROM OWNERSHIP ALONE — canActOn /
     *   canActOnCandidate / canActOnProbation — and `CompletedTable` renders its
     *   row action straight off it. So on a view-only grant every Completed tab in
     *   the app offered a live Edit. Folding it here rather than in eight branches
     *   keeps the next branch honest by default. hr-exit's twin
     *   (CompletedExitTable) already tested `s.canEdit` at the call site.
     */
    const completedFor = (stepKey: StepKey): StageEntry<CompletedRow>[] =>
      canEdit
        ? completedForUngated(stepKey)
        : completedForUngated(stepKey).map((e) => ({ ...e, canEdit: false }));

    /* ---------------------------------------------------------------------- */

    return {
      requisitions,
      requisitionById,
      requisitionPlatforms,
      platformIdsFor: (id) => platformsByReq.get(id) ?? [],
      otherPlatformNoteFor: (id) => otherNoteByReq.get(id) ?? null,
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
      canReconsiderCandidate,
      duplicatesOf: (probe, requisitionId) => matchesOf(probe, candidates, requisitionId),

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
      toggleOnboardingCheck: async (checkId, done, input) => {
        await toggleOnboardingCheckWrite(checkId, done, input ?? {});
        await invalidate();
      },
      setEmployeeCode: async (oid, code) => {
        await setEmployeeCodeWrite(oid, code);
        await invalidate();
      },
      setOfferStatus: async (oid, status, reason) => {
        await setOfferStatusWrite(oid, status, reason ?? "");
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
      updateDecideProbation: async (p, decision, remarks, permanentFrom, employeeCode) => {
        await updateDecideProbationWrite(p.id, decision, remarks, permanentFrom ?? null, employeeCode ?? null);
        await invalidate();
      },

      queueEntries,
      myQueue,
      dueIsoFor: (r, stepKey) => requisitionDueIso(snapshot, r, stepKey),
      canActOn,
      stepIsMine,
      holderOfStep,
      canReassignStep,
      reassignCandidates,
      reassignPoolDepartmentIds,
      reassignPoolUserIds,
      queueOwnerIds,

      completedFor,
      personName,
      personNameOrNull,
      orgPeople: orgPeople ?? [],
      moduleUserIds,
      mrfOwnerIds,
      isBookedInterviewer,
      userId: user.id,
      stageScopeNote: user.id !== realUserId ? `Showing ${user.name}'s work` : undefined,

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
      // The RPC writes its own activity row — it is the only thing that still knows
      // the original rejection reason at the moment it clears it — so there is no
      // safeAnnounce here. Nobody is notified: reopening a card is HR's own
      // housekeeping, and the person who now owes it an action finds it on the board.
      reconsiderCandidate: async (candidateId, note) => {
        await reconsiderCandidateWrite(candidateId, note);
        await invalidate();
      },
      // The RPC does its own announcing — it is the only writer that knows who was
      // tagged — so there is no safeAnnounce here, unlike the moves above.
      postCandidateComment: async (candidateId, text, mentions) => {
        await postCandidateCommentWrite(candidateId, text, mentions ?? []);
        await invalidate();
      },
      setCandidateNote: async (candidateId, note) => {
        await setCandidateNoteWrite(candidateId, note);
        await invalidate();
      },
      setCandidateTags: async (candidateId, tags) => {
        await setCandidateTagsWrite(candidateId, tags);
        await invalidate();
      },
      // Advisory only. It records what the model said and refreshes the snapshot —
      // it does NOT move a stage, notify anyone, or write an activity row.
      saveCandidateScore: async (candidateId, score) => {
        await saveCandidateScoreWrite(candidateId, score);
        await invalidate();
      },
      moveCandidate: async (c, toStage, payload) => {
        await moveCandidateWrite(c.id, toStage, payload ?? {});
        const nextStep = STAGE_PENDING_STEP[toStage];
        const r = reqById.get(c.requisitionId);
        // A card landing in `hr_shortlisted` is the HOD's, but it is ONE of a batch
        // HR is working through — so the per-card ping is suppressed here and the
        // rolling digest below carries the news instead. Empty recipients still
        // writes the activity row, so the audit trail is unaffected.
        const digestOnly = toStage === "hr_shortlisted";
        // Notify whoever now owes this card an action. A HOD step routes to the
        // requisition's OWN hiring manager, not to a global owner list — plus, when
        // the move BOOKED a panel (an interview move carries `interviewerIds`), the
        // people just put on it. Ownership is additive, so both are told: the panel
        // has to turn up, and the hiring manager still owns the vacancy.
        const bookedPanel = payload?.interviewerIds ?? [];
        const recipients = digestOnly
          ? []
          : nextStep && r
            ? isHodStep(nextStep)
              ? [...new Set([...r.hiringManagerIds, ...bookedPanel])]
              : [...new Set([...ownerIdsOf(nextStep), ...bookedPanel])]
            : bookedPanel;
        await safeAnnounce({
          entityType: "candidate",
          entityId: c.id,
          type: `moved_${toStage}`,
          text: `${c.name} → ${toStage.replace(/_/g, " ")}`,
          recipients,
        });
        // Refresh the digest when the move touches `hr_shortlisted` on EITHER side.
        // Only firing on the way in would leave the count stale behind every
        // disqualify-from-shortlist and every drag back — the bell would go on
        // claiming CVs that are no longer waiting.
        if (digestOnly || c.stage === "hr_shortlisted") {
          await safeNotifyHodPending(c.requisitionId);
        }
        // The offer kicks off onboarding — nudge its owners to send the offer
        // confirmation (there is no auto-email; the checklist item is the record).
        if (toStage === "finalized") {
          await safeAnnounce({
            entityType: "candidate",
            entityId: c.id,
            type: "send_offer_confirmation",
            text: `${c.name} offered ${r?.mrfNo ?? "the vacancy"} — send the offer confirmation`,
            recipients: ownerIdsOf("onboarding"),
          });
        }
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
        // The batch just left the HOD's plate either way — close their digest out
        // rather than leaving it announcing work they have already done.
        const first = canById.get(ids[0]);
        if (first) await safeNotifyHodPending(first.requisitionId);
        await invalidate();
      },
      scheduleInterview: async (id, round, interviewerIds, interviewerName, scheduledOn) => {
        await scheduleInterviewWrite(id, round, interviewerIds, interviewerName, scheduledOn);
        // Tell the panel. Booking used to notify NOBODY — not the people put on it,
        // not anyone else — so a head learned they were taking a round only by opening
        // the board. The panel is the audience here, not the step owner: they are the
        // ones who now owe the interview.
        const c = canById.get(id);
        await safeAnnounce({
          entityType: "candidate",
          entityId: id,
          type: "interview_booked",
          text: `${c?.name ?? "A candidate"} — ${
            round === 0 ? "telephonic screen" : `Round ${round}`
          } booked${scheduledOn ? ` for ${scheduledOn}` : ""}`,
          recipients: interviewerIds,
          meta: { round, scheduled_on: scheduledOn },
        });
        await invalidate();
      },
      reassignInterview: async (c, round, interviewerIds, interviewerName, scheduledOn, reason) => {
        const before = (ivsByCan.get(c.id) ?? []).find((iv) => iv.round === round);
        await reassignInterviewWrite(c.id, round, interviewerIds, interviewerName, scheduledOn);
        const roundLabel = round === 0 ? "the telephonic screen" : `Round ${round}`;
        // The incoming panel is told they have it...
        await safeAnnounce({
          entityType: "candidate",
          entityId: c.id,
          type: "interview_reassigned",
          text: `${c.name} — ${roundLabel} is now yours${reason.trim() ? ` (${reason.trim()})` : ""}`,
          recipients: interviewerIds,
          meta: { round, from: before?.interviewerIds ?? [], to: interviewerIds, reason: reason.trim() || null },
        });
        // ...and whoever is losing it is told to stop expecting it. Without this the
        // outgoing head keeps a round on their list that is no longer theirs, which is
        // exactly the confusion a handover is meant to remove. Anyone on both panels is
        // dropped — being told you have gained and lost the same round is nonsense.
        const dropped = (before?.interviewerIds ?? []).filter((id) => !interviewerIds.includes(id));
        if (dropped.length) {
          await safeAnnounce({
            entityType: "candidate",
            entityId: c.id,
            type: "interview_handed_over",
            text: `${c.name} — ${roundLabel} has been passed to someone else`,
            recipients: dropped,
            meta: { round },
          });
        }
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
      updateDecideMrf: async (id, stage, decision, remarks) => {
        await updateDecideMrfWrite(id, stage, decision, remarks);
        await invalidate();
      },
      postJob: async (id, platformIds, postedOn, otherNote) => {
        await postJobWrite(id, platformIds, postedOn, otherNote);
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
      updatePostJob: async (id, platformIds, postedOn, otherNote) => {
        await updatePostJobWrite(id, platformIds, postedOn, otherNote);
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
      isModuleViewer,
      canMonitor,
      canSeeMasters,
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
      jobTitles,
      skills,
      qualifications,
      jobTitleById,
      skillById,
      skillNames,
      qualificationNames,
      masterLists: {
        jobPlatforms,
        jobTypes,
        locations,
        disqualificationReasons,
        onboardingItems,
        jobTitles,
        skills,
        qualifications,
      },
      activeOnboardingItems: onboardingItems
        .filter((i) => i.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),

      stepOwners,
      stepOwnerFor,
      processCoordinatorIds,
      stepSla,
      salaryViewers,
      canViewSalary,

      isAdmin,
      canEdit,
      canConfigure: canEdit && isAdmin,
      isProcessCoordinator,
      isStepOwner,
      isAnyStepOwner,

      activity,
      activityFor: (entityType, entityId) => activityByEntity.get(`${entityType}:${entityId}`) ?? [],
      fitFor: (candidateId) => fitByCandidate.get(candidateId),
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
      reassignStep: async ({ requisition, stepKey, assignee, note }) => {
        await reassignStepWrite(requisition.id, stepKey, assignee, note ?? null);
        const returned = assignee === null;
        const label = stepByKey(stepKey)?.title ?? stepKey;
        await safeAnnounce({
          entityType: 'requisition',
          entityId: requisition.id,
          type: 'step_reassigned',
          text: returned
            ? label + ' on ' + requisition.mrfNo + ' was returned to its usual owner' + (note ? ' - ' + note : '')
            : label + ' on ' + requisition.mrfNo + ' was reassigned to ' + personName(assignee) + (note ? ' - ' + note : ''),
          // On a hand-back nobody in particular owns it, so tell whoever does now.
          recipients: returned
            ? (isHodStep(stepKey) ? requisition.hiringManagerIds : ownerIdsOf(stepKey))
            : [assignee as string],
        });
        await invalidate();
      },
      setReassignPool: async ({ departmentIds, userIds }) => {
        // department_ids is stored so Setup can re-open on the same filter; it is
        // NOT read by fms_hr_can_receive_reassignment and grants nothing.
        await setConfigWrite('reassign_pool', { department_ids: departmentIds, user_ids: userIds });
        await invalidate();
      },
      setProcessCoordinators: async (userIds) => {
        await setConfigWrite("process_coordinators", { user_ids: userIds });
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
    onboardingItems, jobTitles, skills, qualifications,
    stepOwners, processCoordinatorIds, stepSla, salaryViewers, activity, candidateScores, notifications,
    // Load-bearing and invisible to tsc, like orgPeople below: without these the
    // memo keeps the holders and the pool it was built with, so a handover would
    // not move anything on screen and Setup Save would never confirm.
    stepAssignees, reassignPoolDepartmentIds, reassignPoolUserIds,
    requisitions, requisitionPlatforms, candidates, interviews, onboardings, onboardingChecks,
    probations, probationReviews, masterManagers, masterRequests, isAdmin, user.id, user.name, realUserId, queryClient,
    // `orgPeople` — personName closes over it; without it the memo would not recompute
    // when the org roster arrives and Completed-tab "By" names would stay "Unknown user".
    orgPeople,
    // Same reason: the interview picker marks anyone who cannot open this module, and
    // that marking must appear when the lookup lands rather than on the next board move.
    moduleUserIdList,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useHrStore(): HrStoreValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useHrStore must be used within HrStoreProvider");
  return ctx;
}
