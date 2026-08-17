import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useProductionStore } from "../store";
import { stepAppliesTo, type StepKey } from "../lib/steps";
import type { ProductionRequest } from "../types";

/**
 * The job-card lifecycle stages, in order, for the detail stepper — the origin
 * (Generated), the nine workflow steps, and the terminal Closed node. `step` is
 * the workflow step_key whose owners caption the node; null nodes (Generated /
 * Closed) have no step owners.
 */
const STAGES: { key: string; label: string; step: StepKey | null }[] = [
  { key: "generated", label: "Generated", step: null },
  { key: "material_handover", label: "Handover", step: "material_handover" },
  { key: "rm_transfer", label: "RM Transfer", step: "rm_transfer" },
  { key: "quality_check", label: "Quality", step: "quality_check" },
  { key: "transfer_slip", label: "Log Book", step: "transfer_slip" },
  { key: "production_entry", label: "Production", step: "production_entry" },
  { key: "mc_testing", label: "M/C Testing", step: "mc_testing" },
  { key: "pm_transfer", label: "PM Transfer", step: "pm_transfer" },
  { key: "packing_entry", label: "Packing", step: "packing_entry" },
  { key: "ready_to_dispatch", label: "Dispatch", step: "ready_to_dispatch" },
  { key: "fg_transfer", label: "FG Transfer", step: "fg_transfer" },
  { key: "closed", label: "Closed", step: null },
];

/**
 * The rail this card actually walks.
 *
 * A repackaging card never runs the six manufacturing steps, so they are DROPPED
 * from its rail rather than shown greyed — a traded FG has no handover or log
 * book to speak of, and six "Not required" nodes just crowd out the four that
 * matter. (Contrast the sampling rail, which keeps a skipped collect node
 * because there the step exists and was deliberately waived.)
 */
const flowFor = (r: ProductionRequest) =>
  STAGES.filter((st) => !st.step || stepAppliesTo(r.cardType, st.step));

/** Which node the card is sitting on, INDEXED INTO ITS OWN FLOW. A closed card
 *  sits on (and finishes) the final node; every other status sits on its current
 *  step. The additional-issue-slip branch is a QC-reject state — show it on the
 *  Quality node. Generated (index 0) is always complete for a live card, so the
 *  floor is 1. */
function activeIndex(r: ProductionRequest, flow: typeof STAGES): number {
  if (r.status === "closed") return flow.length - 1;
  const currentStep = r.currentStep === "additional_issue_slip" ? "quality_check" : r.currentStep;
  const i = flow.findIndex((st) => st.step === currentStep);
  return i < 1 ? 1 : i;
}

/**
 * Horizontal lifecycle stepper for a production job card — the same rail the
 * Purchase / Import FMS use for a PO, captioned with the department and people
 * responsible for each step. This is the adapter: it resolves step owner ids to
 * names; the rendering lives in the shared PoStageRail.
 */
export default function ProductionStepper({ request }: { request: ProductionRequest }) {
  const s = useProductionStore();

  const flow = useMemo(() => flowFor(request), [request.cardType]);

  const nodes: PoStageRailNode[] = useMemo(() => {
    const deptName = (id: string) => s.orgDepartments.find((d) => d.id === id)?.name;
    return flow.map((st) => {
      // Generated has no step owner — caption it with who raised the card.
      if (st.key === "generated") {
        return { key: st.key, label: st.label, departments: [], people: [request.requesterName].filter(Boolean), hasStep: true };
      }
      if (!st.step) {
        return { key: st.key, label: st.label, departments: [], people: [], hasStep: false };
      }
      const owner = s.stepOwnerFor(st.step);
      return {
        key: st.key,
        label: st.label,
        departments: (owner?.departmentIds ?? []).map(deptName).filter((n): n is string => !!n),
        // personName, not profileById: the directory is RLS-scoped, so a cross-
        // department owner would render blank via profileById.
        people: (owner?.employeeIds ?? []).map((id) => s.personName(id)).filter((n) => n !== "—" && n !== "Unknown user"),
        hasStep: true,
      };
    });
  }, [s, request.requesterName, flow]);

  return <PoStageRail nodes={nodes} activeIndex={activeIndex(request, flow)} finished={request.status === "closed"} />;
}
