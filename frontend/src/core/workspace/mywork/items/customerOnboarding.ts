/**
 * New Customer Onboarding → work items. See ./README.md.
 *
 * A request sits at exactly one open step (`openStep`), so it appears once.
 *
 * Ownership mirrors the store's `canActOn` (lib/customerOnboarding/store.tsx) and
 * SQL `fms_customer_can_act`:
 *   - `submission` (a request bounced back for rework) is the RAISER's — no step
 *     owner configuration covers it;
 *   - every other step is its step owners';
 *   - admins see every request, as "team".
 *
 * ⚠ COORDINATORS ARE NOT GIVEN EVERY REQUEST. A coordinator CAN act on anything,
 *   but that is a power, not an assignment — the same line every other file here
 *   draws. Listing the whole book for them would fill their Overdue tile and their
 *   morning mail with work nobody gave them. Admins alone see it, as "team".
 *
 * Held requests (`on_hold`) leave every queue in the app, but are returned here,
 * flagged, at the step they were parked on (`currentStep`, which hold does not
 * touch) — see ./officeSupplies.ts for why parked work is listed rather than dropped.
 */
import { appName } from "@/apps/appInfo";
import type { CustomerSnapshot } from "@hub/data/customerOnboarding/customerFetch";
import { buildQueueEntries } from "@hub/lib/customerOnboarding/queues";
import { OWNED_STEPS, stepShort, type StepKey } from "@hub/lib/customerOnboarding/steps";
import { detailHref } from "@hub/lib/customerOnboarding/routes";
import type { CustomerRequest } from "@hub/lib/customerOnboarding/types";
import { isMineByStepOwners, type StepOwnerRow } from "@/shared/lib/fmsOwners";
import type { WorkItem } from "../types";

const SOURCE = "customer-onboarding";
const APPROVAL_STEPS = new Set<string>(["accounts_verification", "sales_head_approval", "director_approval"]);

export function customerOnboardingWorkItems(
  data: CustomerSnapshot,
  uid: string,
  isAdmin: boolean,
  /** The edit grant. A view-only holder can act on nothing — the DB refuses it. */
  canEdit = true,
): WorkItem[] {
  if (!canEdit) return [];
  const owners = data.stepOwners as StepOwnerRow[];

  const mine = (step: string, r: CustomerRequest): boolean =>
    step === "submission" ? r.raisedBy === uid : isMineByStepOwners(step, uid, owners);

  const live = buildQueueEntries(data.requests, data.stepSla).map((e) => ({
    step: e.stepKey as string,
    r: e.request,
    ref: e.ref,
    dueIso: e.dueIso,
    held: false,
  }));

  const held = data.requests
    .filter((r) => r.status === "on_hold")
    .map((r) => {
      const step = (OWNED_STEPS as string[]).includes(r.currentStep) ? (r.currentStep as StepKey) : "submission";
      return { step: step as string, r, ref: r.reqNo ?? r.legalName ?? "(unnumbered)", dueIso: null, held: true };
    });

  return [...live, ...held]
    .filter(({ step, r }) => isAdmin || mine(step, r))
    .map(({ step, r, ref, dueIso, held: isHeld }) => ({
      id: `${SOURCE}:${r.id}:${step}`,
      source: SOURCE,
      sourceLabel: appName(SOURCE),
      ref,
      // The customer's name, when the reference is the request number.
      detail: r.reqNo && r.legalName ? r.legalName : undefined,
      stage: stepShort(step),
      dueIso,
      to: detailHref(r.id),
      assignment: mine(step, r) ? ("direct" as const) : ("team" as const),
      isApproval: APPROVAL_STEPS.has(step),
      ...(isHeld ? { isHeld: true, holdReason: r.holdReason ?? null } : {}),
    }));
}
