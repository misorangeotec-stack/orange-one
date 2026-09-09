import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useComplaintStore } from "../store";
import { openStep } from "../lib/queues";
import { dmy } from "../lib/format";
import type { StepKey } from "../lib/steps";
import type { ComplaintRequest } from "../types";

/**
 * Where ONE complaint has got to — the numbered rail across the top of its
 * detail page.
 *
 * ⚠ THIS IS THE SAME `PoStageRail` THE PURCHASE FMS USES, not a lookalike. The
 *   user asked for the Purchase rail by pointing at it, and six other FMS already
 *   render through this component; a second implementation would drift from it
 *   the first time the shared one is touched. This file is only the adapter —
 *   it picks the path, resolves owner ids to names, and says which node is live.
 *
 * ⚠ NOT `StepPipeline`. That is a COUNT rail — how much work sits at each step
 *   across every complaint. On a single record those numbers mean nothing.
 */

/** A rail node's backing step. `closed` is a terminus with no workflow step. */
type FlowKey = StepKey | "closed";

const FLOW: { key: FlowKey; label: string }[] = [
  { key: "raise", label: "Raised" },
  { key: "plant", label: "Plant Action" },
  { key: "service", label: "Service Team" },
  { key: "approval", label: "Approval" },
  { key: "management_review", label: "Management Review" },
  { key: "closed", label: "Closed" },
];

export default function ComplaintStepper({ r }: { r: ComplaintRequest }) {
  const s = useComplaintStore();

  /** When each step actually completed. The rail captions the node with it. */
  const doneAt: Record<string, string | null> = {
    raise: r.submittedAt,
    plant: r.plantAt,
    // Service is complete only once it has CLOSED the complaint; its first pass
    // hands off to approval and the complaint comes back to the same desk.
    service: r.svcCloseAt,
    approval: r.aprAt,
    management_review: r.mgmtAt,
    closed: r.closedAt,
  };

  /** Whoever actually did the step, once they have — better than its owners. */
  const actorOf = (key: FlowKey): string | null => {
    if (key === "raise") return r.requesterName;
    const by =
      key === "plant" ? r.plantBy
      : key === "service" ? (r.svcCloseBy ?? r.svcBy)
      : key === "approval" ? r.aprBy
      : key === "management_review" ? r.mgmtBy
      : null;
    return by ? s.personName(by) : null;
  };

  /**
   * ⚠ APPROVAL IS DROPPED FROM THE RAIL, not greyed out, when the service team
   *   answered "no commercial call". It was shown as a "Not required" stub at
   *   first; the user asked for it gone, and they are right — on this chain the
   *   No branch is the ordinary path, so a permanent grey stub on most
   *   complaints is noise, not information. The approval that DID happen is
   *   never hidden: the guard keeps the node the moment `aprAt` is stamped.
   *
   * The whole rail is measured against this array — nodes AND activeIndex — so
   * dropping a node here cannot shift the active one out from under it.
   */
  const flow = useMemo(
    () =>
      FLOW.filter(
        (n) =>
          n.key !== "approval" ||
          r.approvalRequired ||
          !!r.aprAt ||
          r.svcCommercialCall !== false,
      ),
    [r.approvalRequired, r.aprAt, r.svcCommercialCall],
  );

  const nodes: PoStageRailNode[] = useMemo(
    () =>
      flow.map((n) => {
        if (n.key === "closed") {
          return {
            key: n.key,
            label: n.label,
            departments: [],
            people: [],
            hasStep: false,
            note: r.closedAt ? dmy(r.closedAt) : undefined,
          };
        }

        const owner = s.stepOwners.find((o) => o.stepKey === n.key);
        const actor = actorOf(n.key);
        const people = actor
          ? [actor]
          : (owner?.employeeIds ?? []).map((id) => s.personName(id)).filter((nm) => nm !== "—");

        return {
          key: n.key,
          label: n.label,
          departments: (owner?.departmentIds ?? [])
            .map((id) => s.orgDepartments.find((d) => d.id === id)?.name)
            .filter((nm): nm is string => !!nm),
          people,
          hasStep: true,
          note: doneAt[n.key] ? dmy(doneAt[n.key]!) : undefined,
        };
      }),
    [flow, s, r],
  );

  const finished = r.status === "closed";
  const stopped = r.status === "cancelled";

  const activeIndex = useMemo(() => {
    if (finished) return flow.length - 1; // sit on Closed, ticked
    const key = openStep(r);
    const i = key ? flow.findIndex((n) => n.key === key) : -1;
    // A live complaint has always passed Raised (index 0); unknown → the plant.
    return i < 1 ? 1 : i;
  }, [flow, r, finished]);

  // fit: the complaint detail is a single column, so the nodes share the width
  // evenly instead of scrolling.
  return (
    <div className="rounded-xl border border-line bg-white px-4 py-3">
      <PoStageRail nodes={nodes} activeIndex={activeIndex} finished={finished} stopped={stopped} fit />
    </div>
  );
}
