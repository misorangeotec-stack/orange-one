import { supabase } from "@/core/platform/supabase";
import { resolveStepSla, type StepSlaMap } from "../lib/sla";
import type {
  AssetStatus,
  CaseStatus,
  CaseType,
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
  ExitInterviewFeedback,
  ExitMasterManager,
  ExitMasterRequest,
  ExitNotification,
  ExitPayrollHead,
  ExitPayrollLine,
  ExitPolicy,
  ExitReason,
  ExitSettlement,
  ManagerRecommendation,
  StepOwner,
  StepSkip,
} from "../types";

/**
 * HR Exit read layer. One paginated pass over the tables the module needs, mapped
 * snake_case → camelCase. Mirrors `fetchHrData`.
 *
 * The module loads in one snapshot so the pure queue rules in lib/queues.ts (Phase 2)
 * can be handed plain data, and so the Control Center adapter can reuse this exact
 * react-query cache entry rather than issuing a second copy of the reads.
 *
 * Nothing here is bounded by a time window: config, the five masters and the bell
 * feed are all small by construction. The one entity that could grow — the cases and
 * their clearance rows — arrives in Phase 2, and is bounded there.
 */

const PAGE = 1000;

type Tbl =
  | "fms_exit_step_owners"
  | "fms_exit_config"
  | "fms_exit_reasons"
  | "fms_exit_asset_types"
  | "fms_exit_document_types"
  | "fms_exit_payroll_heads"
  | "fms_exit_clearance_items"
  | "fms_exit_master_managers"
  | "fms_exit_master_requests"
  | "fms_exit_clearance_checks"
  | "fms_exit_assets"
  | "fms_exit_handover"
  | "fms_exit_interviews"
  | "fms_exit_settlements"
  | "fms_exit_payroll_lines"
  | "fms_exit_documents"
  | "fms_exit_cases"
  | "fms_exit_step_skips"
  | "fms_exit_activity"
  | "fms_exit_notifications"
  | "designations";

async function fetchAll(table: Tbl, orderBy = "created_at"): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface ExitConfig {
  processCoordinatorIds: string[];
  /** Per-step due-date rules (anchor + days), merged over the code defaults. */
  stepSla: StepSlaMap;
  policy: ExitPolicy;
}

/**
 * The react-query key. Exported so consumers outside this app (the FMS Control
 * Center's exit adapter) share the same cache entry. Keyed on the REAL session user
 * id — never the impersonated persona — so switching persona never refetches.
 */
export const EXIT_QK = ["hrExitData"] as const;
export const exitQueryKey = (userId: string | null) => [...EXIT_QK, userId] as const;

export interface ExitData {
  stepOwners: StepOwner[];
  designations: Designation[];
  config: ExitConfig;
  reasons: ExitReason[];
  assetTypes: ExitAssetType[];
  documentTypes: ExitDocumentType[];
  payrollHeads: ExitPayrollHead[];
  clearanceItems: ClearanceItem[];
  /** Who owns each master (all five types). Read-all under RLS; admin-only to write. */
  masterManagers: ExitMasterManager[];
  /**
   * The "request a new entry" queue. Read is deliberately OPEN: a requester must see
   * their own request's status, and the client's duplicate guard has to see other
   * people's pending ones to say "already requested by X".
   */
  masterRequests: ExitMasterRequest[];
  /** Whatever RLS lets this user see — fms_exit_can_read_case decides, not the app. */
  cases: ExitCase[];
  skips: StepSkip[];
  /**
   * The materialised checklists. RLS narrows them to the cases the user may read —
   * which, thanks to M3's `fms_exit_can_read_case` clause, INCLUDES the cases they
   * own a row on and no others.
   */
  clearanceChecks: ClearanceCheck[];
  /** The per-case asset list, seeded alongside the checklist at LWD confirmation. */
  assets: ExitAsset[];
  /** At most one row per case (the case id is the primary key). */
  handovers: ExitHandover[];
  /**
   * ⚠ THE CONFIDENTIAL SATELLITE. RLS returns rows ONLY to admin / a coordinator /
   * `fms_exit_is_hr_confidential` — everyone else gets an EMPTY ARRAY, with no error.
   *
   * **An empty array means "you may not see it", NOT "no interview was held."** They
   * are different facts and conflating them is how a leak gets papered over into a
   * lie. The fact that an interview happened lives on the WIDE-READ header
   * (`ExitCase.interviewDoneAt`), and that is what every chip, queue and stepper node
   * reads — so a non-reader still sees "Recorded ✓", with no content behind it.
   */
  interviews: ExitInterview[];
  /**
   * ⚠ THE SECOND CONFIDENTIAL SATELLITE — THE MONEY. RLS returns rows ONLY to admin /
   * a coordinator / `fms_exit_is_finance_staff` / **the leaver themselves, and then only
   * once `fnf_approved_at` is set**. Everyone else gets an EMPTY ARRAY, with no error —
   * including the reporting manager (who is on NO clause of that gate, at any stage) and
   * the Admin / IT clearance owners, who are exit staff and read every other panel.
   *
   * **An empty array means "you may not see it", NOT "no settlement was recorded."** The
   * facts live on the WIDE-READ header (`fnfGeneratedAt` / `fnfApprovedAt` / `fnfPaidAt`)
   * and that is what every chip, queue and stepper node reads.
   */
  settlements: ExitSettlement[];
  /** The free-form F&F lines. Same gate, joined through `case_id`. */
  payrollLines: ExitPayrollLine[];
  /**
   * ⭐ The documents issued at closure. Unlike the two satellites above, this follows
   * the WIDE gate (`fms_exit_can_read_case`) — deliberately: THE EMPLOYEE MUST READ IT.
   * These are their letters, and My Resignation is where they open them. Nothing here
   * carries a rupee or a word of the exit interview.
   */
  documents: ExitDocument[];
  activity: ExitActivity[];
  notifications: ExitNotification[];
}

const mapMaster = (r: any) => ({
  id: r.id,
  name: r.name,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapDocumentType = (r: any): ExitDocumentType => ({ ...mapMaster(r), requiresFile: r.requires_file });

const mapPayrollHead = (r: any): ExitPayrollHead => ({
  ...mapMaster(r),
  kind: (r.kind ?? "deduction") as "addition" | "deduction",
});

const mapClearanceItem = (r: any): ClearanceItem => ({
  id: r.id,
  key: r.key,
  name: r.name,
  departmentLabel: r.department_label,
  description: r.description ?? null,
  ownerIds: (r.owner_ids ?? []) as string[],
  ownerIsReportingManager: r.owner_is_reporting_manager,
  requiresFile: r.requires_file,
  allowsLink: r.allows_link,
  // Signed on purpose — negative means "before the last working day".
  dueDays: r.due_days ?? 0,
  satisfiedByStep: r.satisfied_by_step ?? null,
  active: r.active,
  sortOrder: r.sort_order ?? 0,
});

const mapMasterManager = (r: any): ExitMasterManager => ({
  id: r.id,
  masterType: r.master_type,
  managerUserId: r.manager_user_id,
});

const mapMasterRequest = (r: any): ExitMasterRequest => ({
  id: r.id,
  masterType: r.master_type,
  proposedPayload: (r.proposed_payload ?? {}) as Record<string, unknown>,
  status: r.status,
  requestedBy: r.requested_by ?? null,
  reviewedBy: r.reviewed_by ?? null,
  reviewNote: r.review_note ?? null,
  resolvedMasterId: r.resolved_master_id ?? null,
  createdAt: r.created_at,
});

/**
 * One materialised clearance row. Every field is a SNAPSHOT of the master taken at
 * seed time — nothing here is joined live, so a later master edit cannot rewrite
 * what this leaver was asked for.
 */
const mapClearanceCheck = (r: any): ClearanceCheck => ({
  id: r.id,
  caseId: r.case_id,
  itemKey: r.item_key,
  name: r.name,
  departmentLabel: r.department_label,
  description: r.description ?? null,
  ownerIds: (r.owner_ids ?? []) as string[],
  ownerIsReportingManager: !!r.owner_is_reporting_manager,
  requiresFile: !!r.requires_file,
  allowsLink: !!r.allows_link,
  // Signed on purpose — negative means "before the last working day".
  dueDays: r.due_days ?? 0,
  sortOrder: r.sort_order ?? 0,
  satisfiedByStep: r.satisfied_by_step ?? null,
  done: !!r.done,
  doneAt: r.done_at ?? null,
  doneBy: r.done_by ?? null,
  notApplicable: !!r.not_applicable,
  naReason: r.na_reason ?? null,
  filePath: r.file_path ?? null,
  fileName: r.file_name ?? null,
  linkUrl: r.link_url ?? null,
  pendingReason: r.pending_reason ?? null,
});

/**
 * One asset issued to the leaver. Snapshotted (`name` is a copy of the master's), so
 * a master rename cannot rewrite what this leaver was asked to hand back.
 */
const mapAsset = (r: any): ExitAsset => ({
  id: r.id,
  caseId: r.case_id,
  assetTypeId: r.asset_type_id ?? null,
  name: r.name,
  sortOrder: r.sort_order ?? 0,
  status: (r.status ?? "pending") as AssetStatus,
  returnedOn: r.returned_on ?? null,
  condition: r.condition ?? null,
  remarks: r.remarks ?? null,
  // numeric(12,2) arrives as a string from PostgREST.
  recoveryAmount: r.recovery_amount === null || r.recovery_amount === undefined ? null : Number(r.recovery_amount),
  filePath: r.file_path ?? null,
  fileName: r.file_name ?? null,
});

/** The handover — 1:1 with the case, so `caseId` is its identity. */
const mapHandover = (r: any): ExitHandover => ({
  caseId: r.case_id,
  handoverToUserId: r.handover_to_user_id ?? null,
  handoverToName: r.handover_to_name ?? null,
  ktDone: !!r.kt_done,
  ktRemarks: r.kt_remarks ?? null,
  notes: r.notes ?? null,
  filePath: r.file_path ?? null,
  fileName: r.file_name ?? null,
  managerConfirmedAt: r.manager_confirmed_at ?? null,
  managerConfirmedBy: r.manager_confirmed_by ?? null,
  managerRemarks: r.manager_remarks ?? null,
  hrConfirmedAt: r.hr_confirmed_at ?? null,
  hrConfirmedBy: r.hr_confirmed_by ?? null,
  hrRemarks: r.hr_remarks ?? null,
});

/**
 * The exit interview — 1:1 with the case, so `caseId` is its identity.
 *
 * Only ever populated for a reader (admin / coordinator / HR-confidential). For
 * everyone else this mapper is simply never called: RLS handed back zero rows.
 */
const mapInterview = (r: any): ExitInterview => ({
  caseId: r.case_id,
  conductedBy: r.conducted_by ?? null,
  conductedOn: r.conducted_on ?? null,
  primaryReasonId: r.primary_reason_id ?? null,
  // Tri-state on purpose: null = "not answered", which is not the same as "no".
  wouldRehire: r.would_rehire === null || r.would_rehire === undefined ? null : !!r.would_rehire,
  remarks: r.remarks ?? null,
  feedback: (r.feedback ?? {}) as ExitInterviewFeedback,
  portalFeedbackDone: !!r.portal_feedback_done,
  filePath: r.file_path ?? null,
  fileName: r.file_name ?? null,
});

/** `numeric` arrives from PostgREST as a STRING. `null` must survive as `null`. */
const num = (v: any): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * The settlement — 1:1 with the case, so `caseId` is its identity.
 *
 * Only ever populated for a reader (admin / coordinator / finance staff / the leaver
 * after approval). For everyone else this mapper is simply never called: RLS handed
 * back zero rows.
 */
const mapSettlement = (r: any): ExitSettlement => ({
  caseId: r.case_id,
  leaveBalanceDays: num(r.leave_balance_days),
  lwpDays: num(r.lwp_days),
  encashableDays: num(r.encashable_days),
  leaveRemarks: r.leave_remarks ?? null,
  lwpCompleted: !!r.lwp_completed,
  noticeRecoveryDays: num(r.notice_recovery_days),
  noticeRecoveryAmount: num(r.notice_recovery_amount),
  incentiveAmount: num(r.incentive_amount),
  loanRecoveryAmount: num(r.loan_recovery_amount),
  otherDeductions: num(r.other_deductions),
  payrollRemarks: r.payroll_remarks ?? null,
  // ⚠ NULL IS A REAL VALUE HERE, not a missing one. Payroll may simply not have stated a
  // net figure — the portal has no salary data with which to invent one. Never `?? 0`.
  fnfAmount: num(r.fnf_amount),
  fnfFilePath: r.fnf_file_path ?? null,
  fnfFileName: r.fnf_file_name ?? null,
  fnfRemarks: r.fnf_remarks ?? null,
  fnfApprovedById: r.fnf_approved_by_id ?? null,
  fnfApprovalRemarks: r.fnf_approval_remarks ?? null,
  fnfPaidOn: r.fnf_paid_on ?? null,
  fnfPaymentMode: r.fnf_payment_mode ?? null,
  fnfPaymentRef: r.fnf_payment_ref ?? null,
  fnfPaidById: r.fnf_paid_by_id ?? null,
  finalFnfPath: r.final_fnf_path ?? null,
  finalFnfName: r.final_fnf_name ?? null,
});

/**
 * ⭐ One document issued at closure. `name` / `requiresFile` are SNAPSHOTS of the
 * master, taken at seed time — never joined live.
 *
 * Note the TWO evidence pairs: the letter going out (`issuedOn` / `filePath`) and the
 * SIGNED ACKNOWLEDGEMENT COMING BACK (`handedOverOn` / `ackSignedPath`). The archive
 * refuses without the second, which is the failure this phase exists to make visible.
 */
const mapDocument = (r: any): ExitDocument => ({
  id: r.id,
  caseId: r.case_id,
  documentTypeId: r.document_type_id ?? null,
  name: r.name,
  requiresFile: !!r.requires_file,
  sortOrder: r.sort_order ?? 0,
  issuedOn: r.issued_on ?? null,
  filePath: r.file_path ?? null,
  fileName: r.file_name ?? null,
  handedOverOn: r.handed_over_on ?? null,
  ackSignedPath: r.ack_signed_path ?? null,
  ackSignedName: r.ack_signed_name ?? null,
  remarks: r.remarks ?? null,
});

/** One F&F line. `headName` is a SNAPSHOT — never joined live off the master. */
const mapPayrollLine = (r: any): ExitPayrollLine => ({
  id: r.id,
  caseId: r.case_id,
  headId: r.head_id ?? null,
  headName: r.head_name,
  kind: (r.kind ?? "deduction") as "addition" | "deduction",
  amount: Number(r.amount ?? 0),
  remarks: r.remarks ?? null,
  sortOrder: r.sort_order ?? 0,
});

/**
 * The case header. Every step's completion is a COLUMN here — never something
 * reconstructed from the activity trail, which is best-effort and can be missing.
 */
const mapCase = (r: any): ExitCase => ({
  id: r.id,
  exitNo: r.exit_no,
  caseType: r.case_type as CaseType,
  employeeUserId: r.employee_user_id ?? null,
  employeeCode: r.employee_code,
  employeeName: r.employee_name,
  departmentId: r.department_id,
  designation: r.designation ?? null,
  dateOfJoining: r.date_of_joining ?? null,
  reportingManagerIds: (r.reporting_manager_ids ?? []) as string[],
  reportingManagerNote: r.reporting_manager_note ?? null,
  raisedBy: r.raised_by ?? null,
  raisedOnBehalf: !!r.raised_on_behalf,
  reasonId: r.reason_id ?? null,
  reasonNote: r.reason_note ?? null,
  resignationLetterPath: r.resignation_letter_path ?? null,
  resignationLetterName: r.resignation_letter_name ?? null,
  noticePeriodDays: r.notice_period_days ?? null,
  noticeWaived: !!r.notice_waived,
  policyApplicable: r.policy_applicable !== false,
  policyNaReason: r.policy_na_reason ?? null,
  proposedLwd: r.proposed_lwd ?? null,
  lwd: r.lwd ?? null,
  clearanceRemarks: r.clearance_remarks ?? null,
  systemStatusChanged: !!r.system_status_changed,
  status: r.status as CaseStatus,
  currentStep: r.current_step,
  submittedAt: r.submitted_at,
  managerReviewedAt: r.manager_reviewed_at ?? null,
  managerRecommendation: (r.manager_recommendation ?? null) as ManagerRecommendation | null,
  managerRemarks: r.manager_remarks ?? null,
  managerReviewerId: r.manager_reviewer_id ?? null,
  discussedAt: r.discussed_at ?? null,
  hrVerifiedAt: r.hr_verified_at ?? null,
  hrVerifierId: r.hr_verifier_id ?? null,
  hrRemarks: r.hr_remarks ?? null,
  approvedAt: r.approved_at ?? null,
  approverId: r.approver_id ?? null,
  approvalRemarks: r.approval_remarks ?? null,
  clearanceCompletedAt: r.clearance_completed_at ?? null,
  assetsReturnedAt: r.assets_returned_at ?? null,
  handoverCompletedAt: r.handover_completed_at ?? null,
  interviewDoneAt: r.interview_done_at ?? null,
  leaveVerifiedAt: r.leave_verified_at ?? null,
  payrollDoneAt: r.payroll_done_at ?? null,
  fnfGeneratedAt: r.fnf_generated_at ?? null,
  fnfApprovedAt: r.fnf_approved_at ?? null,
  fnfPaidAt: r.fnf_paid_at ?? null,
  documentsIssuedAt: r.documents_issued_at ?? null,
  archivedAt: r.archived_at ?? null,
  // The two signatures. HR's is what stamps assetsReturnedAt above.
  assetsHodSignedAt: r.assets_hod_signed_at ?? null,
  assetsHodSignedBy: r.assets_hod_signed_by ?? null,
  assetsHodRemarks: r.assets_hod_remarks ?? null,
  assetsHrSignedAt: r.assets_hr_signed_at ?? null,
  assetsHrSignedBy: r.assets_hr_signed_by ?? null,
  assetsHrRemarks: r.assets_hr_remarks ?? null,
  rejectedAt: r.rejected_at ?? null,
  rejectReason: r.reject_reason ?? null,
  withdrawnAt: r.withdrawn_at ?? null,
  withdrawReason: r.withdraw_reason ?? null,
  holdAt: r.hold_at ?? null,
  holdReason: r.hold_reason ?? null,
  createdAt: r.created_at,
});

const mapSkip = (r: any): StepSkip => ({
  caseId: r.case_id,
  stepKey: r.step_key,
  reason: r.reason,
  skippedBy: r.skipped_by ?? null,
  skippedAt: r.skipped_at,
});

const mapStepOwner = (r: any): StepOwner => ({
  id: r.id,
  stepKey: r.step_key,
  departmentIds: (r.department_ids ?? []) as string[],
  designationId: r.designation_id ?? null,
  employeeIds: (r.employee_ids ?? []) as string[],
});

const mapDesignation = (r: any): Designation => ({ id: r.id, name: r.name, active: r.active });

const mapActivity = (r: any): ExitActivity => ({
  id: r.id,
  entityType: r.entity_type as ExitEntityType,
  entityId: r.entity_id,
  type: r.type,
  actorId: r.actor_id ?? null,
  note: r.note ?? null,
  meta: (r.meta ?? {}) as Record<string, unknown>,
  createdAt: r.created_at,
});

const mapNotification = (r: any): ExitNotification => ({
  id: r.id,
  userId: r.user_id,
  type: r.type,
  entityType: r.entity_type as ExitEntityType,
  entityId: r.entity_id,
  text: r.text,
  actorId: r.actor_id ?? null,
  readAt: r.read_at ?? null,
  createdAt: r.created_at,
});

export async function fetchExitData(): Promise<ExitData> {
  const [
    stepOwners,
    configRows,
    designations,
    reasons,
    assetTypes,
    documentTypes,
    payrollHeads,
    clearanceItems,
    masterManagers,
    masterRequests,
    cases,
    skips,
    clearanceChecks,
    assets,
    handovers,
    interviews,
    settlements,
    payrollLines,
    documents,
    activity,
    notifications,
  ] = await Promise.all([
    fetchAll("fms_exit_step_owners"),
    fetchAll("fms_exit_config", "key"),
    fetchAll("designations"),
    fetchAll("fms_exit_reasons"),
    fetchAll("fms_exit_asset_types"),
    fetchAll("fms_exit_document_types"),
    fetchAll("fms_exit_payroll_heads"),
    fetchAll("fms_exit_clearance_items"),
    // Master governance (M8). Both are read-all: the owners table drives the "who will
    // review this?" line on the request modal, and the requests table has to be visible
    // to its own requester and to the client-side duplicate guard.
    fetchAll("fms_exit_master_managers"),
    fetchAll("fms_exit_master_requests"),
    // Whatever fms_exit_can_read_case() lets this user see. An ordinary employee gets
    // their own case and nothing else; the app never filters — RLS does.
    fetchAll("fms_exit_cases"),
    fetchAll("fms_exit_step_skips", "skipped_at"),
    // The checklist. RLS follows fms_exit_can_read_case(), which since M3 is true for
    // whoever OWNS a row on the case — the IT / Admin / Travel-Desk people, who own no
    // workflow step and would otherwise read nothing at all.
    fetchAll("fms_exit_clearance_checks"),
    // Assets + the handover. Both follow fms_exit_can_read_case() too, so a reporting
    // manager (who owns asset_return and handover PER CASE, through
    // reporting_manager_ids rather than the step-owner table) reads exactly the cases
    // they manage — and an unrelated employee reads none.
    fetchAll("fms_exit_assets"),
    fetchAll("fms_exit_handover"),
    // ⚠ THE CONFIDENTIAL SATELLITE. It does NOT follow fms_exit_can_read_case() — its
    // own policy is admin | coordinator | fms_exit_is_hr_confidential, and nothing else.
    // A reporting manager, an employee, or an Admin/IT clearance owner gets ZERO ROWS
    // back here, with no error — which means "not visible", NEVER "not recorded". The
    // fact lives on the header (interview_done_at); this is only ever the content.
    fetchAll("fms_exit_interviews"),
    // ⚠ THE SECOND CONFIDENTIAL SATELLITE — THE MONEY. Its own policy is
    // admin | coordinator | fms_exit_is_finance_staff | the leaver-once-approved, and
    // nothing else. A REPORTING MANAGER gets ZERO ROWS at every stage, including after
    // payment; an Admin/IT clearance owner gets zero rows; the employee gets zero rows
    // until fnf_approved_at is stamped, and their own row after it. Zero rows means "not
    // visible", NEVER "not recorded" — the facts are on the header.
    fetchAll("fms_exit_settlements"),
    fetchAll("fms_exit_payroll_lines"),
    // ⭐ The closure documents. NOT a confidential satellite: its RLS is the WIDE gate
    // (fms_exit_can_read_case), because THE EMPLOYEE MUST READ THEIR OWN LETTERS — My
    // Resignation is where they open them. The manager and the clearance owners see that
    // the letters went out, which is a fact about the process, not about the money.
    fetchAll("fms_exit_documents"),
    // The activity trail carries employee names, so RLS already narrows it to exit
    // staff and coordinators — an ordinary employee simply reads zero rows.
    fetchAll("fms_exit_activity"),
    fetchAll("fms_exit_notifications"),
  ]);

  const byKey = new Map<string, any>(configRows.map((r) => [r.key, r.value ?? {}]));
  const config: ExitConfig = {
    processCoordinatorIds: (byKey.get("process_coordinators")?.user_ids ?? []) as string[],
    // Unset or partially-stored rules fall back to the code defaults.
    stepSla: resolveStepSla(byKey.get("step_sla")),
    policy: {
      payrollCutoffDay: Number(byKey.get("payroll_cutoff_day")?.day ?? 25),
      defaultNoticeDays: Number(byKey.get("default_notice_days")?.value ?? 30),
      allowSelfService: byKey.get("allow_self_service")?.value !== false,
    },
  };

  return {
    stepOwners: stepOwners.map(mapStepOwner),
    designations: designations.map(mapDesignation),
    config,
    reasons: reasons.map(mapMaster),
    assetTypes: assetTypes.map(mapMaster),
    documentTypes: documentTypes.map(mapDocumentType),
    payrollHeads: payrollHeads.map(mapPayrollHead),
    clearanceItems: clearanceItems.map(mapClearanceItem),
    masterManagers: masterManagers.map(mapMasterManager),
    masterRequests: masterRequests.map(mapMasterRequest),
    cases: cases.map(mapCase),
    skips: skips.map(mapSkip),
    clearanceChecks: clearanceChecks.map(mapClearanceCheck),
    assets: assets.map(mapAsset),
    handovers: handovers.map(mapHandover),
    interviews: interviews.map(mapInterview),
    settlements: settlements.map(mapSettlement),
    payrollLines: payrollLines.map(mapPayrollLine),
    documents: documents.map(mapDocument),
    activity: activity.map(mapActivity),
    notifications: notifications.map(mapNotification),
  };
}

/**
 * ⭐⭐ WHY THIS EXIT CANNOT BE ARCHIVED YET — asked of the DATABASE, not worked out here.
 *
 * ⚠ **THE SCREEN CANNOT COMPUTE THIS.** One of the five conditions is "the leaver's own
 *   copy of the final F&F is attached", and `final_fnf_path` lives on
 *   `fms_exit_settlements`, whose RLS is admin ∨ coordinator ∨ finance staff ∨
 *   the-leaver-after-approval. **The owner of the `documents` / `archive` steps is exit
 *   staff, and exit staff is NOT finance staff** — so they get ZERO ROWS from that table,
 *   and a client-side checklist would tell them with total confidence that the final F&F
 *   copy was missing while it sat right there. They would go and ask payroll to upload it
 *   again, and payroll would say they already had.
 *
 * So `fms_exit_archive_blockers()` (SECURITY DEFINER) returns the checklist as SENTENCES
 * — and not one figure: no amount, no payment mode, no UTR. `fms_exit_archive_case` calls
 * the very same function and refuses on its output, so **what the panel shows and what
 * the database will do cannot drift apart**.
 *
 * ⚠ The query key is nested UNDER `EXIT_QK`, so every `invalidateQueries({queryKey: QK})`
 *   in the store (i.e. every write in this app) re-asks the question. Issue a letter, and
 *   the checklist updates itself.
 */
export const archiveBlockersKey = (caseId: string) => [...EXIT_QK, "archiveBlockers", caseId] as const;

export async function fetchArchiveBlockers(caseId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("fms_exit_archive_blockers", { p_case: caseId });
  if (error) throw new Error(error.message);
  return (data ?? []) as string[];
}
