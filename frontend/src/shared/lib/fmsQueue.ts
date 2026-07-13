/**
 * The two shapes every FMS module and the cross-FMS Control Center agree on.
 *
 * These live in `shared/` rather than in one app because the Control Center rolls
 * up *every* FMS: importing `QueueEntry` from `apps/procurement` made the scoreboard
 * depend on one specific FMS, which stops working the moment there are two.
 *
 * Each FMS extends these with its own domain fields (Purchase adds `companyId` and
 * an order value; HR adds a department and a candidate). The Control Center reads
 * only the fields declared here, so it never needs to know which FMS it is counting.
 */

/** One step in an FMS's canonical, ordered workflow. */
export interface StepDefBase<K extends string = string, S extends string = string> {
  key: K;
  /**
   * 1-based display index — used for ordering and the `#` columns. Nothing persists it.
   * (Note: the SLA anchor rules key off ARRAY POSITION, not this number, so renumbering
   * is cosmetic but re-ordering the array is not.)
   */
  index: number;
  title: string;
  /** Short label — column headers, chips, the Control Center breakdown. */
  short: string;
  /** Which entity this step acts on (Purchase: request|po. HR: requisition|candidate|hire). */
  scope: S;
  /**
   * This step can never hold a work-item — it is a structural anchor, not a queue
   * (Purchase's `request`, HR's `mrf`).
   *
   * It exists so consumers can tell "this step CANNOT hold work" apart from "this step
   * happens to be empty right now". The cross-FMS scoreboard used to infer the former
   * from the latter — dropping any step with zero entries — so a real step with a
   * momentarily empty queue silently vanished from the breakdown, and a coordinator
   * could not distinguish "nothing stuck here" from "this step doesn't exist".
   */
  noQueue?: true;
}

/** One open work-item sitting at one step: the atom every queue and the board render. */
export interface QueueEntryBase<K extends string = string> {
  stepKey: K;
  entityId: string;
  /** Human reference — request no., PO no., MRF no., candidate name. */
  ref: string;
  /** Local yyyy-mm-dd. `null` = deliberately untimed (it can never be late). */
  dueIso: string | null;
}
