/**
 * HR Exit domain types — camelCase mirrors of the snake_case fms_exit_* rows.
 * Phases 1–2 cover config, the masters and the case header + approvals; clearance,
 * assets, handover, the exit interview and the settlement land in Phases 3–7.
 */

export type ExitEntityType =
  | "case"
  | "clearance"
  | "asset"
  | "handover"
  | "interview"
  | "settlement"
  | "document"
  | "master_request";

/**
 * The status of an exit case. DELIBERATELY DISJOINT FROM StepKey.
 *
 * `on_hold` / `withdrawn` / `rejected` / `archived` are statuses, never steps: a
 * status that leaks into the work queue flows silently into the KPI tiles, the
 * Dashboard ("work owed by Nobody") and the cross-FMS scoreboard. Held cases get
 * their own strip with a days-parked count, never a red count.
 *
 * Absconding / termination / retirement are a `caseType`, not step branches — the
 * real-world holes they open (an absconder has no handover; a terminated employee
 * gets no relieving letter) are covered by the generic skip-step mechanism.
 */
export type CaseStatus =
  | "manager_review"
  | "hr_review"
  | "head_approval"
  | "clearance"
  | "settlement"
  | "closure"
  | "on_hold"
  | "withdrawn"
  | "rejected"
  | "archived";

export type CaseType = "resignation" | "termination" | "retirement" | "absconding" | "end_of_contract";

/**
 * The reporting manager's answer. A RECOMMENDATION — it never blocks: the case
 * advances to HR whatever is chosen (you cannot legally refuse a resignation).
 * `discuss` additionally stamps `discussedAt` and leaves the SLA clock alone, so it
 * cannot be used as an SLA dodge. Only the HR Head can terminally reject.
 */
export type ManagerRecommendation = "accept" | "reject" | "discuss";

/** The HR Head's decision — the only terminal reject in the whole workflow. */
export type HeadDecision = "approve" | "reject";

/* ----------------------------------- cases --------------------------------- */

/**
 * The exit case header — the WIDE-READ row.
 *
 * The clearance crowd (IT, Admin, Travel Desk), the reporting manager and the
 * employee all read this, so it carries NO SALARY, NO F&F AND NO INTERVIEW
 * CONTENT. Those live in confidential satellites with their own narrow read gates
 * (Phases 5–6). Only the FACT that a step happened lives here — `interviewDoneAt`,
 * `fnfApprovedAt` — so a queue can show done / not-done without leaking a word.
 *
 * Every step's completion is one of these timestamp fields. NEVER infer it from the
 * activity trail: `announce` is best-effort and its failure is swallowed, so the
 * trail can be missing a step that definitely happened.
 */
export interface ExitCase {
  id: string;
  exitNo: string;
  caseType: CaseType;

  /** SNAPSHOT + an OPTIONAL login link — plenty of staff have no portal account. */
  employeeUserId: string | null;
  employeeCode: string;
  employeeName: string;
  departmentId: string;
  /** Free text. `designations` exists but is dead in the UI. */
  designation: string | null;
  dateOfJoining: string | null;

  /** Drives every MANAGER step (manager_review, asset_return, handover). */
  reportingManagerIds: string[];
  reportingManagerNote: string | null;

  raisedBy: string | null;
  raisedOnBehalf: boolean;

  reasonId: string | null;
  reasonNote: string | null;
  resignationLetterPath: string | null;
  resignationLetterName: string | null;

  noticePeriodDays: number | null;
  noticeWaived: boolean;
  policyApplicable: boolean;
  policyNaReason: string | null;

  /** What HR works out at verification. Not yet binding. */
  proposedLwd: string | null;
  /** THE last working day, finalised at `lwd_confirm`. Seven SLAs hang off it. */
  lwd: string | null;

  clearanceRemarks: string | null;
  systemStatusChanged: boolean;

  status: CaseStatus;
  currentStep: string;

  submittedAt: string;
  managerReviewedAt: string | null;
  managerRecommendation: ManagerRecommendation | null;
  managerRemarks: string | null;
  managerReviewerId: string | null;
  discussedAt: string | null;
  hrVerifiedAt: string | null;
  hrVerifierId: string | null;
  hrRemarks: string | null;
  approvedAt: string | null;
  approverId: string | null;
  approvalRemarks: string | null;
  clearanceCompletedAt: string | null;
  /** Stamped by HR's signature on the asset return — never by the HOD's. */
  assetsReturnedAt: string | null;
  handoverCompletedAt: string | null;
  interviewDoneAt: string | null;
  leaveVerifiedAt: string | null;
  payrollDoneAt: string | null;
  fnfGeneratedAt: string | null;
  fnfApprovedAt: string | null;
  fnfPaidAt: string | null;
  documentsIssuedAt: string | null;
  archivedAt: string | null;

  /**
   * THE TWO SIGNATURES ON THE ASSET RETURN — the operational sheet's "HOD Sign" and
   * "HR Sign" columns, which no generic checklist row can carry (a tick has one actor;
   * this has two, in order). The HOD signs first; **HR's signature is what completes
   * the step** (it stamps `assetsReturnedAt`) and auto-ticks the Admin + IT clearance
   * rows. They live on the header, next to `assetsReturnedAt`, so the queue reads one
   * row per case.
   */
  assetsHodSignedAt: string | null;
  assetsHodSignedBy: string | null;
  assetsHodRemarks: string | null;
  assetsHrSignedAt: string | null;
  assetsHrSignedBy: string | null;
  assetsHrRemarks: string | null;

  rejectedAt: string | null;
  rejectReason: string | null;
  withdrawnAt: string | null;
  withdrawReason: string | null;
  holdAt: string | null;
  holdReason: string | null;

  createdAt: string;
}

/* ------------------------------ assets + handover -------------------------- */

/**
 * `pending` is THE ONLY STATUS THAT BLOCKS HR'S SIGNATURE. The other three all settle
 * the row — returned, never issued, or gone (and being recovered).
 */
export type AssetStatus = "pending" | "returned" | "not_applicable" | "lost";

/**
 * One asset issued to the leaver — SNAPSHOTTED from `fms_exit_asset_types` when the
 * last working day was confirmed, exactly as the clearance checks are. `name` is a
 * copy: renaming a master next quarter must not rewrite what this leaver was asked to
 * hand back.
 *
 * A `lost` asset needs a `recoveryAmount` **or** an explicit remark — the RPC refuses
 * otherwise. A lost laptop with no number against it is how a recovery quietly never
 * happens: the row settles, the step signs off, the F&F is generated, and nobody ever
 * deducts anything.
 */
export interface ExitAsset {
  id: string;
  caseId: string;
  /** Provenance only — `on delete set null`, so deleting a master keeps the history. */
  assetTypeId: string | null;
  name: string;
  sortOrder: number;
  status: AssetStatus;
  returnedOn: string | null;
  condition: string | null;
  remarks: string | null;
  /** Only ever set on a `lost` asset. Any other status clears it server-side. */
  recoveryAmount: number | null;
  filePath: string | null;
  fileName: string | null;
}

/**
 * The work handover & knowledge transfer — 1:1 with the case (the case id IS the
 * primary key: there is one handover, and a second row would be a second version of
 * the truth).
 *
 * The receiver is a portal user **or** a plain name: the work very often goes to
 * someone with no login (a contractor, a new joiner whose account is not open yet).
 * One of the two is mandatory — "handed over to nobody" is not a handover, it is the
 * work quietly evaporating on someone's last day.
 *
 * The reporting manager confirms first; **HR's confirmation completes the step**
 * (it stamps `handoverCompletedAt`) and auto-ticks the Reporting-Manager clearance row.
 */
export interface ExitHandover {
  caseId: string;
  handoverToUserId: string | null;
  handoverToName: string | null;
  ktDone: boolean;
  ktRemarks: string | null;
  notes: string | null;
  filePath: string | null;
  fileName: string | null;
  managerConfirmedAt: string | null;
  managerConfirmedBy: string | null;
  managerRemarks: string | null;
  hrConfirmedAt: string | null;
  hrConfirmedBy: string | null;
  hrRemarks: string | null;
}

/* -------------------------------- interview -------------------------------- */

/**
 * The structured half of an exit interview. OPEN-ENDED ON PURPOSE — it is stored as
 * `jsonb`, not as columns: every company changes its exit questionnaire, a column per
 * question would make that a migration, and a dropped column would erase the answers
 * people already gave.
 *
 * `ratings` is keyed by the question keys in `ExitInterviewPanel` (1–5).
 */
export interface ExitInterviewFeedback {
  ratings?: Record<string, number>;
  what_worked?: string;
  what_would_have_kept?: string;
  [key: string]: unknown;
}

/**
 * ⭐ THE EXIT INTERVIEW — the FIRST CONFIDENTIAL SATELLITE, and the one type in this
 * file most of the app must never see.
 *
 * 1:1 with the case (the case id IS the primary key in SQL: there is one exit
 * interview, and a second row would be a second version of what was said).
 *
 * ⚠ **READABLE BY: admin ∨ a process coordinator ∨ `fms_exit_is_hr_confidential`
 *   (the owners of hr_verification | hr_head_approval | exit_interview). NOBODY ELSE.**
 *
 *   Not the reporting manager. Not the employee. Not the IT / Admin / Travel-Desk
 *   clearance owners, who ARE exit staff and read the header quite happily.
 *
 *   An exit interview exists to say things ABOUT the manager; if the manager can read
 *   it, it is not an exit interview — it is a performance review with extra steps.
 *   That is why it does not live on `ExitCase`, which the entire clearance crowd, the
 *   manager and the employee all read.
 *
 * ⚠ A NON-READER GETS **ZERO ROWS** FROM RLS — which is NOT the same fact as "no
 *   interview has been held". The **fact** lives on the wide-read header as
 *   `ExitCase.interviewDoneAt`, and every done/not-done chip, queue and stepper node
 *   must read THAT. Deriving "not recorded" from an empty satellite is how a leak gets
 *   papered over into a lie.
 */
export interface ExitInterview {
  caseId: string;
  /** Not necessarily the person who keyed it in — HR records what the HR Head held. */
  conductedBy: string | null;
  conductedOn: string | null;
  /**
   * The reason the leaver gave IN THE ROOM — very often not the one on the resignation
   * letter (`ExitCase.reasonId`). Keeping both is the point: the gap is the finding.
   */
  primaryReasonId: string | null;
  wouldRehire: boolean | null;
  remarks: string | null;
  feedback: ExitInterviewFeedback;
  /** The sheet's "Exit Feedback Update on Portal" — a manual flag, no HRMS to call. */
  portalFeedbackDone: boolean;
  /** `cases/<id>/interview/…` — HR-confidential in storage too (a restrictive policy). */
  filePath: string | null;
  fileName: string | null;
}

/* -------------------------------- settlement ------------------------------- */

/**
 * ⭐⭐ THE SETTLEMENT — the SECOND CONFIDENTIAL SATELLITE, and the money.
 *
 * 1:1 with the case (the case id IS the primary key in SQL: there is one settlement,
 * and a second row would be a second version of what someone is owed).
 *
 * ⚠ **RECORD, DON'T COMPUTE.** The portal holds NO salary data and NO leave ledger.
 *   Every number below is what payroll or accounts SAID, keyed in and attached to the
 *   sheet it came from. `fnfAmount` is therefore **NULLABLE** — there is no settlement
 *   calculator in this application and there must never be one, because a total derived
 *   from data the portal does not have is fiction wearing the authority of a database
 *   column. The panel SUMS the payroll lines for display and labels that sum as a
 *   display aid; nothing persists it.
 *
 * ⚠ **READABLE BY: admin ∨ a process coordinator ∨ `fms_exit_is_finance_staff` (the
 *   owners of leave_verification | payroll_inputs | fnf_generate | fnf_approve |
 *   fnf_payment) ∨ THE LEAVER THEMSELVES — but only once `ExitCase.fnfApprovedAt` is
 *   set.** They are entitled to their statement; they are not entitled to watch the
 *   numbers being keyed.
 *
 *   **THE REPORTING MANAGER IS NOT ON THAT LIST AT ALL.** Not before, not after. A
 *   manager has no business reading a subordinate's notice recovery or loan balance —
 *   and `fms_exit_can_read_case()` IS true for them, which is exactly why the money does
 *   not live on the header.
 *
 * ⚠ A NON-READER GETS **ZERO ROWS** FROM RLS — which is NOT the same fact as "no
 *   settlement was recorded". The FACTS live on the wide-read header
 *   (`fnfGeneratedAt` / `fnfApprovedAt` / `fnfPaidAt`), and every chip, queue and
 *   stepper node must read THOSE.
 */
export interface ExitSettlement {
  caseId: string;

  /** Leave verification — what HR reads off the leave system and states for the record. */
  leaveBalanceDays: number | null;
  lwpDays: number | null;
  /** Of the balance, what is actually payable. Never more than the balance (the RPC checks). */
  encashableDays: number | null;
  leaveRemarks: string | null;

  /** Payroll inputs — the sheet's stage 8. Every one of these ARRIVES from payroll. */
  lwpCompleted: boolean;
  noticeRecoveryDays: number | null;
  noticeRecoveryAmount: number | null;
  incentiveAmount: number | null;
  loanRecoveryAmount: number | null;
  otherDeductions: number | null;
  payrollRemarks: string | null;

  /** ⚠ NULLABLE BY DESIGN. What payroll SAYS the net is — never something we worked out. */
  fnfAmount: number | null;
  /** The working, under `cases/<id>/fnf/…` — finance-confidential in storage too. */
  fnfFilePath: string | null;
  fnfFileName: string | null;
  fnfRemarks: string | null;

  /** WHO DECIDED. On a rejection this is the person who sent it back — `fnfApprovedAt` on
   *  the header is what tells you whether the decision was an approval. */
  fnfApprovedById: string | null;
  fnfApprovalRemarks: string | null;

  fnfPaidOn: string | null;
  fnfPaymentMode: string | null;
  fnfPaymentRef: string | null;
  fnfPaidById: string | null;

  /** ⭐ The employee's own copy, under `cases/<id>/share/…` — the one prefix they can read.
   *  The RPC refuses any other prefix: a final F&F filed under `fnf/` would be a
   *  settlement the leaver is told about and cannot open. */
  finalFnfPath: string | null;
  finalFnfName: string | null;
}

/**
 * One free-form F&F addition or deduction, off the `fms_exit_payroll_heads` master.
 *
 * `headName` is a **SNAPSHOT** — `headId` is provenance only (`on delete set null`).
 * Renaming or deleting a master head next quarter must never rewrite what THIS leaver
 * was actually deducted, and a line whose name vanished with its master is a line
 * nobody can defend in a dispute.
 */
export interface ExitPayrollLine {
  id: string;
  caseId: string;
  headId: string | null;
  headName: string;
  kind: "addition" | "deduction";
  amount: number;
  remarks: string | null;
  sortOrder: number;
}

/* --------------------------------- closure --------------------------------- */

/**
 * ⭐ ONE DOCUMENT ISSUED AT CLOSURE — the experience letter, the relieving letter, the
 * F&F statement, the NOC. SNAPSHOTTED from `fms_exit_document_types` when the last
 * working day was confirmed, exactly as the clearance checks and the assets are:
 * `name` and `requiresFile` are COPIES, so renaming a master (or relaxing its
 * requires-a-file rule) next quarter can never rewrite what THIS leaver was given.
 *
 * ⚠⚠ **TWO PIECES OF EVIDENCE, NOT ONE — AND THAT IS THE WHOLE POINT OF THE PHASE.**
 *
 *   `issuedOn` / `filePath`      — the letter going **OUT**.
 *   `handedOverOn` / `ackSignedPath` — the SIGNED ACKNOWLEDGEMENT COMING **BACK**.
 *
 *   `documents` and `archive` are two steps precisely so that the second cannot hide
 *   behind the first. The commonest real failure of an exit is *the letters were issued
 *   and the acknowledgement never came back* — the case reads "closed", the employee has
 *   no relieving letter on file, and nobody finds out until a background check eighteen
 *   months later. `fms_exit_archive_case` REFUSES without an ack for every document that
 *   was actually issued, and names the ones that are missing.
 *
 * Both files live under `cases/<id>/share/…` — the ONE prefix the exiting employee may
 * read. The RPCs validate the prefix: a relieving letter the leaver cannot open is not
 * a relieving letter.
 */
export interface ExitDocument {
  id: string;
  caseId: string;
  /** Provenance only — `on delete set null`, so deleting a master keeps the history. */
  documentTypeId: string | null;
  name: string;
  /** SNAPSHOT. A letter with no PDF is a promise, not a document. */
  requiresFile: boolean;
  sortOrder: number;

  /** ---- the letter goes OUT ---- */
  issuedOn: string | null;
  filePath: string | null;
  fileName: string | null;

  /** ---- ⭐ the signed acknowledgement comes BACK. `archive` refuses without it. ---- */
  handedOverOn: string | null;
  ackSignedPath: string | null;
  ackSignedName: string | null;

  remarks: string | null;
}

/**
 * "This step does not apply to this case, and here is why."
 *
 * A SKIPPED STEP IS COMPLETE-WITH-A-REASON: it emits no queue entry, renders ⊘ on
 * the stepper with the reason on hover, and it SATISFIES THE DOWNSTREAM GUARDS.
 * This one mechanism covers every real-world hole — an absconder has no handover, a
 * terminated employee gets no relieving letter, Training clearance is "if
 * applicable" — instead of branching the workflow three ways.
 */
export interface StepSkip {
  caseId: string;
  stepKey: string;
  reason: string;
  skippedBy: string | null;
  skippedAt: string;
}

/**
 * One materialised clearance row on one case — the SNAPSHOT of a
 * `fms_exit_clearance_items` master row, taken when the LWD was confirmed.
 *
 * SNAPSHOT, NOT A JOIN. Every field below is a copy, so renaming or deactivating a
 * master row next quarter can never rewrite what last quarter's leaver was actually
 * asked for.
 *
 * `ownerIds` is WHO OWES THIS SPECIFIC ROW — the IT / Admin / Travel-Desk people,
 * who own no workflow step at all. That is why each outstanding check becomes its
 * own queue entry rather than being folded into one `clearance` entry per case, and
 * why `fms_exit_can_read_case` has a clause for it (without which they could not
 * open the very case they owe work on).
 */
export interface ClearanceCheck {
  id: string;
  caseId: string;
  itemKey: string;
  name: string;
  /** IT | Admin | Payroll | Accounts | Travel Desk | Training | HR | Reporting Manager */
  departmentLabel: string;
  description: string | null;
  /** Empty → falls back to the owners of the `clearance` step. Nothing is owed by nobody. */
  ownerIds: string[];
  /** Routes PER CASE, like a MANAGER step: this leaver's own reporting manager. */
  ownerIsReportingManager: boolean;
  requiresFile: boolean;
  allowsLink: boolean;
  /** SIGNED working-day offset from the LWD. Negative = before it (the normal case). */
  dueDays: number;
  sortOrder: number;
  /** 'asset_return' | 'handover' | null — that step's completion auto-ticks this row (M4). */
  satisfiedByStep: string | null;

  done: boolean;
  /** Stamped SERVER-SIDE. Nobody types a completion date. */
  doneAt: string | null;
  doneBy: string | null;
  /** The sheet's "if applicable". SETTLES the row — it is not outstanding. */
  notApplicable: boolean;
  naReason: string | null;
  filePath: string | null;
  fileName: string | null;
  linkUrl: string | null;
  /** The sheet's "Reason (If Pending)". */
  pendingReason: string | null;
}

/* ---------------------------------- masters -------------------------------- */

/** The four plain {id, name, active, sortOrder} masters (MasterCrud). */
export interface ExitMaster {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export type ExitReason = ExitMaster;
export type ExitAssetType = ExitMaster;

/** A letter with no PDF is a promise, not a document — hence `requiresFile`. */
export interface ExitDocumentType extends ExitMaster {
  requiresFile: boolean;
}

/** A line item on the F&F. The app RECORDS these amounts; it does not compute them. */
export interface ExitPayrollHead extends ExitMaster {
  kind: "addition" | "deduction";
}

/**
 * One departmental clearance-checklist item — the config-driven backbone of the
 * `clearance` step. Making each of the 8 departments a workflow step would double
 * the step list and make "HR adds a 9th department" a code change + a migration.
 *
 * `dueDays` IS SIGNED, and negative is the NORMAL case: a clearance item is due
 * BEFORE the last working day. It is a plain master column, never an SLA rule, so it
 * never passes through `resolveStepSla` (which rejects negatives and silently
 * substitutes a default). The maths is done with `addWorkingDaysSigned`.
 *
 * `satisfiedByStep` stops the same work being owed twice: Asset Return and Handover
 * are ALSO first-class steps, so completing the step auto-ticks the matching rows.
 */
export interface ClearanceItem {
  id: string;
  /** Stable slug for code that special-cases an item. */
  key: string;
  name: string;
  /** IT | Admin | Payroll | Accounts | Travel Desk | Training | HR | Reporting Manager */
  departmentLabel: string;
  description: string | null;
  /** WHO owes it. Empty → falls back to the owners of the `clearance` step. */
  ownerIds: string[];
  /** Routes PER CASE, like a MANAGER step: the exiting employee's own manager. */
  ownerIsReportingManager: boolean;
  requiresFile: boolean;
  allowsLink: boolean;
  /** SIGNED working-day offset from the last working day. Negative = before it. */
  dueDays: number;
  /** 'asset_return' | 'handover' | null → completing that step auto-ticks this row. */
  satisfiedByStep: string | null;
  active: boolean;
  sortOrder: number;
}

/* ------------------------------ master governance -------------------------- */

export type ExitMasterType =
  | "reason"
  | "asset_type"
  | "document_type"
  | "payroll_head"
  | "clearance_item";

/** Every master, for the owners config — all five can be assigned an owner (Phase 9). */
export const EXIT_MASTER_TYPES: { value: ExitMasterType; label: string; plural: string }[] = [
  { value: "reason", label: "Exit Reason", plural: "Exit Reasons" },
  { value: "asset_type", label: "Asset Type", plural: "Asset Types" },
  { value: "document_type", label: "Document Type", plural: "Document Types" },
  { value: "payroll_head", label: "Payroll Head", plural: "Payroll Heads" },
  { value: "clearance_item", label: "Clearance Item", plural: "Clearance Checklist" },
];

/**
 * The masters a user can REQUEST a new entry for — the four that back a dropdown.
 * The clearance checklist is deliberately absent: it feeds no form (it is seeded
 * server-side onto each case) and is unique on a slug `key` rather than `name`,
 * which would drag key-generation and collision de-duping into the resolve RPC for a
 * path nobody would use. Its owner edits it directly on the Masters page.
 */
export const REQUESTABLE_EXIT_MASTER_TYPES = EXIT_MASTER_TYPES.filter((m) => m.value !== "clearance_item");

/** One assigned owner of one master type (`fms_exit_master_managers`). All five types. */
export interface ExitMasterManager {
  id: string;
  masterType: ExitMasterType;
  managerUserId: string;
}

export type ExitMasterRequestStatus = "pending" | "approved" | "rejected";

/**
 * A "please add this to the master" request (`fms_exit_master_requests`).
 *
 * `masterType` is one of the FOUR requestable types — the DB CHECK refuses
 * `clearance_item` outright, so a row of that type cannot exist. The typing here is
 * deliberately the wider `ExitMasterType` anyway, so a stray row could never crash a
 * mapper; every screen that offers a type picker reads REQUESTABLE_EXIT_MASTER_TYPES.
 */
export interface ExitMasterRequest {
  id: string;
  masterType: ExitMasterType;
  /** The proposed values. ⚠ Its keys are the WIRE CONTRACT with the resolve RPC — see lib/masterFields.ts. */
  proposedPayload: Record<string, unknown>;
  status: ExitMasterRequestStatus;
  requestedBy: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  /** The id of the master row the approval actually created. */
  resolvedMasterId: string | null;
  createdAt: string;
}

/* -------------------------------- config ----------------------------------- */

export interface StepOwner {
  id: string;
  stepKey: string;
  /** UI filter for choosing employees. Authorization comes from employeeIds. */
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

/** The no-code policy knobs (Setup → Policy). */
export interface ExitPolicy {
  /** Day of the month payroll closes. `payroll_inputs` is due on it. */
  payrollCutoffDay: number;
  /** Suggested notice period, prefilled on a new case. */
  defaultNoticeDays: number;
  /** May an employee raise their own resignation? Enforced in fms_exit_raise_case. */
  allowSelfService: boolean;
}

export interface Designation {
  id: string;
  name: string;
  active: boolean;
}

/* --------------------------- activity + bell feed -------------------------- */

export interface ExitActivity {
  id: string;
  entityType: ExitEntityType;
  entityId: string;
  type: string;
  actorId: string | null;
  note: string | null;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface ExitNotification {
  id: string;
  userId: string;
  type: string;
  entityType: ExitEntityType;
  entityId: string;
  /** Rendered RAW in the bell — write it as a whole, self-contained sentence. */
  text: string;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}
