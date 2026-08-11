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
  /*
    A cancellation waiting on its sales return has `current_step = 'sales_return'`,
    which is not on this rail — and must not be, since the rail is the six-step
    chain. Left to `findIndex` it returns -1, floors to 1, and the rail would
    light up Credit as the live step on an order nobody is working.

    Gate Out is always where it stopped: an order can only reach this state from
    `awaiting_gate_out`, because cancelling is refused once `go_at` is stamped.
    The chip beside the rail says the rest.
  */
  if (o.status === "awaiting_sales_return") {
    return STAGES.findIndex((st) => st.key === "gate_out");
  }
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

  /*
    Step ownership is per site, so the captions below mean nothing without saying
    which site they describe. `masterName` answers "—" for an id it cannot
    resolve, which would caption a node "No owner for —"; an em dash is not a
    place, so it is normalised back to empty.
  */
  const rawSite = order.locationId ? s.masterName("company_location", order.locationId) : "";
  const siteName = rawSite === "—" ? "" : rawSite;

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
      /*
        ⚠ THE LOCATION IS THE POINT. This used to call `stepOwnerFor(st.step)`,
        whose default asks for the ALL-LOCATIONS FALLBACK row rather than "any
        location" — so every step owned per site captioned as "Unassigned" while
        Setup showed it fully staffed. `stepOwnerCovering` is the display lookup:
        the site's own row, else the fallback.
      */
      const owner = s.stepOwnerCovering(st.step, order.locationId);
      // A site-specific set is worth naming — "these two, at Vapi". The fallback
      // covers everywhere, so saying where would be noise.
      const ownSite = !!owner && owner.locationId !== null;
      /*
        An order with NO site (a company nobody has added locations to) resolves
        to nothing under a per-site setup. It is not owned by nobody — it is
        owned by whoever owns the step, so name them rather than printing
        "Unassigned" on a rail that is in fact staffed. Names only: there is no
        single department to attribute it to.
      */
      const orphan = !owner && !order.locationId;
      const people = orphan
        ? s.ownerNamesFor(st.step)
        : (owner?.employeeIds ?? [])
            // personName, not a directory lookup: the directory is RLS-scoped, so a
            // cross-department owner would render blank.
            .map((id) => s.personName(id))
            .filter((n) => n !== "—" && n !== "Unknown user");

      return {
        key: st.key,
        label: st.label,
        departments: orphan
          ? []
          : (owner?.departmentIds ?? []).map(deptName).filter((n): n is string => !!n),
        people,
        hasStep: true,
        // Says WHICH site these names cover, and names the gap when none do —
        // "Unassigned" alone reads as a global hole rather than a per-site one.
        note: ownSite ? siteName : !people.length && siteName ? `No owner for ${siteName}` : undefined,
      };
    });
  }, [s, order.requesterName, order.locationId, siteName]);

  /*
    ⚠ ONLY A ROUND THAT WAS GATED OUT HAS "GONE OUT". `order.rounds` is every
    ARCHIVED round, and cancelling an order archives its live round too
    (`archived_reason = 'cancelled'`) — a round that never left the premises. So
    counting the array told a cancelled order it "has already gone out 1 time,
    the rail restarts for the balance", directly beside a rail saying it was
    cancelled and an items table showing nothing dispatched. `goAt` is the fact.
  */
  const goneOut = order.rounds.filter((r) => r.goAt != null).length;
  const rounds = goneOut + (order.status === "closed" || order.status === "cancelled" ? 0 : 1);
  const multi = goneOut > 0;
  const awaitingReturn = order.status === "awaiting_sales_return";
  /*
    A dead order's rail shows where it STOPPED. Painting that node orange — the
    colour every other screen uses for "this is the live step, somebody owns it"
    — put SO-2627-0097 on Gate Out in the same breath as its Cancelled pill.
  */
  const stopped = order.status === "cancelled" || awaitingReturn;

  return (
    <div className="space-y-3">
      {/*
        Whose site these captions describe. Once, beside the rail — not on each
        node, because one order dispatches from one place and repeating it seven
        times is noise.
      */}
      {siteName && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="rounded-full bg-[#F1F4F9] px-2.5 py-0.5 font-semibold text-grey">
            {siteName}
          </span>
          <span className="text-grey-2">owners shown are the ones covering this site</span>
        </div>
      )}
      {/*
        On a loop-back the rail walks BACKWARDS — from Delivered to Stock — which
        is correct but reads as a bug without saying why. The chip is rendered
        beside the rail rather than inside PoStageRail: that component is shared
        with five other FMS apps, and none of them has rounds.
      */}
      {multi && !awaitingReturn && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="rounded-full bg-orange/10 px-2.5 py-0.5 font-semibold text-orange">
            Round {order.roundNo}
          </span>
          <span className="text-grey-2">
            {order.status === "closed"
              ? `delivered over ${rounds} consignment${rounds === 1 ? "" : "s"}`
              : `this order has already gone out ${goneOut} time${goneOut === 1 ? "" : "s"} — the rail restarts for the balance`}
          </span>
        </div>
      )}
      {/*
        Replaces the round chip rather than joining it: "the rail restarts for the
        balance" is false here — there is no balance, the order is being cancelled
        — and the rail is showing where it STOPPED, not where the work is.
      */}
      {awaitingReturn && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="rounded-full bg-ryg-red/10 px-2.5 py-0.5 font-semibold text-ryg-red">
            Cancellation pending
          </span>
          <span className="text-grey-2">
            the rail shows where this order stopped — it is cancelled once the sales bill is unwound
          </span>
        </div>
      )}
      <PoStageRail
        nodes={nodes}
        activeIndex={activeIndex(order)}
        finished={order.status === "closed"}
        stopped={stopped}
        fit={fit}
      />
    </div>
  );
}
