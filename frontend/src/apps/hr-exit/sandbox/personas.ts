import type { Persona } from "@/shared/sandbox/SandboxContext";
import { STEPS } from "../lib/steps";
import { useExitStore } from "../store";

export type { Persona };

/**
 * The demo cast — derived ENTIRELY from live data. No hard-coded user ids: the switcher
 * shows exactly who Setup and the Masters page have actually wired up, so a demo can
 * never point at somebody who owns nothing.
 *
 * Four sources, in this order (first label wins; a person appears once):
 *
 *  1. ⭐ STEP OWNERS — one persona per workflow step, labelled by the earliest step they
 *     own. This is HR's whole cast, and here it is only the first third of it.
 *
 *  2. ⭐⭐ CLEARANCE-ROW OWNERS — the IT person, the Admin, the Travel Desk. They own NO
 *     WORKFLOW STEP AT ALL: they own one row of a checklist. They are the entire reason
 *     each outstanding check is its own queue entry, and a cast built from step owners
 *     alone — the way HR's is — would leave the most interesting person in this app
 *     unimpersonable. Read off the live master, so a 9th department added on the Masters
 *     page becomes demoable without touching this file.
 *
 *  3. ⭐⭐⭐ REPORTING MANAGERS on the cases we can see. The three MANAGER steps
 *     (manager_review, asset_return, handover) route PER CASE to
 *     `reporting_manager_ids` — there is no global owner row to read them off, so
 *     without this clause the manager steps would be undemoable no matter who the seed
 *     picked. (The demo seed also names cases whose managers are in the cast; this is
 *     the belt to that braces, and it keeps working on REAL cases too.)
 *
 *  4. The process coordinator — the "sees everything" view.
 *
 * Only personas whose profile resolves are returned.
 */
export function usePersonas(): Persona[] {
  const s = useExitStore();
  const out: Persona[] = [];
  const seen = new Set<string>();

  const push = (id: string | undefined | null, stepLabel: string) => {
    if (!id || seen.has(id)) return;
    const p = s.profileById(id);
    if (!p) return;
    seen.add(id);
    out.push({ id, name: p.name, stepLabel });
  };

  // 1 · the workflow step owners, labelled by the earliest step they own.
  for (const step of STEPS) {
    const ownerId = s.stepOwnerFor(step.key)?.employeeIds[0];
    if (ownerId) push(ownerId, step.title);
  }

  // 2 · the clearance-row owners — the people who own no step at all.
  for (const item of s.activeClearanceItems) {
    // `ownerIsReportingManager` rows route per case; they are covered by (3).
    if (item.ownerIsReportingManager) continue;
    for (const ownerId of item.ownerIds) push(ownerId, `${item.departmentLabel} clearance`);
  }

  // 3 · the per-case reporting managers — the only route into the MANAGER steps.
  for (const c of s.cases) {
    for (const mgrId of c.reportingManagerIds) push(mgrId, "Reporting manager");
  }

  // 4 · the coordinator.
  push(s.processCoordinatorIds[0], "Coordinator / Admin");

  return out;
}
