import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useDispatchStore } from "../store";
import type { StepKey } from "../lib/steps";
import type { DispatchOrder } from "../types";

/**
 * The order lifecycle stages, in order, for the detail stepper — the origin
 * (Received), the six workflow steps, and the terminal Closed node. `step` is the
 * workflow step_key whose owners caption the node; null nodes (Received / Closed)
 * have no step owners.
 *
 * ⚠ PoStageRail prints `i + 1` in each pending circle, so THIS ORDER IS THE
 *   USER-VISIBLE STEP NUMBERING. It must line up 1:1 with STEPS[].index, which is
 *   what Setup → Step Owners and Setup → Due Dates also show. A rail that numbers
 *   a step differently from Setup is the exact mismatch the Import FMS had to fix.
 */
const STAGES: { key: string; label: string; step: StepKey | null }[] = [
  { key: "received", label: "Received", step: null },
  { key: "credit_check", label: "Credit", step: "credit_check" },
  { key: "material_status", label: "Stock", step: "material_status" },
  { key: "lot_confirm", label: "LOT & Qty", step: "lot_confirm" },
  { key: "sales_bill", label: "Sales Bill", step: "sales_bill" },
  { key: "gate_out", label: "Gate Out", step: "gate_out" },
  { key: "dispatch_confirm", label: "Delivered", step: "dispatch_confirm" },
  { key: "closed", label: "Closed", step: null },
];

/**
 * Which node the order is sitting on. A closed order sits on (and finishes) the
 * final node; every other status sits on its current step. Received (index 0) is
 * always complete for a live order, so the floor is 1.
 */
function activeIndex(o: DispatchOrder): number {
  if (o.status === "closed") return STAGES.length - 1;
  const i = STAGES.findIndex((st) => st.step === o.currentStep);
  return i < 1 ? 1 : i;
}

/**
 * Horizontal lifecycle rail for a sales order — the same rail the Purchase,
 * Import and Production FMS use, captioned with the department and people
 * responsible for each step. This is the ADAPTER: it resolves step-owner ids to
 * names; the rendering lives in the shared PoStageRail.
 */
export default function DispatchStepper({ order, fit }: { order: DispatchOrder; fit?: boolean }) {
  const s = useDispatchStore();

  const nodes: PoStageRailNode[] = useMemo(() => {
    const deptName = (id: string) => s.orgDepartments.find((d) => d.id === id)?.name;
    return STAGES.map((st) => {
      // Received has no step owner — caption it with whoever raised the order.
      if (st.key === "received") {
        return {
          key: st.key,
          label: st.label,
          departments: [],
          people: [order.requesterName].filter(Boolean),
          hasStep: true,
        };
      }
      if (!st.step) {
        return { key: st.key, label: st.label, departments: [], people: [], hasStep: false };
      }
      const owner = s.stepOwnerFor(st.step);
      return {
        key: st.key,
        label: st.label,
        departments: (owner?.departmentIds ?? []).map(deptName).filter((n): n is string => !!n),
        // personName, not a directory lookup: the directory is RLS-scoped, so a
        // cross-department owner would render blank.
        people: (owner?.employeeIds ?? []).map((id) => s.personName(id)).filter((n) => n !== "—" && n !== "Unknown user"),
        hasStep: true,
      };
    });
  }, [s, order.requesterName]);

  return <PoStageRail nodes={nodes} activeIndex={activeIndex(order)} finished={order.status === "closed"} fit={fit} />;
}
