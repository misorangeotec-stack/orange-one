/**
 * The single source of truth for HR Exit **queue membership** and **due dates**.
 *
 * Everything here is pure: it takes an `ExitSnapshot` and returns plain data. In
 * particular it knows nothing about the signed-in user, so it never owner-filters —
 * `store.myQueue` narrows a step's queue to what you may action, but a coordinator's
 * Control Center must count *all* of it. Callers that want owner scoping compose
 * their own `.filter(...)` on top.
 *
 * ── WHY THIS CLONES **PROCUREMENT**, NOT HR RECRUITMENT ────────────────────────
 *
 * HR Recruitment's aggregator emits exactly ONE entry per entity (an `if / else if`
 * chain). That model cannot describe an exit case, because an exit case is
 * legitimately owed at SEVERAL STEPS AT ONCE: between the confirmed last working day
 * and the F&F it owes clearance AND asset return AND handover AND the exit interview
 * AND leave verification AND payroll inputs — simultaneously, to six different
 * people. Purchase already emits N-per-entity (no `break`), so its shape is the one
 * this follows.
 *
 * A "queue entry" is therefore a **(step, entity) work-item**, not an entity. THE
 * SUM OF THE PER-STEP COUNTS CAN LEGITIMATELY EXCEED THE OPEN-CASE COUNT — that is
 * correct and intended (Purchase documents the same), and it is the number a process
 * coordinator actually wants: units of step-work due. It also means:
 *
 *   • the Dashboard's "open exits" KPI must count DISTINCT CASES, never entries;
 *   • every table rendering mixed steps needs the composite row key
 *     `${stepKey}:${entityId}:${checkId ?? ""}` — `entityId` alone is not unique.
 */
import { todayLocalIso } from "@/shared/lib/dueBuckets";
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import { addWorkingDaysSigned, dueIsoFrom, localDateIso, type StepSlaMap } from "./sla";
import { TRIGGER_STEPS } from "./sla";
import type { StepKey } from "./steps";
import type { ClearanceCheck, ExitCase, ExitPolicy, StepOwner, StepSkip } from "../types";

/**
 * Everything the queue needs to answer "what is owed, and when".
 *
 * Every field is REQUIRED on purpose. This object is assembled by `store.tsx` AND by
 * the cross-FMS scoreboard's adapter (Phase 8); if a field were optional, the adapter
 * could quietly omit it and the two would compute *different due dates from the same
 * data*, with nothing to catch it. Required means the compiler catches it.
 *
 * Better still: both build it through {@link exitSnapshotFrom}, so there is exactly
 * ONE place. Never hand-write this literal a second time — two hand-written literals
 * is precisely how HR's interview and onboarding clocks drifted.
 */
export interface ExitSnapshot {
  cases: ExitCase[];
  skips: StepSkip[];
  clearanceChecks: ClearanceCheck[];
  stepSla: StepSlaMap;
  /** Day of the month payroll closes — `payroll_inputs` is due on it. */
  payrollCutoffDay: number;
  /**
   * The owners of the `clearance` STEP — the fallback for a checklist row whose own
   * `ownerIds` is empty. Without it such a row would be OWED BY NOBODY: it would
   * appear in no one's queue and quietly hold the exit open forever.
   */
  clearanceStepOwnerIds: string[];
}

/** THE ONE snapshot builder. See the note on {@link ExitSnapshot}. */
export function exitSnapshotFrom(data: {
  cases: ExitCase[];
  skips: StepSkip[];
  clearanceChecks: ClearanceCheck[];
  stepOwners: StepOwner[];
  config: { stepSla: StepSlaMap; policy: ExitPolicy };
}): ExitSnapshot {
  return {
    cases: data.cases,
    skips: data.skips,
    clearanceChecks: data.clearanceChecks,
    stepSla: data.config.stepSla,
    payrollCutoffDay: data.config.policy.payrollCutoffDay,
    clearanceStepOwnerIds:
      data.stepOwners.find((o) => o.stepKey === "clearance")?.employeeIds ?? [],
  };
}

/**
 * WHO OWES THIS ROW — the whole reason a clearance check is its own queue entry.
 *
 * Three sources, in order:
 *   1. `ownerIsReportingManager` → the CASE'S OWN managers (it routes per case, like
 *      a MANAGER step — "the department's HOD" is not a portal concept);
 *   2. its snapshotted `ownerIds` — the IT / Admin / Travel-Desk people, who own no
 *      workflow step at all;
 *   3. nothing set → the `clearance` STEP's owners, so no row is ever owed by nobody.
 *
 * Mirrors fms_exit_can_tick_clearance() in SQL. Change one, change the other.
 */
export function checkOwnerIds(snap: ExitSnapshot, c: ExitCase, check: ClearanceCheck): string[] {
  if (check.ownerIsReportingManager) return c.reportingManagerIds;
  if (check.ownerIds.length) return check.ownerIds;
  return snap.clearanceStepOwnerIds;
}

/**
 * HR Exit's queue atom. Extends the shared shape (everything the Control Center
 * reads) with what the exit screens need.
 *
 * `checkId` / `ownerIds` are set ONLY on clearance rows. They exist because a
 * clearance row is owned by a DIFFERENT PERSON PER ROW — the IT person owns no
 * workflow step at all — which HR's per-entity `myQueue` predicate simply cannot
 * express. `store.myQueue` reads `ownerIds` when it is present, and falls back to
 * `canActOn(step, case)` when it is not.
 */
export interface QueueEntry extends QueueEntryBase<StepKey> {
  entityType: "exit" | "clearance_check";
  /** The group-by dimension (Purchase groups by company; the HR apps by department). */
  departmentId: string | null;
  caseId: string;
  /** Clearance rows only. */
  checkId?: string;
  /** Clearance rows only — WHO owes THIS SPECIFIC ROW. */
  ownerIds?: string[];
}

/* -------------------------------------------------------------------------- */
/*  Primitives                                                                */
/* -------------------------------------------------------------------------- */

const NO_SKIPS: ReadonlySet<StepKey> = new Set<StepKey>();

/** Local midnight from a yyyy-mm-dd. NEVER `new Date(iso)` — that parses as UTC. */
const dateFromIso = (iso: string): Date | null => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Still someone's work.
 *
 * `on_hold` is in this list deliberately. A held case LEAVES EVERY QUEUE — it gets
 * its own strip with a days-parked count, and never a red one. A status loose in the
 * work queue flows silently into the KPI tiles and the cross-FMS scoreboard as "work
 * owed by Nobody".
 */
export const isOpenCase = (c: ExitCase): boolean =>
  c.status !== "withdrawn" && c.status !== "rejected" && c.status !== "archived" && c.status !== "on_hold";

/** Every step this case has SKIPPED, as a set. */
export const skippedStepsOf = (skips: StepSkip[], caseId: string): ReadonlySet<StepKey> =>
  new Set(skips.filter((s) => s.caseId === caseId).map((s) => s.stepKey as StepKey));

/**
 * When `step` completed for this case, or `null` if it hasn't.
 *
 * Reads the case's own timestamp columns, stamped inside the RPC that performed the
 * step — NEVER the activity trail, which is best-effort (a failed `announce` is
 * swallowed), so inferring completion from it would silently lose a step.
 *
 * `lwd_confirm` is the one step with no timestamp column of its own: the confirmed
 * `lwd` DATE *is* its completion, and that is the only fact anything downstream
 * needs. Nothing anchors on it through the generic path either — every LWD-anchored
 * step is a TRIGGER_STEP with its own case in {@link exitDueIso} — so returning the
 * date here is safe as well as honest.
 */
export function exitStepCompletedIso(c: ExitCase, step: StepKey): string | null {
  switch (step) {
    case "resignation":
      return c.submittedAt;
    case "manager_review":
      return c.managerReviewedAt;
    case "hr_verification":
      return c.hrVerifiedAt;
    case "hr_head_approval":
      return c.approvedAt;
    case "lwd_confirm":
      return c.lwd;
    case "clearance":
      return c.clearanceCompletedAt;
    case "asset_return":
      return c.assetsReturnedAt;
    case "handover":
      return c.handoverCompletedAt;
    case "exit_interview":
      return c.interviewDoneAt;
    case "leave_verification":
      return c.leaveVerifiedAt;
    case "payroll_inputs":
      return c.payrollDoneAt;
    case "fnf_generate":
      return c.fnfGeneratedAt;
    case "fnf_approve":
      return c.fnfApprovedAt;
    case "fnf_payment":
      return c.fnfPaidAt;
    case "documents":
      return c.documentsIssuedAt;
    case "archive":
      return c.archivedAt;
    default:
      return null;
  }
}

/**
 * Is this step behind us?
 *
 * **Timestamp OR skipped.** A skipped step is complete-with-a-reason: it satisfies
 * every downstream guard, exactly as a completed one does. Every gate below reads
 * THIS, never the raw timestamp — which is what lets one generic mechanism cover an
 * absconder with no handover and a termination with no relieving letter.
 */
export function stepDone(c: ExitCase, step: StepKey, skipped: ReadonlySet<StepKey> = NO_SKIPS): boolean {
  return exitStepCompletedIso(c, step) !== null || skipped.has(step);
}

/* -------------------------------------------------------------------------- */
/*  The open-step rule — the shape of the whole workflow                      */
/* -------------------------------------------------------------------------- */

/**
 * Every step this case currently owes.
 *
 * Three regimes, in order:
 *
 *  1. **The approval prefix is SEQUENTIAL.** One step at a time, because each one's
 *     output is the next one's input (the manager's recommendation, then HR's notice
 *     calculation, then the Head's approval, then the confirmed LWD).
 *
 *  2. **Then everything goes PARALLEL.** Once the last working day exists, six
 *     different people owe six different things and none of them waits on another.
 *     Modelling this as a chain is what would make the app useless: the IT person
 *     would be told to sit on their hands until the exit interview happened.
 *
 *  3. **The F&F chain is sequential again, and it is gated on its INPUTS — leave
 *     verification and payroll inputs — NOT on clearance.** You cannot compute a
 *     settlement without the leave balance and the deductions; you very much can
 *     compute it while IT is still waiting for the laptop back.
 */
export function openSteps(
  c: ExitCase,
  checks: ClearanceCheck[],
  skipped: ReadonlySet<StepKey> = NO_SKIPS,
): StepKey[] {
  if (!isOpenCase(c)) return []; // withdrawn | rejected | archived | on_hold
  const done = (k: StepKey) => stepDone(c, k, skipped);

  // ---- 1. the sequential approval prefix ----
  if (!done("manager_review")) return ["manager_review"];
  if (!done("hr_verification")) return ["hr_verification"];
  if (!done("hr_head_approval")) return ["hr_head_approval"];
  if (!c.lwd) return ["lwd_confirm"];

  const out: StepKey[] = [];

  // ---- 2. the PARALLEL block: all live at once ----
  if (!done("clearance")) out.push("clearance"); // expanded per-check in buildQueueEntries
  if (!done("asset_return")) out.push("asset_return");
  if (!done("handover")) out.push("handover");
  if (!done("exit_interview")) out.push("exit_interview");
  if (!done("leave_verification")) out.push("leave_verification");
  if (!done("payroll_inputs")) out.push("payroll_inputs");

  // ---- 3. F&F: sequential, gated on its INPUTS ----
  const inputsReady = done("leave_verification") && done("payroll_inputs");
  if (inputsReady && !done("fnf_generate")) out.push("fnf_generate");
  if (done("fnf_generate") && !done("fnf_approve")) out.push("fnf_approve");
  if (done("fnf_approve") && !done("fnf_payment")) out.push("fnf_payment");
  // Letters issue once the settlement is SETTLED, not once the bank has moved —
  // transfers lag, and the leaver needs their relieving letter to start elsewhere.
  if (done("fnf_approve") && !done("documents")) out.push("documents");
  if (done("documents") && !done("archive")) out.push("archive");

  // `clearance` is listed here as ONE step; buildQueueEntries expands it into one
  // entry per OUTSTANDING CHECK. Whether the step is owed at all is decided by
  // `clearance_completed_at` — which the DATABASE stamps once every row is done or
  // not-applicable — never by counting boxes here.
  void checks;
  return out;
}

/* -------------------------------------------------------------------------- */
/*  Due dates                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The payroll cut-off that a leaver's final payroll must make.
 *
 * "Before payroll cut-off" is a MONTHLY CALENDAR EVENT, not an offset from another
 * step — so it gets its own function rather than an SLA rule. It is the cut-off day
 * of the month the LWD falls in; if that day has already passed relative to the LWD,
 * it rolls to next month's, because **you cannot key someone's final payroll before
 * their last day**.
 *
 * `graceDays` is the step's configured `days` (Setup → Due Dates), always ≥ 0, added
 * on top in working days. It defaults to 0 — the cut-off itself.
 */
export function payrollCutoffIso(lwdIso: string, cutoffDay: number, graceDays = 0): string | null {
  const lwd = dateFromIso(lwdIso);
  if (!lwd) return null;

  const wanted = Math.min(31, Math.max(1, Math.floor(cutoffDay) || 25));
  /** The cut-off in month `m` of year `y`, clamped to that month's length (Feb 31 → 28). */
  const cutOf = (y: number, m: number): Date => {
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(wanted, last));
  };

  let cut = cutOf(lwd.getFullYear(), lwd.getMonth());
  if (cut < lwd) cut = cutOf(lwd.getFullYear(), lwd.getMonth() + 1);

  return localDateIso(addWorkingDaysSigned(cut, Math.max(0, graceDays)));
}

/** Is this row still owed? Done OR not-applicable ⇒ SETTLED, and it leaves the queue. */
export const isCheckOutstanding = (k: ClearanceCheck): boolean => !k.done && !k.notApplicable;

/**
 * Due date for ONE clearance checklist row.
 *
 * The item's SIGNED offset from the last working day. **NEGATIVE IS THE NORMAL
 * CASE** — a clearance item is due BEFORE the person walks out, because you cannot
 * chase a laptop afterwards.
 *
 * ⚠ IT MUST BE `addWorkingDaysSigned`. `addWorkingDays` clamps `n` to `max(0, n)`,
 * so a −1 would silently return the LWD ITSELF and the entire "before the last
 * working day" design would evaporate with no error anywhere.
 *
 * Items are NOT workflow steps, so `dueDays` is a plain master column and must never
 * pass through `resolveStepSla` — which rejects a negative and silently substitutes
 * the step's default.
 *
 * `null` while the LWD is unset: the list is locked until it exists, so it cannot be
 * late.
 */
export function checkDueIso(c: ExitCase, check: ClearanceCheck): string | null {
  if (!c.lwd) return null;
  const lwd = dateFromIso(c.lwd);
  if (!lwd) return null;
  return localDateIso(addWorkingDaysSigned(lwd, check.dueDays));
}

/**
 * Due date for the `clearance` STEP — the earliest thing it still owes.
 *
 * Mirrors the hard-won shape of HR's `onboardingDueIso`:
 *   • no LWD                → `null`. Nothing can be late before the date it hangs off exists.
 *   • something outstanding → the EARLIEST of those rows. That is what the step owes.
 *   • all settled           → the LATEST row's date, so a finished list still reports
 *                             honestly rather than losing its date.
 *
 * ⚠ **THE EMPTY-CHECKLIST HOLE.** A case seeded at a moment when every master item
 * happened to be inactive gets ZERO rows — and `fms_exit_try_complete_clearance`
 * deliberately refuses to auto-complete an empty list (that would mark eight
 * departments cleared that never were). So the step is PERMANENTLY STUCK. Returning
 * `null` here would make it **vanish from every overdue count and every scoreboard
 * while being permanently stuck** — invisible and broken is the worst possible pair.
 * Dating it on **the LWD** makes it go red instead, and someone comes looking. That
 * is the entire job. This exact hole bit HR.
 */
export function clearanceDueIso(snap: ExitSnapshot, c: ExitCase): string | null {
  if (!c.lwd) return null;

  const checks = snap.clearanceChecks.filter((k) => k.caseId === c.id);
  const dueOf = (k: ClearanceCheck) => checkDueIso(c, k);

  const outstanding = checks
    .filter(isCheckOutstanding)
    .map(dueOf)
    .filter((d): d is string => !!d)
    .sort();
  if (outstanding.length) return outstanding[0]; // the earliest thing still owed

  const all = checks
    .map(dueOf)
    .filter((d): d is string => !!d)
    .sort();
  // Empty checklist → the LWD itself. See the header.
  return all.length ? all[all.length - 1] : c.lwd;
}

/**
 * A case's due date for one step.
 *
 * ⚠ **EVERY `TRIGGER_STEPS` ENTRY HAS ITS OWN CASE HERE.** One that fell through to
 * the generic `dueIsoFrom(anchor)` path would be **BORN OVERDUE**: a 60-day-notice
 * resignation goes red on day 2 and stays red for two months, so the whole board
 * bleeds and tells you nothing. This is exactly how HR's onboarding clock and
 * `mrf_resubmit` were wrong. If you add a trigger step, add its case here too.
 *
 * The LWD-anchored steps return `null` while `lwd` is unset — **they cannot be late
 * before the date they hang off even exists**. The direction (`before: true`) lives
 * in code and only the magnitude is configurable, because a negative `days` in config
 * does not mean "before": `resolveStepSla` silently substitutes the step's default.
 */
export function exitDueIso(snap: ExitSnapshot, c: ExitCase, step: StepKey): string | null {
  const sla = snap.stepSla[step];
  if (!sla) return null;

  const trigger = TRIGGER_STEPS[step];
  if (trigger) {
    if (step === "clearance") return clearanceDueIso(snap, c);
    if (!c.lwd) return null; // the event has not happened — nothing can be late yet
    if (step === "payroll_inputs") return payrollCutoffIso(c.lwd, snap.payrollCutoffDay, sla.days);

    const lwd = dateFromIso(c.lwd);
    if (!lwd) return null;
    // asset_return / handover / exit_interview / leave_verification → BEFORE the LWD.
    // fnf_generate → AFTER it. The magnitude is the configured `days` (always ≥ 0).
    const offset = trigger.before ? -Math.abs(sla.days) : Math.abs(sla.days);
    return localDateIso(addWorkingDaysSigned(lwd, offset));
  }

  // The ordinary rule: the anchor step's completion + N working days. Falls back to
  // the case's own submission so a row never silently loses its due date.
  const from = exitStepCompletedIso(c, sla.anchor) ?? c.submittedAt;
  return dueIsoFrom(from, sla);
}

/** Whole days from today until the last working day (negative once it has passed). */
export function daysToLwd(c: ExitCase, today: string = todayLocalIso()): number | null {
  if (!c.lwd) return null;
  const lwd = dateFromIso(c.lwd);
  const now = dateFromIso(today);
  if (!lwd || !now) return null;
  return Math.round((lwd.getTime() - now.getTime()) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/*  The aggregator                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Every open work-item across the whole HR Exit FMS, one per **(step, case)** — and,
 * from Phase 3, one per **(clearance step, outstanding check)**.
 *
 * Cloned from `procurement/lib/queues.ts`: no `break`, no `else if`. A case that owes
 * clearance and assets and handover emits three entries, and that is the point.
 */
export function buildQueueEntries(snap: ExitSnapshot): QueueEntry[] {
  const out: QueueEntry[] = [];

  // Index once — scanning the flat arrays per case turns this into an O(n²) walk.
  const skipsByCase = new Map<string, Set<StepKey>>();
  for (const s of snap.skips) {
    const set = skipsByCase.get(s.caseId) ?? new Set<StepKey>();
    set.add(s.stepKey as StepKey);
    skipsByCase.set(s.caseId, set);
  }
  const checksByCase = new Map<string, ClearanceCheck[]>();
  for (const k of snap.clearanceChecks) {
    const list = checksByCase.get(k.caseId) ?? [];
    list.push(k);
    checksByCase.set(k.caseId, list);
  }

  for (const c of snap.cases) {
    if (!isOpenCase(c)) continue;
    const skipped = skipsByCase.get(c.id) ?? NO_SKIPS;
    const checks = checksByCase.get(c.id) ?? [];

    for (const step of openSteps(c, checks, skipped)) {
      /**
       * ⭐ `clearance` expands to ONE ENTRY PER OUTSTANDING CHECK — each carrying its
       * own `checkId`, its own `ownerIds` and ITS OWN due date.
       *
       * That is what lets the IT person — who owns no workflow step at all — see
       * exactly their row and nothing else (`store.myQueue` reads `ownerIds` when it
       * is present). A case with 3 outstanding checks therefore contributes **3**
       * entries, and the clearance count legitimately exceeds the open-case count.
       * That is correct and intended; Purchase documents the same.
       */
      if (step === "clearance") {
        const outstanding = checks.filter(isCheckOutstanding).sort((a, b) => a.sortOrder - b.sortOrder);

        // ZERO outstanding rows but the step is still open = THE EMPTY-CHECKLIST HOLE
        // (every master item was inactive when this case was seeded, so it can never
        // self-complete). Emit ONE plain entry — no `ownerIds`, so `myQueue` falls back
        // to `canActOn`, which is the clearance step's owner and the coordinators. It is
        // dated on the LWD and goes red, rather than vanishing from every count while
        // being permanently stuck.
        if (outstanding.length === 0) {
          out.push({
            stepKey: step,
            entityType: "exit",
            entityId: c.id,
            ref: c.exitNo,
            dueIso: clearanceDueIso(snap, c),
            departmentId: c.departmentId,
            caseId: c.id,
          });
          continue;
        }

        for (const k of outstanding) {
          out.push({
            stepKey: step,
            entityType: "clearance_check",
            entityId: c.id,
            // Names the case AND the item — a queue row that just said "EXIT-2627-0004"
            // three times over would tell its owner nothing.
            ref: `${c.exitNo} — ${k.name}`,
            dueIso: checkDueIso(c, k), // THIS ROW'S date, not the step's
            departmentId: c.departmentId,
            caseId: c.id,
            checkId: k.id,
            ownerIds: checkOwnerIds(snap, c, k),
          });
        }
        continue;
      }

      out.push({
        stepKey: step,
        entityType: "exit",
        entityId: c.id,
        ref: c.exitNo,
        dueIso: exitDueIso(snap, c, step),
        departmentId: c.departmentId,
        caseId: c.id,
      });
    }
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/*  The STAGE VIEW — "what I did here", editable until the next step is done   */
/* -------------------------------------------------------------------------- */

/**
 * One completed work-item, for the Completed tab. Every HR-Exit step is
 * case-scoped, so `row` is always the case — a page that needs satellite content
 * (the settlement figures, the interview) looks it up by `caseId` in its own
 * cell renderer, so this stays a plain function of the wide-read header.
 *
 * `id` is composite (`${stepKey}:${caseId}`) because a Completed tab concatenates
 * several steps' entries and the case id alone is not unique across them.
 */
export interface StageEntry<T> {
  id: string;
  stepKey: StepKey;
  caseId: string;
  ref: string;
  departmentId: string | null;
  /** Who did the step. Null = not recorded (an old row, before attribution). */
  actorId: string | null;
  /** When the step completed. */
  atIso: string;
  /** When it was last corrected, if ever. */
  editedAtIso: string | null;
  editedById: string | null;
  /** Null ⇒ the entry may still be corrected; otherwise WHY it cannot be. */
  lockReason: string | null;
  row: T;
}

/**
 * Every lock reason below mirrors its server guard (the raises added in
 * 20260720120000). The DATABASE is the gate; these exist so the button can grey
 * and SAY WHY, written to the same shape so a drift is easy to spot.
 *
 * All are pure functions of the wide-read header. `on_hold` locks everything, and
 * that is MECHANICAL: `fms_exit_resume_status` derives where a held case resumes
 * from the very timestamps an edit touches, so editing under hold could move where
 * it comes back to. Resume first, then edit.
 */
export function heldTerminalBar(c: ExitCase, what: string): string | null {
  if (c.status === "on_hold") return `This case is on hold — take it off hold before editing its ${what}.`;
  if (c.status === "withdrawn" || c.status === "rejected" || c.status === "archived") {
    return `This case was ${c.status} — its ${what} can no longer be changed.`;
  }
  return null;
}

export const managerReviewLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "manager review") ??
  (c.hrVerifiedAt ? "HR has verified this case — the manager review can no longer be changed." : null);

export const hrVerifyLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "HR verification") ??
  (c.approvedAt ? "The HR Head has approved this case — the verification can no longer be changed." : null);

export const headApprovalLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "approval") ??
  (c.lwd ? "The last working day is confirmed and the clearance is seeded — the approval can no longer be re-opened." : null);

export const lwdLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "last working day") ??
  (c.leaveVerifiedAt || c.payrollDoneAt
    ? "The leave / payroll has been recorded against this last working day — correct those first."
    : null);

/** Feeds no calculation; editable (reopen the checklist) until the case is terminal. */
export const clearanceLockReason = (c: ExitCase): string | null => heldTerminalBar(c, "clearance");

/** Signed off — a signature cannot be invalidated under the signer. Always view-only. */
export const assetReturnLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "asset return") ?? "The asset return is signed off — it is a record now, not editable.";

/** Confirmed by HR — view-only, same reason as the asset return. */
export const handoverLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "handover") ?? "The handover is confirmed — it is a record now, not editable.";

/** Feeds no calculation; editable (re-record) until the case is terminal. */
export const interviewLockReason = (c: ExitCase): string | null => heldTerminalBar(c, "exit interview");

export const leaveLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "leave verification") ??
  (c.fnfGeneratedAt ? "The F&F has been generated from this leave balance — send it back first to correct it." : null);

export const payrollLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "payroll inputs") ??
  (c.fnfGeneratedAt ? "The F&F has been generated from these payroll inputs — send it back first to correct them." : null);

export const fnfGenerateLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "F&F") ??
  (c.fnfApprovedAt ? "The F&F has been approved — send it back first to regenerate it." : null);

export const fnfApproveLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "F&F approval") ??
  (c.fnfPaidAt ? "The F&F has been paid — its approval can no longer be changed." : null);

/** Editable (correct the UTR / mode) until the case is terminal. */
export const fnfPaymentLockReason = (c: ExitCase): string | null => heldTerminalBar(c, "F&F payment");

export const documentsLockReason = (c: ExitCase): string | null =>
  heldTerminalBar(c, "exit documents") ??
  (c.archivedAt ? "The case is archived — the documents can no longer be changed." : null);

/** The terminal act. Always a record, never editable. */
export const archiveLockReason = (_c: ExitCase): string | null => "The case is archived — this is the final record.";

/** Build a case-scoped Completed entry. `row` is the case; `atIso` its completion. */
export function exitEntryOf(
  stepKey: StepKey,
  c: ExitCase,
  actorId: string | null,
  atIso: string,
  lockReason: string | null,
): StageEntry<ExitCase> {
  return {
    id: `${stepKey}:${c.id}`,
    stepKey,
    caseId: c.id,
    ref: c.exitNo,
    departmentId: c.departmentId,
    actorId,
    atIso,
    editedAtIso: c.editedAt,
    editedById: c.editedBy,
    lockReason,
    row: c,
  };
}
