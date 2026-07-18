/**
 * Step ownership for the FMS apps that route work by step alone.
 *
 * HR Recruitment, HR Exit and Office Supplies all answer "who owns this step?"
 * the same way — look up `fms_<domain>_step_owners` by `step_key` and read
 * `employee_ids`. That one rule lives here so the home screen's My Work list can
 * apply it without importing from any single app.
 *
 * Purchase and Import are NOT covered by this: both override the `approval` step
 * with a value-band matrix, so each keeps its own resolver in `lib/owners.ts`.
 *
 * A step owner list is a TEAM, not a person. Five owners on a step means the same
 * work-item is genuinely on five people's plates — callers that present this as
 * "my work" should say whether an item is personally or team-assigned rather than
 * silently implying sole ownership.
 */

/** The shape every `fms_*_step_owners` row shares once mapped. */
export interface StepOwnerRow {
  stepKey: string;
  employeeIds: string[];
}

export const stepOwnerIdsFor = (stepKey: string, owners: StepOwnerRow[]): string[] =>
  owners.find((o) => o.stepKey === stepKey)?.employeeIds ?? [];

export const isMineByStepOwners = (stepKey: string, userId: string, owners: StepOwnerRow[]): boolean =>
  stepOwnerIdsFor(stepKey, owners).includes(userId);
