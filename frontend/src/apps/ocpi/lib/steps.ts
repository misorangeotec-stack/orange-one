import type { StepDefBase } from "@/shared/lib/fmsQueue";

/**
 * The OCPI steps (code-defined, 1-based display index). `key` is the stable
 * identifier used by fms_ocpi_step_owners, the SLA config and the queue logic.
 *
 * A LINEAR chain that does NOT repeat:
 *   quotation → quotation_approval → customer_signoff → management_signoff
 *     → finance_handover → finance_receipt → closed
 *
 * `quotation` is the origin (drafting and revising the quotation) and holds no
 * queue; every other live step owns one. Queue membership reads `status`, so a
 * held / closed / cancelled deal leaves every queue.
 *
 * ⚠ TWO STEPS ARE RETIRED AND STILL HERE (revision stage F). `order_confirmation`
 *   and `oc_approval` were the second form and the second approval gate. The
 *   client asked for ONE act: both papers are now issued together, and the
 *   Directors' approval of the quotation IS the issue of the order confirmation
 *   — number minted, both sheets re-headed and frozen — so there is nothing left
 *   for a separate order-confirmation step to ask.
 *
 *   They are marked `retired` rather than deleted, because deals raised before
 *   the cutover are still sitting at them. A retired step:
 *     · keeps its STATUS_STEP entry, so a parked deal is still counted, still
 *       shows on the Control Center, and is never silently invisible;
 *     · keeps its place on the rail — but only for a deal that actually went
 *       that way (see OcpiStepper), so a new deal is not shown two steps it will
 *       never visit;
 *     · is NOT offered a queue in the sidebar, and is NOT ownable in Settings;
 *     · keeps its RPCs in the database, so a historical row keeps its meaning.
 *   Nothing new ever reaches one.
 *
 * ⚠ THE TWO APPROVAL GATES ARE ORDINARY STEPS — now one gate, `quotation_approval`,
 *   which is the Directors'. Whoever is listed on it in Settings → Step Owners
 *   approves, and approving issues the contract. There is no second approval
 *   subsystem, per the decision to follow Order to Dispatch rather than invent
 *   one. If value bands are ever wanted, fms_purchase_approval_matrix is the
 *   shape to copy — and Customer Onboarding's rule applies: freeze the threshold
 *   in force onto the approved row so changing the rule cannot rewrite history.
 *
 * ⚠ THE REVISION LOOP IS NOT A STEP. A salesperson may regenerate the quotation
 *   any number of times while the deal sits at `quotation`; each generation
 *   mints an immutable row in fms_ocpi_quotation_versions. Modelling revisions
 *   as a step would put the same deal in a queue once per negotiation round and
 *   make "how many quotations are waiting?" unanswerable.
 *
 * ⚠ THE TWO FINANCE STEPS ARE A HANDOVER, NOT AN APPROVAL. Nobody judges
 *   anything: one person records that they handed the signed contract over, and
 *   somebody in Finance records that they have it. The database refuses to let
 *   one person do both — a handover with one name on both halves is a note to
 *   self.
 *
 * ⚠ Statuses are NOT step keys — closed / on_hold / cancelled / rework live in
 *   OcpiStatus (types/index.ts), never here.
 *
 * ⚠ The ARRAY ORDER is semantic — `createStepSlaModel` derives each step's
 *   default anchor from the position of the one before it. OCPI names an
 *   EXPLICIT anchor for every non-origin step (lib/sla.ts) precisely so that
 *   retiring a step cannot silently re-anchor its neighbours, but the order is
 *   still the chain and should be read as one.
 */
export type StepKey =
  | "quotation"
  | "quotation_approval"
  | "customer_signoff"
  | "management_signoff"
  | "finance_handover"
  | "finance_receipt"
  /** Retired at the stage-F cutover. Kept so historical deals stay readable. */
  | "order_confirmation"
  | "oc_approval";

/** One scope — a deal is one entity from first draft to Finance receipt. */
export type StepScope = "deal";

/**
 * OCPI's own extension of the shared step shape: the one-liner (OCPI-16).
 *
 * ⚠ IT IS DECLARED HERE, NOT ON `StepDefBase`. That interface documents itself as
 *   the contract the cross-FMS Control Center reads, and the Control Center has no
 *   use for this — it counts work, it does not brief anybody. Adding a field there
 *   would put it in front of nine other FMS modules that did not ask for it.
 *
 * ⚠ OPTIONAL, AND MOST STEPS HAVE NONE. "Approve Quotation" and "Finance Receipt"
 *   already say what they are; a line under them would be filler. Every renderer
 *   must therefore show NOTHING AT ALL when it is absent — not an empty paragraph
 *   that leaves a gap under four of the six headings.
 */
export type StepDef = StepDefBase<StepKey, StepScope> & {
  /** One line saying what the person who opens this step actually does. */
  blurb?: string;
};

/**
 * ⚠ THE NAME LIVES HERE AND NOWHERE ELSE (OCPI-16). Until 02-09 the two signature
 *   steps were named in three places that had already drifted apart — `title` here,
 *   a second hardcoded list in `OcpiStepper.tsx`, and a third, differently-worded
 *   `<h1>` on each queue page. The stepper now reads this array and the two queue
 *   headings read `title`, so a rename is one edit again.
 *
 * ⚠ `short` IS WIDTH-CONSTRAINED. It captions a stage-rail circle and a Dashboard
 *   KPI tile, both of which truncate to one line. "Cust Copy" / "Mgmt Copy" are
 *   sized to the "Cust Sign" / "Mgmt Sign" they replaced; do not lengthen them.
 */
export const STEPS: StepDef[] = [
  { key: "quotation",          index: 1, title: "Quotation",                 short: "Quotation", scope: "deal", noQueue: true },
  { key: "quotation_approval", index: 2, title: "Approve Quotation",         short: "Qtn Appr",  scope: "deal" },
  /*
    Named after the ACTION, not after a person signing: by the time a deal reaches
    either of these steps the signature already exists on paper, and the work is
    getting the scan onto the record.

    ⚠ THE MANAGEMENT LINE STOPS AT THE UPLOAD. Step 5 is "Hand Over to Finance",
      immediately after it — describing that handover here would leave a reader
      asking why the process has both. Settled with Ritesh Bhai on 01-09-2026,
      knowing step 5 exists.
  */
  { key: "customer_signoff",   index: 3, title: "Upload Customer Signed Copy",   short: "Cust Copy", scope: "deal",
    blurb: "Upload the scanned copy the customer has signed." },
  { key: "management_signoff", index: 4, title: "Upload Management Signed Copy", short: "Mgmt Copy", scope: "deal",
    blurb: "Upload the copy signed by management." },
  { key: "finance_handover",   index: 5, title: "Hand Over to Finance",      short: "To Finance", scope: "deal" },
  { key: "finance_receipt",    index: 6, title: "Finance Receipt",           short: "Fin Recd",  scope: "deal" },
  // ── Retired at the stage-F cutover. Nothing new arrives here. ─────────────
  { key: "order_confirmation", index: 7, title: "Order Confirmation (retired)",         short: "OC (old)",      scope: "deal", retired: true },
  { key: "oc_approval",        index: 8, title: "Approve Order Confirmation (retired)", short: "OC Appr (old)", scope: "deal", retired: true },
];

export const stepByKey = (key: string): StepDef | undefined => STEPS.find((s) => s.key === key);

/** The steps a deal raised today actually travels. */
export const LIVE_STEPS: StepDef[] = STEPS.filter((s) => !s.retired);

/** The two the cutover left behind. Exported so consumers can name them once. */
export const RETIRED_STEPS: StepKey[] = STEPS.filter((s) => s.retired).map((s) => s.key);

export const isRetiredStep = (key: string): boolean => RETIRED_STEPS.includes(key as StepKey);

/**
 * Coarse bands for the cross-FMS scoreboard, where eight rows is more detail
 * than a director reading ten modules wants. Every queue step appears in exactly
 * one — including the retired pair, which still holds deals raised before the
 * cutover. A step named by no stage would land in a trailing "Other" band, which
 * reads as a bug rather than as history.
 */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Quotation", keys: ["quotation_approval"] },
  { label: "Signatures", keys: ["customer_signoff", "management_signoff"] },
  { label: "Finance", keys: ["finance_handover", "finance_receipt"] },
  { label: "Order Confirmation (retired)", keys: ["order_confirmation", "oc_approval"] },
];

/**
 * Step keys an admin may assign owners to — every LIVE step including the origin.
 *
 * Following Order to Dispatch, `quotation` MAY be owned: with no owners on it,
 * any user holding an edit grant may raise a deal; set owners and only they
 * (plus admins and coordinators) may. The database says the same thing in
 * fms_ocpi_can_act, which is the boundary — this list only drives the Settings
 * screen.
 *
 * ⚠ THE RETIRED STEPS ARE NOT OWNABLE. Naming an owner for a step nothing can
 *   reach would be asking somebody to watch an empty queue.
 */
export const OWNER_STEPS: StepKey[] = LIVE_STEPS.map((s) => s.key);
