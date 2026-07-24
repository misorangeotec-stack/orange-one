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

/**
 * The paths, in order. Both inward branches start at collect and diverge at the
 * handover receipt.
 *
 * INWARD_LEGACY_FLOW is for rows raised BEFORE the lab gate existed — they started
 * at receive_sample and still run the old testing → result → handover tail. Nothing
 * routes into it any more; it exists so a legacy row still renders sanely.
 */
const INWARD_LEGACY_FLOW: FlowNode[] = [
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
/** Inward WITH lab testing: collect → to the lab → lab process → result received. */
const INWARD_LAB_FLOW: FlowNode[] = [
  { key: "request", label: "Request" },
  { key: "sample_collect", label: "Collect & Handover" },
  { key: "sample_to_lab", label: "Received & Sent to Lab" },
  { key: "lab_process", label: "Lab Process" },
  { key: "result_received", label: "Result Received" },
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
  // A legacy row is one that entered at receive_sample; it keeps the old rail.
  const isLegacyInward = request.status === "awaiting_receipt" || !!request.receivedAt;
  const flow =
    request.direction === "outward"
      ? OUTWARD_FLOW
      : isLegacyInward
        ? INWARD_LEGACY_FLOW
        : request.labTestingRequired === false
          ? INWARD_NO_LAB_FLOW
          : INWARD_LAB_FLOW;

  const nodes: PoStageRailNode[] = useMemo(
    () =>
      flow.map((n) => {
        if (n.key === "request" || n.key === "closed") {
          return { key: n.key, label: n.label, departments: [], people: [], hasStep: false };
        }
        const owner = s.stepOwnerFor(n.key);
        // Several steps are owned, for THIS request, by a person chosen on the
        // request rather than by the step's global owners: the collector collects,
        // the hand-over recipient receives (and sends to the lab), and whoever the
        // lab handed the result to confirms it.
        const perRequestName =
          (n.key === "receive_sample" || n.key === "sample_collect") && request.collectorId
            ? s.personName(request.collectorId)
            : n.key === "sample_received" || n.key === "sample_to_lab"
              ? request.handoverRecipientId
                ? s.personName(request.handoverRecipientId)
                : request.handoverRecipientName
              : n.key === "result_received"
                ? request.labResultToId
                  ? s.personName(request.labResultToId)
                  : request.labResultToName
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
    [flow, s, request.collectorId, request.handoverRecipientId, request.handoverRecipientName,
     request.labResultToId, request.labResultToName],
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
