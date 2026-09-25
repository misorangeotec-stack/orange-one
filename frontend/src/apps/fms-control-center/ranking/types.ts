/**
 * The contract every FMS fills in to take part in the monthly ranking (CC-1).
 *
 * ── What the ranking scores ───────────────────────────────────────────────────
 * FMS STEPS. Every step a person is given is worth one point: closed on time = 1,
 * closed late = ½, not closed = 0. Score = points ÷ steps given.
 *
 * ── Why a contract rather than a query ────────────────────────────────────────
 * No step's due date is stored anywhere. Each is computed in TypeScript by its own
 * module (anchor step's completion + that step's rule, as an IST date), and SQL
 * copies of those rules drifted from the screen three times for the morning mail.
 * So a module takes part by composing ITS OWN functions — its completed-entry
 * builders, its due-date function and My Work Today's ownership rule — and the
 * ranking never restates any of them.
 *
 * ── Pure ──────────────────────────────────────────────────────────────────────
 * Everything under `ranking/` is bundled into the `fms-ranking` edge function by
 * supabase/ranking/build.mjs. No React, no `window`, no `import.meta.env`: the
 * build refuses to finish if any of them reaches the import graph.
 */

/** How one scored step ended, for the person it is scored against. */
export type Outcome = "on_time" | "late" | "missed";

/**
 * Why a step the module reported counts for NOBODY. Reported per module on every
 * run, so "we dropped 34 of them" is a number rather than a silence.
 *
 *  untimed        the step has no due date (a Log Book entry, an Inward receipt)
 *  no_actor       the module recorded no one as having closed it
 *  no_time        the module recorded no real completion time for it
 *  test_record    a test or demo entity (`ZZ TEST`, a named dummy deal)
 *  held           the entity is on hold, so the step is nobody's work today
 *  excluded_step  a step type deliberately left out (see the scorer's comment)
 */
export type DropReason = "untimed" | "no_actor" | "no_time" | "test_record" | "held" | "excluded_step";

/** The fields every scored step carries, closed or open. */
export interface StepIdentity {
  /**
   * Stable and unique within the module. Includes the round for modules that loop
   * (Order to Dispatch), so round 2's sales bill is a different step from round 1's.
   */
  stepId: string;
  entityId: string;
  /** What a person reading the list recognises: an order no, a PO no, a name. */
  ref: string;
  stepKey: string;
  stepLabel: string;
  /** 0 for modules without rounds. */
  roundNo: number;
  /** IST yyyy-mm-dd, exactly as the module's own screen shows it; null = untimed. */
  dueIso: string | null;
  /** Set when this step counts for nobody. */
  drop?: DropReason;
}

/** A step the module says was closed. The closer gets the credit. */
export interface ClosedStep extends StepIdentity {
  actorId: string | null;
  /** The ORIGINAL completion timestamp — never an edit stamp. */
  doneAtIso: string;
}

/** A step still open. Charged to everyone whose My Work Today lists it. */
export type OpenStep = StepIdentity;

export interface ModuleScorer<D> {
  /** The FMS Control Center adapter key (adapters/registry.ts). The build guard matches on it. */
  key: string;
  /** Registry app id, for names and links. */
  appId: string;
  /** Load the module's whole dataset once, as its own fetcher does. */
  load: () => Promise<D>;
  /** Every step the module reports as closed, ever. The month filter is applied centrally. */
  closed: (data: D) => ClosedStep[];
  /**
   * The open steps My Work Today lists for `uid`, computed as for a NON-admin.
   *
   * ⚠ Always as a non-admin. With `isAdmin = true` every `items/` rule returns the
   *   whole book, and one admin would then be charged with everybody's backlog.
   */
  openFor: (data: D, uid: string) => OpenStep[];
}

/** A scorer's own data type is its business; the runner only ever passes it back. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyScorer = ModuleScorer<any>;
