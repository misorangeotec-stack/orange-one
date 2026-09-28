import { useMemo } from "react";
import PoStageRail, { type PoStageRailNode } from "@/shared/components/ui/PoStageRail";
import { useComplaintStore } from "../store";
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ A RAIL NODE IS NOT A STEP KEY. A node carries its OWN key plus `ownerKey` —
 *   the step whose Setup owners it should name while nobody has acted yet —
 *   because the two are not the same thing: `closed` is a node with no step at
 *   all, and a node's LABEL is per-complaint (the assignee node is captioned with
 *   the person's name). Keeping them separate is also what let the management
 *   split (lib/steps.ts) change the steps without touching this rail's shape.
 *
 * ⚠ AND THE PATH ITSELF DIFFERS PER COMPLAINT, which is the point of the branch:
 *   a raw-material complaint never sees the plant or the service team, and a
 *   finished-good one never sees Purchase. `pathFor` picks the whole chain from
 *   the row rather than drawing every node and greying most of them out — the
 *   lesson the approval node already taught here (see its note below).
 * ─────────────────────────────────────────────────────────────────────────────
 */

interface FlowNode {
  /** Unique within one rail. NOT a StepKey — see the header. */
  key: string;
  label: string;
  /** Whose Setup owners to name before anyone has acted. Absent on `closed`. */
  ownerKey?: StepKey;
}

const RAISE: FlowNode = { key: "raise", label: "Raised" };
const CLOSED: FlowNode = { key: "closed", label: "Closed" };

/** Finished goods — the original chain, unchanged. */
const FG_FLOW: FlowNode[] = [
  RAISE,
  { key: "plant", label: "Plant Action", ownerKey: "plant" },
  { key: "service", label: "Service Team", ownerKey: "service" },
  { key: "approval", label: "Approval", ownerKey: "approval" },
  { key: "management_review", label: "Management Review", ownerKey: "management_review" },
  CLOSED,
];

/** Where every imported-material complaint lands. Its own step — see lib/steps.ts. */
const RM_MANAGEMENT: FlowNode = {
  key: "rm_management",
  label: "RM-Complaint View (MGT)",
  ownerKey: "rm_management",
};

/**
 * The chain THIS complaint runs. Read the row, not the module.
 *
 * ⚠ THE IMPORT PATH GROWS TWO NODES THE MOMENT MANAGEMENT REASSIGN IT, and that
 *   is deliberate: until they do, "Assigned" and a second "Management Review"
 *   describe a future that most imported complaints never have — management
 *   answer them and close. Drawing them anyway would put two permanently grey
 *   stubs on the common path, which is exactly the noise the approval node was
 *   removed for.
 */
/*
 * Exported for the routing audit. The rail's shape is the one thing on this page
 * that silently disagreed with the status pill once — a raw-material row with no
 * `rmOrigin` drew the purchase chain while its pill read "With the plant" — and a
 * mismatch like that is invisible to a type checker. Both are pure functions of
 * the row, so they are worth being able to assert on directly.
 */
export function pathFor(r: ComplaintRequest): FlowNode[] {
  if (r.complaintType === "finished_good") {
    /**
     * ⚠ APPROVAL IS DROPPED FROM THE RAIL, not greyed out, when the service team
     *   answered "no commercial call". It was shown as a "Not required" stub at
     *   first; the user asked for it gone, and they are right — on this chain the
     *   No branch is the ordinary path, so a permanent grey stub on most
     *   complaints is noise, not information. The approval that DID happen is
     *   never hidden: the guard keeps the node the moment `aprAt` is stamped.
     */
    return FG_FLOW.filter(
      (n) =>
        n.key !== "approval" ||
        r.approvalRequired ||
        !!r.aprAt ||
        r.svcCommercialCall !== false,
    );
  }

  if (r.rmOrigin === "import") {
    // Handed to somebody: they answer, then management review and close.
    if (r.rmAssignedAt) {
      return [
        RAISE,
        RM_MANAGEMENT,
        { key: "assignee", label: r.rmAssigneeName ?? "Assigned", ownerKey: "assignee" },
        { key: "management_review", label: "Management Review", ownerKey: "management_review" },
        CLOSED,
      ];
    }
    // Management deal with it themselves.
    return [RAISE, RM_MANAGEMENT, CLOSED];
  }

  /**
   * Domestic.
   *
   * ⚠ AND THE FALLBACK FOR A ROW WITH NO `rmOrigin` AT ALL — a raw-material
   *   complaint raised before the branch existed. Such a row is still sitting on
   *   the FINISHED-GOOD chain (it was raised into `awaiting_plant`), so drawing
   *   it a purchase rail would describe a journey it is not on: the rail would
   *   say "Purchase Department" while the status pill says "With the plant".
   *   That mismatch is exactly what a null `rmOrigin` looks like on screen, so
   *   hand those rows the FG rail, which is the chain they are actually running.
   */
  if (!r.rmOrigin) return FG_FLOW;

  return [
    RAISE,
    { key: "purchase", label: "Purchase Department", ownerKey: "purchase" },
    { key: "management_review", label: "Management Review", ownerKey: "management_review" },
    CLOSED,
  ];
}

/**
 * The rail node this complaint is SITTING ON, by status.
 *
 * Deliberately not `openStep` — that answers in STEP keys, and `management_review`
 * is two different nodes here. Same switch, one extra arm.
 */
export function liveNodeKey(r: ComplaintRequest): string | null {
  switch (r.status) {
    case "awaiting_plant":
      return "plant";
    case "awaiting_service":
    case "awaiting_service_close":
      return "service";
    case "awaiting_approval":
      return "approval";
    case "awaiting_purchase":
      return "purchase";
    case "awaiting_rm_management":
      return "rm_management";
    case "awaiting_assignee":
      return "assignee";
    case "awaiting_management_review":
      return "management_review";
    default:
      return null;
  }
}

export default function ComplaintStepper({ r }: { r: ComplaintRequest }) {
  const s = useComplaintStore();

  /** When each node actually completed. The rail captions the node with it. */
  const doneAt: Record<string, string | null> = {
    raise: r.submittedAt,
    plant: r.plantAt,
    // Service is complete only once it has CLOSED the complaint; its first pass
    // hands off to approval and the complaint comes back to the same desk.
    service: r.svcCloseAt,
    approval: r.aprAt,
    purchase: r.purAt,
    // The first management pass ends EITHER by assigning it on or by closing it,
    // so it is done when either happened.
    rm_management: r.rmAssignedAt ?? r.mgmtAt,
    assignee: r.asgAt,
    management_review: r.mgmtAt,
    closed: r.closedAt,
  };

  /** Whoever actually did the step, once they have — better than its owners. */
  const actorOf = (key: string): string | null => {
    if (key === "raise") return r.requesterName;
    if (key === "assignee") return r.rmAssigneeName ?? (r.asgBy ? s.personName(r.asgBy) : null);
    const by =
      key === "plant" ? r.plantBy
      : key === "service" ? (r.svcCloseBy ?? r.svcBy)
      : key === "approval" ? r.aprBy
      : key === "purchase" ? r.purBy
      : key === "rm_management" ? (r.rmAssignedBy ?? r.mgmtBy)
      : key === "management_review" ? r.mgmtBy
      : null;
    return by ? s.personName(by) : null;
  };

  const flow = useMemo(() => pathFor(r), [r]);

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

        const owner = n.ownerKey ? s.stepOwners.find((o) => o.stepKey === n.ownerKey) : undefined;
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
    const key = liveNodeKey(r);
    const i = key ? flow.findIndex((n) => n.key === key) : -1;
    // A live complaint has always passed Raised (index 0); unknown → the first
    // working node, whichever chain this is.
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
