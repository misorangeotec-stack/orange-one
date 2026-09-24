/**
 * Purchase RM Domestic → work items. See ./README.md.
 *
 * `buildQueueEntries` deliberately does NOT filter by owner — a coordinator's
 * Control Center must count everyone's work — so the owner rule is applied here.
 * It lives in `procurement/lib/owners.ts` precisely so this can apply it without
 * mounting the procurement store.
 *
 * Purchase overrides the `approval` step with a VALUE-BAND matrix, which is why it
 * keeps its own resolver rather than using the shared step-owner helper.
 *
 * ── HOLD HERE IS PER LINE, NOT PER REQUEST ───────────────────────────────────
 * Unlike the modules where `on_hold` is a top-level status that empties every
 * queue, a Purchase request stays parked ON the `approval` step while its
 * individual lines go `on_hold`. `buildQueueEntries` therefore keeps returning it,
 * and before `isHeld` existed that is exactly why a request an approver had
 * deliberately held kept counting as overdue on the home screen and in the 9am
 * mail. The ranking already knew better and dropped it as `held`; the screen did
 * not, and the two disagreed about the same request.
 *
 * EVERY line under decision must be held for the STEP to be held. One line still
 * awaiting a decision means the approver genuinely still owes that request today,
 * so a partially-held request stays live and stays due.
 */
import { appName } from "@/apps/appInfo";
import type { ProcurementData } from "@/apps/procurement/data/procFetch";
import { buildProcIndex, buildQueueEntries, lineInApproval, linesOf } from "@/apps/procurement/lib/queues";
import { stepByKey } from "@/apps/procurement/lib/steps";
import { ownerResolver } from "@/apps/procurement/lib/owners";
import { linkResolver } from "@/apps/procurement/lib/links";
import type { WorkItem } from "../types";

export function purchaseWorkItems(data: ProcurementData, uid: string, isAdmin: boolean): WorkItem[] {
  const owners = ownerResolver(data);
  const linkOf = linkResolver(data.requestItems);
  const idx = buildProcIndex(data);

  /** Held only when the approval step has lines under decision and ALL are on hold. */
  const heldLines = (stepKey: string, entityId: string) => {
    if (stepKey !== "approval") return null;
    const underDecision = linesOf(idx, entityId).filter(lineInApproval);
    if (underDecision.length === 0) return null;
    return underDecision.every((l) => l.status === "on_hold") ? underDecision : null;
  };

  return buildQueueEntries(data)
    // An admin owns no workflow steps, so a personal filter would show them an
    // empty screen. They see the whole book instead — matching the Control Center.
    .filter((e) => isAdmin || owners.isMine(e, uid))
    .map((e) => ({
      id: `purchase:${e.entityId}:${e.stepKey}`,
      source: "purchase",
      sourceLabel: appName("procurement"),
      ref: e.ref,
      stage: stepByKey(e.stepKey)?.short,
      dueIso: e.dueIso,
      to: linkOf(e),
      assignment: owners.isMine(e, uid) ? ("direct" as const) : ("team" as const),
      isApproval: e.stepKey === "approval",
      ...holdFieldsOf(heldLines(e.stepKey, e.entityId)),
    }));
}

/**
 * The hold flag, when every line under decision is on hold.
 *
 * NO REASON IS AVAILABLE HERE, and that is a property of the schema rather than an
 * omission: `fms_purchase_hold_line` only sets `status = 'on_hold'` on the line
 * (migration 20260630140000) — the text the approver typed goes to the activity
 * trail, which this rule does not load and must not, since it also runs inside the
 * 9am mail. So the row says how many lines are parked instead, which is true and
 * costs nothing. If a `hold_reason` column is ever added to the line, return it here.
 */
function holdFieldsOf(held: unknown[] | null): Pick<WorkItem, "isHeld" | "holdReason"> {
  if (!held) return {};
  return { isHeld: true, holdReason: held.length > 1 ? `${held.length} lines on hold` : null };
}
