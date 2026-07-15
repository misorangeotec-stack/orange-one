import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The 16 canonical HR Exit steps (code-defined, 1-based display index).
 * `key` is the stable identifier used by fms_exit_step_owners, the SLA config and
 * the queue logic.
 *
 * One scope — an exit case is one entity from resignation to archive, so there is
 * no cross-scope anchor walk (Recruitment needs one; this does not).
 *
 * Reconciled from the source workflow's 17 steps against the operational sheet's
 * 11 stages:
 *   • "Exit checklist auto-generated" is NOT a step — it is a system action inside
 *     fms_exit_confirm_lwd(). A step no human can complete is a queue row owed by
 *     nobody, forever.
 *   • KT and Handover are MERGED (`handover`): same owner, same deadline, same
 *     evidence. KT survives as kt_done / kt_remarks on the handover row.
 *   • `documents` and `archive` stay SPLIT: different TAT, different evidence (the
 *     signed acknowledgement coming BACK), and merging them hides the commonest
 *     failure — letters issued, ack never returned.
 *
 * Statuses are NOT step keys. on_hold / withdrawn / rejected / archived live in
 * CaseStatus (types/index.ts): a status in the work queue flows silently into the
 * KPI tiles and the cross-FMS scoreboard as "work owed by Nobody".
 */
export type StepKey =
  /** noQueue: raising it IS the event. Exists only as the anchor step 2 points at. */
  | "resignation"
  | "manager_review"
  | "hr_verification"
  | "hr_head_approval"
  | "lwd_confirm"
  | "clearance"
  | "asset_return"
  | "handover"
  | "exit_interview"
  | "leave_verification"
  | "payroll_inputs"
  | "fnf_generate"
  | "fnf_approve"
  | "fnf_payment"
  | "documents"
  | "archive";

/** One scope — no cross-scope anchor walk. */
export type StepScope = "exit";

export type StepDef = StepDefBase<StepKey, StepScope>;

/**
 * `index` is display + sort only — nothing persists it (the DB stores step KEYS as
 * free text). What IS load-bearing is the ARRAY POSITION: `createStepSlaModel`
 * derives a step's default anchor from the step before it and offers only strictly
 * earlier steps as anchor options, which makes an anchor cycle impossible by
 * construction. The order below is a legal topological order — verify that still
 * holds against sla.ts's OVERRIDES before moving anything here.
 *
 * `noQueue` marks a step that structurally never holds a work-item, so consumers
 * can tell "this step cannot hold work" apart from "this step happens to be empty".
 */
export const STEPS: StepDef[] = [
  { key: "resignation",        index: 1,  title: "Resignation Raised",           short: "Resignation",   scope: "exit", noQueue: true },
  { key: "manager_review",     index: 2,  title: "Reporting Manager Review",     short: "Manager",       scope: "exit" },
  { key: "hr_verification",    index: 3,  title: "HR Verification",              short: "HR Verify",     scope: "exit" },
  { key: "hr_head_approval",   index: 4,  title: "HR Head Approval",             short: "HR Approval",   scope: "exit" },
  { key: "lwd_confirm",        index: 5,  title: "Confirm Last Working Day",     short: "Confirm LWD",   scope: "exit" },
  { key: "clearance",          index: 6,  title: "Departmental Clearance",       short: "Clearance",     scope: "exit" },
  { key: "asset_return",       index: 7,  title: "Asset Return",                 short: "Assets",        scope: "exit" },
  { key: "handover",           index: 8,  title: "Handover & Knowledge Transfer", short: "Handover",     scope: "exit" },
  { key: "exit_interview",     index: 9,  title: "Exit Interview",               short: "Interview",     scope: "exit" },
  { key: "leave_verification", index: 10, title: "Leave Balance Verification",   short: "Leave",         scope: "exit" },
  { key: "payroll_inputs",     index: 11, title: "Payroll Inputs",               short: "Payroll",       scope: "exit" },
  { key: "fnf_generate",       index: 12, title: "Generate Full & Final",        short: "F&F Prepare",   scope: "exit" },
  { key: "fnf_approve",        index: 13, title: "Approve Full & Final",         short: "F&F Approve",   scope: "exit" },
  { key: "fnf_payment",        index: 14, title: "Full & Final Payment",         short: "F&F Payment",   scope: "exit" },
  { key: "documents",          index: 15, title: "Issue Exit Documents",         short: "Documents",     scope: "exit" },
  { key: "archive",            index: 16, title: "Acknowledge & Archive",        short: "Archive",       scope: "exit" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * The four stages an exit really is. Lives here, not in a page, because two screens
 * read it: the Exit Control Center strip and the Exit row on the cross-FMS
 * scoreboard. One list, so the two cannot describe the same workflow differently.
 *
 * `resignation` is absent on purpose: it is `noQueue`, so it never holds work.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Approval", keys: ["manager_review", "hr_verification", "hr_head_approval"] },
  { label: "Exit & Clearance", keys: ["lwd_confirm", "clearance", "asset_return", "handover", "exit_interview"] },
  { label: "Settlement", keys: ["leave_verification", "payroll_inputs", "fnf_generate", "fnf_approve", "fnf_payment"] },
  { label: "Closure", keys: ["documents", "archive"] },
];

/**
 * Steps routed to the case's OWN reporting_manager_ids, not the global step-owner
 * table — the same reason HR Recruitment routes to hiring_manager_ids: "the
 * department's HOD" is not a portal concept (there is no departments.hod_id).
 *
 * ⚠ MIRRORS fms_exit_can_act() IN SQL (Phase 2) — CHANGE ONE, CHANGE THE OTHER.
 *
 * Manager access here is ADDITIVE, not exclusive. fms_hr_can_act() early-returns
 * for HOD steps, which makes them unreachable when the manager list is empty. Here
 * it is *manager OR the step's configured owners*: asset_return needs an HOD sign
 * AND an HR sign, handover needs both confirmations — and a manager who never
 * responds must not be able to wedge the case.
 */
export const MANAGER_STEPS: StepKey[] = ["manager_review", "asset_return", "handover"];

export const isManagerStep = (key: StepKey): boolean => MANAGER_STEPS.includes(key);

/**
 * The five steps whose owners may read THE MONEY — the settlement satellite.
 *
 * ⚠ MIRRORS `fms_exit_is_finance_staff()` IN SQL (M1) — CHANGE ONE, CHANGE THE OTHER.
 *
 * ⚠ THIS IS NOT "exit staff", AND SUBSTITUTING IT WOULD BE THE WHOLE BUG. The IT person
 *   owns `clearance` and the Admin owns `asset_return`; both are exit staff, both read
 *   the case header quite happily, and neither may see a rupee of a settlement. Neither
 *   may the reporting manager — a manager has no business reading a subordinate's notice
 *   recovery or loan balance. The employee themselves reads their own, and only once it
 *   has been APPROVED (see `store.canReadSettlement`).
 */
export const SETTLEMENT_STEPS: StepKey[] = [
  "leave_verification",
  "payroll_inputs",
  "fnf_generate",
  "fnf_approve",
  "fnf_payment",
];
