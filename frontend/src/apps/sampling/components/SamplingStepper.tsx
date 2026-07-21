import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useSamplingStore } from "../store";
import { openStep } from "../lib/queues";
import type { StepKey } from "../lib/steps";
import type { SamplingRequest } from "../types";

/** A rail node's backing step ("request" and "closed" have none). */
type FlowKey = StepKey | "closed";
interface FlowNode {
  key: FlowKey;
  label: string;
}

/** The two paths, in order. They converge at `testing`. */
const INWARD_FLOW: FlowNode[] = [
  { key: "request", label: "Request" },
  { key: "receive_sample", label: "Sample Received" },
  { key: "testing", label: "Testing" },
  { key: "result", label: "Result" },
  { key: "result_handover", label: "Result Handover" },
  { key: "closed", label: "Closed" },
];
const OUTWARD_FLOW: FlowNode[] = [
  { key: "request", label: "Request" },
  { key: "send_sample", label: "Sample Sent" },
  { key: "confirm_receipt", label: "Receipt Confirmed" },
  { key: "testing", label: "Testing" },
  { key: "result", label: "Result" },
  { key: "result_handover", label: "Result Handover" },
  { key: "closed", label: "Closed" },
];

/**
 * Horizontal lifecycle stepper for a sampling request — the same rail the Purchase
 * Order detail uses, captioned with each step's owners (or, for the receive step,
 * the chosen collector). Rendering lives in the shared PoStageRail; this is the
 * adapter that picks the direction's path, resolves owners to names, and maps the
 * request's status to the active node.
 */
export default function SamplingStepper({ request }: { request: SamplingRequest }) {
  const s = useSamplingStore();
  const flow = request.direction === "inward" ? INWARD_FLOW : OUTWARD_FLOW;

  const nodes: PoStageRailNode[] = useMemo(
    () =>
      flow.map((n) => {
        if (n.key === "request" || n.key === "closed") {
          return { key: n.key, label: n.label, departments: [], people: [], hasStep: false };
        }
        const owner = s.stepOwnerFor(n.key);
        // The receive step is owned, for this request, by the chosen collector.
        const collectorName =
          n.key === "receive_sample" && request.collectorId ? s.personName(request.collectorId) : null;
        const people = collectorName
          ? [collectorName]
          : (owner?.employeeIds ?? []).map((id) => s.personName(id)).filter((nm) => nm !== "—");
        return {
          key: n.key,
          label: n.label,
          departments: (owner?.departmentIds ?? [])
            .map((id) => s.orgDepartments.find((d) => d.id === id)?.name)
            .filter((nm): nm is string => !!nm),
          people,
          hasStep: true,
        };
      }),
    [flow, s, request.collectorId],
  );

  const finished = request.status === "closed";
  const activeIndex = useMemo(() => {
    if (finished) return flow.length - 1; // sit on Closed, ticked
    const key = openStep(request) ?? (request.currentStep as FlowKey);
    const i = flow.findIndex((n) => n.key === key);
    // A live request has always passed Request (index 0); unknown → first real step.
    return i < 1 ? 1 : i;
  }, [flow, request, finished]);

  // fit: the sampling detail is a narrow column, so the nodes share the width
  // evenly instead of scrolling (unlike the full-width PO detail).
  return <PoStageRail nodes={nodes} activeIndex={activeIndex} finished={finished} fit />;
}
