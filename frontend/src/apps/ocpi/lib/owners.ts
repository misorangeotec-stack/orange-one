/**
 * Who a deal's open step belongs to — the OCPI answer to "whose work is this?".
 *
 * OCPI has no My Work Today rule and its queue pages list every entry, so until the
 * monthly ranking (CC-1) nothing needed this as a list of people. It mirrors the
 * database's own authority for each step, read off the live functions on
 * 18-09-2026, minus the coordinator arm — a coordinator CAN act on anything, but
 * is not the person a step was given to (the same line every `items/` rule draws):
 *
 *   every step   `fms_ocpi_can_act` → the step's owners, with an edit grant
 *   quotation_approval
 *                the deal's approval-location list when it has anyone, else
 *                the step's owners (`quotationApproverIds`)
 *   customer_signoff, finance_handover
 *                `fms_ocpi_record_customer_sign` / `…_finance_handover` also let the
 *                deal's OWN RAISER act, with an edit grant — the salesperson files
 *                their customer's signed copy and hands their contract to Finance.
 *
 * Pure. The caller supplies `canEdit`, because the grants are not part of the deal
 * data (`module_can_edit` = an `edit` grant on ocpi, or an admin).
 */
import type { OcpiApprovalLocation, OcpiDeal, OcpiStepOwner } from "../types";
import type { QueueStep } from "./queues";

/** Steps the deal's own raiser may act on. Also what the store's queue gate reads. */
export const RAISER_STEPS: QueueStep[] = ["customer_signoff", "finance_handover"];

/**
 * Who approves THIS quotation — mirrors `fms_ocpi_quotation_approver_ids`.
 *
 * The deal's approval location (Surat / Noida) wins when that location has
 * anyone named; otherwise, and for a deal with no location, the ordinary
 * Approve Quotation owners. A location list REPLACES the general list for its
 * deals, it does not add to it.
 */
export function quotationApproverIds(
  deal: Pick<OcpiDeal, "approvalLocation">,
  stepOwners: OcpiStepOwner[],
  approvalLocations: OcpiApprovalLocation[] = [],
): string[] {
  const loc = deal.approvalLocation
    ? approvalLocations.find((l) => l.name === deal.approvalLocation && l.active)
    : undefined;
  if (loc && loc.employeeIds.length > 0) return loc.employeeIds;
  return stepOwners.find((o) => o.stepKey === "quotation_approval")?.employeeIds ?? [];
}

export function ocpiStepOwnerIds(
  deal: OcpiDeal,
  step: QueueStep,
  stepOwners: OcpiStepOwner[],
  canEdit: (uid: string) => boolean,
  approvalLocations: OcpiApprovalLocation[] = [],
): string[] {
  const ids = new Set(
    step === "quotation_approval"
      ? quotationApproverIds(deal, stepOwners, approvalLocations)
      : stepOwners.find((o) => o.stepKey === step)?.employeeIds ?? [],
  );
  if (RAISER_STEPS.includes(step) && deal.raisedBy) ids.add(deal.raisedBy);
  return [...ids].filter(canEdit);
}
