/**
 * The 9 canonical Import Purchase FMS workflow steps (code-defined, 1-based
 * display index). step_key is the stable identifier used by fms_import_step_owners
 * and the stage logic. Stages 1–3 act on the request/item-line; 4–9 on the PO.
 *
 * Import differs from domestic in two ways: there is NO Sourcing step (vendors +
 * pricing are fixed in masters, so a request goes straight from Request to
 * Approval), and the payment step is a simple 100%-advance "Payment". The DB
 * step_key stays `advance_payment` (refresh_po emits that stage) — only its
 * display title changes to "Payment". `sourcing` is kept in the union so the
 * shared queue/SLA plumbing type-checks, but it is absent from STEPS, so no
 * Sourcing queue, nav entry, or stepper node is ever shown, and no line reaches
 * `sourcing` status (submit_request enters lines directly at `approval`).
 *
 * The flow ends at `tally`. Settling the vendor's balance is an accounts activity,
 * not a work-item to chase in a queue — balance payments stay *recordable* on
 * PoDetail, but no step tracks them.
 */
import type { StepDefBase } from "@/shared/lib/fmsQueue";

export type StepKey =
  | "request"
  | "sourcing"
  | "approval"
  | "po"
  | "share_po"
  | "collect_pi"
  | "advance_payment"
  | "follow_up"
  | "inward"
  | "tally";

/** Import's instance of the shared step shape (see `@/shared/lib/fmsQueue`). */
export type StepDef = StepDefBase<StepKey, "request" | "po">;

export const STEPS: StepDef[] = [
  { key: "request", index: 1, title: "Generate Order (Request)", short: "Request", scope: "request", noQueue: true },
  { key: "approval", index: 2, title: "Purchase Approval", short: "Approval", scope: "request" },
  { key: "po", index: 3, title: "Generate PO", short: "PO", scope: "request" },
  { key: "share_po", index: 4, title: "Share PO", short: "Share PO", scope: "po" },
  { key: "collect_pi", index: 5, title: "Collect PI(s)", short: "Collect PI", scope: "po" },
  { key: "advance_payment", index: 6, title: "Payment (100% Advance)", short: "Payment", scope: "po" },
  { key: "follow_up", index: 7, title: "Follow-up", short: "Follow-up", scope: "po" },
  { key: "inward", index: 8, title: "Inward (GRN)", short: "Inward", scope: "po" },
  { key: "tally", index: 9, title: "System Entry (Tally)", short: "Tally", scope: "po" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);
