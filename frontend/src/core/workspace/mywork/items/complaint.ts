/**
 * Complaint (RM/FG) → work items. See ./README.md.
 *
 * A complaint sits at exactly one open step (`openStep`), so it appears once.
 *
 * Ownership mirrors the store's `canActOn` (apps/complaint/store.tsx) and SQL
 * `fms_complaint_can_act`: the step's owners, plus ONE per-request arm — the
 * person management assigned an RM-import complaint to (`rmAssigneeId`) owns its
 * `assignee` step. Admins see every complaint, as "team". A step owner limited
 * to some companies (Setup → Step Owners → Companies) gets only those companies'
 * complaints and compensations — the record's company goes to isMineByStepOwners.
 *
 * ⚠ COORDINATORS ARE NOT GIVEN EVERY REQUEST. A coordinator CAN act on anything,
 *   but that is a power, not an assignment — the same line every other file here
 *   draws. Listing the whole book for them would fill their Overdue tile and their
 *   morning mail with work nobody gave them. Admins alone see it, as "team".
 *
 * ⚠ THE ROW OPENS THE STEP'S QUEUE, NOT THE COMPLAINT. Complaint's detail page is
 *   read-only by design — acting on a step happens in that step's queue (its
 *   StepModal). Opening the detail page from here would hand the reader a page
 *   with nothing to press.
 */
import { appName } from "@/apps/appInfo";
import type { ComplaintData } from "@/apps/complaint/data/complaintFetch";
import { buildQueueEntries, complaintDueIso, complaintSnapshotFrom, openStep } from "@/apps/complaint/lib/queues";
import { MANAGEMENT_STEPS, stepByKey } from "@/apps/complaint/lib/steps";
import { creditNotesHref, queueHref, type QueueSlug } from "@/apps/complaint/lib/routes";
import type { ComplaintRequest } from "@/apps/complaint/types";
import { isMineByStepOwners, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "../types";

const SOURCE = "complaint";

export function complaintWorkItems(data: ComplaintData, uid: string, isAdmin: boolean, canEdit = true): WorkItem[] {
  if (!canEdit) return [];
  const owners = data.stepOwners as StepOwnerRow[];
  const byId = new Map(data.requests.map((r) => [r.id, r]));
  const snap = complaintSnapshotFrom({ requests: data.requests, stepSla: data.config.stepSla });

  const mine = (step: string, r: ComplaintRequest | undefined): boolean =>
    isMineByStepOwners(step, uid, owners, r?.companyId) || (step === "assignee" && !!r && r.rmAssigneeId === uid);

  const live = buildQueueEntries(snap).map((e) => ({ e, held: false }));
  // A held complaint resumes at the step its pre-hold status maps to.
  const held = data.requests
    .filter((r) => r.status === "on_hold" && r.holdFromStatus)
    .flatMap((r) => {
      const step = openStep({ ...r, status: r.holdFromStatus! });
      if (!step) return [];
      return [{
        e: { stepKey: step, requestId: r.id, ref: r.complaintNo, dueIso: complaintDueIso(snap, r, step) },
        held: true,
      }];
    });

  // CUSTOMER CREDIT NOTES — their own table and two Setup steps. Same owner
  // rule (isMineByStepOwners), admins see the rest as "team". No SLA is
  // configured for them, so no due date.
  const cnItems: WorkItem[] = (data.creditNotes ?? []).flatMap((c) => {
    const step =
      c.status === "awaiting_cn_approval" ? "cn_approval" : c.status === "awaiting_cn_tally" ? "cn_tally" : null;
    if (!step) return [];
    const isMine = isMineByStepOwners(step, uid, owners, c.companyId);
    if (!isAdmin && !isMine) return [];
    return [{
      id: `${SOURCE}:cn:${c.id}:${step}`,
      source: SOURCE,
      sourceLabel: appName(SOURCE),
      ref: c.cnNo,
      detail: c.partyName,
      stage: step === "cn_approval" ? "Compensation approval" : "Compensation — Tally entry",
      dueIso: null,
      // Approvals sit on the Management Approval page with every other one.
      to: step === "cn_approval" ? queueHref("approval") : creditNotesHref({ open: c.id }),
      assignment: isMine ? ("direct" as const) : ("team" as const),
      isApproval: step === "cn_approval",
    }];
  });

  const complaintItems: WorkItem[] = [...live, ...held]
    .filter(({ e }) => isAdmin || mine(e.stepKey, byId.get(e.requestId)))
    .map(({ e, held: isHeld }) => {
      const r = byId.get(e.requestId);
      const step = stepByKey(e.stepKey);
      return {
        id: `${SOURCE}:${e.requestId}:${e.stepKey}`,
        source: SOURCE,
        sourceLabel: appName(SOURCE),
        ref: e.ref,
        detail: r?.partyName ?? undefined,
        // Two steps are both "Review" in short form — the title tells them apart.
        stage: e.stepKey === "rm_management" || e.stepKey === "management_review" ? step?.title : step?.short,
        dueIso: e.dueIso,
        // Management's three steps share ONE page — Management Approval.
        to: queueHref(
          (MANAGEMENT_STEPS.includes(e.stepKey) ? "approval" : e.stepKey.replace(/_/g, "-")) as QueueSlug,
        ),
        assignment: mine(e.stepKey, r) ? ("direct" as const) : ("team" as const),
        isApproval: e.stepKey === "approval",
        ...(isHeld ? { isHeld: true, holdReason: r?.holdReason ?? null } : {}),
      };
    });
  return complaintItems.concat(cnItems);
}
