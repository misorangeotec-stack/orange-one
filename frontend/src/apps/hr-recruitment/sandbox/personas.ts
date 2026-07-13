import type { Persona } from "@/shared/sandbox/SandboxContext";
import { STEPS } from "../lib/steps";
import { useHrStore } from "../store";

export type { Persona };

/**
 * The demo cast, derived entirely from the seeded step owners — no hard-coded ids.
 * One persona per workflow step, plus a Coordinator/Admin persona. Only personas
 * whose profile resolves are returned, so the switcher shows exactly who Setup has
 * wired up.
 *
 * The HOD steps are skipped here on purpose: they have no global owner (they route
 * to whoever raised the MRF), so the person who owns `mrf` already covers them.
 */
export function usePersonas(): Persona[] {
  const s = useHrStore();
  const out: Persona[] = [];
  const seen = new Set<string>();

  const push = (id: string | undefined | null, stepLabel: string) => {
    if (!id) return;
    const p = s.profileById(id);
    if (!p) return;
    out.push({ id, name: p.name, stepLabel });
  };

  for (const step of STEPS) {
    const ownerId = s.stepOwnerFor(step.key)?.employeeIds[0];
    // One row per person, labelled by the earliest step they own.
    if (ownerId && !seen.has(ownerId)) {
      seen.add(ownerId);
      push(ownerId, step.title);
    }
  }

  const coordinator = s.processCoordinatorIds[0];
  if (coordinator && !seen.has(coordinator)) push(coordinator, "Coordinator / Admin");

  return out;
}
