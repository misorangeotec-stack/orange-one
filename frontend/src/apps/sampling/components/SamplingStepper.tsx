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

/** The paths, in order. The lab paths converge at `testing`. */
const INWARD_FLOW: FlowNode[] = [
  { key: "request", label: "Request" },
  { key: "receive_sample", label: "Sample Received" },
  { key: "testing", label: "Testing" },
  { key: "result", label: "Result" },
  { key: "result_handover", label: "Result Handover" },
  { key: "closed", label: "Closed" },
];
/** Inward with NO lab testing: collect → hand over → received (close). */
const INWARD_NO_LAB_FLOW: FlowNode[] = [
  { key: "request", label: "Request" },
  { key: "sample_collect", label: "Collect & Handover" },
  { key: "sample_received", label: "Sample Received" },
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
  const flow =
    request.direction === "outward"
      ? OUTWARD_FLOW
      : request.labTestingRequired === false
        ? INWARD_NO_LAB_FLOW
        : INWARD_FLOW;

  const nodes: PoStageRailNode[] = useMemo(
    () =>
      flow.map((n) => {
        if (n.key === "request" || n.key === "closed") {
          return { key: n.key, label: n.label, departments: [], people: [], hasStep: false };
        }
        const owner = s.stepOwnerFor(n.key);
        // The receive/collect steps are owned, for this request, by the chosen
        // collector; the received step by the chosen recipient (or a free-text name).
        const perRequestName =
          (n.key === "receive_sample" || n.key === "sample_collect") && request.collectorId
            ? s.personName(request.collectorId)
            : n.key === "sample_received"
              ? request.handoverRecipientId
                ? s.personName(request.handoverRecipientId)
                : request.handoverRecipientName
              : null;
        const people = perRequestName
          ? [perRequestName]
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
    [flow, s, request.collectorId, request.handoverRecipientId, request.handoverRecipientName],
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
