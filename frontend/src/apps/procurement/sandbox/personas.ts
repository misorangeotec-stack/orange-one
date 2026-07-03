import { STEPS } from "../lib/steps";
import { useProcurementStore } from "../store";

export interface Persona {
  /** Directory profile id to impersonate. */
  id: string;
  /** Person's display name. */
  name: string;
  /** Their role in the workflow, e.g. "Approver", "Inward (GRN)". */
  stepLabel: string;
}

/**
 * The demo cast, derived entirely from the seeded config in the store — no
 * hard-coded ids. One persona per workflow step (resolved from step owners, or
 * the approval-matrix approver for the Approval step), plus a Coordinator/Admin
 * persona (the first process coordinator). Only personas whose profile resolves
 * are returned, so the switcher shows exactly who the demo seed wired up.
 */
export function usePersonas(): Persona[] {
  const s = useProcurementStore();
  const out: Persona[] = [];
  const seen = new Set<string>();

  const push = (id: string | undefined | null, stepLabel: string) => {
    if (!id) return;
    const p = s.profileById(id);
    if (!p) return;
    out.push({ id, name: p.name, stepLabel });
  };

  for (const step of STEPS) {
    const ownerId =
      step.key === "approval"
        ? // The first-tier approver (covers the lowest amounts) — the one who owns
          // the entry-level approval items; falls back to any band if none matches.
          s.approverForAmount(1) ?? s.approvalBands[0]?.approverUserId
        : s.stepOwnerFor(step.key)?.employeeIds[0];
    // Skip a step if its owner is a duplicate of one already listed (keeps the
    // switcher one-row-per-person while still labelling by the earliest step).
    if (ownerId && !seen.has(`${step.key}:${ownerId}`)) {
      seen.add(`${step.key}:${ownerId}`);
      push(ownerId, step.title);
    }
  }

  push(s.processCoordinatorIds[0], "Coordinator / Admin");
  return out;
}
