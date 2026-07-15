import { supabase } from "@/core/platform/supabase";
import type { Json } from "@/core/platform/database.types";
import type {
  AssetStatus,
  CaseType,
  ExitEntityType,
  ExitMasterType,
  HeadDecision,
  ManagerRecommendation,
} from "../types";

/**
 * HR Exit write layer.
 *
 * Config and masters are written directly under RLS (Setup is admin-only; Masters
 * relaxes to the master's owner in Phase 9). Every WORKFLOW mutation, by contrast,
 * goes through a SECURITY DEFINER RPC that re-checks authorization (fms_exit_can_act),
 * validates the transition and stamps the step's completion timestamp on a domain row.
 * The wrappers below are thin on purpose: the DATABASE is the gate, not this file.
 */

/* --------------------------------- cases ---------------------------------- */

/** What a new exit case needs. Mirrors the jsonb `fms_exit_raise_case` expects. */
export interface CaseInput {
  caseType: CaseType;
  /** Null for staff with no portal login — they get no notifications, HR mails them. */
  employeeUserId: string | null;
  employeeCode: string;
  employeeName: string;
  departmentId: string;
  designation: string | null;
  dateOfJoining: string | null;
  reportingManagerIds: string[];
  reportingManagerNote: string | null;
  reasonId: string | null;
  reasonNote: string | null;
  resignationLetterPath: string | null;
  resignationLetterName: string | null;
}

/**
 * camelCase → the snake_case jsonb the RPCs take.
 *
 * ⚠ A KEY THE CALLER DID NOT SUPPLY IS **OMITTED**, never sent as `""`.
 * `fms_exit_update_case` is a PATCH: it reads `jsonb_exists(p, key)` to tell "leave
 * this alone" apart from "clear it". Defaulting an absent field to `""` here would
 * turn every partial update into a blanking operation — the post-raise letter upload
 * sends two keys and would otherwise erase the designation, the joining date and the
 * reason. `raiseCase` always passes a complete `CaseInput`, so it is unaffected.
 */
const caseJson = (i: Partial<CaseInput>): Json => {
  const out: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined) out[key] = value ?? "";
  };
  put("case_type", i.caseType);
  put("employee_user_id", i.employeeUserId);
  put("employee_code", i.employeeCode);
  put("employee_name", i.employeeName);
  put("department_id", i.departmentId);
  put("designation", i.designation);
  put("date_of_joining", i.dateOfJoining);
  if (i.reportingManagerIds !== undefined) out.reporting_manager_ids = i.reportingManagerIds;
  put("reporting_manager_note", i.reportingManagerNote);
  put("reason_id", i.reasonId);
  put("reason_note", i.reasonNote);
  put("resignation_letter_path", i.resignationLetterPath);
  put("resignation_letter_name", i.resignationLetterName);
  return out as unknown as Json;
};

/**
 * Raise an exit case.
 *
 * The self-service rule lives ENTIRELY in the RPC and is never gated on step
 * ownership: `resignation` is not an owned step and must never become one, or the PII
 * read gate would be true for the whole company. This wrapper simply asks.
 */
export async function raiseCase(input: CaseInput): Promise<string> {
  const { data, error } = await supabase.rpc("fms_exit_raise_case", { p: caseJson(input) });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Edit a case. The raiser or HR/coordinator, and only before the HR Head approves. */
export async function updateCase(caseId: string, input: Partial<CaseInput>): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_update_case", { p_case: caseId, p: caseJson(input) });
  if (error) throw new Error(error.message);
}

/**
 * The reporting manager's recommendation. It NEVER blocks — the case advances to HR
 * whatever is chosen. Only `fms_exit_decide_case` (the HR Head) can terminally stop it.
 */
export async function managerReview(
  caseId: string,
  recommendation: ManagerRecommendation,
  remarks: string,
): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_manager_review", {
    p_case: caseId,
    p_recommendation: recommendation,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

export interface HrVerifyInput {
  noticePeriodDays: number | null;
  noticeWaived: boolean;
  policyApplicable: boolean;
  policyNaReason: string | null;
  /** Required. The CONFIRMED last working day is set later, at `lwd_confirm` (M3). */
  proposedLwd: string;
  hrRemarks: string | null;
}

export async function hrVerify(caseId: string, input: HrVerifyInput): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_hr_verify", {
    p_case: caseId,
    p: {
      notice_period_days: input.noticePeriodDays ?? "",
      notice_waived: input.noticeWaived,
      policy_applicable: input.policyApplicable,
      policy_na_reason: input.policyNaReason ?? "",
      proposed_lwd: input.proposedLwd,
      hr_remarks: input.hrRemarks ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/** The HR Head. `reject` is terminal, and it is the only terminal reject there is. */
export async function decideCase(caseId: string, decision: HeadDecision, remarks: string): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_decide_case", {
    p_case: caseId,
    p_decision: decision,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

/** The employee retracts. Allowed right up until the F&F has actually been paid. */
export async function withdrawCase(caseId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_withdraw_case", { p_case: caseId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/** Park / un-park a case. `on_hold` is a STATUS: a held case leaves every queue. */
export async function holdCase(caseId: string, hold: boolean, reason: string): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_hold_case", {
    p_case: caseId,
    p_hold: hold,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/**
 * Waive a step, with a reason — the one generic mechanism for every real-world hole
 * (an absconder has no handover; a terminated employee gets no relieving letter). A
 * skipped step is complete-with-a-reason: it leaves the queues and satisfies the
 * downstream guards. HR Head / coordinator / admin only.
 */
export async function skipStep(caseId: string, stepKey: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_skip_step", {
    p_case: caseId,
    p_step: stepKey,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/* ---------------------- the LWD + the clearance checklist ------------------ */

/**
 * Confirm the last working day — **the pivot of the whole application**.
 *
 * Two things happen server-side, and only one of them is a date: `lwd` is finalised
 * (seven downstream SLAs hang off it), and the CLEARANCE CHECKLIST IS MATERIALISED
 * from the active master, idempotently.
 *
 * Re-confirming a CHANGED date **moves every deadline and touches no item**: the due
 * dates are derived in TS from `lwd` + each row's snapshotted `dueDays`, so there is
 * nothing stored to rewrite, and the seed is guarded by `if count = 0`.
 */
export async function confirmLwd(caseId: string, lwd: string): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_confirm_lwd", { p_case: caseId, p_lwd: lwd });
  if (error) throw new Error(error.message);
}

export interface CheckInput {
  filePath?: string | null;
  fileName?: string | null;
  linkUrl?: string | null;
  pendingReason?: string | null;
}

/**
 * Tick / untick one clearance row.
 *
 * `done_at` / `done_by` are stamped SERVER-SIDE — nobody types a completion date. The
 * evidence rule lives in the RPC: a file, **or** (where the item allows one) a link —
 * and whatever arrives in THIS call counts, so a tick that supplies its own evidence
 * succeeds. Completion of the whole step is then the DATABASE's decision, never this
 * client's.
 *
 * Passing `done: false` is also the way back from "not applicable".
 */
export async function toggleClearanceCheck(
  checkId: string,
  done: boolean,
  input: CheckInput = {},
): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_toggle_clearance_check", {
    p_check: checkId,
    p_done: done,
    p_file_path: input.filePath ?? undefined,
    p_file_name: input.fileName ?? undefined,
    p_link_url: input.linkUrl ?? undefined,
    p_pending_reason: input.pendingReason ?? undefined,
  });
  if (error) throw new Error(error.message);
}

/** "This one does not apply here" — the sheet's *(if applicable)*. The reason is required. */
export async function setClearanceNa(checkId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_set_clearance_na", {
    p_check: checkId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

/* ---------------------------- assets + handover --------------------------- */

export interface AssetInput {
  status: AssetStatus;
  /** A business date, yyyy-mm-dd. NEVER `toISOString()`. */
  returnedOn?: string | null;
  condition?: string | null;
  remarks?: string | null;
  /** Only meaningful on a `lost` asset; the RPC clears it on any other status. */
  recoveryAmount?: number | null;
  filePath?: string | null;
  fileName?: string | null;
}

/**
 * Record what happened to ONE asset.
 *
 * The RPC refuses a `lost` asset that carries neither a recovery amount nor an
 * explicit remark — a lost laptop with no number against it is how a recovery quietly
 * never happens. It also refuses any edit once HR has signed: a signature that can be
 * invalidated underneath the person who gave it is not a signature.
 */
export async function updateAsset(assetId: string, input: AssetInput): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_update_asset", {
    p_asset: assetId,
    p: {
      status: input.status,
      returned_on: input.returnedOn ?? "",
      condition: input.condition ?? "",
      remarks: input.remarks ?? "",
      recovery_amount: input.recoveryAmount === null || input.recoveryAmount === undefined ? "" : String(input.recoveryAmount),
      file_path: input.filePath ?? "",
      file_name: input.fileName ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/**
 * Sign the asset return. **The HOD signs first; HR's signature completes the step.**
 *
 * HR's is refused while the HOD has not signed, and while any asset is still `pending`.
 * On completion the RPC stamps `assets_returned_at` and **auto-ticks every clearance
 * row whose `satisfiedByStep` is `asset_return`** (Admin + IT), bypassing their
 * evidence rule — the evidence is this signature — and then asks the database whether
 * the whole clearance step is now complete.
 *
 * Signing twice is idempotent: it neither errors nor re-stamps.
 */
export async function signAssets(caseId: string, role: "hod" | "hr", remarks: string): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_sign_assets", {
    p_case: caseId,
    p_role: role,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

export interface HandoverInput {
  /** A portal user… */
  handoverToUserId?: string | null;
  /** …or a plain name, for the many receivers who have no login. ONE IS REQUIRED. */
  handoverToName?: string | null;
  ktDone: boolean;
  ktRemarks?: string | null;
  notes?: string | null;
  filePath?: string | null;
  fileName?: string | null;
}

/**
 * Record the handover: who is taking the work over, and whether the KT happened.
 *
 * The RPC demands a receiver — a user id **or** a name. "Handed over to nobody" is not
 * a handover; it is the work quietly evaporating on someone's last day.
 */
export async function recordHandover(caseId: string, input: HandoverInput): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_record_handover", {
    p_case: caseId,
    p: {
      handover_to_user_id: input.handoverToUserId ?? "",
      handover_to_name: input.handoverToName ?? "",
      kt_done: input.ktDone,
      kt_remarks: input.ktRemarks ?? "",
      notes: input.notes ?? "",
      file_path: input.filePath ?? "",
      file_name: input.fileName ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/**
 * Confirm the handover. **The manager confirms first; HR's confirmation completes the
 * step** — it stamps `handover_completed_at` and auto-ticks the Reporting-Manager
 * clearance row, so the manager never signs the same thing twice. Idempotent.
 */
export async function confirmHandover(
  caseId: string,
  role: "manager" | "hr",
  remarks: string,
): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_confirm_handover", {
    p_case: caseId,
    p_role: role,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------ exit interview ---------------------------- */

export interface InterviewInput {
  /** Not necessarily the caller — HR records what the HR Head actually held. */
  conductedBy: string | null;
  /** A business date, yyyy-mm-dd, straight out of a date input. NEVER `toISOString()`. */
  conductedOn: string | null;
  /** The reason given IN THE ROOM — often not the one on the resignation letter. */
  primaryReasonId: string | null;
  /** Tri-state: `null` is "not answered", which is not the same as "no". */
  wouldRehire: boolean | null;
  remarks: string | null;
  /** Open-ended by design — stored as jsonb, so the questionnaire can change. */
  feedback: Record<string, unknown>;
  /** The sheet's "Exit Feedback Update on Portal". */
  portalFeedbackDone: boolean;
  filePath?: string | null;
  fileName?: string | null;
}

/**
 * ⭐ Record — or CORRECT — the exit interview.
 *
 * Authorized by `fms_exit_can_act('exit_interview', …)`: the configured owner of the
 * step, a process coordinator, or an admin. The reporting manager is NOT on that list
 * (it is not a MANAGER step) and neither is the employee — the RPC raises for both.
 *
 * Upserts on the case id, so a correction updates in place rather than growing a second
 * version of what was said. It stamps `fms_exit_cases.interview_done_at` — the FACT, on
 * the wide-read header — with a `coalesce`, so correcting a typo three days later does
 * not silently re-date a step that completed on time.
 *
 * ⚠ The announce it fires deliberately says only "Exit interview recorded for EXIT-…".
 *   It fans out to step owners and writes an activity row every clearance owner can
 *   read; a bell that quoted the feedback would undo the whole RLS policy from inside a
 *   SECURITY DEFINER function, silently.
 */
export async function recordInterview(caseId: string, input: InterviewInput): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_record_interview", {
    p_case: caseId,
    p: {
      conducted_by: input.conductedBy ?? "",
      conducted_on: input.conductedOn ?? "",
      primary_reason_id: input.primaryReasonId ?? "",
      would_rehire: input.wouldRehire === null ? "" : String(input.wouldRehire),
      remarks: input.remarks ?? "",
      feedback: input.feedback,
      portal_feedback_done: input.portalFeedbackDone,
      file_path: input.filePath ?? "",
      file_name: input.fileName ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------- settlement ------------------------------- */

/**
 * ⚠ A NUMBER FIELD THE USER LEFT BLANK IS SENT AS `""`, WHICH EVERY RPC READS AS NULL
 *   (`nullif(p->>'x','')::numeric`). It is NEVER sent as `0`.
 *
 *   Zero and "not stated" are different facts, and on an F&F the difference is money: a
 *   loan recovery of ₹0 says the loan was settled; a loan recovery of NULL says nobody
 *   has looked yet. Defaulting one to the other is how a recovery quietly never happens.
 */
const numOrBlank = (n: number | null | undefined): string =>
  n === null || n === undefined || Number.isNaN(n) ? "" : String(n);

export interface LeaveInput {
  leaveBalanceDays: number | null;
  lwpDays: number | null;
  encashableDays: number | null;
  leaveRemarks: string | null;
}

/**
 * Verify the leave balance — the F&F's first input.
 *
 * The RPC refuses without a confirmed last working day (the balance is only final once
 * the person stops accruing) and refuses encashable days greater than the balance. That
 * one check is a SANITY RULE, not a computation: it rejects an impossible input; it does
 * not derive a number nobody stated.
 */
export async function verifyLeave(caseId: string, input: LeaveInput): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_verify_leave", {
    p_case: caseId,
    p: {
      leave_balance_days: numOrBlank(input.leaveBalanceDays),
      lwp_days: numOrBlank(input.lwpDays),
      encashable_days: numOrBlank(input.encashableDays),
      leave_remarks: input.leaveRemarks ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/** One free-form F&F line. `headName` is SNAPSHOTTED server-side from what is sent here. */
export interface PayrollLineInput {
  headId: string | null;
  headName: string;
  kind: "addition" | "deduction";
  amount: number;
  remarks: string | null;
}

export interface PayrollInput {
  lwpCompleted: boolean;
  noticeRecoveryDays: number | null;
  noticeRecoveryAmount: number | null;
  incentiveAmount: number | null;
  loanRecoveryAmount: number | null;
  otherDeductions: number | null;
  payrollRemarks: string | null;
  /** ⚠ REPLACED WHOLESALE by the RPC — send the complete list, every time. */
  lines: PayrollLineInput[];
}

/**
 * Record the payroll inputs — the sheet's stage 8. **RECORDED, NOT CALCULATED.**
 *
 * The lines are REPLACED, not merged: a payroll sheet is re-keyed as a whole, and
 * merging row by row would leave last week's withdrawn deduction sitting in the F&F
 * because nobody remembered to delete it. So this always sends the complete list.
 */
export async function recordPayrollInputs(caseId: string, input: PayrollInput): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_record_payroll_inputs", {
    p_case: caseId,
    p: {
      lwp_completed: input.lwpCompleted,
      notice_recovery_days: numOrBlank(input.noticeRecoveryDays),
      notice_recovery_amount: numOrBlank(input.noticeRecoveryAmount),
      incentive_amount: numOrBlank(input.incentiveAmount),
      loan_recovery_amount: numOrBlank(input.loanRecoveryAmount),
      other_deductions: numOrBlank(input.otherDeductions),
      payroll_remarks: input.payrollRemarks ?? "",
      lines: input.lines.map((l) => ({
        head_id: l.headId ?? "",
        head_name: l.headName,
        kind: l.kind,
        amount: numOrBlank(l.amount),
        remarks: l.remarks ?? "",
      })),
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

export interface FnfInput {
  /** ⚠ NULLABLE, AND THAT IS THE DESIGN. What payroll SAYS the net is — never a total we
   *  worked out. The portal holds no salary data; a number it computed would be fiction. */
  fnfAmount: number | null;
  fnfRemarks: string | null;
  filePath?: string | null;
  fileName?: string | null;
}

/**
 * ⭐ Generate the F&F.
 *
 * **The RPC REFUSES unless the leave balance is verified AND the payroll inputs are
 * recorded — or those steps were waived** (its guard is `fms_exit_step_done`: timestamp
 * OR skipped, the same rule `openSteps()` uses, so the button and the database can never
 * disagree). You cannot work out a settlement before its inputs exist; but an absconder
 * whose payroll step was legitimately waived must not be permanently wedged.
 *
 * The working must be uploaded to `cases/<id>/fnf/…` — the RPC validates the prefix,
 * because anywhere else is readable by every exit staffer, including Admin and IT.
 */
export async function generateFnf(caseId: string, input: FnfInput): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_generate_fnf", {
    p_case: caseId,
    p: {
      fnf_amount: numOrBlank(input.fnfAmount),
      fnf_remarks: input.fnfRemarks ?? "",
      fnf_file_path: input.filePath ?? "",
      fnf_file_name: input.fileName ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/**
 * ⭐ Approve — or SEND BACK — the F&F.
 *
 * The RPC refuses if the F&F has not been generated ("approve what, exactly?").
 *
 * **A REJECTION CLEARS `fnf_generated_at` on the header**, which puts the case straight
 * back into the preparer's queue with its clock running — because a rejected F&F is not
 * a state, it is WORK, and it belongs with the person who has to redo it. The numbers and
 * the attached working are KEPT (they are being asked to correct a sheet, not re-key it),
 * and the remark is mandatory.
 *
 * Approving is also the moment the LEAVER becomes able to read their own settlement.
 */
export async function approveFnf(caseId: string, approve: boolean, remarks: string): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_approve_fnf", {
    p_case: caseId,
    p_approve: approve,
    p_remarks: remarks,
  });
  if (error) throw new Error(error.message);
}

export interface PaymentInput {
  /** NEFT | RTGS | Cheque | Cash | … The RPC requires one: "paid, somehow" cannot be traced. */
  paymentMode: string;
  paymentRef: string | null;
  /** A business date, yyyy-mm-dd, straight out of a date input. NEVER `toISOString()`. */
  paidOn: string | null;
  /** ⭐ The employee's own copy — MUST be under `cases/<id>/share/…` (the RPC checks). */
  finalPath?: string | null;
  finalName?: string | null;
}

/**
 * ⭐ Release the F&F payment. The RPC refuses without an approval — money does not leave
 * on an unapproved working — and refuses a paid-on date before the last working day.
 *
 * The final copy goes to `share/`, the ONE prefix the leaver can read. A final F&F filed
 * under `fnf/` would be a settlement they are told about and cannot open, so the RPC
 * validates the prefix rather than trusting the caller to pick the right uploader.
 */
export async function releaseFnfPayment(caseId: string, input: PaymentInput): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_release_fnf_payment", {
    p_case: caseId,
    p: {
      fnf_payment_mode: input.paymentMode,
      fnf_payment_ref: input.paymentRef ?? "",
      fnf_paid_on: input.paidOn ?? "",
      final_fnf_path: input.finalPath ?? "",
      final_fnf_name: input.finalName ?? "",
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/* --------------------------------- closure -------------------------------- */

/**
 * One document, as the panel sends it. `id` names the SEEDED ROW — the list is
 * materialised server-side at LWD confirmation, so the client never invents a document.
 */
export interface DocumentIssueInput {
  id: string;
  /** A business date, yyyy-mm-dd, straight out of a date input. NEVER `toISOString()`. */
  issuedOn: string | null;
  /** ⭐ MUST be under `cases/<id>/share/…` — the RPC refuses any other prefix. */
  filePath?: string | null;
  fileName?: string | null;
  remarks?: string | null;
}

/**
 * ⭐ Issue the exit documents — the letters go OUT.
 *
 * Several at once, because HR issues the experience letter and the relieving letter
 * together, off one screen. The RPC:
 *
 *  • **refuses a document whose snapshotted `requiresFile` is true without a file** —
 *    and **whatever arrives in THIS call counts** (the 20260712190000 rule). The upload
 *    travels in the same payload as `issuedOn`, so a rule that read only the stored row
 *    would reject every first issue that ever happened;
 *  • **refuses any path outside `cases/<id>/share/`** — a relieving letter the leaver
 *    cannot open is not a relieving letter;
 *  • stamps `documents_issued_at` on the header once EVERY document carries an
 *    `issuedOn`, and moves the case into Closure. That is the DATABASE's call, not this
 *    client's — and un-issuing one un-stamps it.
 */
export async function issueDocuments(caseId: string, docs: DocumentIssueInput[]): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_issue_documents", {
    p_case: caseId,
    p: {
      documents: docs.map((d) => ({
        id: d.id,
        issued_on: d.issuedOn ?? "",
        file_path: d.filePath ?? "",
        file_name: d.fileName ?? "",
        // Present-but-empty means "clear it"; ABSENT means "leave it alone" (the RPC
        // reads jsonb_exists). Only send it when the caller actually supplied one.
        ...(d.remarks !== undefined ? { remarks: d.remarks ?? "" } : {}),
      })),
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

export interface AckInput {
  /** A business date, yyyy-mm-dd. NEVER `toISOString()`. */
  handedOverOn: string | null;
  /** ⭐ The copy the employee SIGNED AND RETURNED. `cases/<id>/share/…`. */
  ackPath?: string | null;
  ackName?: string | null;
  remarks?: string | null;
}

/**
 * ⭐⭐ Record the SIGNED ACKNOWLEDGEMENT — the thing coming **BACK**.
 *
 * This is the evidence `archive` depends on, and its absence is the exact failure this
 * phase exists to make visible: *letters issued, acknowledgement never returned*. It is a
 * SEPARATE call from the issue on purpose — issuing and acknowledging are separated by
 * days, a courier and a human being who has to sign something, and folding them into one
 * call is precisely how "we posted it" quietly becomes "they signed it".
 *
 * The RPC refuses an acknowledgement of a letter that was never issued ("signed what?").
 */
export async function recordAck(caseId: string, documentId: string, input: AckInput): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_record_ack", {
    p_case: caseId,
    p_document: documentId,
    p: {
      handed_over_on: input.handedOverOn ?? "",
      ack_signed_path: input.ackPath ?? "",
      ack_signed_name: input.ackName ?? "",
      ...(input.remarks !== undefined ? { remarks: input.remarks ?? "" } : {}),
    } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/**
 * ⭐⭐⭐ ARCHIVE THE CASE. The terminal act — **and it refuses.**
 *
 * Five conditions, every one required, and the refusal NAMES the ones that failed:
 * clearance complete-or-waived · the F&F paid-or-waived · the documents issued-or-waived ·
 * **the signed acknowledgement attached for every document actually issued** · **the
 * leaver's own copy of the final F&F attached** under `share/`.
 *
 * Every step guard is `fms_exit_step_done` — timestamp **OR SKIPPED** — so an absconder
 * (no handover, no relieving letter, no F&F) archives cleanly on waived steps rather than
 * being wedged open forever.
 *
 * On success it stamps `archived_at`, sets `status = 'archived'` and sets
 * `systemStatusChanged` (the sheet's "Status Change in System"), and the case leaves every
 * queue and every count at once — `isOpenCase()` excludes `archived`.
 */
export async function archiveCase(caseId: string, remarks?: string | null): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_archive_case", {
    p_case: caseId,
    p: { remarks: remarks ?? "" } as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

/* ------------------------------- step owners ------------------------------ */

export interface StepOwnerInput {
  departmentIds: string[];
  designationId: string | null;
  employeeIds: string[];
}

/**
 * Upsert the owners for a workflow step (admin-only under RLS).
 *
 * `resignation` is NOT assignable — the DB has a CHECK barring the row, because the
 * PII read gate (fms_exit_is_exit_staff) is "owns any step OTHER than resignation".
 * Every employee may raise their own exit; if that were expressed as step ownership,
 * the gate would be true for the whole company. StepOwnersSection skips it.
 */
export async function setStepOwner(stepKey: string, input: StepOwnerInput): Promise<void> {
  const { error } = await supabase.from("fms_exit_step_owners").upsert(
    {
      step_key: stepKey,
      department_ids: input.departmentIds,
      designation_id: input.designationId,
      employee_ids: input.employeeIds,
    },
    { onConflict: "step_key" },
  );
  if (error) throw new Error(error.message);
}

/* --------------------------------- config --------------------------------- */

/** Upsert a singleton config key (admin-only under RLS). */
export async function setConfig(key: string, value: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from("fms_exit_config")
    .upsert({ key, value: value as unknown as Json }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

/* --------------------------------- masters -------------------------------- */

/** The two plain {name, active, sort} masters. */
export type ExitMasterTable = "fms_exit_reasons" | "fms_exit_asset_types";

export interface MasterInput {
  name: string;
  active: boolean;
  sortOrder: number;
}

export async function insertMaster(table: ExitMasterTable, input: MasterInput): Promise<string> {
  const { data, error } = await supabase
    .from(table)
    .insert({ name: input.name, active: input.active, sort_order: input.sortOrder })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateMaster(table: ExitMasterTable, id: string, input: MasterInput): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ name: input.name, active: input.active, sort_order: input.sortOrder })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* --------------------------- document types master ------------------------ */

export interface DocumentTypeInput extends MasterInput {
  /** A letter with no PDF is a promise, not a document. */
  requiresFile: boolean;
}

export async function insertDocumentType(input: DocumentTypeInput): Promise<string> {
  const { data, error } = await supabase
    .from("fms_exit_document_types")
    .insert({
      name: input.name,
      requires_file: input.requiresFile,
      active: input.active,
      sort_order: input.sortOrder,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updateDocumentType(id: string, input: DocumentTypeInput): Promise<void> {
  const { error } = await supabase
    .from("fms_exit_document_types")
    .update({
      name: input.name,
      requires_file: input.requiresFile,
      active: input.active,
      sort_order: input.sortOrder,
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* ---------------------------- payroll heads master ------------------------ */

export interface PayrollHeadInput extends MasterInput {
  kind: "addition" | "deduction";
}

export async function insertPayrollHead(input: PayrollHeadInput): Promise<string> {
  const { data, error } = await supabase
    .from("fms_exit_payroll_heads")
    .insert({ name: input.name, kind: input.kind, active: input.active, sort_order: input.sortOrder })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updatePayrollHead(id: string, input: PayrollHeadInput): Promise<void> {
  const { error } = await supabase
    .from("fms_exit_payroll_heads")
    .update({ name: input.name, kind: input.kind, active: input.active, sort_order: input.sortOrder })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/* -------------------------- clearance checklist master -------------------- */

export interface ClearanceItemInput {
  key: string;
  name: string;
  departmentLabel: string;
  description: string | null;
  ownerIds: string[];
  ownerIsReportingManager: boolean;
  requiresFile: boolean;
  allowsLink: boolean;
  /** SIGNED working days from the last working day. Negative = BEFORE it, and that
   *  is the normal case. Never routed through resolveStepSla, which rejects it. */
  dueDays: number;
  active: boolean;
  sortOrder: number;
}

const clearanceRow = (i: ClearanceItemInput) => ({
  key: i.key,
  name: i.name,
  department_label: i.departmentLabel,
  description: i.description,
  owner_ids: i.ownerIds,
  owner_is_reporting_manager: i.ownerIsReportingManager,
  requires_file: i.requiresFile,
  allows_link: i.allowsLink,
  due_days: i.dueDays,
  active: i.active,
  sort_order: i.sortOrder,
});

export async function insertClearanceItem(input: ClearanceItemInput): Promise<string> {
  const { data, error } = await supabase
    .from("fms_exit_clearance_items")
    .insert(clearanceRow(input))
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * `satisfied_by_step` is deliberately NOT editable here: it wires a checklist row to
 * a first-class step's completion (auto-tick), which is a code concern, not a
 * data-entry one. The seeded rows carry it; a hand-added row is independent.
 */
export async function updateClearanceItem(id: string, input: ClearanceItemInput): Promise<void> {
  const { error } = await supabase.from("fms_exit_clearance_items").update(clearanceRow(input)).eq("id", id);
  if (error) throw new Error(error.message);
}

/* ============================ MASTER GOVERNANCE (M8) ====================== */

/**
 * Replace the whole owner set for one master type. Delete-then-insert rather than
 * upsert, so removing an owner actually drops their row. Admin-only under RLS
 * (`fms_exit_master_managers_write`) — Master Owners is Setup config, not a master.
 *
 * All FIVE types are ownable here, `clearance_item` included: it is not requestable,
 * but its owner edits it directly on the Masters page.
 */
export async function setMasterManagers(masterType: ExitMasterType, userIds: string[]): Promise<void> {
  const { error: delError } = await supabase
    .from("fms_exit_master_managers")
    .delete()
    .eq("master_type", masterType);
  if (delError) throw new Error(delError.message);

  if (userIds.length === 0) return;
  const { error } = await supabase
    .from("fms_exit_master_managers")
    .insert(userIds.map((id) => ({ master_type: masterType, manager_user_id: id })));
  if (error) throw new Error(error.message);
}

/**
 * Raise a "Request new …" submission. Returns the new request id.
 *
 * ⚠ `requestedBy` MUST BE THE **REAL** SESSION USER ID, never the demo persona.
 *   The insert policy is `requested_by = auth.uid() and status = 'pending'`, and
 *   `auth.uid()` reads the JWT — which in demo mode is still the real signed-in
 *   admin's. Stamp the persona and RLS rejects the insert outright. The store passes
 *   `realUserId` for exactly this reason; HR hit this and it is Trap 10 of the plan.
 *
 * The DB also refuses `clearance_item` here (its CHECK lists only the four
 * requestable types) — the type system says the same thing via
 * REQUESTABLE_EXIT_MASTER_TYPES, so this should be unreachable.
 */
export async function requestNewMaster(
  masterType: ExitMasterType,
  payload: Record<string, unknown>,
  requestedBy: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("fms_exit_master_requests")
    .insert({
      master_type: masterType,
      proposed_payload: payload as unknown as Json,
      requested_by: requestedBy,
      status: "pending",
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

/**
 * Resolve a master request via the SECURITY DEFINER RPC: approve (creating the real
 * master row from the payload — the approver's edits win) or reject (a reason is
 * MANDATORY; the RPC raises without one). Returns the new master id, or null on reject.
 *
 * ⚠ The payload's KEYS are a wire contract with the RPC — see lib/masterFields.ts.
 */
export async function resolveMasterRequest(
  requestId: string,
  approve: boolean,
  payload: Record<string, unknown> | null,
  note: string | null,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("fms_exit_resolve_master_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_payload: (payload ?? null) as unknown as Json,
    p_note: note ?? undefined,
  });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/* --------------------------- activity + bell feed ------------------------- */

/**
 * Write an activity row + fan a notification out to recipients.
 *
 * Best-effort by design: the caller wraps it so a failed announce can never undo a
 * workflow action. It is therefore NEVER the source of truth for state — every step
 * stamps its own timestamp column inside its RPC.
 */
export async function announce(input: {
  entityType: ExitEntityType;
  entityId: string;
  type: string;
  text: string;
  recipients?: string[];
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabase.rpc("fms_exit_announce", {
    p_entity_type: input.entityType,
    p_entity_id: input.entityId,
    p_type: input.type,
    p_text: input.text,
    p_user_ids: input.recipients ?? [],
    p_meta: (input.meta ?? {}) as unknown as Json,
  });
  if (error) throw new Error(error.message);
}

export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase
    .from("fms_exit_notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  if (error) throw new Error(error.message);
}

/* --------------------------------- storage -------------------------------- */

/**
 * Private bucket. Staff-only for every prefix EXCEPT two, both added additively in
 * 20260714130000 (Postgres OR-combines permissive policies; the 4 staff policies from
 * M1 are untouched):
 *
 *   • `cases/<id>/share/…`       — the one place the exiting EMPLOYEE may read their
 *     own letters from (relieving, experience, final F&F, signed ack).
 *   • `cases/<id>/resignation/…` — the raiser may write and read their OWN letter.
 *     Without that, an ordinary employee literally could not attach the letter their
 *     own resignation requires: the staff insert policy excludes them by definition.
 */
const BUCKET = "fms-exit-docs";

const safeName = (name: string) => name.replace(/[^\w.\-]+/g, "_");

async function upload(path: string, file: File): Promise<{ path: string; name: string }> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false, contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return { path, name: file.name };
}

/** A 10-minute signed URL. Nothing in this bucket is ever public. */
export async function exitDocUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}

export const uploadCaseDoc = (caseId: string, kind: string, file: File) =>
  upload(`cases/${caseId}/${kind}/${Date.now()}-${safeName(file.name)}`, file);

/**
 * The resignation letter, uploaded AFTER the case exists.
 *
 * That ordering is forced by the storage policy, and it is the right way round
 * anyway: the path contains the case id, and the policy proves ownership by joining
 * `fms_exit_cases` on it. So the store raises the case, uploads, then patches the
 * path back on with `updateCase`. Uploading first would need a case-less prefix that
 * nobody could be authorised against.
 */
export const uploadResignationLetter = (caseId: string, file: File) =>
  uploadCaseDoc(caseId, "resignation", file);

/**
 * Clearance evidence → `cases/<id>/clearance/<itemKey>/<ts>-<name>`.
 *
 * The path shape is load-bearing: M3 adds a storage policy on exactly this prefix for
 * whoever owns a row on that case. The M1 bucket policies are staff-only, and the IT /
 * Admin / Travel-Desk clearance owners are — by construction — not staff, so without
 * that policy they would be handed a file input that always 403s.
 */
export const uploadClearanceDoc = (caseId: string, itemKey: string, file: File) =>
  upload(`cases/${caseId}/clearance/${itemKey}/${Date.now()}-${safeName(file.name)}`, file);

/**
 * The asset photo and the handover note → `cases/<id>/assets/…` and
 * `cases/<id>/handover/…`.
 *
 * Both prefixes are load-bearing: M4 adds a storage policy on exactly them for the
 * case's REPORTING MANAGERS, who own asset_return and handover per-case and are
 * neither exit staff nor coordinators — the M1 bucket policies would hand them a file
 * input that always 403s.
 */
export const uploadAssetDoc = (caseId: string, file: File) => uploadCaseDoc(caseId, "assets", file);
export const uploadHandoverDoc = (caseId: string, file: File) => uploadCaseDoc(caseId, "handover", file);

/**
 * ⭐ The exit-interview form → `cases/<id>/interview/…`.
 *
 * That prefix is HR-CONFIDENTIAL IN STORAGE, not just in the table. M1's bucket policies
 * are `is_exit_staff ∨ is_coordinator` — which includes the Admin and IT clearance
 * owners — so a narrow *permissive* policy would have restricted nothing (Postgres
 * OR-combines permissive policies; a narrower one can only widen). 20260714160000 adds a
 * **restrictive** policy instead, which AND-combines: everything outside this exact
 * prefix is unaffected, and inside it only `fms_exit_is_hr_confidential ∨
 * fms_exit_is_coordinator` may read, write, overwrite or delete.
 *
 * So an Admin/IT clearance owner attempting this upload — or a signed URL for the file —
 * gets a 403. That is the design, not a bug.
 */
export const uploadInterviewDoc = (caseId: string, file: File) => uploadCaseDoc(caseId, "interview", file);

/**
 * ⭐ The F&F WORKING → `cases/<id>/fnf/…`.
 *
 * That prefix is FINANCE-CONFIDENTIAL IN STORAGE, not just in the table. M1's bucket
 * policies are `is_exit_staff ∨ is_coordinator` — which includes the Admin and IT
 * clearance owners — so a narrow *permissive* policy would have restricted nothing
 * (Postgres OR-combines permissive policies; a narrower one can only widen). 20260714170000
 * adds a **restrictive** policy, which AND-combines: everything outside this exact prefix
 * is unaffected, and inside it only `fms_exit_is_finance_staff ∨ fms_exit_is_coordinator`
 * may read, write, overwrite or delete.
 *
 * So an Admin/IT clearance owner attempting this upload — or a signed URL for the file —
 * gets a 403, and the reporting manager (who is not exit staff at all) never gets near it.
 * That is the design, not a bug. `fms_exit_generate_fnf` also VALIDATES the path prefix,
 * so a working uploaded anywhere else is refused outright.
 */
export const uploadFnfDoc = (caseId: string, file: File) => uploadCaseDoc(caseId, "fnf", file);

/**
 * ⭐ The EMPLOYEE'S OWN COPY of the final F&F → `cases/<id>/share/…`.
 *
 * **A DIFFERENT PREFIX FROM THE WORKING, ON PURPOSE.** `share/` is the one prefix M2's
 * policy lets the exiting employee read — it is where their relieving letter, experience
 * letter and this statement live. The `fnf/` working, above, they may never open.
 *
 * The leaver IS ENTITLED TO THEIR STATEMENT. Filing the final copy under `fnf/` would be
 * a settlement they are told about and cannot open, so `fms_exit_release_fnf_payment`
 * refuses any path that is not under this prefix. (Phase 7's archive then refuses to close
 * the case without it.)
 */
export const uploadFinalFnfDoc = (caseId: string, file: File) => uploadCaseDoc(caseId, "share", file);

/**
 * ⭐⭐ THE EXIT DOCUMENTS AND THEIR SIGNED ACKNOWLEDGEMENTS → `cases/<id>/share/…`.
 *
 * The relieving letter, the experience letter, the F&F statement, the NOC — and the copy
 * the employee signs and hands back. **The same prefix as the final F&F copy, and for the
 * same reason: it is the ONE prefix M2's policy lets the leaver read.** A relieving letter
 * filed anywhere else is a relieving letter the person does not have — which is the entire
 * failure this phase exists to prevent — so `fms_exit_issue_documents` and
 * `fms_exit_record_ack` both VALIDATE the prefix rather than trusting the caller to pick
 * the right uploader.
 *
 * No new storage policy was needed for the WRITE: the `documents` step's owner is exit
 * staff, and M1's four bucket policies already cover them for every prefix. M5's and M6's
 * restrictive policies test `foldername[3] = 'interview'` / `= 'fnf'`, so a `share/` object
 * passes both untouched.
 */
export const uploadShareDoc = (caseId: string, file: File) => uploadCaseDoc(caseId, "share", file);
