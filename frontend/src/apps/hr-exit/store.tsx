import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/core/platform/session";
import { useDirectory } from "@/core/platform/store";
import type { Department, Profile } from "@/core/platform/types";
import { useEffectiveIdentity } from "@/shared/sandbox/useEffectiveIdentity";
import { EXIT_QK, exitQueryKey, fetchExitData } from "./data/exitFetch";
import {
  announce as announceWrite,
  approveFnf as approveFnfWrite,
  archiveCase as archiveCaseWrite,
  confirmHandover as confirmHandoverWrite,
  confirmLwd as confirmLwdWrite,
  decideCase as decideCaseWrite,
  generateFnf as generateFnfWrite,
  holdCase as holdCaseWrite,
  hrVerify as hrVerifyWrite,
  insertClearanceItem as insertClearanceItemWrite,
  insertDocumentType as insertDocumentTypeWrite,
  insertMaster as insertMasterWrite,
  insertPayrollHead as insertPayrollHeadWrite,
  issueDocuments as issueDocumentsWrite,
  managerReview as managerReviewWrite,
  markNotificationsRead as markNotificationsReadWrite,
  raiseCase as raiseCaseWrite,
  recordAck as recordAckWrite,
  recordHandover as recordHandoverWrite,
  recordInterview as recordInterviewWrite,
  recordPayrollInputs as recordPayrollInputsWrite,
  releaseFnfPayment as releaseFnfPaymentWrite,
  setClearanceNa as setClearanceNaWrite,
  setConfig as setConfigWrite,
  setStepOwner as setStepOwnerWrite,
  signAssets as signAssetsWrite,
  skipStep as skipStepWrite,
  toggleClearanceCheck as toggleClearanceCheckWrite,
  updateAsset as updateAssetWrite,
  updateCase as updateCaseWrite,
  updateClearanceItem as updateClearanceItemWrite,
  updateDocumentType as updateDocumentTypeWrite,
  updateMaster as updateMasterWrite,
  updatePayrollHead as updatePayrollHeadWrite,
  uploadResignationLetter,
  verifyLeave as verifyLeaveWrite,
  withdrawCase as withdrawCaseWrite,
  setMasterManagers as setMasterManagersWrite,
  requestNewMaster as requestNewMasterWrite,
  resolveMasterRequest as resolveMasterRequestWrite,
  type AckInput,
  type AssetInput,
  type CaseInput,
  type CheckInput,
  type ClearanceItemInput,
  type DocumentIssueInput,
  type DocumentTypeInput,
  type ExitMasterTable,
  type HandoverInput,
  type HrVerifyInput,
  type FnfInput,
  type InterviewInput,
  type LeaveInput,
  type MasterInput,
  type PaymentInput,
  type PayrollHeadInput,
  type PayrollInput,
  type StepOwnerInput,
} from "./data/exitWrites";
import {
  buildQueueEntries,
  checkDueIso,
  checkOwnerIds,
  daysToLwd,
  exitDueIso,
  exitSnapshotFrom,
  isCheckOutstanding,
  isOpenCase,
  skippedStepsOf,
  type ExitSnapshot,
  type QueueEntry,
} from "./lib/queues";
import { masterTypeLabel } from "./lib/masterFields";
import { DEFAULT_STEP_SLA, type StepSlaMap } from "./lib/sla";
import { isManagerStep, SETTLEMENT_STEPS, type StepKey } from "./lib/steps";
import type {
  ClearanceCheck,
  ClearanceItem,
  Designation,
  ExitActivity,
  ExitAsset,
  ExitAssetType,
  ExitCase,
  ExitDocument,
  ExitDocumentType,
  ExitEntityType,
  ExitHandover,
  ExitInterview,
  ExitMasterManager,
  ExitMasterRequest,
  ExitMasterType,
  ExitNotification,
  ExitPayrollHead,
  ExitPayrollLine,
  ExitPolicy,
  ExitReason,
  ExitSettlement,
  HeadDecision,
  ManagerRecommendation,
  StepOwner,
  StepSkip,
} from "./types";

/** Prefix key for invalidation; the full key adds the real session user id. */
const QK = EXIT_QK;

/** Module-level so the memo below sees a stable reference before the fetch lands. */
const DEFAULT_POLICY: ExitPolicy = { payrollCutoffDay: 25, defaultNoticeDays: 30, allowSelfService: true };

interface ExitStoreValue {
  isLoading: boolean;
  error: unknown;

  // directory
  profiles: Profile[];
  departments: Department[];
  designations: Designation[];
  profileById: (id: string) => Profile | undefined;

  // masters
  reasons: ExitReason[];
  assetTypes: ExitAssetType[];
  documentTypes: ExitDocumentType[];
  payrollHeads: ExitPayrollHead[];
  clearanceItems: ClearanceItem[];
  /** Only the active items, in order — this is what a new case's checklist is seeded from. */
  activeClearanceItems: ClearanceItem[];

  // config
  stepOwners: StepOwner[];
  stepOwnerFor: (stepKey: StepKey) => StepOwner | undefined;
  processCoordinatorIds: string[];
  stepSla: StepSlaMap;
  policy: ExitPolicy;

  // capabilities (derived from the EFFECTIVE identity, so demo personas re-scope)
  isAdmin: boolean;
  canConfigure: boolean;
  isProcessCoordinator: boolean;
  /**
   * Owner of a step per the global step-owner table.
   *
   * NOTE this is not the whole story for the MANAGER steps (manager_review,
   * asset_return, handover): those are ALSO owned per-case by the exiting employee's
   * own reporting manager. Access there is ADDITIVE — a row set here co-owns the step
   * (asset_return needs an HOD sign AND an HR sign). Screens that act on a specific
   * case must use `canActOn`; this flag answers the coarser "should the nav show this
   * queue at all". Server-side, fms_exit_can_act() is the real gate.
   */
  isStepOwner: (stepKey: StepKey) => boolean;
  /**
   * Works in the exit process at all — the flag that gates the PII screens.
   *
   * Mirrors fms_exit_is_exit_staff(): owning ANY step. There is deliberately no
   * `resignation` step to own (the DB CHECKs it away), because every employee may
   * raise their own exit — if that counted, this would be true for the whole company
   * and hand out everyone's salary and exit-interview transcript.
   */
  isExitStaff: boolean;
  /**
   * Owns at least one clearance row — the IT / Admin / Travel-Desk people, who own no
   * workflow step at all and would otherwise have NO WAY INTO THE APP.
   *
   * True if they own a live MASTER item (so the Clearance queue appears on day one,
   * before anyone has resigned) OR a materialised row on some case (including the
   * per-case reporting-manager rows, which no master can tell you about).
   */
  ownsClearanceItem: boolean;
  /**
   * ⭐ MAY THIS USER READ THE EXIT-INTERVIEW CONTENT?
   *
   * MIRRORS THE SQL GATE EXACTLY: admin ∨ coordinator ∨ `fms_exit_is_hr_confidential`
   * (the owner of `hr_verification` | `hr_head_approval` | `exit_interview`).
   *
   * ⚠ `isExitStaff` IS NOT THIS, AND SUBSTITUTING IT WOULD BE THE WHOLE BUG. The IT
   * person who owns the `clearance` step and the Admin who owns `asset_return` are exit
   * staff; they read the case header quite happily; and they must read NOT ONE WORD of
   * the interview. Neither may the reporting manager — an exit interview exists to say
   * things ABOUT the manager.
   *
   * When this is false, `ExitDetail` renders a bare "Recorded ✓ / Not yet" chip driven
   * by `case.interviewDoneAt` (the fact, on the wide-read header) and NO content. It
   * must never be driven off the satellite: a non-reader gets zero rows from
   * `fms_exit_interviews`, and "I cannot see it" is not "it did not happen".
   */
  canReadConfidential: boolean;
  /**
   * Works on THE MONEY — mirrors `fms_exit_is_finance_staff()`: the owner of
   * `leave_verification` | `payroll_inputs` | `fnf_generate` | `fnf_approve` |
   * `fnf_payment`. Gates the Settlement queue.
   *
   * ⚠ NOT `isExitStaff`. The IT person owns `clearance` and the Admin owns
   *   `asset_return`; both are exit staff, and neither may see a rupee of a settlement.
   */
  isFinanceStaff: boolean;
  /**
   * ⭐⭐ MAY THIS USER READ THIS CASE'S SETTLEMENT?
   *
   * MIRRORS THE SQL GATE ON `fms_exit_settlements` EXACTLY:
   *   admin ∨ coordinator ∨ `fms_exit_is_finance_staff`
   *   ∨ THE LEAVER THEMSELVES, **but only once `fnfApprovedAt` is set**.
   *
   * Per-CASE, not per-user, because of that last clause — which is why this is a
   * function and `canReadConfidential` is a flag.
   *
   * ⚠ THE REPORTING MANAGER IS ON NO CLAUSE OF IT, AT ANY STAGE. A manager has no
   *   business reading a subordinate's notice recovery or loan balance.
   *
   * When this is false, `ExitDetail` renders a bare status chip driven by the HEADER
   * timestamps (`fnfGeneratedAt` / `fnfApprovedAt` / `fnfPaidAt`) and NO content. It must
   * never be driven off the satellite: a non-reader gets zero rows from
   * `fms_exit_settlements`, and "I cannot see it" is not "it was not recorded".
   */
  canReadSettlement: (c: ExitCase) => boolean;
  /* ---- master governance (M8) ---- */

  masterManagers: ExitMasterManager[];
  masterRequests: ExitMasterRequest[];
  pendingRequests: ExitMasterRequest[];
  managerIdsFor: (masterType: ExitMasterType) => string[];
  /** May the user CRUD this master — admin, or its assigned owner. Mirrors the RLS policy. */
  canManage: (masterType: ExitMasterType) => boolean;
  /**
   * Owns at least one master → sees the Masters page and the review tabs.
   *
   * ⚠ NOT "is an admin". A Reasons owner opens Masters, edits Reasons, and reads the
   *   other four tabs — every `MasterCrud` on that page takes its own `canManage(type)`,
   *   so the rest render read-only, and RLS agrees. This is the gate on the route.
   */
  isAnyMasterManager: boolean;
  /** Alias kept for the nav/route wiring written in earlier phases. */
  canManageMasters: boolean;
  /** Pending requests this user may resolve (admin → all; owner → their types). */
  resolvableRequests: ExitMasterRequest[];
  /** Requests I raised, newest first — the requester's worklist. */
  myMasterRequests: ExitMasterRequest[];
  /** Who reviews a new request of this type: its owners, else the admins. Nothing black-holes. */
  masterReviewersFor: (masterType: ExitMasterType) => string[];
  /** True when nobody owns this master — its requests fall back to the admins. */
  isMasterUnassigned: (masterType: ExitMasterType) => boolean;

  setMasterManagers: (masterType: ExitMasterType, userIds: string[]) => Promise<void>;
  /**
   * Raise a "please add this" request.
   *
   * ⚠ TRAP 10. The insert's RLS is `requested_by = auth.uid()`, and `auth.uid()` is the
   *   REAL signed-in user even while a demo persona is active. This carries `realUserId`.
   */
  requestNewMaster: (masterType: ExitMasterType, payload: Record<string, unknown>) => Promise<string>;
  resolveMasterRequest: (
    requestId: string,
    approve: boolean,
    payload: Record<string, unknown> | null,
    note: string | null,
  ) => Promise<string | null>;

  // cases
  cases: ExitCase[];
  caseById: (id: string) => ExitCase | undefined;
  skips: StepSkip[];
  /** Every step this case has waived, with the reason. */
  skipsFor: (caseId: string) => StepSkip[];
  /** Every materialised clearance row RLS lets this user see. */
  clearanceChecks: ClearanceCheck[];
  /** One case's checklist, in master order. */
  checksFor: (caseId: string) => ClearanceCheck[];
  /** Still owed? Done OR not-applicable ⇒ settled. */
  isCheckOutstanding: (k: ClearanceCheck) => boolean;
  /** THIS row's due date — `lwd` + its SIGNED offset. Negative = before the LWD. */
  checkDueIso: (c: ExitCase, k: ClearanceCheck) => string | null;
  /** WHO owes this row: the case's managers, its own owners, or the `clearance` step's. */
  checkOwnerIds: (c: ExitCase, k: ClearanceCheck) => string[];
  /**
   * May the user tick THIS row? MIRRORS fms_exit_can_tick_clearance() EXACTLY.
   * Per-ROW, not per-case: the IT person has no business ticking Payroll's box.
   */
  canTickCheck: (k: ClearanceCheck) => boolean;

  // assets + handover
  /** Every asset row RLS lets this user see. */
  assets: ExitAsset[];
  /** One case's asset list, in master order. */
  assetsFor: (caseId: string) => ExitAsset[];
  /** Still out there? `pending` is the ONLY status that blocks HR's signature. */
  isAssetPending: (a: ExitAsset) => boolean;
  /** One case's handover, or undefined until somebody records it. */
  handoverFor: (caseId: string) => ExitHandover | undefined;
  /**
   * ⚠ One case's exit interview — **`undefined` MEANS "YOU CANNOT SEE IT" JUST AS OFTEN
   * AS IT MEANS "IT HAS NOT HAPPENED"**, because a non-reader gets zero rows back from
   * RLS. Only ever call this behind `canReadConfidential`; to ask whether the interview
   * HAPPENED, read `case.interviewDoneAt` on the header instead.
   */
  interviewFor: (caseId: string) => ExitInterview | undefined;
  /**
   * ⚠ One case's settlement — **`undefined` MEANS "YOU CANNOT SEE IT" JUST AS OFTEN AS IT
   * MEANS "IT HAS NOT BEEN RECORDED"**, because a non-reader gets zero rows back from RLS.
   * Only ever call this behind `canReadSettlement(c)`; to ask whether the F&F was
   * generated / approved / paid, read the HEADER timestamps instead.
   */
  settlementFor: (caseId: string) => ExitSettlement | undefined;
  /** One case's free-form F&F lines, in order. Same gate, same warning as above. */
  payrollLinesFor: (caseId: string) => ExitPayrollLine[];

  /**
   * ⭐ One case's closure documents, in master order.
   *
   * ⚠ NOT a confidential satellite, and the difference matters: its RLS is the WIDE gate
   * (`fms_exit_can_read_case`), so an empty list here really does mean "no documents have
   * been prepared" — unlike `interviewFor` / `settlementFor`, where empty means "you may
   * not see it". THE EMPLOYEE READS THESE: they are their letters.
   */
  documentsFor: (caseId: string) => ExitDocument[];
  /** MY exit — the one I am the subject of. There can be at most one open case per person. */
  myCase: ExitCase | undefined;
  /** Cases I raised or am the subject of, plus the ones I manage. */
  myCases: ExitCase[];
  /** Whole days until the last working day (negative once it has passed). */
  daysToLwd: (c: ExitCase) => number | null;
  /** True while a case is still moving (not withdrawn / rejected / archived / on hold). */
  isOpenCase: (c: ExitCase) => boolean;

  /**
   * May the user act on THIS case at THIS step? MIRRORS fms_exit_can_act() EXACTLY.
   * The RPC re-checks and is the real gate; this only decides what the UI offers.
   */
  canActOn: (stepKey: StepKey, c: ExitCase) => boolean;

  // queues — the SAME entries the Control Center counts, so they cannot disagree
  queueEntries: QueueEntry[];
  /** Open work at one step, narrowed to what this user may action. */
  myQueue: (stepKey: StepKey) => QueueEntry[];
  dueIsoFor: (c: ExitCase, stepKey: StepKey) => string | null;
  /**
   * WHO OWES ONE QUEUE ENTRY — the "who do I call" of the Control Center and the
   * dashboard's overdue-by-owner roll-up.
   *
   * Ownership is NOT a property of the entry, which is why this cannot live in the pure
   * `lib/queues.ts`: three different rules feed it.
   *   1. a CLEARANCE row carries its own `ownerIds` (the IT / Admin / Travel-Desk people,
   *      who own no workflow step at all) — and it WINS wherever it exists;
   *   2. a MANAGER step is owed by the case's own reporting managers **and** by the step's
   *      configured owners, ADDITIVELY (asset_return needs an HOD sign AND an HR sign,
   *      and a manager who never answers must not be able to wedge the case);
   *   3. everything else, by the step-owner table alone.
   *
   * An EMPTY array is a real answer and must not be papered over: it means the step has no
   * owner configured, i.e. work nobody has been told about. The screens render that as
   * "Unassigned", in yellow.
   */
  queueOwnerIds: (e: QueueEntry) => string[];

  // activity + bell
  activity: ExitActivity[];
  activityFor: (entityType: ExitEntityType, entityId: string) => ExitActivity[];
  notifications: ExitNotification[];
  unreadCount: number;
  markNotificationsRead: (ids: string[]) => Promise<void>;

  // workflow writes
  raiseCase: (input: CaseInput, letter?: File | null) => Promise<string>;
  updateCase: (caseId: string, input: Partial<CaseInput>) => Promise<void>;
  managerReview: (c: ExitCase, recommendation: ManagerRecommendation, remarks: string) => Promise<void>;
  hrVerify: (c: ExitCase, input: HrVerifyInput) => Promise<void>;
  decideCase: (c: ExitCase, decision: HeadDecision, remarks: string) => Promise<void>;
  /** Finalise the LWD. The RPC seeds the checklist from the active master, idempotently. */
  confirmLwd: (c: ExitCase, lwd: string) => Promise<void>;
  toggleClearanceCheck: (checkId: string, done: boolean, input?: CheckInput) => Promise<void>;
  setClearanceNa: (checkId: string, reason: string) => Promise<void>;
  /** Record what happened to one asset. A `lost` one needs an amount or a remark. */
  updateAsset: (assetId: string, input: AssetInput) => Promise<void>;
  /**
   * Sign the asset return. The HOD signs first; **HR's signature completes the step**
   * and auto-ticks the Admin + IT clearance rows.
   */
  signAssets: (c: ExitCase, role: "hod" | "hr", remarks: string) => Promise<void>;
  /** Who is taking the work over, and did the KT happen. A receiver is mandatory. */
  recordHandover: (c: ExitCase, input: HandoverInput) => Promise<void>;
  /**
   * Confirm the handover. The manager confirms first; **HR's confirmation completes
   * the step** and auto-ticks the Reporting-Manager clearance row.
   */
  confirmHandover: (c: ExitCase, role: "manager" | "hr", remarks: string) => Promise<void>;
  /**
   * ⭐ Record — or correct — the exit interview. Upserts; the RPC stamps
   * `interview_done_at` on the header (coalesced, so a correction never re-dates a step
   * that completed on time) and announces WITHOUT quoting a word of the content.
   */
  recordInterview: (c: ExitCase, input: InterviewInput) => Promise<void>;

  /* ---- ⭐ the settlement. RECORD, DON'T COMPUTE. ---- */

  /** Verify the leave balance — the F&F's first input. Refused without an LWD. */
  verifyLeave: (c: ExitCase, input: LeaveInput) => Promise<void>;
  /** Record what payroll says. **The lines are REPLACED wholesale** — send them all. */
  recordPayrollInputs: (c: ExitCase, input: PayrollInput) => Promise<void>;
  /**
   * ⭐ Generate the F&F. **The RPC REFUSES unless leave + payroll are done-or-waived.**
   * `fnfAmount` may be null — there is no settlement calculator, and there must not be.
   */
  generateFnf: (c: ExitCase, input: FnfInput) => Promise<void>;
  /**
   * ⭐ Approve, or send it back. Refused before generation. A REJECTION clears
   * `fnfGeneratedAt`, so the case reappears in the preparer's queue rather than sitting
   * in nobody's. Approval is the moment the leaver can read their own settlement.
   */
  approveFnf: (c: ExitCase, approve: boolean, remarks: string) => Promise<void>;
  /** ⭐ Release the payment. Refused before approval. Attaches the leaver's `share/` copy. */
  releaseFnfPayment: (c: ExitCase, input: PaymentInput) => Promise<void>;

  /* ---- ⭐ CLOSURE. The terminal step, and its whole job is to refuse. ---- */

  /**
   * ⭐ Issue the exit documents — the letters go OUT. Several at once (HR issues the
   * experience and relieving letters together). The RPC refuses a `requiresFile` document
   * with no file — **and a file supplied in the same call counts** — refuses any path
   * outside `share/`, and stamps `documentsIssuedAt` once every document carries a date.
   */
  issueDocuments: (c: ExitCase, docs: DocumentIssueInput[]) => Promise<void>;
  /**
   * ⭐⭐ Record the SIGNED ACKNOWLEDGEMENT — the thing coming **BACK**. A separate call
   * from the issue, deliberately: issuing and acknowledging are separated by days and a
   * human being with a pen, and folding them together is how "we posted it" quietly
   * becomes "they signed it". This is the evidence `archiveCase` refuses without.
   */
  recordAck: (c: ExitCase, documentId: string, input: AckInput) => Promise<void>;
  /**
   * ⭐⭐⭐ ARCHIVE. The terminal act — **and it refuses**, naming what is missing:
   * clearance · the F&F paid · the documents issued · **the signed acknowledgement for
   * every document actually issued** · **the leaver's own copy of the final F&F**. Every
   * step guard is timestamp-OR-SKIPPED, so an absconder archives cleanly on waived steps.
   *
   * The live checklist the panel shows comes from `fms_exit_archive_blockers()` — the same
   * function this RPC refuses on, so the screen and the database cannot disagree.
   */
  archiveCase: (c: ExitCase, remarks?: string | null) => Promise<void>;

  withdrawCase: (c: ExitCase, reason: string) => Promise<void>;
  holdCase: (c: ExitCase, hold: boolean, reason: string) => Promise<void>;
  skipStep: (c: ExitCase, stepKey: StepKey, reason: string) => Promise<void>;

  // config writes
  setStepOwner: (stepKey: StepKey, input: StepOwnerInput) => Promise<void>;
  setStepSla: (map: StepSlaMap) => Promise<void>;
  setCoordinators: (userIds: string[]) => Promise<void>;
  setPolicy: (policy: ExitPolicy) => Promise<void>;

  // master writes
  insertMaster: (table: ExitMasterTable, input: MasterInput) => Promise<void>;
  updateMaster: (table: ExitMasterTable, id: string, input: MasterInput) => Promise<void>;
  insertDocumentType: (input: DocumentTypeInput) => Promise<void>;
  updateDocumentType: (id: string, input: DocumentTypeInput) => Promise<void>;
  insertPayrollHead: (input: PayrollHeadInput) => Promise<void>;
  updatePayrollHead: (id: string, input: PayrollHeadInput) => Promise<void>;
  insertClearanceItem: (input: ClearanceItemInput) => Promise<void>;
  updateClearanceItem: (id: string, input: ClearanceItemInput) => Promise<void>;
}

const Ctx = createContext<ExitStoreValue | null>(null);

export function ExitStoreProvider({ children }: { children: ReactNode }) {
  const session = useSession();
  // Effective identity: the real signed-in user, or the impersonated persona in demo
  // mode. Every capability flag below derives from this, so switching persona
  // re-scopes the whole app. The fetch stays keyed on the REAL session id (admin RLS
  // returns all rows) so switching persona never triggers a refetch.
  const { user, isAdmin } = useEffectiveIdentity();
  const dir = useDirectory();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: exitQueryKey(session.user?.id ?? null),
    queryFn: fetchExitData,
    enabled: !!session.user,
  });

  const stepOwners = data?.stepOwners ?? [];
  const designations = data?.designations ?? [];
  const reasons = data?.reasons ?? [];
  const assetTypes = data?.assetTypes ?? [];
  const documentTypes = data?.documentTypes ?? [];
  const payrollHeads = data?.payrollHeads ?? [];
  const clearanceItems = data?.clearanceItems ?? [];
  const masterManagers = data?.masterManagers ?? [];
  const masterRequests = data?.masterRequests ?? [];
  const cases = data?.cases ?? [];
  const skips = data?.skips ?? [];
  const clearanceChecks = data?.clearanceChecks ?? [];
  const assets = data?.assets ?? [];
  const handovers = data?.handovers ?? [];
  // EMPTY for anyone RLS does not let read it — which is NOT the same as "no interview
  // was held". The fact lives on the case header (`interviewDoneAt`); this is content.
  const interviews = data?.interviews ?? [];
  // EMPTY for anyone RLS does not let read it — the reporting manager at EVERY stage, the
  // Admin/IT clearance owners, and the employee until their F&F is approved. Which is NOT
  // the same as "no settlement was recorded": the facts live on the case header.
  const settlements = data?.settlements ?? [];
  const payrollLines = data?.payrollLines ?? [];
  // ⭐ The closure documents. NOT a satellite: the WIDE gate (fms_exit_can_read_case), so
  // an empty list genuinely means "nothing prepared yet". The EMPLOYEE reads these.
  const documents = data?.documents ?? [];
  const activity = data?.activity ?? [];
  const notifications = data?.notifications ?? [];
  const processCoordinatorIds = data?.config.processCoordinatorIds ?? [];
  const stepSla = data?.config.stepSla ?? DEFAULT_STEP_SLA;
  const policy: ExitPolicy = data?.config.policy ?? DEFAULT_POLICY;

  /**
   * The REAL signed-in user, never the impersonated persona. RLS and RPC actor
   * stamping run off the JWT, so any write whose policy checks `= auth.uid()` must
   * carry this id (the storage upload of a resignation letter; the master-request
   * insert in Phase 9).
   */
  const realUserId = session.user?.id ?? null;

  const value = useMemo<ExitStoreValue>(() => {
    const invalidate = () => queryClient.invalidateQueries({ queryKey: QK });

    const stepOwnerFor = (stepKey: StepKey) => stepOwners.find((o) => o.stepKey === stepKey);
    const ownerIdsOf = (stepKey: StepKey): string[] => stepOwnerFor(stepKey)?.employeeIds ?? [];

    const isStepOwner = (stepKey: StepKey): boolean => {
      if (isAdmin) return true;
      return stepOwners.some((o) => o.stepKey === stepKey && o.employeeIds.includes(user.id));
    };

    // Mirrors fms_exit_is_exit_staff(). `resignation` cannot appear in this table.
    const isExitStaff = isAdmin || stepOwners.some((o) => o.employeeIds.includes(user.id));
    const isProcessCoordinator = isAdmin || processCoordinatorIds.includes(user.id);

    /**
     * ⭐ MIRRORS THE SQL GATE ON fms_exit_interviews EXACTLY:
     *   admin ∨ fms_exit_is_coordinator ∨ fms_exit_is_hr_confidential
     * and `fms_exit_is_hr_confidential` is, verbatim, the owner of one of these three.
     *
     * ⚠ NOT `isExitStaff`. That is the trap this whole phase exists to avoid: the IT
     * person owns `clearance`, the Admin owns `asset_return`, both are exit staff, both
     * read the header — and neither may read a word of the interview. Nor may the
     * reporting manager, who is very often the reason for the exit.
     */
    const canReadConfidential =
      isAdmin ||
      isProcessCoordinator ||
      isStepOwner("hr_verification") ||
      isStepOwner("hr_head_approval") ||
      isStepOwner("exit_interview");

    /**
     * ⭐⭐ MIRRORS `fms_exit_is_finance_staff()` EXACTLY — the owner of one of the five
     * money steps (lib/steps.ts: SETTLEMENT_STEPS).
     *
     * ⚠ NOT `isExitStaff`, and that substitution would be the whole bug: the IT person
     *   owns `clearance`, the Admin owns `asset_return`, both are exit staff, both read
     *   the case header, and neither may see a rupee of a settlement.
     */
    const isFinanceStaff =
      isAdmin ||
      stepOwners.some((o) => SETTLEMENT_STEPS.includes(o.stepKey as StepKey) && o.employeeIds.includes(user.id));

    /* ------------------------ master governance (M8) ----------------------- */
    /**
     * These four mirror the RLS on the five master tables EXACTLY:
     *   `is_admin(auth.uid()) or fms_exit_is_master_manager('<type>', auth.uid())`
     * Offering an Edit button the database will reject is worse than not offering it.
     */

    const managerIdsFor = (mt: ExitMasterType) =>
      masterManagers.filter((m) => m.masterType === mt).map((m) => m.managerUserId);

    const canManage = (mt: ExitMasterType) => isAdmin || managerIdsFor(mt).includes(user.id);

    const isAnyMasterManager = isAdmin || masterManagers.some((m) => m.managerUserId === user.id);

    const resolvableRequests = masterRequests
      .filter((r) => r.status === "pending")
      .filter((r) => canManage(r.masterType));

    // A master with no assigned owner still has to go somewhere: admins can always
    // resolve, so they are the implicit reviewers. Nothing black-holes.
    const adminIds = () => dir.profiles.filter((p) => p.role === "admin").map((p) => p.id);
    const masterReviewersFor = (mt: ExitMasterType): string[] => {
      const ids = managerIdsFor(mt);
      return ids.length ? ids : adminIds();
    };
    const isMasterUnassigned = (mt: ExitMasterType) => managerIdsFor(mt).length === 0;

    const activityByEntity = new Map<string, ExitActivity[]>();
    for (const a of activity) {
      const k = `${a.entityType}:${a.entityId}`;
      const list = activityByEntity.get(k) ?? [];
      list.push(a);
      activityByEntity.set(k, list);
    }

    const mine = notifications.filter((n) => n.userId === user.id);

    /** Fan out a transition notification; NEVER let it break the workflow action. */
    const safeAnnounce = async (input: Parameters<typeof announceWrite>[0]) => {
      try {
        await announceWrite(input);
      } catch {
        // Best-effort by design. State lives on the case row, stamped in the RPC.
      }
    };

    /* --------------------------------- cases -------------------------------- */

    const caseMap = new Map(cases.map((c) => [c.id, c]));
    const caseById = (id: string) => caseMap.get(id);

    const skipsByCase = new Map<string, StepSkip[]>();
    for (const s of skips) {
      const list = skipsByCase.get(s.caseId) ?? [];
      list.push(s);
      skipsByCase.set(s.caseId, list);
    }

    /**
     * MIRRORS fms_exit_can_act() EXACTLY — change one, change the other.
     *
     * ⚠ THE MANAGER BRANCH IS ADDITIVE, NOT EXCLUSIVE. fms_hr_can_act() early-returns
     * for its HOD steps, which is precisely what made them unreachable whenever the
     * manager list was empty. Here a manager is a CO-OWNER and we fall THROUGH to the
     * configured step owner: `asset_return` needs an HOD sign AND an HR sign,
     * `handover` needs both confirmations — and a manager who never responds must not
     * be able to wedge the case.
     */
    const canActOn = (stepKey: StepKey, c: ExitCase): boolean => {
      if (isAdmin || isProcessCoordinator) return true;
      if (isManagerStep(stepKey) && c.reportingManagerIds.includes(user.id)) return true;
      return isStepOwner(stepKey); // no early return above — access is additive
    };

    const isMine = (c: ExitCase) => c.employeeUserId === user.id || c.raisedBy === user.id;

    // Built through the SAME function the Phase-8 scoreboard adapter uses. Two
    // hand-written snapshot literals is how HR's clocks drifted apart.
    const snapshot: ExitSnapshot = exitSnapshotFrom({
      cases,
      skips,
      clearanceChecks,
      stepOwners,
      config: { stepSla, policy },
    });
    const queueEntries = buildQueueEntries(snapshot);

    /* -------------------------------- clearance ------------------------------ */

    const checksByCase = new Map<string, ClearanceCheck[]>();
    for (const k of clearanceChecks) {
      const list = checksByCase.get(k.caseId) ?? [];
      list.push(k);
      checksByCase.set(k.caseId, list);
    }
    for (const list of checksByCase.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

    /**
     * MIRRORS fms_exit_can_tick_clearance() EXACTLY — change one, change the other.
     *
     * PER ROW, not per case. The eight rows of one checklist belong to eight different
     * people, and the IT person has no business ticking Payroll's box. The `clearance`
     * step's configured owner chases the whole list (they are the one being asked why
     * it is not done); a row's own owner works only their own row.
     */
    const canTickCheck = (k: ClearanceCheck): boolean => {
      if (isAdmin || isProcessCoordinator) return true;
      if (isStepOwner("clearance")) return true;
      if (k.ownerIds.includes(user.id)) return true;
      const c = caseMap.get(k.caseId);
      return !!(k.ownerIsReportingManager && c?.reportingManagerIds.includes(user.id));
    };

    /* ---------------------------- assets + handover -------------------------- */

    const assetsByCase = new Map<string, ExitAsset[]>();
    for (const a of assets) {
      const list = assetsByCase.get(a.caseId) ?? [];
      list.push(a);
      assetsByCase.set(a.caseId, list);
    }
    for (const list of assetsByCase.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    }

    // 1:1 with the case — the case id IS the handover's primary key.
    const handoverByCase = new Map(handovers.map((h) => [h.caseId, h]));
    // Same shape, but this one is EMPTY for a non-reader. See `interviewFor`.
    const interviewByCase = new Map(interviews.map((i) => [i.caseId, i]));
    // …and so is this one. See `settlementFor`.
    const settlementByCase = new Map(settlements.map((s) => [s.caseId, s]));

    const linesByCase = new Map<string, ExitPayrollLine[]>();
    for (const l of payrollLines) {
      const list = linesByCase.get(l.caseId) ?? [];
      list.push(l);
      linesByCase.set(l.caseId, list);
    }
    for (const list of linesByCase.values()) list.sort((a, b) => a.sortOrder - b.sortOrder);

    // ⭐ The closure documents, in master order — the order HR reads them in.
    const docsByCase = new Map<string, ExitDocument[]>();
    for (const d of documents) {
      const list = docsByCase.get(d.caseId) ?? [];
      list.push(d);
      docsByCase.set(d.caseId, list);
    }
    for (const list of docsByCase.values()) {
      list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    }

    /**
     * ⭐⭐ MIRRORS THE SQL GATE ON `fms_exit_settlements` EXACTLY:
     *   admin ∨ coordinator ∨ finance staff ∨ (the leaver AND fnf_approved_at is not null)
     *
     * The last clause is the one that makes this per-CASE: the employee is entitled to
     * their statement, not to watch the numbers being keyed. An approved F&F is a position
     * the company has taken; an in-progress one is a working.
     *
     * ⚠ NOTE WHAT IS ABSENT: `c.raisedBy`, and any clause on `reportingManagerIds`.
     */
    const canReadSettlement = (c: ExitCase): boolean =>
      isAdmin ||
      isProcessCoordinator ||
      isFinanceStaff ||
      (c.employeeUserId === user.id && !!c.fnfApprovedAt);

    // Owns a live MASTER item (so the queue exists before anyone has resigned) or a
    // materialised row (which is the only place a per-case manager row can be seen).
    const ownsClearanceItem =
      clearanceItems.some((i) => i.active && i.ownerIds.includes(user.id)) ||
      clearanceChecks.some((k) => {
        if (k.ownerIds.includes(user.id)) return true;
        const c = caseMap.get(k.caseId);
        return !!(k.ownerIsReportingManager && c?.reportingManagerIds.includes(user.id));
      });

    /**
     * Open work at one step, narrowed to what this user may action.
     *
     * ⚠ `e.ownerIds` WINS WHERE IT EXISTS. A clearance row is owned PER ROW, by a
     * person who owns no workflow step at all (IT, Admin, the Travel Desk) — a
     * per-entity predicate like HR's simply cannot express that. Everything else falls
     * back to `canActOn(step, case)`.
     *
     * The STEP's configured owner passes too, and must: they are the person being
     * asked why the clearance is not done, so they chase the whole list. Exactly what
     * `fms_exit_can_tick_clearance()` says — an IT owner still sees only their own row,
     * because an IT owner is not the step's owner.
     */
    const myQueue = (stepKey: StepKey): QueueEntry[] =>
      queueEntries.filter((e) => {
        if (e.stepKey !== stepKey) return false;
        if (e.ownerIds) {
          return (
            isAdmin || isProcessCoordinator || isStepOwner(stepKey) || e.ownerIds.includes(user.id)
          );
        }
        const c = caseMap.get(e.caseId);
        return c ? canActOn(stepKey, c) : false;
      });

    /* ---------------------------------------------------------------------- */

    return {
      isLoading,
      error,

      profiles: dir.profiles,
      departments: dir.departments,
      designations,
      profileById: dir.profileById,

      reasons,
      assetTypes,
      documentTypes,
      payrollHeads,
      clearanceItems,
      activeClearanceItems: clearanceItems
        .filter((i) => i.active)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),

      stepOwners,
      stepOwnerFor,
      processCoordinatorIds,
      stepSla,
      policy,

      isAdmin,
      canConfigure: isAdmin,
      isProcessCoordinator,
      isStepOwner,
      isExitStaff,
      ownsClearanceItem,
      canReadConfidential,
      isFinanceStaff,
      canReadSettlement,

      masterManagers,
      masterRequests,
      pendingRequests: masterRequests.filter((r) => r.status === "pending"),
      managerIdsFor,
      canManage,
      isAnyMasterManager,
      // The Masters page and its nav item were wired to this name in Phase 1, when it
      // was admin-only because RLS was. It is now exactly `isAnyMasterManager` — which
      // is the whole point of the phase: a Reasons owner opens Masters without being an
      // admin, and the four tabs they do not own render read-only.
      canManageMasters: isAnyMasterManager,
      resolvableRequests,
      // Keyed on the EFFECTIVE identity, so a persona sees the persona's requests.
      // One consequence, and it is correct rather than a bug: a request RAISED while a
      // demo persona is active is stamped with the REAL admin's id (RLS demands it), so
      // it lands in the admin's list, not the persona's.
      myMasterRequests: masterRequests
        .filter((r) => r.requestedBy === user.id)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      masterReviewersFor,
      isMasterUnassigned,

      cases,
      caseById,
      skips,
      skipsFor: (caseId) => skipsByCase.get(caseId) ?? [],
      clearanceChecks,
      checksFor: (caseId) => checksByCase.get(caseId) ?? [],
      isCheckOutstanding,
      checkDueIso,
      checkOwnerIds: (c, k) => checkOwnerIds(snapshot, c, k),
      canTickCheck,

      assets,
      assetsFor: (caseId) => assetsByCase.get(caseId) ?? [],
      isAssetPending: (a) => a.status === "pending",
      handoverFor: (caseId) => handoverByCase.get(caseId),
      // ⚠ `undefined` here means "not visible" every bit as often as "not recorded".
      // To ask whether the interview HAPPENED, read `case.interviewDoneAt`.
      interviewFor: (caseId) => interviewByCase.get(caseId),
      // ⚠ Same warning, and it bites harder: a reporting manager gets zero rows here at
      // EVERY stage. To ask whether the F&F was generated / approved / paid, read the
      // header stamps (`fnfGeneratedAt` / `fnfApprovedAt` / `fnfPaidAt`).
      settlementFor: (caseId) => settlementByCase.get(caseId),
      payrollLinesFor: (caseId) => linesByCase.get(caseId) ?? [],
      // ⚠ Unlike the two above, an EMPTY list here really does mean "nothing prepared".
      // The wide read gate applies — these are the leaver's own letters.
      documentsFor: (caseId) => docsByCase.get(caseId) ?? [],

      // At most one OPEN case per person — the partial unique index guarantees it.
      // Prefer the open one; fall back to the most recent closed one so someone who
      // withdrew last month can still read what happened.
      myCase:
        cases.filter((c) => c.employeeUserId === user.id && isOpenCase(c))[0] ??
        cases
          .filter((c) => c.employeeUserId === user.id)
          .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0],
      myCases: cases.filter((c) => isMine(c) || c.reportingManagerIds.includes(user.id)),
      daysToLwd: (c) => daysToLwd(c),
      isOpenCase,

      canActOn,

      queueEntries,
      myQueue,
      dueIsoFor: (c, stepKey) => exitDueIso(snapshot, c, stepKey),
      // Mirrors the three ownership rules of fms_exit_can_act() / can_tick_clearance().
      // A clearance row's own owners WIN; a manager step is manager + step owner, additively.
      queueOwnerIds: (e) => {
        if (e.ownerIds) return e.ownerIds;
        const owners = ownerIdsOf(e.stepKey);
        const c = caseMap.get(e.caseId);
        if (c && isManagerStep(e.stepKey)) {
          return Array.from(new Set([...c.reportingManagerIds, ...owners]));
        }
        return owners;
      },

      activity,
      activityFor: (entityType, entityId) => activityByEntity.get(`${entityType}:${entityId}`) ?? [],
      notifications: mine,
      unreadCount: mine.filter((n) => !n.readAt).length,
      markNotificationsRead: async (ids) => {
        await markNotificationsReadWrite(ids);
        await invalidate();
      },

      /* ----------------------------- workflow ----------------------------- */

      raiseCase: async (input, letter) => {
        const id = await raiseCaseWrite(input);
        // The letter has to go up AFTER the case exists: the storage policy proves
        // ownership by joining fms_exit_cases on the case id inside the path. A failed
        // upload must not lose the case, so it is swallowed and the case stands
        // without its attachment (the raiser can add it from the detail page).
        if (letter) {
          try {
            const up = await uploadResignationLetter(id, letter);
            await updateCaseWrite(id, { resignationLetterPath: up.path, resignationLetterName: up.name });
          } catch {
            // The case is raised. The attachment is not the workflow.
          }
        }
        // NOT announced here: fms_exit_raise_case already fans out to the reporting
        // managers and the hr_verification owners from inside its SECURITY DEFINER
        // context — which is the only way an ordinary employee (who owns no step) can
        // notify people at all. Announcing again here would double every bell.
        await invalidate();
        return id;
      },
      updateCase: async (caseId, input) => {
        await updateCaseWrite(caseId, input);
        await invalidate();
      },
      managerReview: async (c, recommendation, remarks) => {
        await managerReviewWrite(c.id, recommendation, remarks);
        // It advances REGARDLESS of the recommendation, so HR is always the next stop.
        await safeAnnounce({
          entityType: "case",
          entityId: c.id,
          type: `manager_${recommendation}`,
          text: `${c.exitNo} — the reporting manager ${
            recommendation === "accept"
              ? "accepted the resignation"
              : recommendation === "reject"
                ? "would rather not lose them"
                : "wants to discuss it first"
          }. It is now with HR for verification.`,
          recipients: ownerIdsOf("hr_verification"),
        });
        await invalidate();
      },
      hrVerify: async (c, input) => {
        await hrVerifyWrite(c.id, input);
        await safeAnnounce({
          entityType: "case",
          entityId: c.id,
          type: "hr_verified",
          text: `${c.exitNo} (${c.employeeName}) — HR has verified the notice period. Your approval is needed.`,
          recipients: ownerIdsOf("hr_head_approval"),
        });
        await invalidate();
      },
      decideCase: async (c, decision, remarks) => {
        await decideCaseWrite(c.id, decision, remarks);
        await safeAnnounce({
          entityType: "case",
          entityId: c.id,
          type: decision === "approve" ? "approved" : "rejected",
          text:
            decision === "approve"
              ? `${c.exitNo} (${c.employeeName}) was approved. Confirm the last working day to start clearance.`
              : `${c.exitNo} (${c.employeeName}) was rejected${remarks ? ` — ${remarks}` : "."}`,
          recipients:
            decision === "approve"
              ? ownerIdsOf("lwd_confirm")
              : [c.employeeUserId, c.raisedBy].filter((x): x is string => !!x),
        });
        await invalidate();
      },
      /**
       * Confirm the last working day.
       *
       * The RPC finalises the date AND materialises the checklist from the active
       * master — idempotently, so re-confirming a changed date moves every deadline
       * and touches no item. The announce below is a SECOND fan-out on top of the
       * one the RPC does from its SECURITY DEFINER context (which is the only way to
       * reach a clearance owner who owns no step): this one tells the reporting
       * managers and the employee in the app's own voice. Both are best-effort.
       */
      confirmLwd: async (c, lwd) => {
        await confirmLwdWrite(c.id, lwd);
        await invalidate();
      },
      toggleClearanceCheck: async (checkId, done, input) => {
        await toggleClearanceCheckWrite(checkId, done, input);
        // Completion of the whole step is the DATABASE's call (it stamps
        // clearance_completed_at once every row is done or not-applicable). We just
        // re-read; there is nothing for the client to decide.
        await invalidate();
      },
      setClearanceNa: async (checkId, reason) => {
        await setClearanceNaWrite(checkId, reason);
        await invalidate();
      },
      updateAsset: async (assetId, input) => {
        await updateAssetWrite(assetId, input);
        await invalidate();
      },
      /**
       * ⭐ HR's signature is the one that completes the step — and the RPC then
       * AUTO-TICKS every clearance row whose `satisfiedByStep` is `asset_return`
       * (Admin + IT), bypassing their evidence rule, because the evidence IS this
       * signature. Nothing is decided here: we sign, and re-read.
       */
      signAssets: async (c, role, remarks) => {
        await signAssetsWrite(c.id, role, remarks);
        if (role === "hr") {
          // The RPC already fanned out from its SECURITY DEFINER context (the only way
          // to reach a clearance owner who owns no step). This is the app's own voice,
          // to the people who now have to act on a settled asset list.
          await safeAnnounce({
            entityType: "case",
            entityId: c.id,
            type: "assets_signed",
            text: `${c.exitNo} (${c.employeeName}) — the asset return is signed off. The Admin and IT clearance rows were ticked automatically.`,
            recipients: ownerIdsOf("payroll_inputs"),
          });
        }
        await invalidate();
      },
      recordHandover: async (c, input) => {
        await recordHandoverWrite(c.id, input);
        await invalidate();
      },
      /** ⭐ HR's confirmation completes the step and auto-ticks the manager's row. */
      confirmHandover: async (c, role, remarks) => {
        await confirmHandoverWrite(c.id, role, remarks);
        await invalidate();
      },
      /**
       * ⭐ THE CONFIDENTIAL SATELLITE.
       *
       * There is NO `safeAnnounce` here, and that omission is deliberate. The RPC
       * already announces from its SECURITY DEFINER context with a content-free
       * sentence ("Exit interview recorded for EXIT-…"); a second fan-out written in
       * this file would be the obvious place for someone to helpfully paste the remarks
       * into — and it lands in a bell the reporting manager reads. There is nothing
       * about this step that anyone outside HR may be told beyond the fact of it, and
       * the fact is already on the header.
       */
      recordInterview: async (c, input) => {
        await recordInterviewWrite(c.id, input);
        await invalidate();
      },

      /* ------------------------- ⭐ THE SETTLEMENT ------------------------- */
      /**
       * There is NO `safeAnnounce` anywhere in this block, and the omission is
       * deliberate — the same rule as the exit interview, for a harder reason.
       *
       * Every one of these RPCs already announces from its SECURITY DEFINER context with
       * a sentence carrying NO NUMBERS. A second fan-out written here would be the obvious
       * place for someone to helpfully interpolate the amount into — and it lands in
       * `fms_exit_activity`, which every exit staffer (including the Admin and IT clearance
       * owners) can read, and in a bell the reporting manager reads. One helpful sentence
       * would undo the entire RLS policy on `fms_exit_settlements`, silently.
       *
       * Nothing here decides anything either: the SEQUENCE is enforced in the database
       * (generate refuses without its inputs, approve without generation, pay without
       * approval). We call, and we re-read.
       */
      verifyLeave: async (c, input) => {
        await verifyLeaveWrite(c.id, input);
        await invalidate();
      },
      recordPayrollInputs: async (c, input) => {
        await recordPayrollInputsWrite(c.id, input);
        await invalidate();
      },
      generateFnf: async (c, input) => {
        await generateFnfWrite(c.id, input);
        await invalidate();
      },
      approveFnf: async (c, approve, remarks) => {
        await approveFnfWrite(c.id, approve, remarks);
        await invalidate();
      },
      releaseFnfPayment: async (c, input) => {
        await releaseFnfPaymentWrite(c.id, input);
        await invalidate();
      },

      /* --------------------------- ⭐ CLOSURE --------------------------- */
      /**
       * As with the settlement, there is NO `safeAnnounce` in this block: every one of
       * these RPCs already announces from its SECURITY DEFINER context (which is the only
       * way to reach the employee, who owns no step), and a second fan-out written here is
       * simply a second place for the wording to drift.
       *
       * Nothing here decides anything either. `documentsIssuedAt` is stamped by the
       * DATABASE once every document carries a date — and un-stamped if one is un-issued —
       * and the archive's five refusal conditions are the database's, checked again on the
       * click. We call, and we re-read.
       *
       * ⚠ `invalidate()` uses the QK PREFIX, so it also refetches the archive-blocker
       *   checklist (`archiveBlockersKey` nests under it). Issue a letter, and the "waiting
       *   on…" list on the screen corrects itself without anyone wiring it up.
       */
      issueDocuments: async (c, docs) => {
        await issueDocumentsWrite(c.id, docs);
        await invalidate();
      },
      recordAck: async (c, documentId, input) => {
        await recordAckWrite(c.id, documentId, input);
        await invalidate();
      },
      archiveCase: async (c, remarks) => {
        await archiveCaseWrite(c.id, remarks ?? null);
        await invalidate();
      },

      withdrawCase: async (c, reason) => {
        await withdrawCaseWrite(c.id, reason);
        await safeAnnounce({
          entityType: "case",
          entityId: c.id,
          type: "withdrawn",
          text: `${c.exitNo} — ${c.employeeName} has withdrawn their exit${reason ? `: ${reason}` : "."}`,
          recipients: [...c.reportingManagerIds, ...ownerIdsOf("hr_verification")],
        });
        await invalidate();
      },
      holdCase: async (c, hold, reason) => {
        await holdCaseWrite(c.id, hold, reason);
        await invalidate();
      },
      skipStep: async (c, stepKey, reason) => {
        await skipStepWrite(c.id, stepKey, reason);
        await safeAnnounce({
          entityType: "case",
          entityId: c.id,
          type: "step_skipped",
          text: `${c.exitNo} — “${stepKey.replace(/_/g, " ")}” was waived: ${reason}`,
          recipients: c.reportingManagerIds,
          meta: { stepKey },
        });
        await invalidate();
      },

      /* ------------------------------ config ------------------------------ */

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
      setPolicy: async (next) => {
        // Three singleton rows, not one — each is read independently by SQL (the
        // payroll cut-off by the settlement RPC, self-service by fms_exit_raise_case).
        await setConfigWrite("payroll_cutoff_day", { day: next.payrollCutoffDay });
        await setConfigWrite("default_notice_days", { value: next.defaultNoticeDays });
        await setConfigWrite("allow_self_service", { value: next.allowSelfService });
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
      insertDocumentType: async (input) => {
        await insertDocumentTypeWrite(input);
        await invalidate();
      },
      updateDocumentType: async (id, input) => {
        await updateDocumentTypeWrite(id, input);
        await invalidate();
      },
      insertPayrollHead: async (input) => {
        await insertPayrollHeadWrite(input);
        await invalidate();
      },
      updatePayrollHead: async (id, input) => {
        await updatePayrollHeadWrite(id, input);
        await invalidate();
      },
      insertClearanceItem: async (input) => {
        await insertClearanceItemWrite(input);
        await invalidate();
      },
      updateClearanceItem: async (id, input) => {
        await updateClearanceItemWrite(id, input);
        await invalidate();
      },

      /* --------------------- ⭐ MASTER GOVERNANCE (M8) --------------------- */

      setMasterManagers: async (masterType, userIds) => {
        await setMasterManagersWrite(masterType, userIds);
        await invalidate();
      },
      /**
       * ⚠⚠ TRAP 10 — THE PERSONA TRAP, AND IT IS RIGHT HERE.
       *
       * Every capability above derives from `useEffectiveIdentity()` — the PERSONA in
       * demo mode. This insert must NOT. The RLS policy on fms_exit_master_requests is
       * `requested_by = auth.uid()`, and `auth.uid()` reads the JWT, which is still the
       * REAL signed-in user's the entire time demo mode is on. Stamp the persona and the
       * database rejects the row outright. So: `realUserId`, and it is in the dep array.
       *
       * (HR hit exactly this, and its dep array was missing `realUserId` on top.)
       */
      requestNewMaster: async (masterType, payload) => {
        const id = await requestNewMasterWrite(masterType, payload, realUserId ?? user.id);
        const name = String(payload.name ?? "entry");
        await safeAnnounce({
          entityType: "master_request",
          entityId: id,
          type: "master_requested",
          // The bell renders this text RAW (no actor prefix), so it must stand on its
          // own as a whole sentence.
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
    isLoading, error, dir, designations, reasons, assetTypes, documentTypes, payrollHeads,
    clearanceItems, masterManagers, masterRequests, cases, skips, clearanceChecks, assets,
    handovers, interviews, settlements, payrollLines, documents, stepOwners,
    processCoordinatorIds, stepSla, policy, activity, notifications, isAdmin, user.id,
    // ⚠ `realUserId` is NOT decoration. `requestNewMaster` closes over it (Trap 10), and
    // HR's memo shipped without it — the persona switch would then hand you a stale
    // closure. It is the REAL session id and never the persona's.
    realUserId, queryClient,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useExitStore(): ExitStoreValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useExitStore must be used within ExitStoreProvider");
  return ctx;
}

/** Re-exported so screens can group a case's skips without importing lib/queues. */
export { skippedStepsOf };
