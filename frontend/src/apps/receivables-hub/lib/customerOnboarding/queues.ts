/**
 * Customer Creation FMS — pure queue logic.
 *
 * ⚠ COMPLETION IS STATUS-DRIVEN, NEVER INFERRED. `openStep` is a switch on
 *   `status` and nothing else; the RPC that completes a step is what sets the
 *   next status. Reading completion out of the activity trail (or out of which
 *   timestamps happen to be filled) is how these modules rot — announce() is
 *   best-effort and its errors are swallowed.
 */
import type { QueueEntryBase } from "@/shared/lib/fmsQueue";
import type { CustomerRequest, CustomerStatus } from "./types";
import type { StepKey } from "./steps";
import { dueIsoFrom } from "./sla";
import type { StepSlaMap } from "./sla";

export interface CustomerQueueEntry extends QueueEntryBase<StepKey> {
  request: CustomerRequest;
}

/**
 * The one step this request currently owes, or null if it owes nothing.
 *
 * `rework` returns `submission`: a bounced request genuinely sits with the
 * raiser and must show up in a queue, or reworked customers go quietly missing.
 * `draft` returns null — an unsubmitted form is not work owed to the business.
 */
export function openStep(r: CustomerRequest): StepKey | null {
  switch (r.status) {
    case "pending_accounts":    return "accounts_verification";
    case "pending_sales_head":  return "sales_head_approval";
    case "pending_director":    return "director_approval";
    case "pending_tally":       return "tally_creation";
    case "rework":              return "submission";
    // draft / completed / rejected / cancelled / on_hold owe nobody anything.
    // on_hold is deliberate: a held request must vanish from the queue, or it
    // accrues overdue days while nobody is allowed to act on it.
    default:                    return null;
  }
}

export const isOpen = (r: CustomerRequest): boolean => openStep(r) !== null;

/** Terminal states — no further transition without an admin reopen. */
export const isTerminal = (s: CustomerStatus): boolean =>
  s === "completed" || s === "rejected" || s === "cancelled";

/**
 * When the open step is due. Anchored on the completion of the PREVIOUS step, so
 * a request that has only just arrived at a step is never born overdue.
 */
export function customerDueIso(r: CustomerRequest, slaMap: StepSlaMap): string | null {
  const step = openStep(r);
  if (!step) return null;
  const sla = slaMap[step];
  if (!sla) return null;

  const from =
    step === "accounts_verification" ? r.submittedAt
    : step === "sales_head_approval" ? r.accVerifiedAt
    : step === "director_approval"   ? r.shDecidedAt
    : step === "tally_creation"      ? (r.dirDecidedAt ?? r.shDecidedAt)
    // A rework restarts the raiser's clock from the moment it bounced.
    : step === "submission"          ? r.reworkAt
    : null;

  return dueIsoFrom(from, sla);
}

/** One open work-item per open request. */
export function buildQueueEntries(
  requests: CustomerRequest[],
  slaMap: StepSlaMap,
): CustomerQueueEntry[] {
  const out: CustomerQueueEntry[] = [];
  for (const r of requests) {
    const step = openStep(r);
    if (!step) continue;
    out.push({
      stepKey: step,
      entityId: r.id,
      ref: r.reqNo ?? r.legalName ?? "(unnumbered)",
      dueIso: customerDueIso(r, slaMap),
      request: r,
    });
  }
  return out;
}

/**
 * Requests whose given step is DONE — the Completed tab of each queue.
 * Driven by the step's own authoritative timestamp, which is the history.
 */
export function completedFor(requests: CustomerRequest[], step: StepKey): CustomerRequest[] {
  const stamped = (r: CustomerRequest): string | null =>
    step === "accounts_verification" ? r.accVerifiedAt
    : step === "sales_head_approval" ? r.shDecidedAt
    : step === "director_approval"   ? r.dirDecidedAt
    : step === "tally_creation"      ? r.tallyAt
    : r.submittedAt;
  return requests
    .filter((r) => stamped(r) !== null)
    .sort((a, b) => (stamped(b) ?? "").localeCompare(stamped(a) ?? ""));
}

/* ── Edit locks ────────────────────────────────────────────────────────────
 * Each returns a human reason why a stage can no longer be corrected, or null
 * when it can. These MIRROR the server predicates; the server is the gate and
 * these exist only so the UI can grey a button and SAY WHY.
 * ------------------------------------------------------------------------ */

/** The sales form: editable in rework, or with Accounts while they've stamped nothing. */
export function formLockReason(r: CustomerRequest): string | null {
  if (r.status === "draft") return null;
  if (r.status === "rework") return null;
  if (r.status !== "pending_accounts") {
    return `This request has moved past sales (${statusNoun(r.status)}) and can no longer be edited.`;
  }
  if (r.accVerifiedAt) return "Accounts have already recorded their verification.";
  return null;
}

export function accountsLockReason(r: CustomerRequest): string | null {
  if (!r.accVerifiedAt) return "Accounts have not verified this request yet.";
  if (r.shDecidedAt) return "The sales head has already decided on this request.";
  if (isTerminal(r.status)) return `This request is ${statusNoun(r.status)}.`;
  return null;
}

export function salesHeadLockReason(r: CustomerRequest): string | null {
  if (!r.shDecidedAt) return "The sales head has not decided on this request yet.";
  if (r.dirDecidedAt) return "The director has already decided on this request.";
  if (r.tallyAt) return "The Tally ledger has already been recorded.";
  if (isTerminal(r.status)) return `This request is ${statusNoun(r.status)}.`;
  return null;
}

export function directorLockReason(r: CustomerRequest): string | null {
  if (!r.dirDecidedAt) return "The director has not decided on this request yet.";
  if (r.tallyAt) return "The Tally ledger has already been recorded.";
  if (isTerminal(r.status)) return `This request is ${statusNoun(r.status)}.`;
  return null;
}

/**
 * The one step that stays correctable after it is done — nothing downstream in
 * this module consumes it, and a mistyped customer code is exactly what someone
 * spots a week later. Mirrors fms_customer_tally_editable().
 */
export function tallyLockReason(r: CustomerRequest): string | null {
  if (!r.tallyAt) return "The Tally ledger has not been recorded yet.";
  if (r.status !== "completed") return `This request is ${statusNoun(r.status)}.`;
  return null;
}

/** The stage whose record a given step owns, for the Completed-tab edit action. */
export function stageLockReason(step: StepKey, r: CustomerRequest): string | null {
  switch (step) {
    case "accounts_verification": return accountsLockReason(r);
    case "sales_head_approval":   return salesHeadLockReason(r);
    case "director_approval":     return directorLockReason(r);
    case "tally_creation":        return tallyLockReason(r);
    case "submission":            return formLockReason(r);
  }
}

function statusNoun(s: CustomerStatus): string {
  switch (s) {
    case "completed": return "completed";
    case "rejected":  return "rejected";
    case "cancelled": return "cancelled";
    case "on_hold":   return "on hold";
    default:          return s.replace(/_/g, " ");
  }
}
