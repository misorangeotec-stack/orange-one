import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The OCPI steps (code-defined, 1-based display index). `key` is the stable
 * identifier used by fms_ocpi_step_owners, the SLA config and the queue logic.
 *
 * A LINEAR chain that does NOT repeat:
 *   quotation → quotation_approval → order_confirmation → oc_approval
 *     → customer_signoff → management_signoff → closed
 *
 * `quotation` is the origin (drafting and revising the quotation) and holds no
 * queue; every other step owns one. Queue membership reads `status`, so a held /
 * closed / cancelled deal leaves every queue.
 *
 * ⚠ THE TWO APPROVAL GATES ARE ORDINARY STEPS, and that is the whole approval
 *   mechanism. Whoever is listed on `quotation_approval` in Settings → Step
 *   Owners approves the quotation; whoever is on `oc_approval` confirms the
 *   order confirmation. There is no second approval subsystem, per the decision
 *   to follow Order to Dispatch rather than invent one. If value bands are ever
 *   wanted, fms_purchase_approval_matrix is the shape to copy — and Customer
 *   Onboarding's rule applies: freeze the threshold in force onto the approved
 *   row so changing the rule cannot rewrite history.
 *
 * ⚠ THE REVISION LOOP IS NOT A STEP. A salesperson may regenerate the quotation
 *   any number of times while the deal sits at `quotation`; each generation
 *   mints an immutable row in fms_ocpi_quotation_versions. Modelling revisions
 *   as a step would put the same deal in a queue once per negotiation round and
 *   make "how many quotations are waiting?" unanswerable.
 *
 * ⚠ Statuses are NOT step keys — closed / on_hold / cancelled / rework live in
 *   OcpiStatus (types/index.ts), never here.
 *
 * ⚠ The ARRAY ORDER is semantic — `createStepSlaModel` derives each step's
 *   default anchor from the position of the one before it. Renumbering `index`
 *   is cosmetic; reordering this array is not.
 */
export type StepKey =
  | "quotation"
  | "quotation_approval"
  | "order_confirmation"
  | "oc_approval"
  | "customer_signoff"
  | "management_signoff";

/** One scope — a deal is one entity from first draft to countersigned OC. */
export type StepScope = "deal";

export type StepDef = StepDefBase<StepKey, StepScope>;

export const STEPS: StepDef[] = [
  { key: "quotation",          index: 1, title: "Quotation",                 short: "Quotation", scope: "deal", noQueue: true },
  { key: "quotation_approval", index: 2, title: "Approve Quotation",         short: "Qtn Appr",  scope: "deal" },
  { key: "order_confirmation", index: 3, title: "Order Confirmation",          short: "OC",      scope: "deal" },
  { key: "oc_approval",        index: 4, title: "Approve Order Confirmation", short: "OC Appr",  scope: "deal" },
  { key: "customer_signoff",   index: 5, title: "Customer Signature",        short: "Cust Sign", scope: "deal" },
  { key: "management_signoff", index: 6, title: "Management Signature",      short: "Mgmt Sign", scope: "deal" },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/**
 * Coarse bands for the cross-FMS scoreboard, where six rows is more detail than
 * a director reading ten modules wants. Every queue step appears in exactly one.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Quotation", keys: ["quotation_approval"] },
  { label: "Confirmation", keys: ["order_confirmation", "oc_approval"] },
  { label: "Signatures", keys: ["customer_signoff", "management_signoff"] },
];

/**
 * Step keys an admin may assign owners to — every step including the origin.
 *
 * Following Order to Dispatch, `quotation` MAY be owned: with no owners on it,
 * any user holding an edit grant may raise a deal; set owners and only they
 * (plus admins and coordinators) may. The database says the same thing in
 * fms_ocpi_can_act, which is the boundary — this list only drives the Settings
 * screen.
 */
export const OWNER_STEPS: StepKey[] = STEPS.map((s) => s.key);
