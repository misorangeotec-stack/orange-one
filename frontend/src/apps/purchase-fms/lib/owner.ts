import type { Profile } from "@/core/platform/types";
import type { StepOwner } from "../types";

/**
 * Resolve a step's owner to display names: live directory profiles (by id) take
 * precedence; otherwise fall back to the seeded sheet names. The current user
 * "owns" a stage if they're an assigned employee (or an admin, handled by callers).
 */
export function ownerNames(owner: StepOwner | undefined, profileById: (id: string | null) => Profile | undefined): string[] {
  if (!owner) return [];
  const fromIds = owner.employeeIds.map((id) => profileById(id)?.name).filter((n): n is string => !!n);
  if (fromIds.length) return fromIds;
  return owner.employeeNames;
}

/** Single-line owner label, e.g. "Jyoti" or "Manisha Rane, Bharat Singh". */
export function ownerLabel(owner: StepOwner | undefined, profileById: (id: string | null) => Profile | undefined): string {
  const names = ownerNames(owner, profileById);
  return names.length ? names.join(", ") : "Unassigned";
}

/** Whether the given user id is an assigned owner of the step. */
export function isOwner(owner: StepOwner | undefined, userId: string): boolean {
  return !!owner && owner.employeeIds.includes(userId);
}
