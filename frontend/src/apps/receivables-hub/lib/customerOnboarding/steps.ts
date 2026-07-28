/**
 * Customer Creation FMS — the canonical, ordered workflow.
 *
 * FIVE workflow steps, not nine. The source document numbers nine "steps", but
 * steps 1–7 are seven SECTIONS of one form filled by one person in one sitting —
 * they are a single hand-off (`submission`), rendered as a seven-pane wizard.
 * A step in the FMS sense is a change of hands, and there are five of those:
 *
 *   Sales fills 1-7 → Accounts verify → Sales Head grades → Director (if the
 *   credit limit is large) → someone records the Tally ledger.
 *
 * ⚠ `submission` is NOT marked noQueue, unlike the origin step in every other
 *   FMS module. A request bounced back for rework genuinely sits there, owed by
 *   the raiser, and must appear in a queue — otherwise reworked customers go
 *   quietly missing. See queues.ts.
 */
import type { StepDefBase } from "@/shared/lib/fmsQueue";

export type StepKey =
  | "submission"
  | "accounts_verification"
  | "sales_head_approval"
  | "director_approval"
  | "tally_creation";

/** Only one entity in this module, unlike Purchase's request|po split. */
export type StepScope = "request";

export type StepDef = StepDefBase<StepKey, StepScope>;

/**
 * ⚠ The SLA anchor rules key off ARRAY POSITION, not `index`. Renumbering is
 *   cosmetic; re-ordering this array is not.
 */
export const STEPS: StepDef[] = [
  {
    key: "submission",
    index: 1,
    title: "Customer details submitted",
    short: "Submission",
    scope: "request",
  },
  {
    key: "accounts_verification",
    index: 2,
    title: "Accounts verification",
    short: "Accounts",
    scope: "request",
  },
  {
    key: "sales_head_approval",
    index: 3,
    title: "Sales head approval",
    short: "Sales Head",
    scope: "request",
  },
  {
    key: "director_approval",
    index: 4,
    title: "Director approval",
    short: "Director",
    scope: "request",
  },
  {
    key: "tally_creation",
    index: 5,
    title: "Customer created in Tally",
    short: "Tally",
    scope: "request",
  },
];

export const stepByKey = (key: StepKey): StepDef | undefined =>
  STEPS.find((s) => s.key === key);

export const stepTitle = (key: string): string =>
  STEPS.find((s) => s.key === key)?.title ?? key;

export const stepShort = (key: string): string =>
  STEPS.find((s) => s.key === key)?.short ?? key;

/** The four steps that have owners and a work queue. `submission` is the raiser's. */
export const OWNED_STEPS: StepKey[] = [
  "accounts_verification",
  "sales_head_approval",
  "director_approval",
  "tally_creation",
];

/** Coarser grouping for the stage rail and the dashboard pipeline. */
export const STAGES: { label: string; keys: StepKey[] }[] = [
  { label: "Sales",    keys: ["submission"] },
  { label: "Approval", keys: ["accounts_verification", "sales_head_approval", "director_approval"] },
  { label: "Creation", keys: ["tally_creation"] },
];

/**
 * The seven form sections. This is the wizard's spine — the "steps" a user sees.
 * Deliberately separate from STEPS above: these are panes, those are hand-offs.
 */
export const FORM_STEPS: { index: number; key: string; title: string; blurb: string }[] = [
  { index: 1, key: "customer",  title: "Customer Information", blurb: "Who they are and what kind of business they run." },
  { index: 2, key: "kyc",       title: "Business & KYC",       blurb: "GST number fills in the PAN and state automatically." },
  { index: 3, key: "contact",   title: "Contact Information",  blurb: "The person we will actually deal with." },
  { index: 4, key: "ink",       title: "Ink Business Profile", blurb: "What they print and what they use today. All optional." },
  { index: 5, key: "potential", title: "Business Potential",   blurb: "Rough numbers are fine. All optional." },
  { index: 6, key: "refs",      title: "Trade References",     blurb: "One reference is required; a second helps credit approval." },
  { index: 7, key: "credit",    title: "Credit Request",       blurb: "Advance or credit, and what they are asking for." },
];

/** The read-only recap pane that follows step 7. */
export const REVIEW_STEP_INDEX = 8;
