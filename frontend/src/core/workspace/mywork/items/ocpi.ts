/**
 * OCPI → work items. See ./README.md.
 *
 * A deal sits at exactly one queue step (`STATUS_STEP`), so it appears once.
 *
 * Ownership is `ocpiStepOwnerIds` (apps/ocpi/lib/owners.ts) — the step's owners,
 * plus the deal's own raiser on the two steps the database lets them act on
 * (customer sign-off, finance handover). That helper is what the monthly ranking
 * already uses, so the home screen and the ranking agree on whose a deal is.
 * Admins see every deal, as "team".
 *
 * ⚠ COORDINATORS ARE NOT GIVEN EVERY REQUEST. A coordinator CAN act on anything,
 *   but that is a power, not an assignment — the same line every other file here
 *   draws. Listing the whole book for them would fill their Overdue tile and their
 *   morning mail with work nobody gave them. Admins alone see it, as "team".
 *
 * Two rules added on top, both copied from the app's own panels:
 *   - a raiser is not shown their OWN quotation to approve unless they are the
 *     only approver (ApprovalPanel's `blockedBySelf`) — they cannot act on it;
 *   - a deal sent back for REWORK sits with its raiser. The app has no queue for
 *     it (the raiser finds it under My Deals), so it would otherwise be nobody's
 *     visible work. ⚠ A returned quotation goes back to status `draft` with
 *     `rework_at` stamped (fms_ocpi_decide_quotation) — there is no `rework`
 *     status on a live deal, so that is what this looks for.
 */
import { appName } from "@/apps/appInfo";
import type { OcpiData } from "@/apps/ocpi/data/ocpiFetch";
import { buildQueueEntries, dealRef, dueIsoFor, type QueueStep } from "@/apps/ocpi/lib/queues";
import { ocpiStepOwnerIds } from "@/apps/ocpi/lib/owners";
import { resolveStepSla } from "@/apps/ocpi/lib/sla";
import { stepByKey } from "@/apps/ocpi/lib/steps";
import { STATUS_STEP, type OcpiDeal } from "@/apps/ocpi/types";
import type { WorkItem } from "../types";

const SOURCE = "ocpi";
const dealHref = (id: string) => `/ocpi/deals/${id}`;

export function ocpiWorkItems(data: OcpiData, uid: string, isAdmin: boolean, canEdit = true): WorkItem[] {
  if (!canEdit) return [];
  const stepSla = resolveStepSla(data.stepSla);
  const byId = new Map(data.deals.map((d) => [d.id, d]));
  const approvers = data.stepOwners.find((o) => o.stepKey === "quotation_approval")?.employeeIds ?? [];
  const soleApprover = approvers.length === 1 && approvers[0] === uid;

  const mine = (step: QueueStep, d: OcpiDeal): boolean => {
    if (step === "quotation_approval" && d.raisedBy === uid && !soleApprover) return false;
    return ocpiStepOwnerIds(d, step, data.stepOwners, () => true).includes(uid);
  };

  const live = buildQueueEntries(data.deals, stepSla).map((e) => ({ step: e.stepKey, dealId: e.dealId, ref: e.ref, dueIso: e.dueIso, held: false }));
  const held = data.deals
    .filter((d) => d.status === "on_hold" && d.holdFromStatus)
    .flatMap((d) => {
      const step = STATUS_STEP[d.holdFromStatus as keyof typeof STATUS_STEP];
      if (!step || step === "quotation") return [];
      const s = step as QueueStep;
      return [{ step: s, dealId: d.id, ref: dealRef(d), dueIso: dueIsoFor(d, s, stepSla), held: true }];
    });

  const queued: WorkItem[] = [...live, ...held]
    .filter(({ step, dealId }) => {
      const d = byId.get(dealId);
      return !!d && (isAdmin || mine(step, d));
    })
    .map(({ step, dealId, ref, dueIso, held: isHeld }) => {
      const d = byId.get(dealId)!;
      return {
        id: `${SOURCE}:${dealId}:${step}`,
        source: SOURCE,
        sourceLabel: appName(SOURCE),
        ref,
        detail: d.customerName ?? undefined,
        stage: stepByKey(step)?.short,
        dueIso,
        to: dealHref(dealId),
        assignment: mine(step, d) ? ("direct" as const) : ("team" as const),
        isApproval: step === "quotation_approval" || step === "oc_approval",
        ...(isHeld ? { isHeld: true, holdReason: d.holdReason ?? null } : {}),
      };
    });

  const rework: WorkItem[] = data.deals
    .filter((d) => d.status === "draft" && !!d.reworkAt && d.raisedBy === uid)
    .map((d) => ({
      id: `${SOURCE}:${d.id}:rework`,
      source: SOURCE,
      sourceLabel: appName(SOURCE),
      ref: dealRef(d),
      detail: d.customerName ?? undefined,
      stage: "Rework",
      dueIso: null,
      to: `${dealHref(d.id)}/edit`,
      assignment: "direct" as const,
      isApproval: false,
    }));

  return [...queued, ...rework];
}
