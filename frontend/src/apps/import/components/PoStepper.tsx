import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useImportStore } from "../store";
import { stageStepKey } from "../lib/steps";
import type { PurchaseOrder } from "../types";

/** The PO lifecycle stages, in order, for the detail stepper. */
const STAGES = [
  { key: "generated", label: "Generated" },
  { key: "share_po", label: "Share PO" },
  { key: "collect_pi", label: "Collect PI" },
  { key: "advance_payment", label: "Advance" },
  { key: "follow_up", label: "Follow-up" },
  { key: "inward", label: "Inward" },
  { key: "tally", label: "Tally" },
  { key: "closed", label: "Closed" },
];

function activeIndex(po: PurchaseOrder): number {
  // Terminal stages sit at the final "Closed" node.
  if (po.currentStage === "closed" || po.currentStage === "cancelled") return STAGES.length - 1;
  const i = STAGES.findIndex((st) => st.key === po.currentStage);
  // The leading 'generated' node is always done for a live PO — the earliest
  // real stage is share_po (index 1). Unknown stages fall back to share_po.
  return i < 1 ? 1 : i;
}

/**
 * Horizontal lifecycle stepper for a PO, captioned with the department and
 * people responsible for each stage.
 *
 * This is the adapter: it maps stepper stages to workflow step_keys and
 * resolves owner ids to names. The rendering lives in the shared PoStageRail,
 * which the domestic Purchase FMS uses too.
 */
export default function PoStepper({ po }: { po: PurchaseOrder }) {
  const s = useImportStore();

  const nodes: PoStageRailNode[] = useMemo(
    () =>
      STAGES.map((st) => {
        const stepKey = stageStepKey(st.key);
        // `closed` has no backing step, so it has no owners to show.
        if (!stepKey) {
          return { key: st.key, label: st.label, departments: [], people: [], hasStep: false };
        }
        const owner = s.stepOwnerFor(stepKey);
        return {
          key: st.key,
          label: st.label,
          departments: (owner?.departmentIds ?? [])
            .map((id) => s.departmentById(id)?.name)
            .filter((n): n is string => !!n),
          // personName, NOT profileById: the directory is RLS-scoped to self +
          // downline + same-department peers, so profileById would render
          // cross-department owners blank. See store.tsx personName.
          people: (owner?.employeeIds ?? [])
            .map((id) => s.personName(id))
            .filter((n) => n !== "—"),
          hasStep: true,
        };
      }),
    [s]
  );

  return (
    <PoStageRail
      nodes={nodes}
      activeIndex={activeIndex(po)}
      // A 'closed' PO has finished its final stage — the last node is DONE
      // (green check), not in progress. (Cancelled stays highlighted, not ticked.)
      finished={po.currentStage === "closed"}
    />
  );
}
