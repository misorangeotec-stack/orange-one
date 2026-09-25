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
 *   customer_signoff, finance_handover
 *                `fms_ocpi_record_customer_sign` / `…_finance_handover` also let the
 *                deal's OWN RAISER act, with an edit grant — the salesperson files
 *                their customer's signed copy and hands their contract to Finance.
 *
 * Pure. The caller supplies `canEdit`, because the grants are not part of the deal
 * data (`module_can_edit` = an `edit` grant on ocpi, or an admin).
 */
import type { OcpiDeal, OcpiStepOwner } from "../types";
import type { QueueStep } from "./queues";

/** Steps the deal's own raiser may act on. Also what the store's queue gate reads. */
export const RAISER_STEPS: QueueStep[] = ["customer_signoff", "finance_handover"];

export function ocpiStepOwnerIds(
  deal: OcpiDeal,
  step: QueueStep,
  stepOwners: OcpiStepOwner[],
  canEdit: (uid: string) => boolean,
): string[] {
  const ids = new Set(stepOwners.find((o) => o.stepKey === step)?.employeeIds ?? []);
  if (RAISER_STEPS.includes(step) && deal.raisedBy) ids.add(deal.raisedBy);
  return [...ids].filter(canEdit);
}
