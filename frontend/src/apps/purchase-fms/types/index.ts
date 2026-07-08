/**
 * Purchase FMS domain types (Phase 1, mock).
 *
 * Purchase FMS is the first FMS workflow; the shapes here are intentionally
 * generic (a workflow = an ordered list of stages; each stage carries a planned
 * date, an actual date, a status, and a free-form `values` payload keyed by field
 * key) so future FMS modules reuse them unchanged. The Phase-2 Supabase engine
 * (`fms_workflows` / `fms_workflow_steps` / `fms_step_fields` / `fms_entries` /
 * `fms_entry_stages`) mirrors these.
 */

/** Per-stage lifecycle. `done` = completed, `active` = the current owner's turn. */
export type StageStatus = "pending" | "active" | "done";

/** Field input kinds a stage can capture. */
export type FieldType = "text" | "number" | "textarea" | "date" | "select" | "file";

/** One captured field in a stage's data-entry form. */
export interface StageFieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Options for `type: "select"`. */
  options?: string[];
  placeholder?: string;
  /** Render hint: half-width on wider screens (so two fields share a row). */
  half?: boolean;
  /** Accept filter for `type: "file"` (e.g. "application/pdf"). */
  accept?: string;
}

/** Static definition of one workflow stage (see config/stages.ts). */
export interface StageDef {
  key: string;
  /** 1-based position in the pipeline. */
  index: number;
  /** Short node label (used in the stepper). */
  short: string;
  title: string;
  /** "What" — what happens in this stage. */
  what: string;
  /** "How" — how it's done (from the sheet). */
  how: string;
  /** "When" — planned-date rule, displayed (engine lands in Phase 3). */
  when: string;
  /** Owner key → resolved against the step-owner map. */
  ownerKey: string;
  /** Default owner display name(s) from the source sheet. */
  defaultOwner: string;
  /** Fields captured at this stage. */
  fields: StageFieldDef[];
  /** Stage 1 (Generate Order) is created via the New Order form, not editable inline. */
  isOrigin?: boolean;
}

/** Live state of one stage on a specific entry. */
export interface StageState {
  key: string;
  status: StageStatus;
  /** Planned date (yyyy-mm-dd) — when this stage should be actioned. */
  plannedDate: string | null;
  /** Actual completion date/time (ISO) — stamped when the owner completes it. */
  actualDate: string | null;
  /** Captured field values, keyed by StageFieldDef.key. */
  values: Record<string, string | number | null>;
}

/** A running purchase entry moving through the 9-stage pipeline. */
export interface PurchaseEntry {
  id: string;
  /** Human code, e.g. "PO-1042". */
  code: string;
  createdAt: string;
  /** Stage-1 header fields, denormalised for easy listing. */
  category: string;
  itemName: string;
  quantity: number;
  unit: string;
  remarks: string;
  /** One state per StageDef, in pipeline order. */
  stages: StageState[];
  /** 0-based index of the active stage; === stages.length when fully complete. */
  currentIndex: number;
}

/** Master: a purchase category and the unit it drives. */
export interface Category {
  id: string;
  name: string;
  unit: string;
}

/** Master: a job designation. */
export interface Designation {
  id: string;
  name: string;
}

/** One-off setup row: who owns a given workflow step. */
export interface StepOwner {
  stepKey: string;
  departmentId: string | null;
  designationId: string | null;
  /** Directory profile ids assigned to this step (the notified owners). */
  employeeIds: string[];
  /** Display fallback when an id isn't in the live directory (seeded from the sheet). */
  employeeNames: string[];
}
